-- Generic idempotent product finalisation for Vercel-native store workers.
-- Additive only. Existing EC2 scrapers are unaffected.

create or replace function public.finalize_store_scrape_product(
  p_run_uuid uuid,
  p_store text,
  p_store_product_id uuid,
  p_success boolean,
  p_price numeric default null,
  p_previous_price numeric default null,
  p_was_price numeric default null,
  p_on_promotion boolean default false,
  p_store_url text default null,
  p_store_sku text default null,
  p_store_product_name text default null,
  p_fetched integer default 0,
  p_extracted integer default 0,
  p_failure_stage text default null,
  p_failure_reason text default null,
  p_canonical_name text default null,
  p_raw_error text default null,
  p_is_retryable boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer;
  v_is_unchanged boolean := false;
  v_attempted integer;
  v_target integer;
  v_inserted_count integer;
  v_unchanged_count integer;
  v_threshold numeric;
  v_coverage numeric;
  v_status text;
begin
  if p_store is null or btrim(p_store) = '' then
    raise exception 'Store is required';
  end if;

  if p_success and (p_price is null or p_price <= 0) then
    raise exception 'Successful scrape finalisation requires a positive price';
  end if;

  insert into public.scrape_product_receipts (run_id, store_product_id, outcome)
  values (p_run_uuid, p_store_product_id, case when p_success then 'success' else 'failure' end)
  on conflict (run_id, store_product_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  if p_success then
    v_is_unchanged := p_previous_price is not null and abs(p_previous_price - p_price) < 0.001;

    insert into public.price_observations (
      store_product_id, price, was_price, on_promotion, observed_at
    ) values (
      p_store_product_id, p_price, p_was_price, coalesce(p_on_promotion, false), now()
    );

    update public.store_products
    set store_url = coalesce(p_store_url, store_url),
        store_sku = coalesce(p_store_sku, store_sku),
        store_product_name = coalesce(p_store_product_name, store_product_name)
    where id = p_store_product_id;
  else
    insert into public.scrape_failures (
      run_id, store_product_id, store, failure_stage, failure_reason,
      store_url, canonical_name, is_retryable, consecutive_failures, raw_error
    ) values (
      p_run_uuid, p_store_product_id, p_store,
      coalesce(p_failure_stage, 'fetching'), coalesce(p_failure_reason, 'unknown'),
      p_store_url, p_canonical_name, coalesce(p_is_retryable, false), 1,
      left(p_raw_error, 500)
    )
    on conflict (run_id, store_product_id, failure_reason) do nothing;
  end if;

  update public.scrape_runs
  set attempted_count = attempted_count + 1,
      fetched = fetched + greatest(p_fetched, 0),
      extracted = extracted + greatest(p_extracted, 0),
      inserted = inserted + case when p_success and not v_is_unchanged then 1 else 0 end,
      unchanged_count = unchanged_count + case when p_success and v_is_unchanged then 1 else 0 end,
      failed = failed + case when p_success then 0 else 1 end
  where id = p_run_uuid
  returning attempted_count, target_count, inserted, unchanged_count,
            coalesce(threshold_pct, 70)
  into v_attempted, v_target, v_inserted_count, v_unchanged_count, v_threshold;

  if v_attempted >= coalesce(v_target, 0) and coalesce(v_target, 0) > 0 then
    v_coverage := round(((v_inserted_count + v_unchanged_count)::numeric / v_target::numeric) * 100, 2);
    v_status := case
      when v_coverage >= v_threshold then 'success'
      when v_coverage >= (v_threshold * 0.5) then 'degraded'
      else 'failed'
    end;

    update public.scrape_runs
    set finished_at = now(),
        duration_seconds = greatest(0, round(extract(epoch from (now() - started_at)))::integer),
        coverage_pct = v_coverage,
        threshold_breached = v_coverage < v_threshold,
        status = v_status
    where id = p_run_uuid;
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_store_scrape_product(
  uuid, text, uuid, boolean, numeric, numeric, numeric, boolean,
  text, text, text, integer, integer, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.finalize_store_scrape_product(
  uuid, text, uuid, boolean, numeric, numeric, numeric, boolean,
  text, text, text, integer, integer, text, text, text, text, boolean
) to service_role;
