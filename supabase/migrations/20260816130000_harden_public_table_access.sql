-- Harden PostgREST-exposed public tables.
--
-- The application performs writes through server-side API routes using the
-- service-role client. Public catalogue data may remain readable for backwards
-- compatibility, but anonymous/authenticated clients must never be able to
-- mutate catalogue, pricing, subscriber, list, or sharing data directly.
--
-- This migration is intentionally staged in source control first. Do not apply
-- it to production until Preview/application smoke tests have confirmed that no
-- browser path depends on direct Supabase writes.

-- Public catalogue: read-only via PostgREST.
alter table public.products enable row level security;
alter table public.store_products enable row level security;
alter table public.price_observations enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.store_products from anon, authenticated;
revoke all on table public.price_observations from anon, authenticated;

grant select on table public.products to anon, authenticated;
grant select on table public.store_products to anon, authenticated;
grant select on table public.price_observations to anon, authenticated;

drop policy if exists "public read products" on public.products;
create policy "public read products"
  on public.products
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public read store products" on public.store_products;
create policy "public read store products"
  on public.store_products
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public read price observations" on public.price_observations;
create policy "public read price observations"
  on public.price_observations
  for select
  to anon, authenticated
  using (true);

-- User/private data: service-role access only. Existing application API routes
-- use the server-side service-role client, which bypasses RLS.
alter table public.subscribers enable row level security;
alter table public.list_items enable row level security;
alter table public.shared_lists enable row level security;

revoke all on table public.subscribers from anon, authenticated;
revoke all on table public.list_items from anon, authenticated;
revoke all on table public.shared_lists from anon, authenticated;

-- latest_prices must respect the permissions/RLS of the querying role rather
-- than the view owner. Underlying catalogue tables remain public read-only.
alter view public.latest_prices set (security_invoker = true);
revoke all on table public.latest_prices from anon, authenticated;
grant select on table public.latest_prices to anon, authenticated;
