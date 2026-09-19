-- Preserve business-level coverage history separately from raw scrape health.
-- The operational catalogue remains in Postgres; these snapshots make losses,
-- gains, freshness and shopper-demand coverage observable over time.

create table public.retailer_coverage_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  store text not null check (store in ('supervalu', 'dunnes')),
  source_run_id uuid references public.scrape_runs(id) on delete set null,
  catalogue_products integer not null check (catalogue_products >= 0),
  mapped_products integer not null check (mapped_products >= 0),
  resolved_products integer not null check (resolved_products >= 0),
  live_trusted_products integer not null check (live_trusted_products >= 0),
  ever_observed_products integer not null check (ever_observed_products >= 0),
  never_observed_products integer not null check (never_observed_products >= 0),
  stale_products integer not null check (stale_products >= 0),
  expiring_within_24h integer not null check (expiring_within_24h >= 0),
  demanded_units integer not null check (demanded_units >= 0),
  live_demanded_units integer not null check (live_demanded_units >= 0),
  top_100_demanded_live integer not null check (top_100_demanded_live >= 0 and top_100_demanded_live <= 100),
  live_coverage_pct numeric(5,2) not null,
  demand_coverage_pct numeric(5,2) not null,
  latest_run_status text,
  latest_run_coverage_pct numeric(5,2)
);

create unique index retailer_coverage_snapshots_run_store
  on public.retailer_coverage_snapshots (source_run_id, store)
  where source_run_id is not null;

create index retailer_coverage_snapshots_store_captured
  on public.retailer_coverage_snapshots (store, captured_at desc);

alter table public.retailer_coverage_snapshots enable row level security;
revoke all on public.retailer_coverage_snapshots from public, anon, authenticated;
grant select, insert, update on public.retailer_coverage_snapshots to service_role;
grant usage, select on sequence public.retailer_coverage_snapshots_id_seq to service_role;

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
  where store in ('supervalu', 'dunnes') and status <> 'running'
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
  lr.threshold_pct as latest_run_threshold_pct
from stores s
cross join catalogue c
left join mapping m on m.store = s.store
left join observation_health oh on oh.store = s.store
left join live l on l.store = s.store
left join demand_health dh on dh.store = s.store
left join latest_run lr on lr.store = s.store;

create or replace view public.retailer_comparison_coverage_current
with (security_invoker = true)
as
with flags as (
  select
    p.id,
    exists (
      select 1 from public.latest_prices lp
      where lp.canonical_product_id = p.id and lp.store = 'supervalu'
    ) as supervalu_live,
    exists (
      select 1 from public.latest_prices lp
      where lp.canonical_product_id = p.id and lp.store = 'dunnes'
    ) as dunnes_live
  from public.products p
)
select
  count(*)::integer as catalogue_products,
  count(*) filter (where supervalu_live and dunnes_live)::integer as both_live,
  count(*) filter (where supervalu_live and not dunnes_live)::integer as supervalu_only,
  count(*) filter (where dunnes_live and not supervalu_live)::integer as dunnes_only,
  count(*) filter (where not supervalu_live and not dunnes_live)::integer as neither_live,
  round(100 * count(*) filter (where supervalu_live and dunnes_live)::numeric / nullif(count(*), 0), 2) as both_live_pct,
  round(100 * count(*) filter (where supervalu_live or dunnes_live)::numeric / nullif(count(*), 0), 2) as either_live_pct
from flags;

create or replace view public.retailer_category_coverage_current
with (security_invoker = true)
as
with flags as (
  select
    p.id,
    coalesce(nullif(btrim(p.category), ''), 'Uncategorised') as category,
    exists (
      select 1 from public.latest_prices lp
      where lp.canonical_product_id = p.id and lp.store = 'supervalu'
    ) as supervalu_live,
    exists (
      select 1 from public.latest_prices lp
      where lp.canonical_product_id = p.id and lp.store = 'dunnes'
    ) as dunnes_live
  from public.products p
)
select
  category,
  count(*)::integer as catalogue_products,
  count(*) filter (where supervalu_live)::integer as supervalu_live,
  count(*) filter (where dunnes_live)::integer as dunnes_live,
  count(*) filter (where supervalu_live and dunnes_live)::integer as both_live,
  count(*) filter (where not supervalu_live and not dunnes_live)::integer as neither_live,
  round(100 * count(*) filter (where supervalu_live)::numeric / nullif(count(*), 0), 2) as supervalu_pct,
  round(100 * count(*) filter (where dunnes_live)::numeric / nullif(count(*), 0), 2) as dunnes_pct
from flags
group by category;

revoke all on public.retailer_coverage_current from public, anon, authenticated;
revoke all on public.retailer_comparison_coverage_current from public, anon, authenticated;
revoke all on public.retailer_category_coverage_current from public, anon, authenticated;
grant select on public.retailer_coverage_current to service_role;
grant select on public.retailer_comparison_coverage_current to service_role;
grant select on public.retailer_category_coverage_current to service_role;

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
begin
  if p_store not in ('supervalu', 'dunnes') then
    raise exception 'Unsupported retailer coverage snapshot store: %', p_store;
  end if;

  insert into public.retailer_coverage_snapshots (
    store, source_run_id, catalogue_products, mapped_products, resolved_products,
    live_trusted_products, ever_observed_products, never_observed_products,
    stale_products, expiring_within_24h, demanded_units, live_demanded_units,
    top_100_demanded_live, live_coverage_pct, demand_coverage_pct,
    latest_run_status, latest_run_coverage_pct
  )
  select
    store, p_source_run_id, catalogue_products, mapped_products, resolved_products,
    live_trusted_products, ever_observed_products, never_observed_products,
    stale_products, expiring_within_24h, demanded_units, live_demanded_units,
    top_100_demanded_live, live_coverage_pct, demand_coverage_pct,
    latest_run_status, latest_run_coverage_pct
  from public.retailer_coverage_current
  where store = p_store
  on conflict (source_run_id, store) where source_run_id is not null do update
  set captured_at = now(),
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

revoke all on function public.capture_retailer_coverage_snapshot(text, uuid)
  from public, anon, authenticated;
grant execute on function public.capture_retailer_coverage_snapshot(text, uuid)
  to service_role;

create or replace function public.capture_completed_retailer_run_coverage()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.store in ('supervalu', 'dunnes')
     and new.status in ('success', 'degraded', 'failed', 'timeout')
     and old.status is distinct from new.status then
    perform public.capture_retailer_coverage_snapshot(new.store, new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.capture_completed_retailer_run_coverage()
  from public, anon, authenticated;

create trigger capture_completed_retailer_run_coverage
after update of status on public.scrape_runs
for each row execute function public.capture_completed_retailer_run_coverage();

comment on table public.retailer_coverage_snapshots is
  'Private business-level coverage history captured when direct retailer runs complete.';
comment on view public.retailer_coverage_current is
  'Private current mapping, freshness, trusted-price and demand coverage for SuperValu and Dunnes.';
comment on view public.retailer_comparison_coverage_current is
  'Private current SuperValu/Dunnes overlap coverage across the canonical catalogue.';

-- Establish a baseline immediately when the migration is deployed.
select public.capture_retailer_coverage_snapshot('supervalu', null);
select public.capture_retailer_coverage_snapshot('dunnes', null);
