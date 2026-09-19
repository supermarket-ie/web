-- Keep deliberately failure-heavy validation and canary runs from replacing
-- the scheduled full-run health signal while retaining them for diagnosis.

alter table public.scrape_runs
  add column if not exists run_scope text not null default 'manual';

alter table public.scrape_runs
  drop constraint if exists scrape_runs_run_scope_check;

alter table public.scrape_runs
  add constraint scrape_runs_run_scope_check check (
    run_scope in (
      'scheduled_full',
      'targeted_validation',
      'canary',
      'catch_up',
      'discovery',
      'manual'
    )
  );

update public.scrape_runs
set run_scope = case
  when retrieval_method ilike '%canary%' then 'canary'
  when retrieval_method ilike '%discovery%' then 'discovery'
  when store in ('supervalu', 'dunnes')
    and retrieval_method in (
      'vercel_direct_product_page',
      'vercel_queue_dunnes_api_resolved_first'
    )
    and target_count >= 1000 then 'scheduled_full'
  when store in ('supervalu', 'dunnes')
    and retrieval_method in (
      'vercel_direct_product_page',
      'vercel_queue_dunnes_api_resolved_first'
    ) then 'targeted_validation'
  else run_scope
end;

create index if not exists scrape_runs_store_scope_started
  on public.scrape_runs (store, run_scope, started_at desc)
  where status <> 'running';

alter table public.retailer_coverage_snapshots
  add column if not exists source_run_scope text;

alter table public.retailer_coverage_snapshots
  drop constraint if exists retailer_coverage_snapshots_source_run_scope_check;

alter table public.retailer_coverage_snapshots
  add constraint retailer_coverage_snapshots_source_run_scope_check check (
    source_run_scope is null or source_run_scope in (
      'scheduled_full',
      'targeted_validation',
      'canary',
      'catch_up',
      'discovery',
      'manual'
    )
  );

update public.retailer_coverage_snapshots snapshots
set source_run_scope = runs.run_scope
from public.scrape_runs runs
where snapshots.source_run_id = runs.id
  and snapshots.source_run_scope is distinct from runs.run_scope;

create or replace view public.retailer_coverage_current
with (security_invoker = true)
as
with stores(store) as (
  values ('supervalu'::text), ('dunnes'::text)
),
catalogue as (
  select count(*)::integer as product_count from public.products
),
latest_observation as (
  select sp.store, sp.product_id, max(po.observed_at) as last_observed_at
  from public.store_products sp
  left join public.price_observations po on po.store_product_id = sp.id
  where sp.store in ('supervalu', 'dunnes')
  group by sp.store, sp.product_id
),
mapping as (
  select
    sp.store,
    count(distinct sp.product_id)::integer as mapped_products,
    count(distinct sp.product_id) filter (
      where sp.url_status = 'resolved'
        and nullif(btrim(sp.store_sku), '') is not null
        and nullif(btrim(sp.store_product_name), '') is not null
        and nullif(btrim(sp.store_url), '') is not null
        and not (sp.store = 'supervalu' and sp.store_url like '%/search-results%')
    )::integer as resolved_products
  from public.store_products sp
  where sp.store in ('supervalu', 'dunnes')
  group by sp.store
),
observation_health as (
  select
    store,
    count(*) filter (where last_observed_at is not null)::integer as ever_observed_products,
    count(*) filter (where last_observed_at is null)::integer as never_observed_products,
    count(*) filter (where last_observed_at < now() - interval '7 days')::integer as stale_products,
    count(*) filter (
      where last_observed_at >= now() - interval '7 days'
        and last_observed_at < now() - interval '6 days'
    )::integer as expiring_within_24h
  from latest_observation
  group by store
),
live as (
  select store, count(distinct canonical_product_id)::integer as live_trusted_products
  from public.latest_prices
  where store in ('supervalu', 'dunnes')
  group by store
),
demand as (
  select
    p.id as product_id,
    sum(greatest(coalesce(li.quantity, 1), 1))::integer as units,
    row_number() over (
      order by sum(greatest(coalesce(li.quantity, 1), 1)) desc, p.id
    ) as demand_rank
  from public.list_items li
  join public.products p on lower(btrim(p.canonical_name)) = lower(btrim(li.canonical_name))
  group by p.id
),
demand_health as (
  select
    s.store,
    coalesce(sum(d.units), 0)::integer as demanded_units,
    coalesce(sum(d.units) filter (where lp.canonical_product_id is not null), 0)::integer as live_demanded_units,
    count(*) filter (where d.demand_rank <= 100 and lp.canonical_product_id is not null)::integer as top_100_demanded_live
  from stores s
  cross join demand d
  left join public.latest_prices lp
    on lp.canonical_product_id = d.product_id
   and lp.store = s.store
  group by s.store
),
latest_run as (
  select distinct on (store)
    store, id as run_uuid, run_id, status, started_at, finished_at, coverage_pct, threshold_pct
  from public.scrape_runs
  where store in ('supervalu', 'dunnes')
    and status <> 'running'
    and run_scope = 'scheduled_full'
  order by store, started_at desc
),
latest_auxiliary_run as (
  select distinct on (store)
    store, id as run_uuid, run_id, run_scope, status, started_at, finished_at, coverage_pct, threshold_pct
  from public.scrape_runs
  where store in ('supervalu', 'dunnes')
    and status <> 'running'
    and run_scope <> 'scheduled_full'
  order by store, started_at desc
)
select
  s.store,
  c.product_count as catalogue_products,
  coalesce(m.mapped_products, 0) as mapped_products,
  coalesce(m.resolved_products, 0) as resolved_products,
  coalesce(l.live_trusted_products, 0) as live_trusted_products,
  coalesce(oh.ever_observed_products, 0) as ever_observed_products,
  coalesce(oh.never_observed_products, 0) as never_observed_products,
  coalesce(oh.stale_products, 0) as stale_products,
  coalesce(oh.expiring_within_24h, 0) as expiring_within_24h,
  coalesce(dh.demanded_units, 0) as demanded_units,
  coalesce(dh.live_demanded_units, 0) as live_demanded_units,
  coalesce(dh.top_100_demanded_live, 0) as top_100_demanded_live,
  coalesce(round(100 * coalesce(l.live_trusted_products, 0)::numeric / nullif(c.product_count, 0), 2), 0) as live_coverage_pct,
  coalesce(round(100 * coalesce(dh.live_demanded_units, 0)::numeric / nullif(dh.demanded_units, 0), 2), 0) as demand_coverage_pct,
  lr.run_uuid as latest_run_uuid,
  lr.run_id as latest_run_id,
  lr.status as latest_run_status,
  lr.started_at as latest_run_started_at,
  lr.finished_at as latest_run_finished_at,
  lr.coverage_pct as latest_run_coverage_pct,
  lr.threshold_pct as latest_run_threshold_pct,
  ar.run_uuid as latest_auxiliary_run_uuid,
  ar.run_id as latest_auxiliary_run_id,
  ar.run_scope as latest_auxiliary_run_scope,
  ar.status as latest_auxiliary_run_status,
  ar.started_at as latest_auxiliary_run_started_at,
  ar.finished_at as latest_auxiliary_run_finished_at,
  ar.coverage_pct as latest_auxiliary_run_coverage_pct,
  ar.threshold_pct as latest_auxiliary_run_threshold_pct
from stores s
cross join catalogue c
left join mapping m on m.store = s.store
left join observation_health oh on oh.store = s.store
left join live l on l.store = s.store
left join demand_health dh on dh.store = s.store
left join latest_run lr on lr.store = s.store
left join latest_auxiliary_run ar on ar.store = s.store;

revoke all on public.retailer_coverage_current from public, anon, authenticated;
grant select on public.retailer_coverage_current to service_role;

create or replace function public.capture_retailer_coverage_snapshot(
  p_store text,
  p_source_run_id uuid default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_snapshot_id bigint;
  v_source_run_scope text;
begin
  if p_store not in ('supervalu', 'dunnes') then
    raise exception 'Unsupported retailer coverage snapshot store: %', p_store;
  end if;

  if p_source_run_id is not null then
    select run_scope into v_source_run_scope
    from public.scrape_runs
    where id = p_source_run_id;
  end if;

  insert into public.retailer_coverage_snapshots (
    store, source_run_id, source_run_scope, catalogue_products, mapped_products,
    resolved_products, live_trusted_products, ever_observed_products,
    never_observed_products, stale_products, expiring_within_24h, demanded_units,
    live_demanded_units, top_100_demanded_live, live_coverage_pct,
    demand_coverage_pct, latest_run_status, latest_run_coverage_pct
  )
  select
    store, p_source_run_id, v_source_run_scope, catalogue_products, mapped_products,
    resolved_products, live_trusted_products, ever_observed_products,
    never_observed_products, stale_products, expiring_within_24h, demanded_units,
    live_demanded_units, top_100_demanded_live, live_coverage_pct,
    demand_coverage_pct, latest_run_status, latest_run_coverage_pct
  from public.retailer_coverage_current
  where store = p_store
  on conflict (source_run_id, store) where source_run_id is not null do update
  set captured_at = now(),
      source_run_scope = excluded.source_run_scope,
      catalogue_products = excluded.catalogue_products,
      mapped_products = excluded.mapped_products,
      resolved_products = excluded.resolved_products,
      live_trusted_products = excluded.live_trusted_products,
      ever_observed_products = excluded.ever_observed_products,
      never_observed_products = excluded.never_observed_products,
      stale_products = excluded.stale_products,
      expiring_within_24h = excluded.expiring_within_24h,
      demanded_units = excluded.demanded_units,
      live_demanded_units = excluded.live_demanded_units,
      top_100_demanded_live = excluded.top_100_demanded_live,
      live_coverage_pct = excluded.live_coverage_pct,
      demand_coverage_pct = excluded.demand_coverage_pct,
      latest_run_status = excluded.latest_run_status,
      latest_run_coverage_pct = excluded.latest_run_coverage_pct
  returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$$;

comment on column public.scrape_runs.run_scope is
  'Operational scope: scheduled full health, targeted validation, canary, catch-up, discovery or manual.';
comment on column public.retailer_coverage_snapshots.source_run_scope is
  'Scope of the run that caused this coverage snapshot; null for standalone baselines.';
comment on view public.retailer_coverage_current is
  'Private current retailer coverage with scheduled full-run health separated from auxiliary validation runs.';
