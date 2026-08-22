create or replace function public.select_dunnes_discovery_targets(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  product_id uuid,
  canonical_name text,
  brand text,
  category text,
  usage_quantity bigint,
  usage_occurrences bigint,
  last_used_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with usage as (
    select
      lower(li.canonical_name) as canonical_key,
      coalesce(sum(li.quantity), 0)::bigint as usage_quantity,
      count(*)::bigint as usage_occurrences,
      max(li.observed_at) as last_used_at
    from public.list_items li
    group by lower(li.canonical_name)
  )
  select
    p.id as product_id,
    p.canonical_name,
    p.brand,
    p.category,
    coalesce(u.usage_quantity, 0)::bigint,
    coalesce(u.usage_occurrences, 0)::bigint,
    u.last_used_at
  from public.products p
  left join public.store_products sp
    on sp.product_id = p.id
   and sp.store = 'dunnes'
   and sp.store_sku is not null
  left join usage u
    on lower(p.canonical_name) = u.canonical_key
  where p.brand is not null
    and btrim(p.brand) <> ''
    and sp.id is null
  order by
    (coalesce(u.usage_occurrences, 0) > 0) desc,
    coalesce(u.usage_occurrences, 0) desc,
    coalesce(u.usage_quantity, 0) desc,
    u.last_used_at desc nulls last,
    p.brand,
    p.canonical_name
  limit greatest(1, least(coalesce(p_limit, 50), 250))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.select_dunnes_discovery_targets(integer, integer) from public, anon, authenticated;
grant execute on function public.select_dunnes_discovery_targets(integer, integer) to service_role;
