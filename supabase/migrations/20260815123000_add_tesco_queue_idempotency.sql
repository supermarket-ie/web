-- Durable idempotency/finalisation for the Vercel Queue Tesco worker.
-- Additive only: EC2 scraper does not use these objects.

create table if not exists public.scrape_product_receipts (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  outcome text not null check (outcome in ('success', 'failure')),
  created_at timestamptz not null default now(),
  primary key (run_id, store_product_id)
);

create table if not exists public.scrape_fetch_attempts (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  delivery_count integer not null check (delivery_count > 0),
  scrapingbee_requests integer not null default 0,
  scrapingbee_credits integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (run_id, store_product_id, delivery_count)
);

alter table public.scrape_product_receipts enable row level security;
alter table public.scrape_fetch_attempts enable row level security;
revoke all on public.scrape_product_receipts from anon, authenticated;
revoke all on public.scrape_fetch_attempts from anon, authenticated;

create index if not exists scrape_product_receipts_run_idx
  on public.scrape_product_receipts (run_id, created_at);
create index if not exists scrape_fetch_attempts_run_idx
  on public.scrape_fetch_attempts (run_id, created_at);

create or replace function public.record_tesco_scrape_attempt(
  p_run_uuid uuid,
  p_store_product_id uuid,
  p_delivery_count integer,
  p_scrapingbee_requests integer,
  p_scrapingbee_credits integer
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer;
begin
  insert into public.scrape_fetch_attempts (
    run_id, store_product_id, delivery_count, scrapingbee_requests, scrapingbee_credits
  ) values (
    p_run_uuid, p_store_product_id, p_delivery_count,
    greatest(p_scrapingbee_requests, 0), greatest(p_scrapingbee_credits, 0)
  )
  on conflict (run_id, store_product_id, delivery_count) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return false;
  end if;

  update public.scrape_runs
  set scrapingbee_requests = coalesce(scrapingbee_requests, 0) + greatest(p_scrapingbee_requests, 0),
      scrapingbee_credits = coalesce(scrapingbee_credits, 0) + greatest(p_scrapingbee_credits, 0)
  where id = p_run_uuid;

  return true;
end;
$$;

create or replace function public.finalize_tesco_scrape_product(
  p_run_uuid uuid,
  p_store_product_id uuid,
  p_success boolean,
  p_price numeric default null,
  p_previous_price numeric default null,
  p_store_url text default null,
  p_store_sku text default null,
  p_store_product_name text default null,
  p_fetched integer default 0,
  p_extracted integer default 0,
  p_scrapingbee_requests integer default 0,
  p_scrapingbee_credits integer default 0,
  p_failure_stage text default null,
  p_failure_reason text default null,
  p_canonical_name text default null,
  p_raw_error text default null
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
  if p_success and (p_price is null or p_price <= 0) then
    raise exception 'Successful Tesco finalisation requires a positive price';
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
      p_store_product_id, p_price, null, false, now()
    );

    if p_store_url is not null then
      update public.store_products
      set store_url = p_store_url,
          store_sku = coalesce(p_store_sku, store_sku),
          store_product_name = coalesce(p_store_product_name, store_product_name)
      where id = p_store_product_id;
    end if;
  else
    insert into public.scrape_failures (
      run_id, store_product_id, store, failure_stage, failure_reason,
      store_url, canonical_name, is_retryable, consecutive_failures, raw_error
    ) values (
      p_run_uuid, p_store_product_id, 'tesco', coalesce(p_failure_stage, 'fetching'),
      coalesce(p_failure_reason, 'unknown'), p_store_url, p_canonical_name,
      false, 1, left(p_raw_error, 500)
    )
    on conflict (run_id, store_product_id, failure_reason) do nothing;
  end if;

  update public.scrape_runs
  set attempted_count = attempted_count + 1,
      fetched = fetched + greatest(p_fetched, 0),
      extracted = extracted + greatest(p_extracted, 0),
      inserted = inserted + case when p_success and not v_is_unchanged then 1 else 0 end,
      unchanged_count = unchanged_count + case when p_success and v_is_unchanged then 1 else 0 end,
      failed = failed + case when p_success then 0 else 1 end,
      scrapingbee_requests = coalesce(scrapingbee_requests, 0) + greatest(p_scrapingbee_requests, 0),
      scrapingbee_credits = coalesce(scrapingbee_credits, 0) + greatest(p_scrapingbee_credits, 0)
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

revoke all on function public.record_tesco_scrape_attempt(uuid, uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_tesco_scrape_attempt(uuid, uuid, integer, integer, integer)
  to service_role;

revoke all on function public.finalize_tesco_scrape_product(
  uuid, uuid, boolean, numeric, numeric, text, text, text,
  integer, integer, integer, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_tesco_scrape_product(
  uuid, uuid, boolean, numeric, numeric, text, text, text,
  integer, integer, integer, integer, text, text, text, text
) to service_role;
