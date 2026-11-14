-- Tesco Apify: evidence-only acquisition + evidence-bound, SINGLE-USE first-price
-- approvals for mappings with NO prior success receipt.
--
-- REVISION NOTE: edited in place; NEVER applied to production. Supersedes the
-- p_allow_first_price boolean merged in PR #394 and the first approval draft in
-- PR #396. This revision additionally:
--   1. removes INHERITED table privileges (Supabase default privileges grant ALL
--      on new public tables to service_role; the explicit narrow grants in the
--      earlier Apify migrations did not take those away),
--   2. pins approvals to IMMUTABLE provider evidence (tesco_apify_provider_evidence
--      becomes select-only for service_role) rather than the legacy-writable page,
--   3. adds an EVIDENCE-ONLY run mode that can fetch and record a page for an
--      unproven mapping (or a repair target URL) but can NEVER write a price,
--   4. adds tesco_internal.completed_apify_evidence_source for the guarded
--      (postgres-bridge-only) mapping-repair activation.
--
-- PRESERVED unchanged: resolved url_status, canonical product URL, snapshot
-- match, not-already-observed (expansion), 24h pending/recent exclusion, pacing,
-- lease fencing + owner. RENEWAL never needs or accepts an approval. The
-- collector still runs the deterministic gate and a fresh independent AI verdict
-- on the LIVE page before it finalises.
--
-- TRUST BOUNDARY (stated honestly): the collector is service_role. The database
-- checks the supplied live identity fingerprint equals the approved one but cannot
-- recompute it from the page. service_role also still holds legacy direct write
-- privileges on price_observations / scrape_product_receipts (used by other
-- retailer collectors); this migration does not change those.

-- ---------------------------------------------------------------------------
-- 0. Inherited privileges: re-grant exactly the intended set to service_role.
-- ---------------------------------------------------------------------------
-- Provider evidence is written ONLY by the SECURITY DEFINER record RPC, so it is
-- read-only for service_role. That makes it the immutable anchor for approvals.
revoke all on public.tesco_apify_provider_evidence from public, anon, authenticated, service_role;
grant select on public.tesco_apify_provider_evidence to service_role;
-- The legacy supervised/direct collector inserts and updates pages directly, so
-- those stay; DELETE/TRUNCATE/REFERENCES/TRIGGER were only ever inherited.
revoke all on public.tesco_direct_collection_pages from public, anon, authenticated, service_role;
grant select, insert, update on public.tesco_direct_collection_pages to service_role;
revoke all on public.tesco_identity_verifications from public, anon, authenticated, service_role;
grant select, insert, update on public.tesco_identity_verifications to service_role;
revoke all on public.tesco_apify_budget_reservations from public, anon, authenticated, service_role;
grant select, insert, update on public.tesco_apify_budget_reservations to service_role;

-- ---------------------------------------------------------------------------
-- 1. Approval table: written ONLY through the SECURITY DEFINER RPCs below.
-- ---------------------------------------------------------------------------
create table if not exists public.tesco_first_price_approvals (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  mapping_snapshot jsonb not null,
  -- Retained evidence: page + its immutable provider-evidence row. Deleting the
  -- referenced evidence is refused while an approval points at it.
  evidence_page_id uuid not null references public.tesco_direct_collection_pages(id) on delete restrict,
  evidence_provider_id uuid not null references public.tesco_apify_provider_evidence(id) on delete restrict,
  evidence_body_sha256 text not null check (evidence_body_sha256 ~ '^[a-f0-9]{64}$'),
  -- The exact product the AI assessed, copied at approval time (pinned).
  evidence_product jsonb not null,
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
-- Remove the INHERITED default privileges (incl. service_role ALL) explicitly.
revoke all on public.tesco_first_price_approvals from public, anon, authenticated, service_role;
grant select on public.tesco_first_price_approvals to service_role;
create unique index if not exists tesco_first_price_one_live_approval
  on public.tesco_first_price_approvals (store_product_id)
  where consumed_at is null and revoked_at is null;
comment on table public.tesco_first_price_approvals is
  'Single-use, evidence-bound first-price approvals. Bound to mapping snapshot, an Apify evidence page + its immutable provider-evidence row, and an independent AI verified_exact assessment; consumed atomically with the first price + receipt. service_role: SELECT only.';

-- ---------------------------------------------------------------------------
-- 2. begin: also accepts the EVIDENCE-ONLY mode (same signature).
-- ---------------------------------------------------------------------------
create or replace function public.apify_begin_tesco_run(
  p_egress_key text, p_mode text, p_target_count integer, p_owner text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_mode not in ('renewal', 'expansion', 'evidence') then raise exception 'mode_must_be_renewal_or_expansion'; end if;
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
      'leaseToken', v_token, 'evidenceOnly', p_mode = 'evidence')::text);

  update public.tesco_egress_pool
    set leased_until = now() + interval '10 minutes', lease_token = v_token, lease_run_id = v_run_id,
        updated_at = now()
    where egress_key = p_egress_key;
  return jsonb_build_object('runId', v_run_id, 'leaseToken', v_token);
end;
$$;
revoke all on function public.apify_begin_tesco_run(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.apify_begin_tesco_run(text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Record an approval. Validates every binding BEFORE the row exists.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_record_first_price_approval(uuid, uuid, text, text, jsonb, jsonb, integer);
create function public.apify_record_first_price_approval(
  p_store_product_id uuid,
  p_evidence_page_id uuid,
  p_evidence_body_sha256 text,
  p_identity_fingerprint text,
  p_assessment jsonb,
  p_expected_snapshot jsonb,
  p_ttl_hours integer default 72
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_page record;
  v_run_id text;
  v_provider_id uuid;
  v_product jsonb;
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
  if jsonb_array_length(coalesce(v_snapshot->'same_sku_canonical_names', '[]'::jsonb)) > 1
  then raise exception 'shared_sku_requires_review'; end if;
  if exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success')
  then raise exception 'already_proven_no_approval_needed'; end if;
  if exists (select 1 from public.latest_prices l
    where l.store_product_id = p_store_product_id and l.store = 'tesco')
  then raise exception 'already_observed'; end if;

  -- Retained evidence: an ok Apify page for THIS mapping at its canonical URL,
  -- exactly one product with the mapped SKU, hashing to the supplied digest,
  -- AND an immutable provider-evidence row carrying the same adapter digest.
  select d.id, d.store_product_id, d.requested_url, d.outcome, d.body_sha256, d.parsed, d.created_at
    into v_page from public.tesco_direct_collection_pages d where d.id = p_evidence_page_id;
  select r.run_id into v_run_id from public.scrape_runs r
    join public.tesco_direct_collection_pages d on d.run_id = r.id where d.id = p_evidence_page_id;
  select e.id into v_provider_id from public.tesco_apify_provider_evidence e
    where e.page_id = p_evidence_page_id and e.adapter_body_sha256 = p_evidence_body_sha256
      and e.sku = (v_snapshot->>'store_sku') and e.requested_url = (v_snapshot->>'store_url');
  if v_page.id is null
    or v_page.store_product_id is distinct from p_store_product_id
    or v_page.outcome <> 'ok'
    or v_page.requested_url <> (v_snapshot->>'store_url')
    or v_page.body_sha256 is distinct from p_evidence_body_sha256
    or coalesce(v_run_id, '') not like 'tesco_apify_%'
    or v_provider_id is null
    or (select count(*) from jsonb_array_elements(coalesce(v_page.parsed->'products', '[]'::jsonb)) pr
        where pr->>'sku' = v_snapshot->>'store_sku') <> 1
  then raise exception 'evidence_mismatch'; end if;
  if v_page.created_at < now() - interval '14 days' then raise exception 'evidence_stale'; end if;
  select pr into v_product from jsonb_array_elements(v_page.parsed->'products') pr
    where pr->>'sku' = v_snapshot->>'store_sku';

  -- Independent AI assessment: verified_exact, a model, a substantive reason,
  -- bound to this mapping, this page, this digest and this identity fingerprint.
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
    (store_product_id, mapping_snapshot, evidence_page_id, evidence_provider_id, evidence_body_sha256,
     evidence_product, identity_fingerprint, assessment, model, expires_at)
  values (p_store_product_id, v_snapshot, p_evidence_page_id, v_provider_id, p_evidence_body_sha256,
     v_product, p_identity_fingerprint, p_assessment, trim(p_assessment->>'model'),
     now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 72), 168))))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.apify_record_first_price_approval(uuid, uuid, text, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.apify_record_first_price_approval(uuid, uuid, text, text, jsonb, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Reserve: supersedes 20261109140000.
--   renewal / expansion: as before; a mapping WITHOUT a success receipt can
--     reserve ONLY in expansion with a live approval for exactly this mapping
--     whose bound snapshot equals the current snapshot. Reserve never consumes.
--   evidence (evidence-only runs ONLY): an UNPROVEN, never-observed mapping at
--     its own canonical URL ('first_price'), or a never-observed mapping at a
--     DIFFERENT canonical product URL whose SKU no Tesco mapping owns
--     ('repair_target'). Evidence runs can never write a price (see finalise).
-- ---------------------------------------------------------------------------
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb);
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, boolean);
drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, uuid);
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
    and (d.outcome = 'pending' or d.created_at > now() - interval '24 hours'))
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

-- ---------------------------------------------------------------------------
-- 5. Finalise: supersedes 20261109140000. Evidence runs NEVER write a price.
-- For a mapping WITHOUT a success receipt the approval is re-validated against
-- the LIVE identity and the IMMUTABLE provider evidence under row locks and
-- CONSUMED in the same transaction as the price + first receipt.
-- ---------------------------------------------------------------------------
drop function if exists public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb);
drop function if exists public.apify_finalise_tesco_page(uuid, text, uuid, text, uuid, text, numeric, numeric, text, jsonb, uuid, text);
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
  if p_mode = 'evidence' then raise exception 'evidence_run_never_writes_price'; end if;
  if p_regular_price is null or p_regular_price <= 0 then raise exception 'positive_regular_price_required'; end if;
  if p_assessed_snapshot is null or jsonb_typeof(p_assessed_snapshot) <> 'object'
  then raise exception 'assessed_snapshot_required'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  perform public.apify_assert_lease(p_egress_key, p_run_id, p_lease_token);
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then raise exception 'owner_mismatch'; end if;
  if exists (select 1 from public.scrape_runs where id = p_run_id
    and (error_summary::jsonb->>'mode' = 'evidence'
      or coalesce((error_summary::jsonb->>'evidenceOnly')::boolean, false)))
  then raise exception 'evidence_run_never_writes_price'; end if;

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
  -- The page must be for the mapping's own URL (never a repair-target page).
  if v_page.requested_url is distinct from (v_now_snapshot->>'store_url') then raise exception 'mapping_snapshot_changed'; end if;

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
    if p_live_identity_fingerprint is null
      or p_live_identity_fingerprint is distinct from v_approval.identity_fingerprint
    then raise exception 'first_price_live_identity_mismatch'; end if;
    -- The approved evidence must still be exactly what was assessed: the
    -- immutable provider row AND the (legacy-writable) page both still match.
    if not exists (select 1 from public.tesco_apify_provider_evidence e
        where e.id = v_approval.evidence_provider_id and e.page_id = v_approval.evidence_page_id
          and e.adapter_body_sha256 = v_approval.evidence_body_sha256)
      or not exists (select 1 from public.tesco_direct_collection_pages d
        where d.id = v_approval.evidence_page_id and d.store_product_id = p_store_product_id
          and d.body_sha256 = v_approval.evidence_body_sha256)
    then raise exception 'first_price_evidence_mismatch'; end if;
  end if;

  -- Transaction-local marker read by tesco_internal.guard_apify_run_receipt:
  -- the shared writer may record an Apify-run receipt only for THIS mapping,
  -- from inside THIS guarded finalise. Cleared straight after.
  perform set_config('smie.apify_finalise_mapping', p_store_product_id::text, true);
  v_finalised := public.finalize_store_scrape_product(
    p_run_uuid => p_run_id, p_store => 'tesco', p_store_product_id => p_store_product_id,
    p_success => true, p_price => p_regular_price, p_previous_price => p_previous_price,
    p_store_url => null, p_store_sku => null, p_store_product_name => null,
    p_fetched => 1, p_extracted => 1);
  perform set_config('smie.apify_finalise_mapping', '', true);

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

-- ---------------------------------------------------------------------------
-- 6. Repair activation source (postgres supervised bridge ONLY). A completed
-- Apify EVIDENCE-ONLY run page with an immutable provider-evidence row. Kept
-- separate from completed_evidence_source so the hold-reentry path is unchanged.
-- ---------------------------------------------------------------------------
create schema if not exists tesco_internal;
create or replace function tesco_internal.completed_apify_evidence_source(p_page_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $body$
  select exists(select 1 from public.tesco_direct_collection_pages d
    join public.scrape_runs r on r.id = d.run_id
    join public.tesco_apify_provider_evidence e on e.page_id = d.id and e.adapter_body_sha256 = d.body_sha256
    where d.id = p_page_id
      and r.run_id like 'tesco_apify_evidence_%'
      and r.store = 'tesco' and r.status = 'success' and r.finished_at is not null
      and r.error_summary::jsonb->>'mode' = 'evidence'
      and coalesce((r.error_summary::jsonb->>'evidenceOnly')::boolean, false)
      and r.error_summary::jsonb->>'activeOwner' is null
      and d.outcome = 'ok' and d.http_status = 200 and d.mode = 'products'
      and jsonb_array_length(d.parsed->'products') = 1
      and d.parsed #>> '{products,0,available}' = 'true'
      and d.parsed #>> '{products,0,currency}' = 'EUR'
      and jsonb_typeof(d.parsed #> '{products,0,price}') = 'number'
      and (d.parsed #>> '{products,0,price}')::numeric > 0
      and e.sku = d.parsed #>> '{products,0,sku}'
      and d.requested_url = d.final_url and d.body_sha256 ~ '^[a-f0-9]{64}$'
      and d.detail::jsonb->>'acquisitionOnly' = 'true'
      and d.detail::jsonb->>'pricesInserted' = '0'
      and d.created_at >= r.started_at and d.created_at <= r.finished_at
      and not exists(select 1 from public.scrape_product_receipts z where z.run_id = r.id));
$body$;
revoke all on function tesco_internal.completed_apify_evidence_source(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. SHARED PRICE WRITERS. service_role can also call the shared finalisers
-- (finalize_store_scrape_product, finalize_tesco_scrape_product_pepesto) with
-- any run id, bypassing apify_finalise_tesco_page. Both write the run receipt
-- FIRST, in the same transaction as the price, so a guard on the receipt insert
-- rolls the price back too. For any Apify run (run_id 'tesco_apify_%'):
--   * an EVIDENCE-ONLY run can never record a receipt (so never a price);
--   * any other Apify run may record a receipt ONLY from inside
--     apify_finalise_tesco_page for exactly the mapping it is finalising (a
--     transaction-local marker that a PostgREST caller cannot set: every RPC is
--     its own transaction and set_config is not an exposed function).
-- Runs of every other collector (Dunnes, SuperValu, Aldi, supervised Tesco) are
-- untouched. Direct table writes by service_role to price_observations remain a
-- stated trust boundary (other collectors rely on that grant).
-- ---------------------------------------------------------------------------
create or replace function tesco_internal.guard_apify_run_receipt()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_run_id text;
  v_summary_text text;
  v_summary jsonb;
begin
  select r.run_id, r.error_summary into v_run_id, v_summary_text
    from public.scrape_runs r where r.id = new.run_id;
  if not starts_with(coalesce(v_run_id, ''), 'tesco_apify_') then return new; end if;
  v_summary := nullif(v_summary_text, '')::jsonb;
  if starts_with(v_run_id, 'tesco_apify_evidence_')
    or coalesce(v_summary->>'mode', '') = 'evidence'
    or coalesce((v_summary->>'evidenceOnly')::boolean, false)
  then raise exception 'evidence_run_never_writes_price'; end if;
  if coalesce(current_setting('smie.apify_finalise_mapping', true), '') <> new.store_product_id::text
  then raise exception 'apify_run_writes_only_via_apify_finalise'; end if;
  return new;
end;
$fn$;
revoke all on function tesco_internal.guard_apify_run_receipt() from public, anon, authenticated, service_role;
drop trigger if exists guard_apify_run_receipt on public.scrape_product_receipts;
create trigger guard_apify_run_receipt before insert on public.scrape_product_receipts
  for each row execute function tesco_internal.guard_apify_run_receipt();
