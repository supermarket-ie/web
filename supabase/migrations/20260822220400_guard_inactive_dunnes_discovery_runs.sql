create or replace function public.finalize_dunnes_discovery_product(
  p_run_uuid uuid,
  p_product_id uuid,
  p_outcome text,
  p_canonical_name text,
  p_candidate_sku text default null,
  p_candidate_name text default null,
  p_candidate_url text default null,
  p_price numeric default null,
  p_confidence numeric default null,
  p_pack_ratio numeric default null,
  p_reason text default null
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer;
  v_store_product_id uuid;
  v_attempted integer;
  v_target integer;
  v_extracted integer;
  v_exact integer;
  v_alternative integer;
  v_rejected integer;
  v_run_status text;
begin
  select status into v_run_status from public.scrape_runs where id = p_run_uuid for update;
  if v_run_status is null then raise exception 'Dunnes discovery run not found'; end if;
  if v_run_status <> 'running' then return false; end if;

  if p_outcome not in ('exact','alternative','rejected') then
    raise exception 'Unsupported Dunnes discovery outcome: %', p_outcome;
  end if;

  if p_outcome = 'exact' and (
    p_candidate_sku is null or btrim(p_candidate_sku) = '' or
    p_candidate_name is null or btrim(p_candidate_name) = '' or
    p_candidate_url is null or btrim(p_candidate_url) = '' or
    p_price is null or p_price <= 0
  ) then
    raise exception 'Exact Dunnes discovery finalization requires SKU, name, URL and positive price';
  end if;

  insert into public.dunnes_discovery_receipts (
    run_id, product_id, outcome, candidate_store_sku,
    candidate_store_product_name, candidate_store_url, observed_price,
    confidence_score, pack_ratio, reason
  ) values (
    p_run_uuid, p_product_id, p_outcome, p_candidate_sku,
    p_candidate_name, p_candidate_url, p_price,
    p_confidence, p_pack_ratio, p_reason
  ) on conflict (run_id, product_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  if p_outcome = 'exact' then
    insert into public.store_products (
      product_id, store, store_product_name, store_url, store_sku,
      url_status, url_last_checked_at, url_last_error
    ) values (
      p_product_id, 'dunnes', p_candidate_name, p_candidate_url, p_candidate_sku,
      'resolved', now(), null
    )
    on conflict (product_id, store) do update set
      store_product_name = excluded.store_product_name,
      store_url = excluded.store_url,
      store_sku = excluded.store_sku,
      url_status = 'resolved',
      url_last_checked_at = now(),
      url_last_error = null
    returning id into v_store_product_id;

    insert into public.price_observations (store_product_id, price, observed_at, source)
    values (v_store_product_id, p_price, now(), 'dunnes_direct');

    update public.store_product_alternative_candidates
    set status = 'promoted', last_seen_at = now(),
        reason = coalesce(reason, '') || case when coalesce(reason, '') = '' then '' else ' ' end || 'Promoted after exact Dunnes discovery.'
    where product_id = p_product_id and store = 'dunnes' and status = 'candidate';

  elsif p_outcome = 'alternative' then
    if p_candidate_sku is null or btrim(p_candidate_sku) = '' or p_candidate_name is null or btrim(p_candidate_name) = '' then
      raise exception 'Alternative Dunnes discovery finalization requires SKU and name';
    end if;

    insert into public.store_product_alternative_candidates (
      product_id, store, candidate_store_sku, candidate_store_product_name,
      candidate_store_url, relationship_type, confidence_score, observed_price,
      pack_ratio, source, status, reason, last_seen_at
    ) values (
      p_product_id, 'dunnes', p_candidate_sku, p_candidate_name,
      p_candidate_url, 'same_product_different_pack', p_confidence, p_price,
      p_pack_ratio, 'dunnes_direct_discovery', 'candidate', p_reason, now()
    )
    on conflict (product_id, store, candidate_store_sku) do update set
      candidate_store_product_name = excluded.candidate_store_product_name,
      candidate_store_url = excluded.candidate_store_url,
      relationship_type = excluded.relationship_type,
      confidence_score = excluded.confidence_score,
      observed_price = excluded.observed_price,
      pack_ratio = excluded.pack_ratio,
      source = excluded.source,
      status = 'candidate',
      reason = excluded.reason,
      last_seen_at = now();
  end if;

  update public.scrape_runs
  set attempted_count = attempted_count + 1,
      fetched = fetched + 1,
      extracted = extracted + case when p_outcome in ('exact','alternative') then 1 else 0 end,
      inserted = inserted + case when p_outcome = 'exact' then 1 else 0 end,
      failed = failed + case when p_outcome = 'rejected' then 1 else 0 end
  where id = p_run_uuid
  returning attempted_count, target_count, extracted into v_attempted, v_target, v_extracted;

  if v_attempted >= coalesce(v_target, 0) and coalesce(v_target, 0) > 0 then
    select
      count(*) filter (where outcome = 'exact'),
      count(*) filter (where outcome = 'alternative'),
      count(*) filter (where outcome = 'rejected')
    into v_exact, v_alternative, v_rejected
    from public.dunnes_discovery_receipts where run_id = p_run_uuid;

    update public.scrape_runs
    set finished_at = now(),
        duration_seconds = greatest(0, round(extract(epoch from (now() - started_at)))::integer),
        coverage_pct = round((v_extracted::numeric / v_target::numeric) * 100, 2),
        threshold_breached = false,
        status = 'success',
        error_summary = json_build_object(
          'exact_matches', v_exact,
          'alternative_candidates', v_alternative,
          'rejected', v_rejected
        )::text
    where id = p_run_uuid;
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_dunnes_discovery_product(uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.finalize_dunnes_discovery_product(uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,text) to service_role;
