-- Tesco Apify: narrow, evidence-bound FIRST-PRICE path for EXPANSION mappings
-- that have never been priced and have NO prior success receipt.
--
-- WHY: the reserve RPC (20261109140000) requires a prior success receipt
-- (`mapping_not_resolved_or_unproven`) for EVERY mapping. That excludes the
-- large cohort of resolved, canonical-URL, never-observed mappings whose
-- identity is independently corroborated by fresh Dunnes/SuperValu peers — the
-- single biggest lever for growing fresh coverage. This migration adds a
-- narrow, EXPANSION-ONLY opt-in that waives ONLY the prior-receipt requirement.
--
-- WHAT IS PRESERVED (unchanged): resolved url_status, canonical product URL,
-- the authoritative snapshot match (no rice→eggs drift), the not-already-
-- observed (expansion) check, the 24h pending/recent exclusion, 10s pacing,
-- lease fencing + owner, and — in the collector — the deterministic identity
-- gate AND an independent AI verified_exact verdict bound to the live identity
-- fingerprint AND independentExactIdentity with fresh peers before finalise.
-- The first price is still written ONLY through apify_finalise_tesco_page /
-- finalize_store_scrape_product (positive regular price, receipt created on
-- success). RENEWAL can NEVER waive proven (a renewal by definition has a
-- prior price). This is the "single-use, evidence-bound approval" path: one
-- guarded finalise writes the first price + its first success receipt, after
-- which the mapping is ordinary/proven.
--
-- SUPERSEDES apify_reserve_tesco_request from 20261109140000 by adding a
-- trailing boolean parameter (default false → existing callers unchanged).

drop function if exists public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb);
create function public.apify_reserve_tesco_request(
  p_run_id uuid, p_egress_key text, p_lease_token uuid, p_owner text,
  p_store_product_id uuid, p_store_url text, p_mode text, p_expected_snapshot jsonb,
  p_allow_first_price boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_observed_at timestamptz;
  v_snapshot jsonb;
  v_proven boolean;
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
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;

  v_proven := exists (select 1 from public.scrape_product_receipts r
    where r.store_product_id = p_store_product_id and r.outcome = 'success');

  -- Structural identity preconditions + prior-receipt requirement. The receipt
  -- requirement is waived ONLY for an expansion FIRST PRICE when the caller
  -- explicitly opts in; renewal always requires proven. The exception name is
  -- unchanged (mapping_not_resolved_or_unproven) so existing callers/tooling
  -- observe identical behaviour for every pre-existing rejection.
  if v_snapshot->>'url_status' <> 'resolved'
    or v_snapshot->>'store_url' <> p_store_url
    or v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || (v_snapshot->>'store_sku')
    or (not v_proven and not (p_allow_first_price and p_mode = 'expansion'))
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
    jsonb_build_object('provider', 'apify', 'firstPrice', (not v_proven))::text);
  return jsonb_build_object('reserved', true, 'snapshot', v_snapshot, 'firstPrice', (not v_proven));
end;
$$;

revoke all on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apify_reserve_tesco_request(uuid, text, uuid, text, uuid, text, text, jsonb, boolean) to service_role;

comment on function public.apify_reserve_tesco_request is
  'Reserve a guarded Apify request. Enforces gate/lease/owner, snapshot match, resolved canonical URL, due/observation, 24h pending-recent exclusion, pacing. Prior-success-receipt required EXCEPT an expansion first price (p_allow_first_price=true, p_mode=expansion), which still needs the collector deterministic gate + independent AI verified_exact + independentExactIdentity before the guarded finalise writes the first price and its first receipt.';
