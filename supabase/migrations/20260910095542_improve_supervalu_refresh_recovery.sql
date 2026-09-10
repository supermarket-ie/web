-- Preserve the real failure streak for operational diagnosis. The generic
-- finalizer supplies 1 for a new failure; this trigger derives the streak from
-- failures recorded since the product's most recent successful observation.

create or replace function public.set_scrape_failure_streak()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_last_success timestamptz;
  v_previous_streak integer;
begin
  select max(po.observed_at)
  into v_last_success
  from public.price_observations po
  where po.store_product_id = new.store_product_id;

  select coalesce(max(sf.consecutive_failures), 0)
  into v_previous_streak
  from public.scrape_failures sf
  where sf.store_product_id = new.store_product_id
    and sf.created_at > coalesce(v_last_success, '-infinity'::timestamptz);

  new.consecutive_failures := v_previous_streak + 1;
  return new;
end;
$$;

drop trigger if exists set_scrape_failure_streak_before_insert
  on public.scrape_failures;
create trigger set_scrape_failure_streak_before_insert
before insert on public.scrape_failures
for each row execute function public.set_scrape_failure_streak();

revoke all on function public.set_scrape_failure_streak() from public, anon, authenticated;

-- Keep coverage gaps ahead of routine maintenance, but place SuperValu rows
-- that have failed twice since their last success behind untried/one-off gaps.
-- They remain eligible when the tranche is large enough; they no longer crowd
-- the same repair failures into every scheduled 1,000-product refresh.

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
  failure_pressure as (
    select
      sf.store_product_id,
      count(*) filter (
        where sf.created_at > coalesce(lo.observed_at, '-infinity'::timestamptz)
      )::integer as failures_since_success
    from public.scrape_failures sf
    left join latest_observation lo on lo.store_product_id = sf.store_product_id
    where sf.store = p_store
    group by sf.store_product_id
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
  left join failure_pressure fp on fp.store_product_id = sp.id
  left join live_coverage lc on lc.product_id = p.id
  left join shopper_demand sd
    on lower(btrim(p.canonical_name)) = sd.canonical_key
  where sp.store = p_store
    and sp.url_status = 'resolved'
    and btrim(coalesce(sp.store_sku, '')) <> ''
    and (not p_product_url_only or sp.store_url like '%/product/%')
    and (p_query is null or p.canonical_name ilike '%' || p_query || '%')
  order by
    coalesce(lc.target_store_is_live, false) asc,
    case
      when p_store = 'supervalu' and coalesce(fp.failures_since_success, 0) >= 2 then 1
      else 0
    end asc,
    (coalesce(sd.usage_occurrences, 0) > 0) desc,
    coalesce(sd.usage_occurrences, 0) desc,
    coalesce(sd.usage_quantity, 0) desc,
    coalesce(lc.live_store_count, 0) desc,
    sd.last_used_at desc nulls last,
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
  'Selects exact resolved mappings for refresh, prioritising missing live coverage and shopper value while placing repeated SuperValu repair failures behind healthier coverage gaps.';
