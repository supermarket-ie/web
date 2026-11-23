-- Barcode-led catalogue expansion (owner decision, 23 Nov 2026): onboard a Tesco SKU that is NOT yet in the
-- catalogue, from Tesco's own catalogue listing, when Dunnes' and/or SuperValu's own storefront search resolved its
-- GTIN to exactly one SKU (strong tier).
--   * target = the existing record that owns the resolved SKU(s): the Tesco offer joins it (fills a Tesco gap);
--   * no owner: a NEW canonical record named from Tesco's own title and brand.
-- One transaction: the Tesco offer, the hash-checked barcode observations bound to it, and an append-only
-- catalogue_repairs row. No price is written: the Tesco first price still goes through the existing evidence,
-- AI approval and expansion gates; Dunnes/SuperValu offers through the existing guarded attach paths.
-- Identity judgements (strong hits, no contradicting offer on the target record) are src/lib/barcode-tesco-onboarding.ts.

alter table public.catalogue_repairs drop constraint catalogue_repairs_kind_check;
alter table public.catalogue_repairs add constraint catalogue_repairs_kind_check
  check (kind in ('regroup', 'attach_supervalu', 'onboard_tesco'));

create function public.onboard_barcode_tesco_offer(p_policy_version text, p_tesco_sku text, p_tesco_name text, p_tesco_brand text,
  p_gtin text, p_target_product uuid, p_observations jsonb, p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  g text := ltrim(coalesce(p_gtin, ''), '0'); o jsonb; offer uuid; product uuid; stores text[] := '{}'; owner uuid; n int;
  url text := 'https://www.tesco.ie/shop/en-IE/products/' || p_tesco_sku;
begin
  if p_tesco_sku !~ '^[0-9]{6,12}$' or p_gtin !~ '^[0-9]{8,14}$' or length(trim(coalesce(p_tesco_name, ''))) < 6
     or length(trim(coalesce(p_tesco_brand, ''))) < 2 or length(trim(coalesce(p_reason, ''))) < 40
     or jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_observations) is distinct from 'array'
     or jsonb_array_length(p_observations) not between 1 and 2 then
    raise exception 'onboarding needs SKU, GTIN, Tesco name and brand, 1-2 observations, checks and a reason';
  end if;
  if p_tesco_brand ~* '^(tesco|dunnes|supervalu)( |$)' or p_tesco_name ~* '^(tesco|dunnes|supervalu)( |$)' then
    raise exception 'retailer own-label products are not onboarded across retailers';
  end if;
  perform pg_advisory_xact_lock(hashtext('barcode-onboard-tesco:' || p_tesco_sku));
  if exists (select 1 from public.store_products where store = 'tesco' and store_sku = p_tesco_sku) then raise exception 'Tesco SKU already in the catalogue'; end if;
  -- Observations: strong, this GTIN, distinct stores, recent; every resolved SKU owned by nobody or by the target only.
  for o in select * from jsonb_array_elements(p_observations) loop
    if o->>'store' not in ('dunnes', 'supervalu') or o->>'store' = any(stores) then raise exception 'observations must be for distinct stores'; end if;
    stores := stores || (o->>'store');
    if o->>'tier' <> 'strong' or o->>'outcome' <> 'identity_consistent' or ltrim(o->>'gtin', '0') <> g
       or o->>'gtin_origin_sku' <> p_tesco_sku or (o->>'observed_at')::timestamptz < now() - interval '3 days' then
      raise exception 'observation is not a recent strong resolution of this GTIN from this Tesco SKU';
    end if;
    select count(*), min(product_id::text)::uuid into n, owner from public.store_products where store = o->>'store' and store_sku = o->>'resolved_sku';
    if n > 1 then raise exception 'resolved % SKU % is shared', o->>'store', o->>'resolved_sku'; end if;
    if n = 1 and owner is distinct from p_target_product then raise exception 'resolved % SKU % belongs to another record', o->>'store', o->>'resolved_sku'; end if;
  end loop;
  if p_target_product is not null then
    perform 1 from public.products where id = p_target_product for update;
    if not found then raise exception 'target record missing'; end if;
    if exists (select 1 from public.store_products where product_id = p_target_product and store = 'tesco') then raise exception 'target record already has a Tesco offer'; end if;
    if not exists (select 1 from jsonb_array_elements(p_observations) x join public.store_products s
        on s.store = x->>'store' and s.store_sku = x->>'resolved_sku' and s.product_id = p_target_product) then
      raise exception 'target record owns none of the resolved SKUs';
    end if;
    product := p_target_product;
  else
    insert into public.products(canonical_name, brand) values (trim(p_tesco_name), trim(p_tesco_brand)) returning id into product;
  end if;
  insert into public.store_products(product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, url_status, gtin)
    values (product, 'tesco', p_tesco_sku, url, trim(p_tesco_name), trim(p_tesco_brand), false, 'resolved', p_gtin) returning id into offer;
  for o in select * from jsonb_array_elements(p_observations) loop
    insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
        store, evidence_kind, query, endpoint, http_status, result_total, result_items, query_forms, response_sha256, response_body,
        resolved_sku, outcome, tier, identity_reasons, review_reasons, title_agreement, rule_version, observed_at)
      values (o->>'gtin', o->>'gtin_kind', 'tesco', p_tesco_sku, offer, o->'gtin_origin_evidence',
        o->>'store', 'sku_found_by_gtin_search', o->>'query', o->>'endpoint', 200, (o->>'result_total')::int, o->'result_items', coalesce(o->'query_forms', '[]'::jsonb),
        o->>'response_sha256', o->>'response_body', o->>'resolved_sku', 'identity_consistent', 'strong', '[]'::jsonb, '[]'::jsonb,
        (o->>'title_agreement')::numeric, o->>'rule_version', (o->>'observed_at')::timestamptz);
  end loop;
  insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, to_product_id, created_offer_id, before_state, checks, reason)
    values (p_policy_version, 'onboard_tesco', g, offer, product, offer,
      jsonb_build_object('target_existing', p_target_product is not null,
        'offers', (select coalesce(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb) from public.store_products s where s.product_id = product and s.id <> offer)),
      p_checks, p_reason);
  return offer;
end $$;
revoke all on function public.onboard_barcode_tesco_offer(text, text, text, text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.onboard_barcode_tesco_offer(text, text, text, text, text, uuid, jsonb, jsonb, text) to service_role;
