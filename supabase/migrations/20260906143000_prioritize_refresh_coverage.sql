-- Rank refresh work by shopper value and cross-retailer coverage before age.
-- This keeps the trusted-price boundary unchanged; it only changes which
-- already-resolved exact retailer mappings are attempted first.

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
stable
security invoker
set search_path = public
as $$
  with latest_observation as (
    select distinct on (po.store_product_id)
      po.store_product_id,
      po.price,
      po.observed_at
    from public.price_observations po
    order by po.store_product_id, po.observed_at desc
  ),
  live_coverage as (
    select
      lp.canonical_product_id as product_id,
      count(distinct lp.store) filter (
        where lp.store in ('tesco', 'dunnes', 'supervalu')
      )::integer as live_store_count,
      bool_or(lp.store = p_store) as target_store_is_live
    from public.latest_prices lp
    group by lp.canonical_product_id
  ),
  shopper_demand as (
    select
      lower(btrim(li.canonical_name)) as canonical_key,
      count(*)::bigint as usage_occurrences,
      coalesce(sum(li.quantity), 0)::bigint as usage_quantity,
      max(li.observed_at) as last_used_at
    from public.list_items li
    where btrim(coalesce(li.canonical_name, '')) <> ''
    group by lower(btrim(li.canonical_name))
  )
  select
    sp.id,
    p.canonical_name,
    sp.store_product_name,
    sp.store_url,
    sp.store_sku,
    lo.price,
    lo.observed_at
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  left join latest_observation lo on lo.store_product_id = sp.id
  left join live_coverage lc on lc.product_id = p.id
  left join shopper_demand sd
    on lower(btrim(p.canonical_name)) = sd.canonical_key
  where sp.store = p_store
    and sp.url_status = 'resolved'
    and btrim(coalesce(sp.store_sku, '')) <> ''
    and (not p_product_url_only or sp.store_url like '%/product/%')
    and (p_query is null or p.canonical_name ilike '%' || p_query || '%')
  order by
    -- First fill a missing retailer price; fresh target-store rows are
    -- maintenance work after current coverage gaps.
    coalesce(lc.target_store_is_live, false) asc,
    -- Within gaps, products shoppers actually use come first.
    (coalesce(sd.usage_occurrences, 0) > 0) desc,
    coalesce(sd.usage_occurrences, 0) desc,
    coalesce(sd.usage_quantity, 0) desc,
    -- Prefer completing three-store and then two-store comparisons.
    coalesce(lc.live_store_count, 0) desc,
    sd.last_used_at desc nulls last,
    -- Preserve the existing never-observed, then stalest ordering.
    (lo.observed_at is null) desc,
    lo.observed_at asc nulls first,
    sp.id
  limit greatest(1, least(coalesce(p_limit, 100), 2500));
$$;

revoke all on function public.select_store_products_for_refresh(text, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.select_store_products_for_refresh(text, integer, boolean, text)
  to service_role;

comment on function public.select_store_products_for_refresh(text, integer, boolean, text) is
  'Selects exact resolved mappings for refresh, prioritising missing live retailer coverage, shopper demand, cross-retailer overlap, never-observed products, then staleness.';
