-- Supports latest-observation lookup for stalest-first scraper selection.
create index if not exists idx_price_obs_store_product_observed_at
  on public.price_observations (store_product_id, observed_at desc);
