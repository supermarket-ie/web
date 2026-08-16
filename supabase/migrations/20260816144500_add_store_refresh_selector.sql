-- Service-role-only selector for Vercel-native store refresh workers.
-- Returns resolved mappings ordered by oldest/latest missing observation first.

create or replace function public.select_store_products_for_refresh(
  p_store text,
  p_limit integer default 100,
  p_product_url_only boolean default false,
  p_query text default null
)
returns table (
  store_product_id uuid,
  canonical_name text,
  store_product_name text,
  store_url text,
  store_sku text,
  previous_price numeric,
  last_observed_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with latest as (
    select distinct on (po.store_product_id)
      po.store_product_id,
      po.price,
      po.observed_at
    from public.price_observations po
    order by po.store_product_id, po.observed_at desc
  )
  select
    sp.id,
    p.canonical_name,
    sp.store_product_name,
    sp.store_url,
    sp.store_sku,
    l.price,
    l.observed_at
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  left join latest l on l.store_product_id = sp.id
  where sp.store = p_store
    and sp.url_status = 'resolved'
    and (not p_product_url_only or sp.store_url like '%/product/%')
    and (p_query is null or p.canonical_name ilike '%' || p_query || '%')
  order by l.observed_at asc nulls first, sp.id
  limit greatest(1, least(coalesce(p_limit, 100), 2500));
$$;

revoke all on function public.select_store_products_for_refresh(text, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.select_store_products_for_refresh(text, integer, boolean, text)
  to service_role;
