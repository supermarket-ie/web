create table public.tesco_candidate_discovery_evidence (
  id uuid primary key default gen_random_uuid(),
  run_uuid uuid not null references public.scrape_runs(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  candidate_index integer not null check (candidate_index >= 0),
  query_text text not null,
  candidate_name text,
  candidate_url text,
  candidate_sku text,
  candidate_price_cents integer check (candidate_price_cents is null or candidate_price_cents >= 0),
  classification text not null check (classification in (
    'exact_replacement_candidate', 'material_mismatch', 'ambiguous', 'insufficient_evidence'
  )),
  reasons jsonb not null,
  identity_signals jsonb not null,
  raw_candidate jsonb not null,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_uuid, store_product_id, candidate_index)
);

alter table public.tesco_candidate_discovery_evidence enable row level security;
revoke all on public.tesco_candidate_discovery_evidence from public, anon, authenticated;
grant select, insert, update on public.tesco_candidate_discovery_evidence to service_role;

create index tesco_candidate_discovery_store_product_idx
  on public.tesco_candidate_discovery_evidence (store_product_id, created_at desc);
create index tesco_candidate_discovery_run_classification_idx
  on public.tesco_candidate_discovery_evidence (run_uuid, classification);

comment on table public.tesco_candidate_discovery_evidence is
  'Private candidate-level evidence from single-query Tesco discovery canaries; candidates are never trusted without exact deterministic classification.';

create or replace function public.finalize_tesco_candidate_discovery(
  p_run_uuid uuid,
  p_candidate_id uuid,
  p_previous_price numeric default null,
  p_on_promotion boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_candidate public.tesco_candidate_discovery_evidence%rowtype;
  v_inserted integer;
  v_attempted integer;
  v_target integer;
  v_inserted_count integer;
  v_unchanged_count integer;
  v_threshold numeric;
  v_coverage numeric;
  v_price numeric;
begin
  select c.* into v_candidate
  from public.tesco_candidate_discovery_evidence c
  join public.scrape_runs r on r.id = c.run_uuid
  where c.id = p_candidate_id
    and c.run_uuid = p_run_uuid
    and r.store = 'tesco'
    and r.retrieval_method = 'pepesto_candidate_discovery'
    and r.status = 'running'
    and c.classification = 'exact_replacement_candidate'
    and c.selected_at is null
  for update of c;

  if not found then raise exception 'Candidate is not eligible for Tesco discovery finalisation'; end if;
  if v_candidate.candidate_sku is null or v_candidate.candidate_url is null or v_candidate.candidate_name is null then
    raise exception 'Exact Tesco candidate identity is incomplete';
  end if;
  if (select count(distinct c.candidate_sku)
      from public.tesco_candidate_discovery_evidence c
      where c.run_uuid = p_run_uuid
        and c.store_product_id = v_candidate.store_product_id
        and c.classification = 'exact_replacement_candidate') <> 1 then
    raise exception 'Tesco discovery finalisation requires exactly one distinct exact candidate';
  end if;

  v_price := coalesce(v_candidate.candidate_price_cents, 0)::numeric / 100;
  if v_price <= 0 then raise exception 'Tesco discovery finalisation requires a positive candidate price'; end if;

  insert into public.scrape_product_receipts(run_id, store_product_id, outcome)
  values (p_run_uuid, v_candidate.store_product_id, 'success')
  on conflict (run_id, store_product_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  update public.store_products sp
  set store_url = v_candidate.candidate_url,
      store_sku = v_candidate.candidate_sku,
      store_product_name = v_candidate.candidate_name,
      brand = p.brand,
      is_own_brand = lower(v_candidate.candidate_name) like 'tesco %',
      url_status = 'resolved',
      url_last_checked_at = now(),
      url_last_error = null
  from public.products p
  where sp.id = v_candidate.store_product_id
    and p.id = sp.product_id
    and sp.store = 'tesco'
    and sp.url_status = 'failed'
    and sp.url_last_error like 'tesco_mapping_audit:%';
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then raise exception 'Audited Tesco mapping guard did not match'; end if;

  insert into public.price_observations(store_product_id, price, was_price, on_promotion, observed_at, source)
  values (v_candidate.store_product_id, v_price, null, coalesce(p_on_promotion, false), now(), 'pepesto_search');

  update public.tesco_candidate_discovery_evidence
  set selected_at = now()
  where id = v_candidate.id;

  insert into public.retailer_mapping_audit_decisions (
    decision_batch, store_product_id, store, classification, reason,
    evidence_source, prior_mapping, applied_action, applied_at
  )
  select
    'tesco-candidate-discovery-' || p_run_uuid::text,
    sp.id, 'tesco', 'exact_replacement_candidate',
    'single-query discovery produced exactly one candidate passing all strict identity checks',
    'pepesto_search_single_candidate_evidence',
    jsonb_build_object(
      'product_id', sp.product_id,
      'store_product_name', prior.prior_mapping ->> 'store_product_name',
      'store_sku', prior.prior_mapping ->> 'store_sku',
      'store_url', prior.prior_mapping ->> 'store_url',
      'candidate_evidence_id', v_candidate.id
    ),
    'restore_exact_replacement', now()
  from public.store_products sp
  join lateral (
    select d.prior_mapping
    from public.retailer_mapping_audit_decisions d
    where d.store_product_id = sp.id and d.applied_action = 'invalidate_trusted_mapping'
    order by d.applied_at desc limit 1
  ) prior on true
  where sp.id = v_candidate.store_product_id
  on conflict (decision_batch, store_product_id) do nothing;

  update public.scrape_runs
  set attempted_count = attempted_count + 1,
      fetched = fetched + 1,
      extracted = extracted + 1,
      inserted = inserted + case when p_previous_price is null or abs(p_previous_price - v_price) >= 0.001 then 1 else 0 end,
      unchanged_count = unchanged_count + case when p_previous_price is not null and abs(p_previous_price - v_price) < 0.001 then 1 else 0 end
  where id = p_run_uuid
  returning attempted_count, target_count, inserted, unchanged_count, coalesce(threshold_pct, 70)
  into v_attempted, v_target, v_inserted_count, v_unchanged_count, v_threshold;

  if v_attempted >= coalesce(v_target, 0) and coalesce(v_target, 0) > 0 then
    v_coverage := round(((v_inserted_count + v_unchanged_count)::numeric / v_target::numeric) * 100, 2);
    update public.scrape_runs
    set finished_at = now(),
        duration_seconds = greatest(0, round(extract(epoch from (now() - started_at)))::integer),
        coverage_pct = v_coverage,
        threshold_breached = v_coverage < v_threshold,
        status = case when v_coverage >= v_threshold then 'success' when v_coverage >= v_threshold * 0.5 then 'degraded' else 'failed' end
    where id = p_run_uuid;
  end if;
  return true;
end;
$$;

revoke all on function public.finalize_tesco_candidate_discovery(uuid, uuid, numeric, boolean) from public, anon, authenticated;
grant execute on function public.finalize_tesco_candidate_discovery(uuid, uuid, numeric, boolean) to service_role;
