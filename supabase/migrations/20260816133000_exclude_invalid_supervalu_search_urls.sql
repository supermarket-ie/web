-- Exclude invalid SuperValu mappings whose stored URL is a search-results page.
--
-- Production audit on 2026-08-16 found 104 rows marked `resolved` with URLs
-- like /shopping/search-results?... . Those same 104 mappings currently have
-- a latest price of EUR 16.29 across unrelated products, strongly indicating
-- the scraper extracted a price from the search page rather than a validated
-- product page.
--
-- This migration does not modify or delete store_products or observations. It
-- only prevents those invalid mappings from entering the live-price view.

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
  and not (
    sp.store = 'supervalu'
    and sp.store_url like '%/search-results%'
  )
order by po.store_product_id, po.observed_at desc;

revoke all on table public.latest_prices from anon, authenticated;
grant select on table public.latest_prices to anon, authenticated;
