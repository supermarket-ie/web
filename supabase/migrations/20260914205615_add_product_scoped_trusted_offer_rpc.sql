-- Product-scoped trusted-price lookup for high-frequency exact product reads.
--
-- Filtering latest_prices by canonical product still builds the full trusted
-- retailer offer set before applying the filter. This function applies the
-- canonical product constraint first, then uses the existing
-- (store_product_id, observed_at) index to fetch only the latest trusted
-- observation for the handful of retailer mappings belonging to that product.

create or replace function public.trusted_offers_for_products(product_ids uuid[])
returns table (
  canonical_product_id uuid,
  canonical_name text,
  category text,
  store text,
  store_product_name text,
  price numeric,
  was_price numeric,
  on_promotion boolean,
  observed_at timestamptz,
  source text,
  relationship_type text,
  freshness_state text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id as canonical_product_id,
    p.canonical_name,
    p.category,
    sp.store,
    sp.store_product_name,
    po.price,
    po.was_price,
    po.on_promotion,
    po.observed_at,
    po.source,
    'exact'::text as relationship_type,
    'fresh'::text as freshness_state
  from public.products p
  join public.store_products sp on sp.product_id = p.id
  join lateral (
    select
      obs.price,
      obs.was_price,
      obs.on_promotion,
      obs.observed_at,
      obs.source
    from public.price_observations obs
    where obs.store_product_id = sp.id
      and obs.observed_at >= now() - interval '7 days'
      and obs.price > 0
      and obs.source = any (array[
        'tesco_direct'::text,
        'pepesto_search'::text,
        'dunnes_direct'::text,
        'supervalu_direct'::text
      ])
    order by obs.observed_at desc
    limit 1
  ) po on true
  where p.id = any(product_ids)
    and sp.store = any (array['tesco'::text, 'dunnes'::text, 'supervalu'::text])
    and sp.url_status = 'resolved'
    and nullif(btrim(sp.store_sku), '') is not null
    and nullif(btrim(sp.store_product_name), '') is not null
    and not (sp.store = 'supervalu' and sp.store_url like '%/search-results%');
$$;

revoke all on function public.trusted_offers_for_products(uuid[]) from public;
grant execute on function public.trusted_offers_for_products(uuid[]) to authenticated;
grant execute on function public.trusted_offers_for_products(uuid[]) to service_role;
