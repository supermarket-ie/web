-- Guarded canonical split batch (generated 2026-11-15T20:56:53.621Z).
-- Run ONLY through the postgres supervised bridge. Asserts every reviewed row
-- first; any drift aborts the whole transaction. Offers MOVE with their
-- price_observations (keyed by store_product_id), so price history is preserved;
-- nothing is deleted.
begin;
do $split$ begin
  if current_user <> 'postgres' then raise exception 'supervised_bridge_required'; end if;
  if exists (select 1 from public.store_products where store='tesco' and store_sku='257518392') then raise exception 'split_target_sku_owned: 257518392'; end if;
  perform 1 from public.products where id='014dfd6d-a376-428f-968a-abdd7eefc8f7' and canonical_name='Cajun Seasoning' and brand is not distinct from 'Schwartz' and ean is not distinct from '00000050020737' for update;
  if not found then raise exception 'split_snapshot_changed: product 014dfd6d-a376-428f-968a-abdd7eefc8f7'; end if;
  perform 1 from public.store_products where id='fb65e4d2-1221-4ffc-9ce3-35446f2be5be' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7' and store='supervalu' and store_sku is not distinct from '1020899000' and store_product_name='Schwartz Cajun Seasoning (44 g)' for update;
  if not found then raise exception 'split_snapshot_changed: offer fb65e4d2-1221-4ffc-9ce3-35446f2be5be'; end if;
  perform 1 from public.store_products where id='ab4871c4-3cea-42fc-9a79-e4305e044e61' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7' and store='dunnes' and store_sku is not distinct from '100206328' and store_product_name='Dunnes Stores Cajun Seasoning 35g' for update;
  if not found then raise exception 'split_snapshot_changed: offer ab4871c4-3cea-42fc-9a79-e4305e044e61'; end if;
  perform 1 from public.store_products where id='5cb35a07-f9a9-478e-bc48-24048c69f7ab' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7' and store='tesco' and store_sku is not distinct from '289081921' and store_product_name='Tesco Cajun Seasoning 45G' for update;
  if not found then raise exception 'split_snapshot_changed: offer 5cb35a07-f9a9-478e-bc48-24048c69f7ab'; end if;
  perform 1 from public.store_products where id='a62ca5fa-55d2-4940-8fcb-f38a4f27f57d' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7' and store='aldi' and store_sku is not distinct from 'READY, SET…COOK! Cajun Seasoning' and store_product_name='READY, SET…COOK! Cajun Seasoning' for update;
  if not found then raise exception 'split_snapshot_changed: offer a62ca5fa-55d2-4940-8fcb-f38a4f27f57d'; end if;
  if (select count(*) from public.store_products where product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7') <> 4 then raise exception 'split_offer_set_changed: 014dfd6d-a376-428f-968a-abdd7eefc8f7'; end if;
  if exists (select 1 from public.store_products where store='tesco' and store_sku='251970492') then raise exception 'split_target_sku_owned: 251970492'; end if;
  perform 1 from public.products where id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed' and canonical_name='Muesli' and brand is not distinct from 'Lifeforce' and ean is not distinct from '05099856000017' for update;
  if not found then raise exception 'split_snapshot_changed: product 1cca7ae6-2118-4871-be9a-d8eeb359f0ed'; end if;
  perform 1 from public.store_products where id='10ba1cd5-c64a-449c-90b1-454406ad5347' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed' and store='supervalu' and store_sku is not distinct from '1008602002' and store_product_name='Lifeforce Muesli (750 g)' for update;
  if not found then raise exception 'split_snapshot_changed: offer 10ba1cd5-c64a-449c-90b1-454406ad5347'; end if;
  perform 1 from public.store_products where id='41f36453-5afc-4ebe-ab45-d5327163410a' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed' and store='tesco' and store_sku is not distinct from '315060999' and store_product_name='Flahavan''s Hi8 Muesli - Fruit & Nut' for update;
  if not found then raise exception 'split_snapshot_changed: offer 41f36453-5afc-4ebe-ab45-d5327163410a'; end if;
  perform 1 from public.store_products where id='ef5c7b5c-60de-4ee0-b48d-6615dfd0f1af' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed' and store='aldi' and store_sku is not distinct from 'HARVEST MORN Chocolate Muesli Bars' and store_product_name='HARVEST MORN Chocolate Muesli Bars' for update;
  if not found then raise exception 'split_snapshot_changed: offer ef5c7b5c-60de-4ee0-b48d-6615dfd0f1af'; end if;
  perform 1 from public.store_products where id='7d80821c-7231-4e2f-b09c-36a463d1cc78' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed' and store='dunnes' and store_sku is not distinct from '100673561' and store_product_name='Flahavan''s Hi8 Muesli Original 1kg' for update;
  if not found then raise exception 'split_snapshot_changed: offer 7d80821c-7231-4e2f-b09c-36a463d1cc78'; end if;
  if (select count(*) from public.store_products where product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed') <> 4 then raise exception 'split_offer_set_changed: 1cca7ae6-2118-4871-be9a-d8eeb359f0ed'; end if;
  if exists (select 1 from public.store_products where store='tesco' and store_sku='250858535') then raise exception 'split_target_sku_owned: 250858535'; end if;
  perform 1 from public.products where id='95000afc-bf7f-4478-a624-b098446b6799' and canonical_name='Dijon Mustard' and brand is not distinct from 'Maille' and ean is not distinct from '08712566134144' for update;
  if not found then raise exception 'split_snapshot_changed: product 95000afc-bf7f-4478-a624-b098446b6799'; end if;
  perform 1 from public.store_products where id='a0f35d1e-b28b-4662-b869-4aadef017c09' and product_id='95000afc-bf7f-4478-a624-b098446b6799' and store='supervalu' and store_sku is not distinct from '1038275000' and store_product_name='Maille Dijon Mustard (215 g)' for update;
  if not found then raise exception 'split_snapshot_changed: offer a0f35d1e-b28b-4662-b869-4aadef017c09'; end if;
  perform 1 from public.store_products where id='46bf45a7-71df-44f8-98f3-db308713bc66' and product_id='95000afc-bf7f-4478-a624-b098446b6799' and store='tesco' and store_sku is not distinct from '260691710' and store_product_name='Tesco Dijon Mustard 185g' for update;
  if not found then raise exception 'split_snapshot_changed: offer 46bf45a7-71df-44f8-98f3-db308713bc66'; end if;
  perform 1 from public.store_products where id='e5c0eece-c510-440a-9bcf-c94fcbd84780' and product_id='95000afc-bf7f-4478-a624-b098446b6799' and store='dunnes' and store_sku is not distinct from '100173824' and store_product_name='Lakeshore Dijon Mustard 200g' for update;
  if not found then raise exception 'split_snapshot_changed: offer e5c0eece-c510-440a-9bcf-c94fcbd84780'; end if;
  perform 1 from public.store_products where id='10426a52-1d30-4b21-bcb4-177dc86fa9ad' and product_id='95000afc-bf7f-4478-a624-b098446b6799' and store='aldi' and store_sku is not distinct from 'BRAMWELLS Dijon Mustard' and store_product_name='BRAMWELLS Dijon Mustard' for update;
  if not found then raise exception 'split_snapshot_changed: offer 10426a52-1d30-4b21-bcb4-177dc86fa9ad'; end if;
  if (select count(*) from public.store_products where product_id='95000afc-bf7f-4478-a624-b098446b6799') <> 4 then raise exception 'split_offer_set_changed: 95000afc-bf7f-4478-a624-b098446b6799'; end if;
  -- Cajun Seasoning -> Schwartz Cajun Seasoning 44g
  update public.products set canonical_name='Schwartz Cajun Seasoning 44g', brand='Schwartz' where id='014dfd6d-a376-428f-968a-abdd7eefc8f7';
  insert into public.products(id, canonical_name, brand, category) values ('f294755c-46af-419a-8349-ccb0c1f85e60', 'Dunnes Stores Cajun Seasoning 35g', 'Dunnes Stores', 'Seasoning');
  update public.store_products set product_id='f294755c-46af-419a-8349-ccb0c1f85e60' where id='ab4871c4-3cea-42fc-9a79-e4305e044e61' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7';
  insert into public.products(id, canonical_name, brand, category) values ('f262711f-0c5d-43ca-92f6-d395c97c135c', 'Tesco Cajun Seasoning 45G', 'Tesco', 'Seasoning');
  update public.store_products set product_id='f262711f-0c5d-43ca-92f6-d395c97c135c' where id='5cb35a07-f9a9-478e-bc48-24048c69f7ab' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7';
  insert into public.products(id, canonical_name, brand, category) values ('5d4b5a53-1fc1-4aaf-a4ba-568efd71f1b2', 'READY, SET…COOK! Cajun Seasoning', 'READY, SET…COOK!', 'Seasoning');
  update public.store_products set product_id='5d4b5a53-1fc1-4aaf-a4ba-568efd71f1b2' where id='a62ca5fa-55d2-4940-8fcb-f38a4f27f57d' and product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7';
  insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values ('7faf308a-8c95-48ab-a618-2f9e9eee1872', '014dfd6d-a376-428f-968a-abdd7eefc8f7', 'tesco', '257518392', 'https://www.tesco.ie/shop/en-IE/products/257518392', 'Schwartz Cajun Seasoning 44g', 'failed');
  -- Muesli -> Lifeforce Muesli 750g
  update public.products set canonical_name='Lifeforce Muesli 750g', brand='Lifeforce' where id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed';
  insert into public.products(id, canonical_name, brand, category) values ('408253c3-82da-424c-aa01-5d5ac11f16b9', 'Flahavan''s Hi8 Muesli - Fruit & Nut', 'Flahavan''s', 'Breakfast');
  update public.store_products set product_id='408253c3-82da-424c-aa01-5d5ac11f16b9' where id='41f36453-5afc-4ebe-ab45-d5327163410a' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed';
  insert into public.products(id, canonical_name, brand, category) values ('52833f6d-04e8-4437-8bb4-d67771c8dae1', 'HARVEST MORN Chocolate Muesli Bars', 'HARVEST MORN', 'Breakfast');
  update public.store_products set product_id='52833f6d-04e8-4437-8bb4-d67771c8dae1' where id='ef5c7b5c-60de-4ee0-b48d-6615dfd0f1af' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed';
  insert into public.products(id, canonical_name, brand, category) values ('8c5c4ec0-a615-4426-a7f9-96c46300a557', 'Flahavan''s Hi8 Muesli Original 1kg', 'Flahavan''s', 'Breakfast');
  update public.store_products set product_id='8c5c4ec0-a615-4426-a7f9-96c46300a557' where id='7d80821c-7231-4e2f-b09c-36a463d1cc78' and product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed';
  insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values ('7e661ab9-b759-47dc-992a-50035b98ee39', '1cca7ae6-2118-4871-be9a-d8eeb359f0ed', 'tesco', '251970492', 'https://www.tesco.ie/shop/en-IE/products/251970492', 'Lifeforce Irish Muesli 750G', 'failed');
  -- Dijon Mustard -> Maille Dijon Mustard 215g
  update public.products set canonical_name='Maille Dijon Mustard 215g', brand='Maille' where id='95000afc-bf7f-4478-a624-b098446b6799';
  insert into public.products(id, canonical_name, brand, category) values ('09f55be6-e79d-4894-a5e2-b465343f2a16', 'Tesco Dijon Mustard 185g', 'Tesco', 'Condiments');
  update public.store_products set product_id='09f55be6-e79d-4894-a5e2-b465343f2a16' where id='46bf45a7-71df-44f8-98f3-db308713bc66' and product_id='95000afc-bf7f-4478-a624-b098446b6799';
  insert into public.products(id, canonical_name, brand, category) values ('f782052a-d967-44cf-8d8c-0c4f446f1360', 'Lakeshore Dijon Mustard 200g', 'Lakeshore', 'Condiments');
  update public.store_products set product_id='f782052a-d967-44cf-8d8c-0c4f446f1360' where id='e5c0eece-c510-440a-9bcf-c94fcbd84780' and product_id='95000afc-bf7f-4478-a624-b098446b6799';
  insert into public.products(id, canonical_name, brand, category) values ('19ef3f2e-5d85-462d-9076-59775909c9f2', 'BRAMWELLS Dijon Mustard', 'BRAMWELLS', 'Condiments');
  update public.store_products set product_id='19ef3f2e-5d85-462d-9076-59775909c9f2' where id='10426a52-1d30-4b21-bcb4-177dc86fa9ad' and product_id='95000afc-bf7f-4478-a624-b098446b6799';
  insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values ('0f73f3fd-e3f3-40f2-8548-bad63c079d58', '95000afc-bf7f-4478-a624-b098446b6799', 'tesco', '250858535', 'https://www.tesco.ie/shop/en-IE/products/250858535', 'Maille Dijon Original Mustard 215G', 'failed');
end $split$;
select 'Dunnes Stores Cajun Seasoning 35g' new_product, count(*) moved_offers from public.store_products where product_id='f294755c-46af-419a-8349-ccb0c1f85e60';
select 'Tesco Cajun Seasoning 45G' new_product, count(*) moved_offers from public.store_products where product_id='f262711f-0c5d-43ca-92f6-d395c97c135c';
select 'READY, SET…COOK! Cajun Seasoning' new_product, count(*) moved_offers from public.store_products where product_id='5d4b5a53-1fc1-4aaf-a4ba-568efd71f1b2';
select 'Schwartz Cajun Seasoning 44g' core, count(*) remaining_offers from public.store_products where product_id='014dfd6d-a376-428f-968a-abdd7eefc8f7';
select 'Flahavan''s Hi8 Muesli - Fruit & Nut' new_product, count(*) moved_offers from public.store_products where product_id='408253c3-82da-424c-aa01-5d5ac11f16b9';
select 'HARVEST MORN Chocolate Muesli Bars' new_product, count(*) moved_offers from public.store_products where product_id='52833f6d-04e8-4437-8bb4-d67771c8dae1';
select 'Flahavan''s Hi8 Muesli Original 1kg' new_product, count(*) moved_offers from public.store_products where product_id='8c5c4ec0-a615-4426-a7f9-96c46300a557';
select 'Lifeforce Muesli 750g' core, count(*) remaining_offers from public.store_products where product_id='1cca7ae6-2118-4871-be9a-d8eeb359f0ed';
select 'Tesco Dijon Mustard 185g' new_product, count(*) moved_offers from public.store_products where product_id='09f55be6-e79d-4894-a5e2-b465343f2a16';
select 'Lakeshore Dijon Mustard 200g' new_product, count(*) moved_offers from public.store_products where product_id='f782052a-d967-44cf-8d8c-0c4f446f1360';
select 'BRAMWELLS Dijon Mustard' new_product, count(*) moved_offers from public.store_products where product_id='19ef3f2e-5d85-462d-9076-59775909c9f2';
select 'Maille Dijon Mustard 215g' core, count(*) remaining_offers from public.store_products where product_id='95000afc-bf7f-4478-a624-b098446b6799';
rollback;
