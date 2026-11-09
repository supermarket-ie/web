-- Tesco Apify unattended collection — SECURITY CORRECTION (supersedes the RPCs
-- in 20261108200000, which has NOT been applied to production).
--
-- Reproduced vulnerability (independent review):
--   1. Worker A begins run, records an OK page for mapping A.
--   2. A's lease expires; worker B begins a successor run.
--   3. A calls finalise with ITS original run/owner + recorded URL but a
--      DIFFERENT mapping B with an old observation → it succeeded, wrote a price
--      for B and overwrote B's URL.
--   4. A closed its run and cleared B's lease.
--
-- Root causes fixed here:
--   • The gate lease was only a timestamp; "ownership" was a JSON string in the
--     caller's OWN run row, so a superseded worker still matched itself. →
--     Add a FENCING TOKEN (lease_token + lease_run_id) on the gate; begin mints
--     a new token and binds it to exactly one run; EVERY RPC (reserve/record/
--     finalise/close) requires the caller's token to equal the gate's current
--     token. A superseded worker's token is stale → all its calls fail,
--     including close (so it cannot clear the successor's lease).
--   • The page was keyed only by URL and the mapping id was a separate caller
--     arg, so finalise could pass the recorded URL with a different mapping. →
--     BIND each page to its store_product_id + an immutable mapping_snapshot at
--     reservation; finalise looks the page up by (run_id, store_product_id) and
--     rechecks the snapshot atomically before writing.
--   • The legacy p_accept=true finalise path inside apify_record_tesco_page is
--     REMOVED; recording never writes a price.
--
-- Unapplied-migration note: 20261108200000 defines these objects; this file
-- ALTERs the tables and CREATE OR REPLACEs the functions with signatures that
-- add p_lease_token. Both must be applied in order (108200000 then 109090000).

-- 1. Fencing token on the gate. lease_token identifies the CURRENT holder;
--    lease_run_id ties it to exactly one run. Nullable (no active lease = null).
alter table public.tesco_egress_pool
  add column if not exists lease_token uuid,
  add column if not exists lease_run_id uuid;

-- 2. Bind each page to its exact mapping + an immutable canonical snapshot.
alter table public.tesco_direct_collection_pages
  add column if not exists store_product_id uuid references public.store_products(id) on delete cascade,
  add column if not exists mapping_snapshot jsonb;

-- Canonical mapping snapshot used for binding (material identity only: the
-- store↔canonical association + sku/url/brand/gtin + canonical identity). Price
-- and observation are deliberately excluded — they change between reservation
-- and finalise; the binding is about WHICH product this page is for.
create or replace function public.apify_mapping_snapshot(p_store_product_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'store_product_id', s.id, 'product_id', s.product_id, 'store_sku', s.store_sku,
    'store_url', s.store_url, 'url_status', s.url_status, 'store_brand', s.brand,
    'gtin', s.gtin, 'canonical_name', p.canonical_name, 'canonical_brand', p.brand,
    'canonical_ean', (to_jsonb(p)->>'ean'))
  from public.store_products s join public.products p on p.id = s.product_id
  where s.id = p_store_product_id and s.store = 'tesco';
$$;
revoke all on function public.apify_mapping_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.apify_mapping_snapshot(uuid) to service_role;

-- A reusable guard: assert the caller's token is the gate's CURRENT live lease
-- for THIS run. Raises on any mismatch. Caller must already hold the row lock.
create or replace function public.apify_assert_lease(p_egress_key text, p_run_id uuid, p_lease_token uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.tesco_egress_pool
    where egress_key = p_egress_key
      and lease_token = p_lease_token and lease_run_id = p_run_id
      and leased_until > now() and coalesce(cooldown_until, now()) <= now())
  then raise exception 'lease_lost_or_superseded'; end if;
end;
$$;
revoke all on function public.apify_assert_lease(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.apify_assert_lease(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- begin: mint a NEW fencing token, bind it to this run, claim the gate.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_begin_tesco_run(text, text, integer, text);
create function public.apify_begin_tesco_run(
  p_egress_key text, p_mode text, p_target_count integer, p_owner text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_mode not in ('renewal', 'expansion') then raise exception 'mode_must_be_renewal_or_expansion'; end if;
  if p_owner is null or length(p_owner) < 8 then raise exception 'owner_required'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  if not exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
    and (leased_until is null or leased_until <= now())
    and (cooldown_until is null or cooldown_until <= now()))
  then raise exception 'apify_gate_unavailable'; end if;

  insert into public.scrape_runs (id, store, run_id, target_count, retrieval_method, run_scope, status,
    started_at, attempted_count, fetched, extracted, inserted, unchanged_count, failed,
    silently_skipped_count, threshold_pct, threshold_breached, error_summary)
  values (v_run_id, 'tesco', 'tesco_apify_' || p_mode || '_' || replace(v_run_id::text, '-', ''),
    greatest(coalesce(p_target_count, 0), 0), 'tesco_apify_provider', 'canary', 'running',
    now(), 0, 0, 0, 0, 0, 0, 0, 70, false,
    jsonb_build_object('protocol', 'tesco-apify-v1', 'mode', p_mode, 'activeOwner', p_owner,
      'leaseToken', v_token)::text);

  -- Mint/overwrite the fencing token. Any predecessor's token is now stale.
  update public.tesco_egress_pool
    set leased_until = now() + interval '10 minutes', lease_token = v_token, lease_run_id = v_run_id,
        updated_at = now()
    where egress_key = p_egress_key;
  return jsonb_build_object('runId', v_run_id, 'leaseToken', v_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve: fencing-token + mapping binding. Records store_product_id + snapshot.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_reserve_tesco_request(uuid, text, text, uuid, text, text);
create function public.apify_reserve_tesco_request(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_store_url text, p_mode text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_observed_at timestamptz;
  v_snapshot jsonb;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;

  -- The mapping must be a resolved, proven Tesco mapping at its canonical URL,
  -- and the URL passed must be ITS url (no URL/mapping mismatch).
  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_snapshot is null
    or v_snapshot->>'url_status' <> 'resolved'
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
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- record: evidence ONLY. No price-write path at all (legacy p_accept removed).
-- Looks the pending row up by (run_id, store_product_id) so the recorded page
-- is bound to its exact mapping.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_record_tesco_page(uuid, text, text, uuid, text, text, text, integer, text, integer, text, jsonb, jsonb, jsonb, boolean, numeric, numeric, text, text, boolean, timestamptz, boolean, jsonb);
create function public.apify_record_tesco_page(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_store_url text, p_mode text,
  p_outcome text, p_http_status integer, p_retry_after text, p_elapsed_ms integer,
  p_adapter_body_sha256 text, p_parsed jsonb, p_identity_results jsonb, p_detail jsonb,
  p_pause boolean, p_pause_until timestamptz, p_blocked boolean, p_provider jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_page_id uuid;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);

  select id into v_page_id from public.tesco_direct_collection_pages
    where run_id = p_run_id and store_product_id = p_store_product_id and outcome = 'pending' for update;
  if v_page_id is null then return jsonb_build_object('recorded', false, 'noop', true); end if;

  update public.tesco_direct_collection_pages
    set final_url = p_store_url, outcome = p_outcome, http_status = p_http_status,
        retry_after = p_retry_after, elapsed_ms = p_elapsed_ms, body_sha256 = p_adapter_body_sha256,
        parsed = p_parsed, identity_results = coalesce(p_identity_results, '[]'::jsonb), detail = p_detail::text
    where id = v_page_id;

  if p_provider is not null then
    insert into public.tesco_apify_provider_evidence (run_id, page_id, store_product_id, requested_url, sku,
      actor_id, actor_build_id, actor_build_number, provider_run_id, provider_dataset_id,
      raw_item, raw_item_sha256, adapter_body_sha256, provider_scraped_at, freshness, freshness_verified)
    values (p_run_id, v_page_id, p_store_product_id, p_store_url, coalesce(p_provider->>'sku', ''),
      coalesce(p_provider->>'actorId', ''), p_provider->>'actorBuildId', p_provider->>'actorBuildNumber',
      coalesce(p_provider->>'runId', ''), coalesce(p_provider->>'datasetId', ''),
      coalesce(p_provider->'rawItem', '{}'::jsonb), coalesce(p_provider->>'rawItemSha256', repeat('0',64)),
      p_adapter_body_sha256, nullif(p_provider->>'scrapedAt','')::timestamptz,
      coalesce(p_provider->'freshness', '{}'::jsonb), coalesce((p_provider->>'freshnessVerified')::boolean, false))
    on conflict (run_id, requested_url) do nothing;
  end if;

  if p_pause then
    perform public.pause_tesco_collection_egress(p_egress_key, p_pause_until, coalesce(p_blocked, false));
    -- Pausing releases the lease; drop the fencing token too.
    update public.tesco_egress_pool set lease_token = null, lease_run_id = null, updated_at = now()
      where egress_key = p_egress_key;
    update public.scrape_runs
      set error_summary = (error_summary::jsonb || jsonb_build_object('stopReason', p_outcome))::text
      where id = p_run_id;
    return jsonb_build_object('recorded', true, 'paused', true);
  end if;

  -- Heartbeat the lease (token preserved).
  update public.tesco_egress_pool
    set leased_until = now() + interval '10 minutes', last_success_at = now(), updated_at = now()
    where egress_key = p_egress_key and lease_token = p_lease_token;
  update public.scrape_runs
    set error_summary = (error_summary::jsonb || jsonb_build_object('heartbeatAt', now()))::text
    where id = p_run_id;
  return jsonb_build_object('recorded', true, 'paused', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- finalise: fencing-token + page-by-mapping lookup + atomic snapshot recheck.
-- The ONLY price-write path.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_finalise_tesco_page(uuid, text, text, uuid, text, text, numeric, numeric, text, text);
create function public.apify_finalise_tesco_page(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_mode text,
  p_regular_price numeric, p_previous_price numeric, p_store_product_name text
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

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  -- Fencing: only the gate's CURRENT token holder for THIS run may write.
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;

  -- Find the recorded ok page BY MAPPING within this run — NOT by a caller URL.
  -- Lock it so the snapshot cannot change under us.
  select id, requested_url, store_product_id, mapping_snapshot into v_page
    from public.tesco_direct_collection_pages
    where run_id = p_run_id and store_product_id = p_store_product_id and outcome = 'ok'
    for update;
  if v_page.id is null then raise exception 'no_recorded_ok_page_for_mapping'; end if;

  -- Atomic snapshot recheck: the mapping must be IDENTICAL now to what was
  -- reserved (store↔canonical association, sku, url, brand, gtin unchanged).
  v_now_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_now_snapshot is null or v_now_snapshot is distinct from v_page.mapping_snapshot
  then raise exception 'mapping_snapshot_changed'; end if;

  -- Due/observation recheck immediately before the write.
  if p_mode = 'renewal' then
    if not exists (select 1 from public.latest_prices
      where store_product_id = p_store_product_id and store = 'tesco'
      and observed_at <= now() - interval '4 days') then raise exception 'observation_changed'; end if;
  elsif p_mode = 'expansion' then
    if exists (select 1 from public.latest_prices where store_product_id = p_store_product_id and store = 'tesco')
    then raise exception 'already_observed'; end if;
  else raise exception 'mode_must_be_renewal_or_expansion'; end if;

  v_finalised := public.finalize_store_scrape_product(
    p_run_uuid => p_run_id, p_store => 'tesco', p_store_product_id => p_store_product_id,
    p_success => true, p_price => p_regular_price, p_previous_price => p_previous_price,
    p_store_url => v_page.requested_url, p_store_sku => v_now_snapshot->>'store_sku',
    p_store_product_name => p_store_product_name, p_fetched => 1, p_extracted => 1);

  update public.tesco_egress_pool set last_success_at = now(), updated_at = now()
    where egress_key = p_egress_key and lease_token = p_lease_token;
  update public.scrape_runs
    set error_summary = (error_summary::jsonb || jsonb_build_object('heartbeatAt', now()))::text
    where id = p_run_id;
  return jsonb_build_object('finalised', v_finalised);
end;
$$;

-- ---------------------------------------------------------------------------
-- close: fencing-token guarded. A superseded worker (stale token) closes
-- NOTHING and cannot clear the successor's lease.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_close_tesco_run(uuid, text, text, text);
create function public.apify_close_tesco_run(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text, p_stop_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_closed boolean := false;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;

  -- Only release the gate if THIS run+token is still the current holder. A
  -- superseded worker leaves the successor's lease untouched.
  if exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
      and lease_token = p_lease_token and lease_run_id = p_run_id) then
    update public.tesco_egress_pool set leased_until = null, lease_token = null, lease_run_id = null,
      updated_at = now() where egress_key = p_egress_key;
    v_closed := true;
  end if;

  -- Always allow a run to mark ITS OWN terminal status (by owner), but this
  -- never touches the gate unless the token matched above.
  update public.scrape_runs
    set status = case when coalesce(p_stop_reason, 'complete') = 'complete' then 'success' else 'degraded' end,
        finished_at = now(), duration_seconds = extract(epoch from now() - started_at)::int,
        error_summary = (error_summary::jsonb || jsonb_build_object('activeOwner', null,
          'stopReason', coalesce(nullif(error_summary::jsonb->>'stopReason', ''), p_stop_reason),
          'complete', coalesce(p_stop_reason, 'complete') = 'complete'))::text
    where id = p_run_id and error_summary::jsonb->>'activeOwner' = p_owner;
  return jsonb_build_object('leaseReleased', v_closed);
end;
$$;

revoke all on function public.apify_begin_tesco_run(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apify_record_tesco_page(uuid, text, uuid, text, uuid, text, text, text, integer, text, integer, text, jsonb, jsonb, jsonb, boolean, timestamptz, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.apify_close_tesco_run(uuid, text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.apify_begin_tesco_run(text, text, integer, text) to service_role;
grant execute on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text) to service_role;
grant execute on function public.apify_record_tesco_page(uuid, text, uuid, text, uuid, text, text, text, integer, text, integer, text, jsonb, jsonb, jsonb, boolean, timestamptz, boolean, jsonb) to service_role;
grant execute on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text) to service_role;
grant execute on function public.apify_close_tesco_run(uuid, text, uuid, text, text) to service_role;

comment on function public.apify_finalise_tesco_page is
  'ONLY price-write path. Fencing-token + owner guarded; looks the ok page up by (run_id, store_product_id) and rechecks the immutable mapping_snapshot atomically; receipt idempotency + positive price via finalize_store_scrape_product.';
