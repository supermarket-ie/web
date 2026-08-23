-- Establish one fail-closed production boundary for retailer offers used by
-- the website, shopping agent, API and future MCP capabilities.

-- Backfill provenance only where a successful, idempotent scrape receipt ties
-- the observation to a known production run. Historical observations without
-- that evidence remain untrusted.
with provenance_candidates as (
  select
    po.id as observation_id,
    case
    when r.retrieval_method like 'pepesto_%' then 'pepesto_search'
    when sp.store = 'dunnes' and r.retrieval_method like 'vercel_queue_dunnes_%' then 'dunnes_direct'
    when sp.store = 'supervalu' and r.retrieval_method = 'vercel_direct_product_page' then 'supervalu_direct'
    else null
    end as source,
    row_number() over (partition by po.id order by r.started_at desc) as preference
  from public.price_observations po
  join public.store_products sp on sp.id = po.store_product_id
  join public.scrape_product_receipts receipt
    on receipt.store_product_id = sp.id
   and receipt.outcome = 'success'
  join public.scrape_runs r on r.id = receipt.run_id
  where po.source is null
    and po.observed_at >= r.started_at - interval '5 seconds'
    and po.observed_at <= coalesce(r.finished_at, now()) + interval '5 seconds'
)
update public.price_observations po
set source = provenance.source
from provenance_candidates provenance
where po.id = provenance.observation_id
  and provenance.preference = 1
  and provenance.source is not null;

create or replace view public.trusted_retailer_offers
with (security_invoker = true)
as
select distinct on (po.store_product_id)
  p.id as canonical_product_id,
  p.canonical_name,
  p.category,
  sp.id as store_product_id,
  sp.store as retailer,
  sp.store_sku as retailer_sku,
  sp.store_product_name as retailer_product_name,
  sp.store_url as retailer_product_url,
  po.price,
  po.was_price,
  po.on_promotion,
  po.observed_at,
  po.source,
  'exact'::text as relationship_type,
  'fresh'::text as freshness_state
from public.price_observations po
join public.store_products sp on sp.id = po.store_product_id
join public.products p on p.id = sp.product_id
where sp.store in ('tesco', 'dunnes', 'supervalu')
  and sp.url_status = 'resolved'
  and nullif(btrim(sp.store_sku), '') is not null
  and nullif(btrim(sp.store_product_name), '') is not null
  and po.price > 0
  and po.observed_at >= now() - interval '7 days'
  and po.source in ('tesco_direct', 'pepesto_search', 'dunnes_direct', 'supervalu_direct')
  and not (sp.store = 'supervalu' and sp.store_url like '%/search-results%')
order by po.store_product_id, po.observed_at desc;

comment on view public.trusted_retailer_offers is
  'Fresh, provenance-backed exact retailer offers safe for shared shopping capabilities. Approved alternatives remain separate and must be explicitly resolved.';

-- Keep the established consumer contract while making the trusted-offer view
-- its sole source of data. The original columns remain first and unchanged.
create or replace view public.latest_prices
with (security_invoker = true)
as
select
  offer.store_product_id,
  offer.price,
  offer.was_price,
  offer.on_promotion,
  offer.retailer as store,
  offer.retailer_product_name as store_product_name,
  offer.canonical_name,
  offer.category,
  offer.canonical_product_id,
  offer.retailer_sku as store_sku,
  offer.retailer_product_url as store_url,
  offer.observed_at,
  offer.source,
  offer.relationship_type,
  offer.freshness_state
from public.trusted_retailer_offers offer;

grant select on public.trusted_retailer_offers to anon, authenticated, service_role;
grant select on public.latest_prices to anon, authenticated, service_role;
