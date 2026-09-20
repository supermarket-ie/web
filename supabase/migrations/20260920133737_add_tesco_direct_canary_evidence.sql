create table if not exists public.tesco_direct_canary_results (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  requested_url text not null,
  final_url text,
  expected_sku text,
  returned_sku text,
  returned_name text,
  price numeric,
  availability text not null default 'unknown',
  classification text not null check (classification in (
    'successful_exact_sku', 'redirected_exact_sku', 'redirected_to_different_sku',
    'product_removed_or_unavailable', 'access_challenge_response', 'parsing_failure',
    'network_failure', 'insufficient_evidence'
  )),
  http_status integer,
  detail text,
  created_at timestamptz not null default now(),
  primary key (run_id, store_product_id)
);

alter table public.tesco_direct_canary_results enable row level security;
revoke all on public.tesco_direct_canary_results from public, anon, authenticated;
grant all on public.tesco_direct_canary_results to service_role;

create index if not exists tesco_direct_canary_results_run_classification
  on public.tesco_direct_canary_results (run_id, classification);

create or replace view public.retailer_coverage_current
with (security_invoker = true)
as
with stores(store) as (values ('supervalu'::text), ('dunnes'::text), ('tesco'::text)),
catalogue as (select count(*)::integer product_count from public.products),
latest_observation as (
  select sp.store, sp.product_id, max(po.observed_at) last_observed_at
  from public.store_products sp left join public.price_observations po on po.store_product_id=sp.id
  where sp.store in ('supervalu','dunnes','tesco') group by sp.store,sp.product_id
),
mapping as (
  select sp.store, count(distinct sp.product_id)::integer mapped_products,
    count(distinct sp.product_id) filter (where sp.url_status='resolved'
      and nullif(btrim(sp.store_sku),'') is not null and nullif(btrim(sp.store_product_name),'') is not null
      and nullif(btrim(sp.store_url),'') is not null
      and not (sp.store='supervalu' and sp.store_url like '%/search-results%'))::integer resolved_products
  from public.store_products sp where sp.store in ('supervalu','dunnes','tesco') group by sp.store
),
observation_health as (
  select store, count(*) filter(where last_observed_at is not null)::integer ever_observed_products,
    count(*) filter(where last_observed_at is null)::integer never_observed_products,
    count(*) filter(where last_observed_at < now()-interval '7 days')::integer stale_products,
    count(*) filter(where last_observed_at >= now()-interval '7 days' and last_observed_at < now()-interval '6 days')::integer expiring_within_24h
  from latest_observation group by store
),
live as (
  select store,count(distinct canonical_product_id)::integer live_trusted_products
  from public.latest_prices where store in ('supervalu','dunnes','tesco') group by store
),
demand as (
  select p.id product_id,sum(greatest(coalesce(li.quantity,1),1))::integer units,
    row_number() over(order by sum(greatest(coalesce(li.quantity,1),1)) desc,p.id) demand_rank
  from public.list_items li join public.products p on lower(btrim(p.canonical_name))=lower(btrim(li.canonical_name)) group by p.id
),
demand_health as (
  select s.store,coalesce(sum(d.units),0)::integer demanded_units,
    coalesce(sum(d.units) filter(where lp.canonical_product_id is not null),0)::integer live_demanded_units,
    count(*) filter(where d.demand_rank<=100 and lp.canonical_product_id is not null)::integer top_100_demanded_live
  from stores s cross join demand d left join public.latest_prices lp on lp.canonical_product_id=d.product_id and lp.store=s.store group by s.store
),
latest_run as (
  select distinct on(store) store,id run_uuid,run_id,status,started_at,finished_at,coverage_pct,threshold_pct
  from public.scrape_runs where store in ('supervalu','dunnes','tesco') and status<>'running'
    and (run_scope='scheduled_full' or (store='tesco' and run_scope='manual'))
  order by store,started_at desc
),
latest_auxiliary_run as (
  select distinct on(store) store,id run_uuid,run_id,run_scope,status,started_at,finished_at,coverage_pct,threshold_pct
  from public.scrape_runs where store in ('supervalu','dunnes','tesco') and status<>'running'
    and not (run_scope='scheduled_full' or (store='tesco' and run_scope='manual'))
  order by store,started_at desc
)
select s.store,c.product_count catalogue_products,coalesce(m.mapped_products,0) mapped_products,
  coalesce(m.resolved_products,0) resolved_products,coalesce(l.live_trusted_products,0) live_trusted_products,
  coalesce(oh.ever_observed_products,0) ever_observed_products,coalesce(oh.never_observed_products,0) never_observed_products,
  coalesce(oh.stale_products,0) stale_products,coalesce(oh.expiring_within_24h,0) expiring_within_24h,
  coalesce(dh.demanded_units,0) demanded_units,coalesce(dh.live_demanded_units,0) live_demanded_units,
  coalesce(dh.top_100_demanded_live,0) top_100_demanded_live,
  coalesce(round(100*coalesce(l.live_trusted_products,0)::numeric/nullif(c.product_count,0),2),0) live_coverage_pct,
  coalesce(round(100*coalesce(dh.live_demanded_units,0)::numeric/nullif(dh.demanded_units,0),2),0) demand_coverage_pct,
  lr.run_uuid latest_run_uuid,lr.run_id latest_run_id,lr.status latest_run_status,lr.started_at latest_run_started_at,
  lr.finished_at latest_run_finished_at,lr.coverage_pct latest_run_coverage_pct,lr.threshold_pct latest_run_threshold_pct,
  ar.run_uuid latest_auxiliary_run_uuid,ar.run_id latest_auxiliary_run_id,ar.run_scope latest_auxiliary_run_scope,
  ar.status latest_auxiliary_run_status,ar.started_at latest_auxiliary_run_started_at,ar.finished_at latest_auxiliary_run_finished_at,
  ar.coverage_pct latest_auxiliary_run_coverage_pct,ar.threshold_pct latest_auxiliary_run_threshold_pct
from stores s cross join catalogue c left join mapping m on m.store=s.store left join observation_health oh on oh.store=s.store
left join live l on l.store=s.store left join demand_health dh on dh.store=s.store left join latest_run lr on lr.store=s.store
left join latest_auxiliary_run ar on ar.store=s.store;

revoke all on public.retailer_coverage_current from public,anon,authenticated;
grant select on public.retailer_coverage_current to service_role;

create or replace view public.tesco_direct_canary_run_summary
with (security_invoker = true)
as
select
  r.id as run_uuid,
  r.run_id,
  r.status,
  r.started_at,
  r.finished_at,
  r.target_count,
  r.attempted_count,
  count(c.*)::integer as evidence_count,
  count(*) filter (where c.classification in ('successful_exact_sku', 'redirected_exact_sku'))::integer as exact_recovered,
  round(100 * count(*) filter (where c.classification in ('successful_exact_sku', 'redirected_exact_sku'))::numeric / nullif(r.target_count, 0), 2) as exact_recovery_pct,
  coalesce((select jsonb_object_agg(x.classification, x.n) from (
    select classification, count(*)::integer n
    from public.tesco_direct_canary_results cr
    where cr.run_id = r.id group by classification
  ) x), '{}'::jsonb) as failure_and_result_reasons,
  r.pepesto_actual_cost_cents,
  case when count(*) filter (where c.classification in ('successful_exact_sku', 'redirected_exact_sku')) > 0
    then round(coalesce(r.pepesto_actual_cost_cents, 0)::numeric / count(*) filter (where c.classification in ('successful_exact_sku', 'redirected_exact_sku')), 2)
    else null end as pepesto_cents_per_recovered_product
from public.scrape_runs r
left join public.tesco_direct_canary_results c on c.run_id = r.id
where r.store = 'tesco' and r.retrieval_method = 'vercel_queue_tesco_exact_direct'
group by r.id;

revoke all on public.tesco_direct_canary_run_summary from public, anon, authenticated;
grant select on public.tesco_direct_canary_run_summary to service_role;

create or replace view public.main_retailer_comparison_coverage_current
with (security_invoker = true)
as
with flags as (
  select p.id,
    exists(select 1 from public.latest_prices lp where lp.canonical_product_id=p.id and lp.store='supervalu') as supervalu_live,
    exists(select 1 from public.latest_prices lp where lp.canonical_product_id=p.id and lp.store='dunnes') as dunnes_live,
    exists(select 1 from public.latest_prices lp where lp.canonical_product_id=p.id and lp.store='tesco') as tesco_live
  from public.products p
)
select count(*)::integer as catalogue_products,
  count(*) filter (where supervalu_live::integer + dunnes_live::integer + tesco_live::integer >= 2)::integer as at_least_two_live,
  count(*) filter (where supervalu_live and dunnes_live and tesco_live)::integer as all_three_live,
  round(100 * count(*) filter (where supervalu_live::integer + dunnes_live::integer + tesco_live::integer >= 2)::numeric / nullif(count(*),0),2) as at_least_two_live_pct,
  round(100 * count(*) filter (where supervalu_live and dunnes_live and tesco_live)::numeric / nullif(count(*),0),2) as all_three_live_pct
from flags;

revoke all on public.main_retailer_comparison_coverage_current from public, anon, authenticated;
grant select on public.main_retailer_comparison_coverage_current to service_role;
