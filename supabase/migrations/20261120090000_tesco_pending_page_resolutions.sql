-- Terminal resolution of HISTORICAL pending Tesco pages (owner request, 20 Nov 2026).
--
-- A pending page records a reservation whose outcome was never recorded (the
-- run died before finalise). It blocks its URL forever: the reserve RPC and the
-- Apify selector exclude a URL with a pending page of ANY age. This migration
-- adds a NARROW, AUDITABLE terminal disposition WITHOUT touching the page row:
--   * public.tesco_pending_page_resolutions: append-only ledger, one row per
--     resolved page, carrying the page's complete original row as an immutable
--     snapshot. UPDATE/DELETE are refused by trigger.
--   * tesco_internal.resolve_historical_pending_page(): the ONLY writer. It runs
--     only as the postgres SQL bridge (current_user = session_user = postgres),
--     resolves ONE explicitly named page, and only when the page is still
--     pending, at least 7 days old, matches the caller's expected URL and
--     creation time, and its run holds no live gate lease.
--   * apify_reserve_tesco_request: unchanged except that a RESOLVED pending page
--     no longer blocks its URL (the 24h attempt window is unchanged).
-- Nothing here writes a price or receipt, infers success, changes a mapping,
-- deletes evidence, releases budget or touches a lease/cooldown. The supervised
-- collector's held predicate is NOT changed: it still treats the URL as held.
-- Disposition 'abandoned_unknown_outcome' means "never retried, outcome
-- unknown"; it is not a success or a failure of the product.

create table if not exists public.tesco_pending_page_resolutions (
  page_id uuid primary key references public.tesco_direct_collection_pages(id) on delete restrict,
  run_id uuid not null,
  requested_url text not null,
  page_created_at timestamptz not null,
  page_snapshot jsonb not null check (jsonb_typeof(page_snapshot) = 'object'),
  disposition text not null check (disposition = 'abandoned_unknown_outcome'),
  reason text not null check (length(trim(reason)) >= 40),
  resolved_by text not null,
  resolved_at timestamptz not null default now()
);
comment on table public.tesco_pending_page_resolutions is
  'Append-only terminal dispositions for historical pending Tesco pages. The page row is never modified; page_snapshot is its full original row. Written only by tesco_internal.resolve_historical_pending_page (postgres SQL bridge).';

create or replace function public.prevent_tesco_pending_resolution_rewrite() returns trigger
language plpgsql as $$ begin raise exception 'pending_resolution_append_only'; end $$;
-- Supabase default privileges grant ALL on new public functions; remove them.
revoke all on function public.prevent_tesco_pending_resolution_rewrite() from public, anon, authenticated, service_role;
drop trigger if exists tesco_pending_resolution_immutable on public.tesco_pending_page_resolutions;
create trigger tesco_pending_resolution_immutable before update or delete on public.tesco_pending_page_resolutions
  for each row execute function public.prevent_tesco_pending_resolution_rewrite();
drop trigger if exists tesco_pending_resolution_no_truncate on public.tesco_pending_page_resolutions;
create trigger tesco_pending_resolution_no_truncate before truncate on public.tesco_pending_page_resolutions
  for each statement execute function public.prevent_tesco_pending_resolution_rewrite();

alter table public.tesco_pending_page_resolutions enable row level security;
revoke all on public.tesco_pending_page_resolutions from public, anon, authenticated, service_role;
grant select on public.tesco_pending_page_resolutions to service_role;

create schema if not exists tesco_internal;
revoke all on schema tesco_internal from public, anon, authenticated, service_role;

create or replace function tesco_internal.resolve_historical_pending_page(
  p_page_id uuid, p_expected_requested_url text, p_expected_created_at timestamptz, p_reason text
) returns uuid
language plpgsql security invoker set search_path = '' set lock_timeout = '10s'
as $function$
declare
  v_page public.tesco_direct_collection_pages%rowtype;
  v_supervisor text;
  v_status text;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'tesco_sql_bridge_identity_required';
  end if;
  if p_page_id is null or p_expected_requested_url is null or p_expected_created_at is null
    or p_reason is null or length(trim(p_reason)) < 40
  then raise exception 'explicit_page_and_reason_required'; end if;

  -- Serialise with every collector: take the gate rows first, then the page.
  perform 1 from public.tesco_egress_pool order by egress_key for update;
  select * into v_page from public.tesco_direct_collection_pages where id = p_page_id for update;
  if not found then raise exception 'pending_page_not_found'; end if;
  if v_page.outcome is distinct from 'pending' then raise exception 'page_not_pending'; end if;
  if v_page.requested_url is distinct from p_expected_requested_url
    or v_page.created_at is distinct from p_expected_created_at
  then raise exception 'pending_page_expectation_changed'; end if;
  if v_page.created_at > now() - interval '7 days' then raise exception 'pending_page_not_historical'; end if;
  if exists (select 1 from public.tesco_egress_pool g
    where g.lease_run_id = v_page.run_id and g.leased_until > now())
  then raise exception 'pending_page_run_holds_live_lease'; end if;
  -- error_summary is text: an unreadable value fails closed with a clear reason.
  begin
    select r.status, nullif(coalesce(nullif(r.error_summary, ''), '{}')::jsonb->>'activeSupervisor', '')
      into v_status, v_supervisor from public.scrape_runs r where r.id = v_page.run_id;
  exception when others then raise exception 'pending_page_run_state_unreadable';
  end;
  if v_status = 'running' and v_supervisor is not null
  then raise exception 'pending_page_run_has_active_supervisor'; end if;

  insert into public.tesco_pending_page_resolutions
    (page_id, run_id, requested_url, page_created_at, page_snapshot, disposition, reason, resolved_by)
  values (v_page.id, v_page.run_id, v_page.requested_url, v_page.created_at, to_jsonb(v_page),
    'abandoned_unknown_outcome', trim(p_reason), session_user);
  return v_page.id;
end;
$function$;
revoke all on function tesco_internal.resolve_historical_pending_page(uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;
comment on function tesco_internal.resolve_historical_pending_page(uuid, text, timestamptz, text) is
  'Records ONE append-only terminal disposition for an explicitly named historical (>=7 days) pending Tesco page. postgres SQL bridge only. Never modifies the page, never writes a price.';

-- Reserve: identical to 20261113090000 except a RESOLVED pending page no longer blocks.
create or replace function public.apify_reserve_tesco_request(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_store_url text, p_mode text, p_expected_snapshot jsonb,
  p_approval_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_observed_at timestamptz;
  v_snapshot jsonb;
  v_proven boolean;
  v_approval record;
  v_run_mode text;
  v_purpose text := null;
  v_target_sku text;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object'
  then raise exception 'expected_snapshot_required'; end if;
  if p_mode not in ('renewal', 'expansion', 'evidence') then raise exception 'mode_must_be_renewal_or_expansion'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;
  -- An evidence run reserves ONLY evidence requests, and vice versa.
  select error_summary::jsonb->>'mode' into v_run_mode from public.scrape_runs where id = p_run_id;
  if (coalesce(v_run_mode, '') = 'evidence') <> (p_mode = 'evidence') then raise exception 'run_mode_mismatch'; end if;

  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_resolved_or_unproven'; end if;

  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;

  v_proven := exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success');
  select l.observed_at into v_observed_at from public.latest_prices l
    where l.store_product_id = p_store_product_id and l.store = 'tesco';

  if p_mode = 'evidence' then
    if v_observed_at is not null then raise exception 'already_observed'; end if;
    if jsonb_array_length(coalesce(v_snapshot->'same_sku_canonical_names', '[]'::jsonb)) > 1
    then raise exception 'shared_sku_requires_review'; end if;
    if p_store_url is not distinct from (v_snapshot->>'store_url') then
      if v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || (v_snapshot->>'store_sku')
      then raise exception 'mapping_not_resolved_or_unproven'; end if;
      if v_snapshot->>'url_status' = 'failed' then
        -- Repair-activation evidence: a mapping STAGED by the supervised repair
        -- (url_status failed at the target URL) needs a current source fetched
        -- after staging. Activation itself stays postgres-bridge-only.
        v_purpose := 'repair_activation';
      elsif v_snapshot->>'url_status' = 'resolved' then
        -- First-price evidence: unproven only (proven mappings use expansion).
        if v_proven then raise exception 'evidence_mode_unproven_only'; end if;
        v_purpose := 'first_price';
      else raise exception 'mapping_not_resolved_or_unproven'; end if;
    else
      -- Repair-target evidence: a canonical product URL for a SKU no Tesco
      -- mapping owns. Records evidence ONLY; it changes no mapping.
      v_target_sku := substring(p_store_url from '^https://www\.tesco\.ie/shop/en-IE/products/([0-9]{6,12})$');
      if v_target_sku is null then raise exception 'repair_target_url_invalid'; end if;
      if coalesce(v_snapshot->>'url_status', '') not in ('resolved', 'failed') then raise exception 'mapping_not_resolved_or_unproven'; end if;
      if exists (select 1 from public.store_products x where x.store = 'tesco' and x.store_sku = v_target_sku)
      then raise exception 'repair_target_owned'; end if;
      v_purpose := 'repair_target';
    end if;
  else
    if v_snapshot->>'url_status' <> 'resolved'
      or v_snapshot->>'store_url' <> p_store_url
      or v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || (v_snapshot->>'store_sku')
      or (not v_proven and (p_mode <> 'expansion' or p_approval_id is null))
    then raise exception 'mapping_not_resolved_or_unproven'; end if;

    if not v_proven then
      select * into v_approval from public.tesco_first_price_approvals
        where id = p_approval_id and store_product_id = p_store_product_id
          and consumed_at is null and revoked_at is null and expires_at > now();
      if v_approval.id is null then raise exception 'first_price_approval_invalid'; end if;
      if v_approval.mapping_snapshot is distinct from v_snapshot
      then raise exception 'first_price_approval_snapshot_changed'; end if;
    end if;

    if p_mode = 'renewal' then
      if v_observed_at is null or v_observed_at > now() - interval '4 days'
      then raise exception 'not_due_or_observation_changed'; end if;
    else
      if v_observed_at is not null then raise exception 'already_observed'; end if;
    end if;
  end if;

  if exists (select 1 from public.tesco_direct_collection_pages d
    where d.requested_url = p_store_url
    and ((d.outcome = 'pending' and not exists (select 1 from public.tesco_pending_page_resolutions z where z.page_id = d.id))
      or d.created_at > now() - interval '24 hours'))
  then raise exception 'attempt_already_recorded'; end if;
  if exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
    and last_success_at > now() - interval '10 seconds')
  then raise exception 'pacing_not_elapsed'; end if;

  insert into public.tesco_direct_collection_pages
    (run_id, egress_key, requested_url, store_product_id, mapping_snapshot, mode, outcome, detail)
  values (p_run_id, p_egress_key, p_store_url, p_store_product_id, v_snapshot, 'products', 'pending',
    jsonb_build_object('provider', 'apify', 'firstPrice', (not v_proven) and p_mode = 'expansion',
      'evidenceOnly', p_mode = 'evidence', 'purpose', v_purpose)::text);
  return jsonb_build_object('reserved', true, 'snapshot', v_snapshot,
    'firstPrice', (not v_proven) and p_mode = 'expansion', 'purpose', v_purpose);
end;
$$;
revoke all on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, uuid) to service_role;
