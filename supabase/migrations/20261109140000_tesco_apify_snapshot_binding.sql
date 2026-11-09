-- Tesco Apify — bind selection/reservation/assessment/finalisation to ONE
-- snapshot (supersedes reserve + finalise from 20261109090000; none applied).
--
-- Reproduced TOCTOU (independent review):
--   • Collector SELECTS mapping A while its canonical product is rice, and
--     ASSESSES the rice evidence in TypeScript.
--   • Before reservation, mapping A's product_id is changed to an eggs canonical.
--   • Reservation captured the NEW (eggs) snapshot; finalise compared the page's
--     (eggs) snapshot with the current (eggs) mapping → MATCH → it wrote a price
--     for the eggs canonical using rice evidence.
--
-- Root cause: the snapshot the TypeScript assessed was never bound to what the
-- server captured/finalised. Fixes:
--   1. reserve now takes p_expected_snapshot (the snapshot the collector
--      SELECTED + ASSESSED against). It locks the mapping + canonical rows,
--      recomputes the snapshot, and REJECTS (expected_snapshot_changed) if the
--      current snapshot differs from the caller's expected one. It returns the
--      authoritative snapshot so the collector can bind assessment to it.
--   2. finalise locks the mapping (FOR UPDATE) and canonical (FOR SHARE) rows
--      for the whole compare+write, recomputes the snapshot under those locks,
--      and requires it to equal BOTH the page's stored snapshot AND (re-asserted)
--      the identity — so nothing can change the mapping between the comparison
--      and the write.

-- reserve: expected-snapshot binding + row locks. Returns the bound snapshot.
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text);
create function public.apify_reserve_tesco_request(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_store_url text, p_mode text, p_expected_snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_observed_at timestamptz;
  v_snapshot jsonb;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object'
  then raise exception 'expected_snapshot_required'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;

  -- Lock the mapping + its canonical row so the snapshot cannot change between
  -- this comparison and the pending insert.
  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_resolved_or_unproven'; end if;

  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  -- The mapping the collector SELECTED + ASSESSED must be the mapping NOW. A
  -- product_id / sku / url / brand / gtin / canonical change (e.g. rice→eggs)
  -- fails here, so collection never proceeds on stale evidence.
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;
  if v_snapshot->>'url_status' <> 'resolved'
    or v_snapshot->>'store_url' <> p_store_url
    or v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || (v_snapshot->>'store_sku')
    or not exists (select 1 from public.scrape_product_receipts r
      where r.store_product_id = p_store_product_id and r.outcome = 'success')
  then raise exception 'mapping_not_resolved_or_unproven'; end if;

  select l.observed_at into v_observed_at from public.latest_prices l
    where l.store_product_id = p_store_product_id and l.store = 'tesco';
  if p_mode = 'renewal' then
    if v_observed_at is null or v_observed_at > now() - interval '4 days'
    then raise exception 'not_due_or_observation_changed'; end if;
  elsif p_mode = 'expansion' then
    if v_observed_at is not null then raise exception 'already_observed'; end if;
  else raise exception 'mode_must_be_renewal_or_expansion'; end if;

  if exists (select 1 from public.tesco_direct_collection_pages d
    where d.requested_url = p_store_url
    and (d.outcome = 'pending' or d.created_at > now() - interval '24 hours'))
  then raise exception 'attempt_already_recorded'; end if;
  if exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
    and last_success_at > now() - interval '10 seconds')
  then raise exception 'pacing_not_elapsed'; end if;

  insert into public.tesco_direct_collection_pages
    (run_id, egress_key, requested_url, store_product_id, mapping_snapshot, mode, outcome, detail)
  values (p_run_id, p_egress_key, p_store_url, p_store_product_id, v_snapshot, 'products', 'pending',
    jsonb_build_object('provider', 'apify')::text);
  -- Return the authoritative snapshot the collector must bind its assessment to.
  return jsonb_build_object('reserved', true, 'snapshot', v_snapshot);
end;
$$;

-- finalise: lock mapping + canonical rows across the compare AND the write.
drop function if exists public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text);
create function public.apify_finalise_tesco_page(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_mode text,
  p_regular_price numeric, p_previous_price numeric, p_store_product_name text,
  -- The snapshot the collector ASSESSED against (returned by reserve). Must
  -- equal both the page's stored snapshot AND the current locked mapping.
  p_assessed_snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_finalised boolean := false;
  v_page record;
  v_now_snapshot jsonb;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_regular_price is null or p_regular_price <= 0 then raise exception 'positive_regular_price_required'; end if;
  if p_assessed_snapshot is null or jsonb_typeof(p_assessed_snapshot) <> 'object'
  then raise exception 'assessed_snapshot_required'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;

  -- Lock the mapping + canonical rows for the whole compare+write window.
  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_found'; end if;

  -- Find the recorded ok page BY MAPPING within this run (never a caller URL).
  select id, requested_url, store_product_id, mapping_snapshot into v_page
    from public.tesco_direct_collection_pages
    where run_id = p_run_id and store_product_id = p_store_product_id and outcome = 'ok'
    for update;
  if v_page.id is null then raise exception 'no_recorded_ok_page_for_mapping'; end if;

  -- Triple binding under lock: current mapping == page snapshot == assessed
  -- snapshot. Any divergence (incl. a product_id change) refuses the write.
  v_now_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_now_snapshot is null
    or v_now_snapshot is distinct from v_page.mapping_snapshot
    or v_now_snapshot is distinct from p_assessed_snapshot
  then raise exception 'mapping_snapshot_changed'; end if;

  if p_mode = 'renewal' then
    if not exists (select 1 from public.latest_prices
      where store_product_id = p_store_product_id and store = 'tesco'
      and observed_at <= now() - interval '4 days') then raise exception 'observation_changed'; end if;
  elsif p_mode = 'expansion' then
    if exists (select 1 from public.latest_prices where store_product_id = p_store_product_id and store = 'tesco')
    then raise exception 'already_observed'; end if;
  else raise exception 'mode_must_be_renewal_or_expansion'; end if;

  -- Pass NULL for store_url/sku/name so the finaliser's coalesce() preserves
  -- the EXISTING store_products row verbatim — it must not mutate any field that
  -- is part of the bound mapping_snapshot (url/sku/name), which would otherwise
  -- make a subsequent snapshot comparison diverge. The renewal only writes a
  -- price_observation; the mapping metadata is already bound+verified.
  v_finalised := public.finalize_store_scrape_product(
    p_run_uuid => p_run_id, p_store => 'tesco', p_store_product_id => p_store_product_id,
    p_success => true, p_price => p_regular_price, p_previous_price => p_previous_price,
    p_store_url => null, p_store_sku => null, p_store_product_name => null,
    p_fetched => 1, p_extracted => 1);

  update public.tesco_egress_pool set last_success_at = now(), updated_at = now()
    where egress_key = p_egress_key and lease_token = p_lease_token;
  update public.scrape_runs
    set error_summary = (error_summary::jsonb || jsonb_build_object('heartbeatAt', now()))::text
    where id = p_run_id;
  return jsonb_build_object('finalised', v_finalised);
end;
$$;

revoke all on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb) to service_role;

comment on function public.apify_finalise_tesco_page is
  'ONLY price-write path. Fencing-token + owner guarded; locks mapping+canonical rows; requires current snapshot == page snapshot == assessed snapshot; receipt idempotency + positive price via finalize_store_scrape_product.';

-- ---------------------------------------------------------------------------
-- Durable campaign budget reservations (corrects count×estimate enforcement).
-- Before each provider launch we RESERVE a bounded amount; the reservation is
-- counted against the $cap immediately and RETAINED while the request is
-- running/uncertain/unsettled, then reconciled to the ACTUAL charge on settle.
-- So a crash/restart/delayed-billing leaves the reservation in place and the
-- cap still holds. The provider-side cap for a launch is the remaining balance.
-- ---------------------------------------------------------------------------
create table if not exists public.tesco_apify_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  run_id uuid,
  state text not null default 'reserved' check (state in ('reserved', 'settled', 'released')),
  reserved_usd numeric not null check (reserved_usd >= 0),
  actual_usd numeric,
  provider_run_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.tesco_apify_budget_reservations enable row level security;
revoke all on public.tesco_apify_budget_reservations from public, anon, authenticated;
grant select, insert, update on public.tesco_apify_budget_reservations to service_role;
create index if not exists tesco_apify_budget_campaign_idx
  on public.tesco_apify_budget_reservations (campaign, state);

-- Committed spend for a campaign = settled ACTUALS + still-outstanding
-- reservations (reserved, not yet settled/released). This is what the cap
-- is checked against.
create or replace function public.apify_campaign_committed_usd(p_campaign text)
returns numeric language sql stable security definer set search_path = public
as $$
  select coalesce(sum(case when state = 'settled' then coalesce(actual_usd, reserved_usd)
                           when state = 'reserved' then reserved_usd
                           else 0 end), 0)
  from public.tesco_apify_budget_reservations where campaign = p_campaign;
$$;
revoke all on function public.apify_campaign_committed_usd(text) from public, anon, authenticated;
grant execute on function public.apify_campaign_committed_usd(text) to service_role;

-- Reserve p_amount against p_cap. Atomic (serialises on an advisory lock keyed
-- to the campaign) so concurrent workers cannot both slip past the cap. Returns
-- the reservation id + the remaining balance AFTER this reservation, or raises
-- budget_exhausted if it would exceed the cap.
create or replace function public.apify_reserve_budget(
  p_campaign text, p_run_id uuid, p_amount numeric, p_cap numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_committed numeric;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'reserve_amount_positive_required'; end if;
  if p_cap is null or p_cap <= 0 then raise exception 'cap_required'; end if;
  -- Serialise budget decisions for this campaign.
  perform pg_advisory_xact_lock(hashtext('apify_budget:' || p_campaign));
  v_committed := public.apify_campaign_committed_usd(p_campaign);
  if v_committed + p_amount > p_cap then
    raise exception 'budget_exhausted: committed=% + amount=% > cap=%', v_committed, p_amount, p_cap;
  end if;
  insert into public.tesco_apify_budget_reservations (campaign, run_id, state, reserved_usd)
    values (p_campaign, p_run_id, 'reserved', p_amount) returning id into v_id;
  return jsonb_build_object('reservationId', v_id, 'committedUsd', v_committed + p_amount,
    'remainingUsd', p_cap - (v_committed + p_amount));
end;
$$;
revoke all on function public.apify_reserve_budget(text, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.apify_reserve_budget(text, uuid, numeric, numeric) to service_role;

-- Settle a reservation to its ACTUAL charge (from provider reconciliation).
-- Idempotent: settling an already-settled row is a no-op. A reservation that is
-- never settled (crash/uncertain) stays 'reserved' and keeps counting.
create or replace function public.apify_settle_budget(
  p_reservation_id uuid, p_actual_usd numeric, p_provider_run_id text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_actual_usd is null or p_actual_usd < 0 then raise exception 'actual_usd_required'; end if;
  update public.tesco_apify_budget_reservations
    set state = 'settled', actual_usd = p_actual_usd, provider_run_id = p_provider_run_id, settled_at = now()
    where id = p_reservation_id and state = 'reserved';
end;
$$;
revoke all on function public.apify_settle_budget(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.apify_settle_budget(uuid, numeric, text) to service_role;

-- Link an OUTSTANDING reservation to the provider run it launched, WITHOUT
-- settling it. Used when the per-fetch completion charge is unknown/preliminary
-- so a later terminal reconciliation can settle THIS reservation to the
-- confirmed charge. Keeps the reservation 'reserved' (still counts).
create or replace function public.apify_link_reservation_run(
  p_reservation_id uuid, p_provider_run_id text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.tesco_apify_budget_reservations
    set provider_run_id = p_provider_run_id
    where id = p_reservation_id and state = 'reserved';
end;
$$;
revoke all on function public.apify_link_reservation_run(uuid, text) from public, anon, authenticated;
grant execute on function public.apify_link_reservation_run(uuid, text) to service_role;

-- Terminal reconciliation (between batches, not per fetch): settle an
-- OUTSTANDING reservation to its CONFIRMED terminal charge once known. The
-- caller supplies the confirmed usageTotalUsd it read from the provider's
-- finished run (reconcileCampaignSpendUsd / a terminal run GET). Only settles a
-- 'reserved' row and only with a non-null confirmed charge — never a 0/estimate.
create or replace function public.apify_reconcile_reservation(
  p_reservation_id uuid, p_confirmed_usd numeric
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_confirmed_usd is null or p_confirmed_usd < 0 then raise exception 'confirmed_usd_required'; end if;
  update public.tesco_apify_budget_reservations
    set state = 'settled', actual_usd = p_confirmed_usd, settled_at = now()
    where id = p_reservation_id and state = 'reserved';
  return found;
end;
$$;
revoke all on function public.apify_reconcile_reservation(uuid, numeric) from public, anon, authenticated;
grant execute on function public.apify_reconcile_reservation(uuid, numeric) to service_role;
