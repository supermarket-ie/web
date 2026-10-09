-- Read-only, single-statement snapshot. Run with the existing authorised SQL
-- bridge; save the snapshot column privately as JSON. No retailer requests.
with mappings as (
  select p.id product_id, p.canonical_name, p.brand canonical_brand,
    s.id, s.store_product_name, s.brand store_brand, s.is_own_brand,
    s.store_sku, s.store_url, s.url_status, s.gtin, l.observed_at,
    exists(select 1 from public.scrape_product_receipts r
      where r.store_product_id=s.id and r.outcome='success') proven
  from public.products p
  left join public.store_products s on s.product_id=p.id and s.store='tesco'
  left join public.latest_prices l on l.store_product_id=s.id
), peers as (
  select s.id,s.product_id,s.store,s.store_product_name,s.brand,s.gtin,
    s.store_sku,l.observed_at
  from public.store_products s
  left join public.latest_prices l on l.store_product_id=s.id
  where s.store in ('supervalu','dunnes')
), evidence as (
  -- Preserve equal-time conflicts; the classifier must see both, not an
  -- arbitrary DISTINCT ON winner. Older snapshots cannot supersede newer ones.
  select product,page_id,created_at,body_sha256,requested_url,final_url,mode from (
    select p product,d.id page_id,d.created_at,d.body_sha256,d.requested_url,d.final_url,d.mode,
      dense_rank() over(partition by p->>'sku' order by d.created_at desc) preference
    from public.tesco_direct_collection_pages d
    cross join lateral jsonb_array_elements(d.parsed->'products') p
    where d.outcome='ok' and p->>'sku' is not null
  ) ranked where preference=1
), attempts as (
  select requested_url,bool_or(outcome='pending') unresolved
  from public.tesco_direct_collection_pages where mode='products'
  group by requested_url
), rejections as (
  select i->>'storeProductId' id,max(d.created_at) at,array_agg(distinct reason order by reason) reasons
  from public.tesco_direct_collection_pages d
  cross join lateral jsonb_array_elements(d.identity_results) i
  cross join lateral jsonb_array_elements_text(i->'reasons') reason
  group by i->>'storeProductId'
), historical as (
  -- Explicit allowlist: never export raw legacy candidates/session tokens.
  select id,store_product_id,candidate_sku,candidate_name,candidate_url,classification,created_at
  from public.tesco_candidate_discovery_evidence
), demand as (
  select lower(trim(canonical_name)) name,sum(greatest(quantity,1)) demand
  from public.list_items where canonical_name is not null group by lower(trim(canonical_name))
)
select jsonb_build_object(
  'asOf',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'mappings',coalesce((select jsonb_agg(m order by m.product_id) from mappings m),'[]'::jsonb),
  'peers',coalesce((select jsonb_agg(p order by p.id) from peers p),'[]'::jsonb),
  'evidence',coalesce((select jsonb_agg(e order by e.product->>'sku',e.page_id) from evidence e),'[]'::jsonb),
  'attempts',coalesce((select jsonb_agg(a order by a.requested_url) from attempts a),'[]'::jsonb),
  'rejections',coalesce((select jsonb_agg(r order by r.id) from rejections r),'[]'::jsonb),
  'historicalHints',coalesce((select jsonb_agg(h order by h.created_at,h.id) from historical h),'[]'::jsonb),
  'demand',coalesce((select jsonb_agg(d order by d.name) from demand d),'[]'::jsonb)
) snapshot;
