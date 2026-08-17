-- Read-only Tesco mapping integrity audit.
--
-- This script is intentionally SELECT-only. It is designed to quantify and
-- inspect historical Tesco URL contamination before any cleanup is approved.
-- Do not turn these queries into UPDATE/DELETE statements without a reviewed
-- remediation plan and explicit production-data approval.

-- 1. Overall duplicate URL scope.
with duplicate_urls as (
  select store_url, count(*) as mapped_rows
  from public.store_products
  where store = 'tesco'
    and url_status = 'resolved'
    and store_url is not null
  group by store_url
  having count(*) > 1
)
select
  count(*) as duplicate_urls,
  coalesce(sum(mapped_rows), 0) as mapped_rows_on_duplicate_urls,
  coalesce(max(mapped_rows), 0) as max_mappings_per_url
from duplicate_urls;

-- 2. Recent activity on duplicate mappings.
with latest_per_mapping as (
  select
    sp.id,
    sp.store_url,
    p.canonical_name,
    sp.store_product_name,
    max(po.observed_at) as latest_observation
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  left join public.price_observations po on po.store_product_id = sp.id
  where sp.store = 'tesco'
    and sp.url_status = 'resolved'
    and sp.store_url is not null
  group by sp.id, sp.store_url, p.canonical_name, sp.store_product_name
), duplicate_urls as (
  select store_url, count(*) as mappings
  from latest_per_mapping
  group by store_url
  having count(*) > 1
)
select
  count(distinct l.store_url) filter (
    where exists (
      select 1
      from latest_per_mapping x
      where x.store_url = l.store_url
        and x.latest_observation >= now() - interval '30 days'
    )
  ) as duplicate_urls_with_30d_activity,
  count(*) filter (where l.latest_observation >= now() - interval '30 days') as mappings_refreshed_30d,
  count(*) filter (where l.latest_observation >= now() - interval '7 days') as mappings_refreshed_7d
from latest_per_mapping l
join duplicate_urls d using (store_url);

-- 3. Highest fan-out URLs with their canonical mappings.
with duplicate_urls as (
  select store_url, count(*) as mapped_rows
  from public.store_products
  where store = 'tesco'
    and url_status = 'resolved'
    and store_url is not null
  group by store_url
  having count(*) > 1
)
select
  d.mapped_rows,
  d.store_url,
  array_agg(p.canonical_name order by p.canonical_name) as canonical_names,
  array_agg(distinct sp.store_product_name) as store_product_names,
  max(po.observed_at) as latest_observation
from duplicate_urls d
join public.store_products sp
  on sp.store_url = d.store_url
 and sp.store = 'tesco'
 and sp.url_status = 'resolved'
join public.products p on p.id = sp.product_id
left join public.price_observations po on po.store_product_id = sp.id
group by d.mapped_rows, d.store_url
order by d.mapped_rows desc, latest_observation desc nulls last
limit 100;

-- 4. Known butter regression cases. These rows are evidence only; do not edit.
select
  sp.id as store_product_id,
  p.canonical_name,
  sp.store_product_name,
  sp.store_url,
  sp.store_sku,
  sp.url_status,
  count(po.*) as observation_count,
  min(po.observed_at) as first_observed,
  max(po.observed_at) as last_observed,
  min(po.price) as min_price,
  max(po.price) as max_price
from public.store_products sp
join public.products p on p.id = sp.product_id
left join public.price_observations po on po.store_product_id = sp.id
where sp.store = 'tesco'
  and lower(p.canonical_name) like '%butter%'
group by
  sp.id,
  p.canonical_name,
  sp.store_product_name,
  sp.store_url,
  sp.store_sku,
  sp.url_status
order by p.canonical_name;
