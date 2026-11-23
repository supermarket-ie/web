-- Legacy Tesco mismatch repair (owner decision, 23 Nov 2026), separate from new-product onboarding.
-- A Tesco offer whose OWN retained page materially contradicts the canonical record it is mapped to (retained review
-- class genuine_mismatch: measure/pack/brand/variant/formulation conflict) is DETACHED onto its own new record,
-- named from that retained Tesco page (tesco_apify_provider_evidence.raw_item: name, brand_name, gtin), so the
-- record stops claiming two different products are the same. Nothing is deleted; prices, receipts and evidence stay
-- with the offer; the Tesco price still needs the existing first-price evidence + AI + approval gates.
-- The material-contradiction judgement is src/lib/tesco-mismatch-detach.ts (policy tesco-detach-v1).

alter table public.catalogue_repairs drop constraint catalogue_repairs_kind_check;
alter table public.catalogue_repairs add constraint catalogue_repairs_kind_check
  check (kind in ('regroup', 'attach_supervalu', 'onboard_tesco', 'detach_tesco'));

create function public.detach_tesco_offer(p_policy_version text, p_tesco_offer uuid, p_evidence_id uuid, p_category text,
  p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; ev record; n uuid; before jsonb; name text; brand text; g text;
begin
  if length(trim(coalesce(p_reason, ''))) < 40 or jsonb_typeof(p_checks) is distinct from 'object' then raise exception 'detach needs checks and a reason'; end if;
  if p_category is null or p_category not in ('Dairy', 'Meat', 'Vegetables', 'Fruit', 'Bakery', 'Breakfast', 'Pasta & Rice', 'Tinned', 'Condiments',
      'Beverages', 'Snacks', 'Frozen', 'Dairy Alternatives', 'Household', 'Personal Care', 'Baking', 'Spreads', 'Fish', 'Baby', 'Chilled',
      'Pet Care', 'Oils', 'Seasoning', 'Stock') then
    raise exception 'a new record needs a catalogue category';
  end if;
  select id, product_id, store, store_sku into t from public.store_products where id = p_tesco_offer for update;
  if t.id is null or t.store <> 'tesco' or t.product_id is null then raise exception 'not a Tesco offer on a record'; end if;
  perform 1 from public.products where id = t.product_id for update;
  -- The identity comes from the offer's OWN retained Tesco provider item, bound to this offer and SKU.
  select e.id, e.raw_item, e.captured_at into ev from public.tesco_apify_provider_evidence e
    where e.id = p_evidence_id and e.store_product_id = t.id and e.sku = t.store_sku;
  if ev.id is null then raise exception 'retained Tesco evidence not bound to this offer'; end if;
  if ev.captured_at < now() - interval '30 days' then raise exception 'retained Tesco evidence too old'; end if;
  name := trim(coalesce(ev.raw_item->>'name', '')); brand := trim(coalesce(ev.raw_item->>'brand_name', ''));
  g := nullif(ltrim(coalesce(ev.raw_item->>'gtin', ''), '0'), '');
  if length(name) < 6 or length(brand) < 2 or g is null or g !~ '^[0-9]{8,14}$' then raise exception 'retained Tesco identity incomplete'; end if;
  if brand ~* '^(tesco|dunnes|supervalu)( |$)' or name ~* '^(tesco|dunnes|supervalu)( |$)' then
    raise exception 'own-label offers are not detached by this policy';
  end if;
  if not exists (select 1 from public.store_products s where s.product_id = t.product_id and s.id <> t.id) then
    raise exception 'the offer is already alone on its record';
  end if;
  if exists (select 1 from public.retailer_offer_pair_reviews r
      where r.classification in ('exact_product', 'comparable_alternative') and (r.left_offer_id = t.id or r.right_offer_id = t.id)) then
    raise exception 'a positive pair decision involves this offer';
  end if;
  select jsonb_build_object('record', to_jsonb(p.*), 'offers', (select jsonb_agg(to_jsonb(s.*)) from public.store_products s where s.product_id = t.product_id))
    into before from public.products p where p.id = t.product_id;
  insert into public.products(canonical_name, brand, category) values (name, brand, p_category) returning id into n;
  update public.store_products set product_id = n where id = t.id;
  insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, from_product_id, to_product_id, moved_offer_ids, before_state, checks, reason)
    values (p_policy_version, 'detach_tesco', g, t.id, t.product_id, n, array[t.id], before, p_checks, p_reason);
  return n;
end $$;
revoke all on function public.detach_tesco_offer(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.detach_tesco_offer(text, uuid, uuid, text, jsonb, text) to service_role;
