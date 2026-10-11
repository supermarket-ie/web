-- One read-only MVCC snapshot. Product data and aggregate demand only; no customer
-- identifiers, credentials, sessions or raw provider responses. Save privately.
with latest_receipt as (
  select distinct on (r.store_product_id) r.store_product_id, r.run_id,
    r.created_at, r.outcome, s.retrieval_method
  from public.scrape_product_receipts r join public.scrape_runs s on s.id=r.run_id
  where s.store in ('tesco','supervalu','dunnes')
  order by r.store_product_id,r.created_at desc,r.run_id
), tesco as (
  select p product,d.id page_id,d.created_at,d.body_sha256,d.requested_url,d.final_url,d.mode,
    dense_rank() over(partition by p->>'sku' order by d.created_at desc) preference
  from public.tesco_direct_collection_pages d
  cross join lateral jsonb_array_elements(d.parsed->'products') p
  where d.outcome='ok' and p->>'sku' is not null
), mappings as (
  select s.id,s.product_id,s.store,s.store_product_name,s.brand,s.is_own_brand,
    s.store_sku,s.store_url,s.url_status,s.url_last_checked_at,s.gtin,
    l.price,l.observed_at,l.source price_source,
    r.created_at receipt_at,r.outcome receipt_outcome,r.run_id receipt_run_id,
    r.retrieval_method receipt_method
  from public.store_products s left join public.latest_prices l on l.store_product_id=s.id
  left join latest_receipt r on r.store_product_id=s.id
  where s.store in ('tesco','supervalu','dunnes')
), products as (
  select id,canonical_name,brand,category,default_quantity,default_unit,ean,
    left(description,3000) description,left(ingredients,3000) ingredients,image_url
  from public.products
), failures as (
  select distinct on (store_product_id) id,store_product_id,store,failure_reason,
    created_at,left(raw_error,500) raw_error
  from public.scrape_failures where store in ('supervalu','dunnes')
  order by store_product_id,created_at desc,id
), demand as (
  select lower(trim(canonical_name)) name,sum(greatest(quantity,1)) units
  from public.list_items where canonical_name is not null group by 1
)
select jsonb_build_object(
  'asOf',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'products',(select jsonb_agg(p order by id) from products p),
  'mappings',(select jsonb_agg(m order by id) from mappings m),
  'tesco',(select jsonb_agg(t order by product->>'sku',page_id) from tesco t where preference=1),
  'failures',(select jsonb_agg(f order by store_product_id) from failures f),
  'demand',(select jsonb_agg(d order by name) from demand d),
  'attempts',(select jsonb_agg(a order by requested_url) from (
    select requested_url,bool_or(outcome='pending') unresolved,max(created_at) last_attempt
    from public.tesco_direct_collection_pages group by requested_url) a),
  'gates',(select jsonb_agg(g) from (select egress_key,enabled,cooldown_until,leased_until from public.tesco_egress_pool) g),
  'renewal',(select jsonb_build_object('due',count(*) filter(where observed_at<=now()-interval '4 days'),
    'firstDue',min(observed_at)+interval '4 days','firstExpiry',min(observed_at)+interval '7 days') from public.latest_prices where store='tesco')
) snapshot;
