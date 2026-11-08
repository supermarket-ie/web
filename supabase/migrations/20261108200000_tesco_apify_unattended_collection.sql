-- Tesco Apify unattended collection — service_role RPC transport.
--
-- WHY: the supervised SQL bridge runs arbitrary `do $runner$` blocks and the
-- privileged tesco_internal.* functions as the postgres superuser. An
-- unattended ECS Fargate task authenticates with the service_role PostgREST
-- key, which is NOT a Postgres connection and cannot run arbitrary SQL. This
-- migration adds the SMALLEST set of narrow, parameterised, SECURITY DEFINER
-- functions — one per supervised transaction boundary — so the identical
-- guards run atomically through granted RPCs. It does NOT:
--   • introduce a general-purpose SQL-execution endpoint;
--   • grant service_role INSERT on tesco_hold_reentry_reviews or any approval;
--   • touch tesco_internal.record_verified_hold_reentry or weaken its restriction;
--   • add another machine Auth account;
--   • require a human approval for ordinary renewal/expansion batches.
--
-- SCOPE: ordinary RENEWAL and EXPANSION of EXISTING, already-proven mappings
-- via a DEDICATED Apify egress gate. The audited hold-reentry / mapping-repair
-- lane keeps its existing supervised path and the restricted function; this RPC
-- path NEVER consumes or mints a reentry approval and NEVER writes a price for a
-- held/unproven mapping. Identity revalidation runs in TypeScript
-- (independentExactIdentity / validateTescoCollectedIdentity) BEFORE the
-- finalise RPC; the RPCs enforce the DB-side invariants (lease ownership,
-- due/observation recheck, pending/recent-24h exclusion, receipt idempotency,
-- positive regular price) inside their own transaction boundary.

-- 1. A dedicated egress gate for the Apify provider path. Disabled-by-default
--    like the supervised gate; the RPCs below claim it. Kept separate from
--    vercel-dub1-canary-20260920 (blocked direct-AWS) and the workspace gate so
--    this campaign never disturbs their cooldowns/leases.
insert into public.tesco_egress_pool (egress_key, label, enabled, priority, cooldown_until)
values ('apify-tesco-ie-20261108', 'Apify parsebird/tesco-scraper IE provider path', false, 50, null)
on conflict (egress_key) do nothing;

-- 2. Provider evidence: the ORIGINAL Apify payload and its hash, kept distinct
--    from the synthetic parser-adapter HTML. Generated HTML is never presented
--    as an original Tesco response; this table holds the true provider record.
create table if not exists public.tesco_apify_provider_evidence (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  page_id uuid not null references public.tesco_direct_collection_pages(id) on delete cascade,
  store_product_id uuid references public.store_products(id) on delete set null,
  requested_url text not null,
  sku text not null,
  provider text not null default 'apify',
  actor_id text not null,
  actor_build_id text,
  actor_build_number text,
  provider_run_id text not null,
  provider_dataset_id text not null,
  -- The ORIGINAL Apify item, verbatim, and its hash (provider-origin evidence).
  raw_item jsonb not null,
  raw_item_sha256 text not null check (raw_item_sha256 ~ '^[a-f0-9]{64}$'),
  -- The synthetic adapter HTML hash the collector stored as the page body hash,
  -- recorded here so adapter output is traceable but clearly separate from the
  -- provider's own payload.
  adapter_body_sha256 text not null check (adapter_body_sha256 ~ '^[a-f0-9]{64}$'),
  provider_scraped_at timestamptz,
  -- Freshness evidence (see the TS verifier + actor cache-behaviour probe).
  freshness jsonb not null default '{}'::jsonb,
  freshness_verified boolean not null default false,
  captured_at timestamptz not null default now(),
  unique (run_id, requested_url)
);
alter table public.tesco_apify_provider_evidence enable row level security;
revoke all on public.tesco_apify_provider_evidence from public, anon, authenticated;
grant select, insert on public.tesco_apify_provider_evidence to service_role;
create index if not exists tesco_apify_provider_evidence_run_idx
  on public.tesco_apify_provider_evidence (run_id, captured_at);

-- 3. Reusable identity verification records. A durable, reusable VERIFICATION
--    (identity only), NOT a reusable price-write approval. Stores canonical +
--    Tesco identity snapshots, evidence references, decision + rationale,
--    verification method, model/rule versions, verification time, and a stable
--    price/promotion-excluding identity fingerprint. Renewals rerun a cheap
--    identity check against this record; reuse is valid only while the mapping,
--    canonical identity, material attributes and rule version are unchanged.
create table if not exists public.tesco_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  -- Stable fingerprint over material identity (excludes price/promotions/stock).
  identity_fingerprint text not null check (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_snapshot jsonb not null,
  tesco_snapshot jsonb not null,
  decision text not null check (decision in ('verified_exact')),
  rationale text not null,
  method text not null check (method in ('deterministic', 'deterministic_plus_ai')),
  rule_version text not null,
  model text,
  -- Evidence references binding this verification to the exact page it was made
  -- against. NOT a price approval: the collector still fetches fresh and writes
  -- the price through the guarded finalise RPC + per-run receipt.
  source_page_id uuid references public.tesco_direct_collection_pages(id) on delete set null,
  source_body_sha256 text check (source_body_sha256 ~ '^[a-f0-9]{64}$'),
  provider text not null default 'apify',
  verified_at timestamptz not null default now(),
  -- Reassessment policy: a verification is reusable only until this instant and
  -- only while the live fingerprint still equals identity_fingerprint. Any
  -- change, new conflict, hold or insufficient evidence invalidates reuse.
  reusable_until timestamptz not null,
  invalidated_at timestamptz,
  invalidated_reason text
);
alter table public.tesco_identity_verifications enable row level security;
revoke all on public.tesco_identity_verifications from public, anon, authenticated;
grant select, insert, update on public.tesco_identity_verifications to service_role;
create index if not exists tesco_identity_verifications_mapping_idx
  on public.tesco_identity_verifications (store_product_id, verified_at desc);
create unique index if not exists tesco_identity_verifications_active_fp
  on public.tesco_identity_verifications (store_product_id, identity_fingerprint)
  where invalidated_at is null;

comment on table public.tesco_identity_verifications is
  'Reusable Tesco IDENTITY verification (not a price-write approval). Reuse valid only while mapping, canonical identity, material attributes and rule_version are unchanged and reusable_until has not passed; otherwise re-verify.';

-- ---------------------------------------------------------------------------
-- 4. The RPC transaction boundaries. All SECURITY DEFINER, owned by the schema
--    owner, search_path pinned, granted ONLY to service_role. Every function is
--    scoped to the Apify gate and refuses any other egress_key.
-- ---------------------------------------------------------------------------

create or replace function public.apify_begin_tesco_run(
  p_egress_key text,
  p_mode text,
  p_target_count integer,
  p_owner text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_mode not in ('renewal', 'expansion') then raise exception 'mode_must_be_renewal_or_expansion'; end if;
  if p_owner is null or length(p_owner) < 8 then raise exception 'owner_required'; end if;

  -- Lock the gate; claim only if available (not leased, not cooling down).
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
    jsonb_build_object('protocol', 'tesco-apify-v1', 'mode', p_mode, 'activeOwner', p_owner)::text);

  update public.tesco_egress_pool
    set leased_until = now() + interval '10 minutes', updated_at = now()
    where egress_key = p_egress_key;
  return v_run_id;
end;
$$;

-- Reserve exactly one request for a product URL. Atomic guard that reproduces
-- the supervised reservation: lease ownership, due/observation recheck,
-- pending/recent-24h exclusion, pacing, and the pending page-row insert.
create or replace function public.apify_reserve_tesco_request(
  p_run_id uuid,
  p_egress_key text,
  p_owner text,
  p_store_product_id uuid,
  p_store_url text,
  p_mode text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_observed_at timestamptz;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;

  -- Lock gate then run, in that order; assert ownership + live lease.
  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  if not exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
      and leased_until > now() and coalesce(cooldown_until, now()) <= now())
    or not exists (select 1 from public.scrape_runs where id = p_run_id
      and error_summary::jsonb->>'activeOwner' = p_owner)
  then raise exception 'ownership_or_gate_lost'; end if;

  -- Mapping must still be a resolved, proven Tesco mapping at the canonical URL.
  if not exists (select 1 from public.store_products s where s.id = p_store_product_id
    and s.store = 'tesco' and s.url_status = 'resolved'
    and s.store_url = p_store_url
    and s.store_url = 'https://www.tesco.ie/shop/en-IE/products/' || s.store_sku
    and exists (select 1 from public.scrape_product_receipts r
      where r.store_product_id = s.id and r.outcome = 'success'))
  then raise exception 'mapping_not_resolved_or_unproven'; end if;

  select l.observed_at into v_observed_at from public.latest_prices l
    where l.store_product_id = p_store_product_id and l.store = 'tesco';

  -- Due recheck: renewal needs an observation >4 days old; expansion needs none.
  if p_mode = 'renewal' then
    if v_observed_at is null or v_observed_at > now() - interval '4 days'
    then raise exception 'not_due_or_observation_changed'; end if;
  elsif p_mode = 'expansion' then
    if v_observed_at is not null then raise exception 'already_observed'; end if;
  else
    raise exception 'mode_must_be_renewal_or_expansion';
  end if;

  -- Pending/recent-request exclusion (24h), identical window to the collector.
  if exists (select 1 from public.tesco_direct_collection_pages d
    where d.requested_url = p_store_url
    and (d.outcome = 'pending' or d.created_at > now() - interval '24 hours'))
  then raise exception 'attempt_already_recorded'; end if;

  -- Pacing: at least 10s since the gate's last success.
  if exists (select 1 from public.tesco_egress_pool where egress_key = p_egress_key
    and last_success_at > now() - interval '10 seconds')
  then raise exception 'pacing_not_elapsed'; end if;

  insert into public.tesco_direct_collection_pages (run_id, egress_key, requested_url, mode, outcome, detail)
  values (p_run_id, p_egress_key, p_store_url, 'products', 'pending',
    jsonb_build_object('provider', 'apify')::text);
  return true;
end;
$$;

-- Record the fetched page outcome and, on an accepted identity, finalise the
-- regular price — one atomic operation. Mapping identity is re-validated in
-- TypeScript before this call; the DB enforces receipt idempotency, a positive
-- regular price, the due recheck again, lease ownership, and (on a transport
-- stop) the gate pause. Clubcard/promotional prices never reach this function:
-- the caller passes only the regular shelf price.
create or replace function public.apify_record_tesco_page(
  p_run_id uuid,
  p_egress_key text,
  p_owner text,
  p_store_product_id uuid,
  p_store_url text,
  p_mode text,
  p_outcome text,
  p_http_status integer,
  p_retry_after text,
  p_elapsed_ms integer,
  p_adapter_body_sha256 text,
  p_parsed jsonb,
  p_identity_results jsonb,
  p_detail jsonb,
  -- finalise inputs (only used when p_accept = true)
  p_accept boolean,
  p_regular_price numeric,
  p_previous_price numeric,
  p_store_sku text,
  p_store_product_name text,
  -- gate pause inputs (only used on a transport stop)
  p_pause boolean,
  p_pause_until timestamptz,
  p_blocked boolean,
  -- provider evidence (original payload + hash, kept separate from adapter HTML)
  p_provider jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_page_id uuid;
  v_finalised boolean := false;
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  if p_accept and (p_regular_price is null or p_regular_price <= 0)
  then raise exception 'accept_requires_positive_regular_price'; end if;

  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  if not exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner)
  then raise exception 'ownership_lost'; end if;

  -- The pending reservation must exist (idempotent re-entry safe: if already
  -- finalised there is no pending row and we no-op).
  select id into v_page_id from public.tesco_direct_collection_pages
    where run_id = p_run_id and requested_url = p_store_url and outcome = 'pending' for update;
  if v_page_id is null then
    return jsonb_build_object('finalised', false, 'noop', true);
  end if;

  update public.tesco_direct_collection_pages
    set final_url = p_store_url, outcome = p_outcome, http_status = p_http_status,
        retry_after = p_retry_after, elapsed_ms = p_elapsed_ms,
        body_sha256 = p_adapter_body_sha256, parsed = p_parsed,
        identity_results = coalesce(p_identity_results, '[]'::jsonb), detail = p_detail::text
    where id = v_page_id;

  -- Provider evidence: the ORIGINAL Apify payload + hash, distinct from the
  -- synthetic adapter HTML hash recorded as the page body hash above.
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

  -- Transport stop: pause the gate (never shorten a cooldown). Reuses the
  -- existing supervised pause function semantics.
  if p_pause then
    perform public.pause_tesco_collection_egress(p_egress_key, p_pause_until, coalesce(p_blocked, false));
    update public.scrape_runs
      set error_summary = (error_summary::jsonb || jsonb_build_object('stopReason', p_outcome))::text
      where id = p_run_id;
    return jsonb_build_object('finalised', false, 'paused', true);
  end if;

  -- Accepted identity (ordinary, non-reentry): re-assert due, then finalise the
  -- REGULAR price through the existing guarded finaliser (receipt idempotency +
  -- positive price). Provenance source = 'tesco_apify'.
  if p_accept then
    if p_mode = 'renewal' then
      if not exists (select 1 from public.latest_prices
        where store_product_id = p_store_product_id and store = 'tesco'
        and observed_at <= now() - interval '4 days')
      then raise exception 'observation_changed'; end if;
    elsif p_mode = 'expansion' then
      if exists (select 1 from public.latest_prices where store_product_id = p_store_product_id and store = 'tesco')
      then raise exception 'already_observed'; end if;
    end if;

    v_finalised := public.finalize_store_scrape_product(
      p_run_uuid => p_run_id, p_store => 'tesco', p_store_product_id => p_store_product_id,
      p_success => true, p_price => p_regular_price, p_previous_price => p_previous_price,
      p_store_url => p_store_url, p_store_sku => p_store_sku, p_store_product_name => p_store_product_name,
      p_fetched => 1, p_extracted => 1);
    -- Provider provenance is recorded authoritatively in
    -- tesco_apify_provider_evidence (actor/run/dataset/raw-item hash), bound to
    -- this run + page below. We deliberately do NOT post-patch
    -- price_observations.source here: the only reliable key would be a fragile
    -- max(observed_at) lookup (racy, and price_observations has no run_id). The
    -- finaliser's own source value stands; provider attribution is the evidence
    -- row, which is exact.
  end if;

  -- Heartbeat the lease + record a success for pacing.
  update public.tesco_egress_pool
    set leased_until = now() + interval '10 minutes', last_success_at = now(), updated_at = now()
    where egress_key = p_egress_key;
  update public.scrape_runs
    set error_summary = (error_summary::jsonb || jsonb_build_object('heartbeatAt', now()))::text
    where id = p_run_id;

  return jsonb_build_object('finalised', v_finalised, 'paused', false);
end;
$$;

-- Close the run: release the lease (never clear/shorten cooldown) and set the
-- terminal status. Owner-guarded so a successor's lease is never cleared.
create or replace function public.apify_close_tesco_run(
  p_run_id uuid,
  p_egress_key text,
  p_owner text,
  p_stop_reason text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_egress_key <> 'apify-tesco-ie-20261108' then raise exception 'apify_gate_only'; end if;
  perform 1 from public.tesco_egress_pool where egress_key = p_egress_key for update;
  perform 1 from public.scrape_runs where id = p_run_id for update;
  if exists (select 1 from public.scrape_runs where id = p_run_id
    and error_summary::jsonb->>'activeOwner' = p_owner) then
    update public.tesco_egress_pool set leased_until = null, updated_at = now()
      where egress_key = p_egress_key and leased_until > now();
    update public.scrape_runs
      set status = case when coalesce(p_stop_reason, 'complete') = 'complete' then 'success' else 'degraded' end,
          finished_at = now(), duration_seconds = extract(epoch from now() - started_at)::int,
          error_summary = (error_summary::jsonb || jsonb_build_object('activeOwner', null,
            'stopReason', coalesce(nullif(error_summary::jsonb->>'stopReason', ''), p_stop_reason),
            'complete', coalesce(p_stop_reason, 'complete') = 'complete'))::text
      where id = p_run_id;
  end if;
end;
$$;

-- Record / refresh a reusable identity verification (identity only; never a
-- price approval). Upsert on the active (mapping, fingerprint) pair.
create or replace function public.apify_record_identity_verification(
  p_store_product_id uuid,
  p_identity_fingerprint text,
  p_canonical jsonb,
  p_tesco jsonb,
  p_rationale text,
  p_method text,
  p_rule_version text,
  p_model text,
  p_source_page_id uuid,
  p_source_body_sha256 text,
  p_reusable_hours integer
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_method not in ('deterministic', 'deterministic_plus_ai') then raise exception 'bad_method'; end if;
  if p_identity_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'bad_fingerprint'; end if;

  -- Invalidate any prior active verification for this mapping with a DIFFERENT
  -- fingerprint (identity changed → old verification cannot be reused).
  update public.tesco_identity_verifications
    set invalidated_at = now(), invalidated_reason = 'superseded_by_new_fingerprint'
    where store_product_id = p_store_product_id and invalidated_at is null
      and identity_fingerprint <> p_identity_fingerprint;

  insert into public.tesco_identity_verifications (store_product_id, identity_fingerprint,
    canonical_snapshot, tesco_snapshot, decision, rationale, method, rule_version, model,
    source_page_id, source_body_sha256, reusable_until)
  values (p_store_product_id, p_identity_fingerprint, p_canonical, p_tesco, 'verified_exact',
    p_rationale, p_method, p_rule_version, p_model, p_source_page_id, p_source_body_sha256,
    now() + make_interval(hours => greatest(1, least(coalesce(p_reusable_hours, 720), 2160))))
  on conflict (store_product_id, identity_fingerprint) where invalidated_at is null
  do update set verified_at = now(), rationale = excluded.rationale, method = excluded.method,
    rule_version = excluded.rule_version, model = excluded.model,
    source_page_id = excluded.source_page_id, source_body_sha256 = excluded.source_body_sha256,
    reusable_until = excluded.reusable_until
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.apify_begin_tesco_run(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.apify_reserve_tesco_request(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apify_record_tesco_page(uuid, text, text, uuid, text, text, text, integer, text, integer, text, jsonb, jsonb, jsonb, boolean, numeric, numeric, text, text, boolean, timestamptz, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.apify_close_tesco_run(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.apify_record_identity_verification(uuid, text, jsonb, jsonb, text, text, text, text, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.apify_begin_tesco_run(text, text, integer, text) to service_role;
grant execute on function public.apify_reserve_tesco_request(uuid, text, text, uuid, text, text) to service_role;
grant execute on function public.apify_record_tesco_page(uuid, text, text, uuid, text, text, text, integer, text, integer, text, jsonb, jsonb, jsonb, boolean, numeric, numeric, text, text, boolean, timestamptz, boolean, jsonb) to service_role;
grant execute on function public.apify_close_tesco_run(uuid, text, text, text) to service_role;
grant execute on function public.apify_record_identity_verification(uuid, text, jsonb, jsonb, text, text, text, text, uuid, text, integer) to service_role;

comment on function public.apify_record_tesco_page is
  'Atomic Apify page record + guarded regular-price finalisation (receipt idempotency, positive price, due recheck, lease ownership). Ordinary renewal/expansion only; never consumes a hold-reentry approval or writes a Clubcard/promo price.';
