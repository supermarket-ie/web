-- Tesco Apify: evidence-bound, SINGLE-USE first-price approval for EXPANSION
-- mappings that have never been priced and have NO prior success receipt.
--
-- REVISION NOTE: this file supersedes the first draft merged in PR #394, which
-- waived the receipt requirement on a caller-supplied boolean. That was too
-- weak: any service_role caller could set the flag. This version requires a
-- per-mapping approval row that is
--   * BOUND to the exact mapping (store_product_id + authoritative snapshot),
--   * BOUND to the retained Tesco evidence page (id + body sha256),
--   * BOUND to an independent AI assessment (verified_exact, model, reason,
--     same mapping, same page, same identity fingerprint),
--   * SINGLE-USE: consumed inside the SAME transaction that writes the price
--     and its first success receipt, so it cannot be replayed.
-- The migration has NOT been applied to production; it is edited in place.
--
-- PRESERVED unchanged: resolved url_status, canonical product URL, snapshot
-- match, not-already-observed (expansion), 24h pending/recent exclusion,
-- pacing, lease fencing + owner. RENEWAL never needs or accepts an approval.
-- The collector still runs the deterministic gate, a fresh independent AI
-- verdict on the LIVE page, and independentExactIdentity before it finalises.
--
-- TRUST BOUNDARY (stated honestly): the live identity fingerprint is computed
-- by the collector (TypeScript) and supplied to finalise; the database checks it
-- equals the approved fingerprint but cannot recompute it from the page. The
-- collector is service_role only, as for every other Apify RPC.

create table if not exists public.tesco_first_price_approvals (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  mapping_snapshot jsonb not null,
  -- Retained evidence is protected from deletion while an approval references it.
  evidence_page_id uuid not null references public.tesco_direct_collection_pages(id) on delete restrict,
  evidence_body_sha256 text not null check (evidence_body_sha256 ~ '^[a-f0-9]{64}$'),
  identity_fingerprint text not null check (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  assessment jsonb not null,
  model text not null check (length(trim(model)) >= 3),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_run_id uuid,
  revoked_at timestamptz,
  check (expires_at > approved_at)
);
alter table public.tesco_first_price_approvals enable row level security;
revoke all on public.tesco_first_price_approvals from public, anon, authenticated;
-- Writes happen ONLY through the SECURITY DEFINER RPCs below.
grant select on public.tesco_first_price_approvals to service_role;
-- At most one live (unconsumed, unrevoked) approval per mapping.
create unique index if not exists tesco_first_price_one_live_approval
  on public.tesco_first_price_approvals (store_product_id)
  where consumed_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Record an approval. Validates every binding BEFORE the row exists.
-- ---------------------------------------------------------------------------
create or replace function public.apify_record_first_price_approval(
  p_store_product_id uuid,
  p_evidence_page_id uuid,
  p_evidence_body_sha256 text,
  p_identity_fingerprint text,
  p_assessment jsonb,
  p_expected_snapshot jsonb,
  p_ttl_hours integer default 48
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_page record;
  v_id uuid;
begin
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object'
  then raise exception 'expected_snapshot_required'; end if;
  if p_evidence_body_sha256 is null or p_evidence_body_sha256 !~ '^[a-f0-9]{64}$'
    or p_identity_fingerprint is null or p_identity_fingerprint !~ '^[a-f0-9]{64}$'
  then raise exception 'approval_hashes_invalid'; end if;

  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_found'; end if;

  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;
  if v_snapshot->>'url_status' <> 'resolved'
    or v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || (v_snapshot->>'store_sku')
  then raise exception 'mapping_not_resolved'; end if;
  -- One-to-one only: a shared-SKU group is never approved here.
  if jsonb_array_length(coalesce(v_snapshot->'same_sku_canonical_names', '[]'::jsonb)) > 1
  then raise exception 'shared_sku_requires_review'; end if;
  if exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success')
  then raise exception 'already_proven_no_approval_needed'; end if;
  if exists (select 1 from public.latest_prices l
    where l.store_product_id = p_store_product_id and l.store = 'tesco')
  then raise exception 'already_observed'; end if;

  -- Retained Tesco evidence: must belong to THIS mapping, be an ok product page
  -- for its canonical URL, carry exactly one product with the mapped SKU, hash to
  -- the supplied digest, and be recent.
  select id, store_product_id, requested_url, outcome, body_sha256, parsed, created_at into v_page
    from public.tesco_direct_collection_pages where id = p_evidence_page_id;
  if v_page.id is null
    or v_page.store_product_id is distinct from p_store_product_id
    or v_page.outcome <> 'ok'
    or v_page.requested_url <> (v_snapshot->>'store_url')
    or v_page.body_sha256 is distinct from p_evidence_body_sha256
    or (select count(*) from jsonb_array_elements(coalesce(v_page.parsed->'products', '[]'::jsonb)) pr
        where pr->>'sku' = v_snapshot->>'store_sku') <> 1
  then raise exception 'evidence_mismatch'; end if;
  if v_page.created_at < now() - interval '14 days' then raise exception 'evidence_stale'; end if;

  -- Independent AI assessment: verified_exact, a model, a substantive reason,
  -- bound to this mapping, this page and this identity fingerprint.
  if p_assessment is null or jsonb_typeof(p_assessment) <> 'object'
    or p_assessment->>'decision' is distinct from 'verified_exact'
    or length(trim(coalesce(p_assessment->>'model', ''))) < 3
    or length(trim(coalesce(p_assessment->>'reason', ''))) < 30
    or length(trim(coalesce(p_assessment->>'rule_version', ''))) < 1
  then raise exception 'assessment_invalid'; end if;
  if p_assessment->>'mapping_id' is distinct from p_store_product_id::text
    or p_assessment->>'source_page_id' is distinct from p_evidence_page_id::text
    or p_assessment->>'source_body_sha256' is distinct from p_evidence_body_sha256
    or p_assessment->>'identity_fingerprint' is distinct from p_identity_fingerprint
  then raise exception 'assessment_binding_mismatch'; end if;

  -- A newer approval supersedes any live one for the mapping (kept for audit).
  update public.tesco_first_price_approvals set revoked_at = now()
    where store_product_id = p_store_product_id and consumed_at is null and revoked_at is null;

  insert into public.tesco_first_price_approvals
    (store_product_id, mapping_snapshot, evidence_page_id, evidence_body_sha256,
     identity_fingerprint, assessment, model, expires_at)
  values (p_store_product_id, v_snapshot, p_evidence_page_id, p_evidence_body_sha256,
     p_identity_fingerprint, p_assessment, trim(p_assessment->>'model'),
     now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 48), 168))))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.apify_record_first_price_approval(uuid, uuid, text, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.apify_record_first_price_approval(uuid, uuid, text, text, jsonb, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Reserve: supersedes 20261109140000. A mapping WITHOUT a success receipt can
-- reserve ONLY in expansion mode with a live approval for exactly this mapping
-- whose bound snapshot equals the current snapshot. Reserve does NOT consume.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb);
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, boolean);
create function public.apify_reserve_tesco_request(
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
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object'
  then raise exception 'expected_snapshot_required'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;

  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_resolved_or_unproven'; end if;

  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;

  v_proven := exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success');

  -- Structural preconditions (same exception name as before for callers/tooling).
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
    jsonb_build_object('provider', 'apify', 'firstPrice', (not v_proven))::text);
  return jsonb_build_object('reserved', true, 'snapshot', v_snapshot, 'firstPrice', (not v_proven));
end;
$$;
revoke all on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Finalise: supersedes 20261109140000. For a mapping WITHOUT a success receipt
-- the approval is re-validated against the LIVE identity under row locks and
-- CONSUMED in the same transaction as the price + first receipt. Any failure
-- raises and rolls the whole transaction back, so the approval is never burned
-- without a write and a write never happens without consuming it.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb);
create function public.apify_finalise_tesco_page(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_mode text,
  p_regular_price numeric, p_previous_price numeric, p_store_product_name text,
  p_assessed_snapshot jsonb,
  p_approval_id uuid default null,
  p_live_identity_fingerprint text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_finalised boolean := false;
  v_page record;
  v_now_snapshot jsonb;
  v_proven boolean;
  v_approval record;
  v_consumed integer;
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

  perform 1 from public.store_products s join public.products p on p.id = s.product_id
    where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_found'; end if;

  select id, requested_url, store_product_id, mapping_snapshot into v_page
    from public.tesco_direct_collection_pages
    where run_id = p_run_id and store_product_id = p_store_product_id and outcome = 'ok'
    for update;
  if v_page.id is null then raise exception 'no_recorded_ok_page_for_mapping'; end if;

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

  v_proven := exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success');

  if not v_proven then
    -- First price: an approval is mandatory, expansion only.
    if p_mode <> 'expansion' then raise exception 'mapping_not_resolved_or_unproven'; end if;
    if p_approval_id is null then raise exception 'first_price_approval_required'; end if;
    select * into v_approval from public.tesco_first_price_approvals where id = p_approval_id for update;
    if v_approval.id is null or v_approval.store_product_id <> p_store_product_id
    then raise exception 'first_price_approval_invalid'; end if;
    if v_approval.consumed_at is not null then raise exception 'first_price_approval_already_consumed'; end if;
    if v_approval.revoked_at is not null or v_approval.expires_at <= now()
    then raise exception 'first_price_approval_invalid'; end if;
    if v_approval.mapping_snapshot is distinct from v_now_snapshot
    then raise exception 'first_price_approval_snapshot_changed'; end if;
    -- Recheck the LIVE identity against the approved one.
    if p_live_identity_fingerprint is null
      or p_live_identity_fingerprint is distinct from v_approval.identity_fingerprint
    then raise exception 'first_price_live_identity_mismatch'; end if;
    -- The approved retained evidence must still be exactly what was assessed.
    if not exists (select 1 from public.tesco_direct_collection_pages d
      where d.id = v_approval.evidence_page_id and d.store_product_id = p_store_product_id
        and d.body_sha256 = v_approval.evidence_body_sha256)
    then raise exception 'first_price_evidence_mismatch'; end if;
  end if;

  v_finalised := public.finalize_store_scrape_product(
    p_run_uuid => p_run_id, p_store => 'tesco', p_store_product_id => p_store_product_id,
    p_success => true, p_price => p_regular_price, p_previous_price => p_previous_price,
    p_store_url => null, p_store_sku => null, p_store_product_name => null,
    p_fetched => 1, p_extracted => 1);

  -- Consume ONLY when the price + receipt were actually written, in this same
  -- transaction. A failed consume rolls the write back.
  if not v_proven and v_finalised then
    update public.tesco_first_price_approvals
      set consumed_at = now(), consumed_run_id = p_run_id
      where id = p_approval_id and consumed_at is null and revoked_at is null;
    get diagnostics v_consumed = row_count;
    if v_consumed <> 1 then raise exception 'first_price_approval_already_consumed'; end if;
  end if;

  update public.tesco_egress_pool set last_success_at = now(), updated_at = now()
    where egress_key = p_egress_key and lease_token = p_lease_token;
  update public.scrape_runs
    set error_summary = (error_summary::jsonb || jsonb_build_object('heartbeatAt', now()))::text
    where id = p_run_id;
  return jsonb_build_object('finalised', v_finalised);
end;
$$;
revoke all on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb, uuid, text) to service_role;

comment on table public.tesco_first_price_approvals is
  'Single-use, evidence-bound first-price approvals. Bound to mapping snapshot, retained Tesco page (id+sha256) and an independent AI verified_exact assessment; consumed atomically with the first price + receipt.';
