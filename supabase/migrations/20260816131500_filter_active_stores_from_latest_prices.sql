-- Restrict the live-price view to supermarkets with an active refresh pipeline.
--
-- Lidl has only two historical observations in production and no scheduled
-- refresh. Keeping those May 2026 rows in latest_prices can allow stale values
-- to enter planner, promotion, comparison, and alert calculations. Do not
-- present Lidl as live until a refresh pipeline and freshness monitoring exist.

create or replace view public.latest_prices
with (security_invoker = true)
as
select distinct on (po.store_product_id)
  po.store_product_id,
  po.price,
  po.was_price,
  po.on_promotion,
  sp.store,
  sp.store_product_name,
  p.canonical_name,
  p.category
from public.price_observations po
join public.store_products sp
  on sp.id = po.store_product_id
 and sp.url_status = 'resolved'
join public.products p
  on p.id = sp.product_id
where sp.store in ('tesco', 'dunnes', 'supervalu', 'aldi')
order by po.store_product_id, po.observed_at desc;

revoke all on table public.latest_prices from anon, authenticated;
grant select on table public.latest_prices to anon, authenticated;
