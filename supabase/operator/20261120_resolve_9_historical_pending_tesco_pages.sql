-- OPERATOR HANDOFF (run via the owner-approved Supabase SQL route, as postgres) AFTER migration
-- 20261120090000_tesco_pending_page_resolutions.sql is applied.
-- Records ONE append-only terminal disposition per EXPLICITLY NAMED historical pending Tesco page.
-- It never modifies or deletes a page, never writes a price/receipt, never touches a mapping, lease or budget.
-- Each call re-checks: still pending, exact URL + created_at, >= 7 days old, no live lease, no active supervisor.
-- Any failure aborts the whole transaction (nothing recorded). Excluded on purpose: 253094431 (Glade) —
-- its SuperValu (Lily) and Dunnes (Clean Linen) offers are different products.
begin;
select tesco_internal.resolve_historical_pending_page('88b5e948-fb07-4f99-aa89-894e5f70b06e'::uuid, 'https://www.tesco.ie/shop/en-IE/products/284776159', '2026-11-07T13:45:47.089429+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('0d432690-dc66-4a78-b895-df2ebca8c881'::uuid, 'https://www.tesco.ie/shop/en-IE/products/318272231', '2026-11-07T14:31:38.041784+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('9113ee91-80c9-43f0-b22e-b67b625bec74'::uuid, 'https://www.tesco.ie/shop/en-IE/products/304388225', '2026-11-05T12:05:08.013881+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('48284070-1f14-4638-96aa-73212c2c25b3'::uuid, 'https://www.tesco.ie/shop/en-IE/products/312236215', '2026-11-01T21:16:43.768308+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('31bf444f-5e48-4c92-8f39-e9e3694ffeab'::uuid, 'https://www.tesco.ie/shop/en-IE/products/322336888', '2026-11-07T14:52:48.475513+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('c4a88804-747b-4035-bfeb-2c03d105b4c7'::uuid, 'https://www.tesco.ie/shop/en-IE/products/307160737', '2026-11-07T14:42:05.46737+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('640a5f0a-1838-426b-9b02-0016e00e108e'::uuid, 'https://www.tesco.ie/shop/en-IE/products/320545465', '2026-11-07T12:58:07.467398+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('abdfb381-08f1-423e-994c-73ca155c5f8e'::uuid, 'https://www.tesco.ie/shop/en-IE/products/317854748', '2026-10-09T11:29:02.482629+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
select tesco_internal.resolve_historical_pending_page('c7dd994f-f6e9-458e-83be-4dc570245817'::uuid, 'https://www.tesco.ie/shop/en-IE/products/284775990', '2026-11-07T09:27:18.931805+00:00'::timestamptz,
  'Historical pending Tesco page from an orphaned Nov 2026 collector run that never finalised; outcome unknown; never retried. Owner-approved terminal disposition 20 Nov 2026 (PR: pending-page resolution). No price, receipt or mapping change.');
-- Verification (must return 9 / 9 / 0 before COMMIT):
select count(*) as resolved_now from public.tesco_pending_page_resolutions where page_id in ('88b5e948-fb07-4f99-aa89-894e5f70b06e','0d432690-dc66-4a78-b895-df2ebca8c881','9113ee91-80c9-43f0-b22e-b67b625bec74','48284070-1f14-4638-96aa-73212c2c25b3','31bf444f-5e48-4c92-8f39-e9e3694ffeab','c4a88804-747b-4035-bfeb-2c03d105b4c7','640a5f0a-1838-426b-9b02-0016e00e108e','abdfb381-08f1-423e-994c-73ca155c5f8e','c7dd994f-f6e9-458e-83be-4dc570245817');
select count(*) as pages_still_pending_and_untouched from public.tesco_direct_collection_pages where id in ('88b5e948-fb07-4f99-aa89-894e5f70b06e','0d432690-dc66-4a78-b895-df2ebca8c881','9113ee91-80c9-43f0-b22e-b67b625bec74','48284070-1f14-4638-96aa-73212c2c25b3','31bf444f-5e48-4c92-8f39-e9e3694ffeab','c4a88804-747b-4035-bfeb-2c03d105b4c7','640a5f0a-1838-426b-9b02-0016e00e108e','abdfb381-08f1-423e-994c-73ca155c5f8e','c7dd994f-f6e9-458e-83be-4dc570245817') and outcome = 'pending';
select count(*) as prices_written from public.price_observations o join public.tesco_direct_collection_pages d on d.store_product_id = o.store_product_id
  where d.id in ('88b5e948-fb07-4f99-aa89-894e5f70b06e','0d432690-dc66-4a78-b895-df2ebca8c881','9113ee91-80c9-43f0-b22e-b67b625bec74','48284070-1f14-4638-96aa-73212c2c25b3','31bf444f-5e48-4c92-8f39-e9e3694ffeab','c4a88804-747b-4035-bfeb-2c03d105b4c7','640a5f0a-1838-426b-9b02-0016e00e108e','abdfb381-08f1-423e-994c-73ca155c5f8e','c7dd994f-f6e9-458e-83be-4dc570245817') and o.observed_at > now() - interval '1 hour';
commit;
