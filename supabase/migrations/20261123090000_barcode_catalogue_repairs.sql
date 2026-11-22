-- Barcode-led catalogue repairs (owner decision, 22 Nov 2026): automated, evidence-bound, append-only.
-- Two guarded write paths, service_role only, each re-deriving its evidence in the database:
--   1. apply_barcode_regroup: SPLIT a mixed canonical record. The Tesco offer whose GTIN the other retailers'
--      own searches resolved, together with the offers those searches resolved ON THE SAME RECORD, moves to a NEW
--      canonical record. Requires independent evidence that the record is mixed: at least one remaining
--      Dunnes/SuperValu offer whose retailer's own search resolved a DIFFERENT SKU for this GTIN. No new
--      association is ever created (only barcode-proven members travel together); no row is deleted; prices,
--      receipts and evidence stay with their offers.
--   2. attach_barcode_supervalu_offer: the SuperValu counterpart of the Dunnes SKU-confirmed attach. Creates the
--      SuperValu offer that SuperValu's own search resolved for the GTIN, on the Tesco offer's record, bound to a
--      direct SKU-bound SuperValu product-page capture retained in the same transaction.
-- catalogue_repairs records every repair with full before-state (append-only). The deterministic and identity
-- decisions are src/lib/barcode-catalogue-repair.ts (policy barcode-repair-v1).

create table public.catalogue_repairs (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null check (policy_version ~ '^[a-z0-9][a-z0-9.-]{2,59}$'),
  kind text not null check (kind in ('regroup', 'attach_supervalu')),
  gtin text not null check (gtin ~ '^[0-9]{8,14}$'),
  tesco_offer_id uuid not null references public.store_products(id),
  from_product_id uuid references public.products(id),
  to_product_id uuid not null references public.products(id),
  moved_offer_ids uuid[] not null default '{}',
  created_offer_id uuid references public.store_products(id),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  reason text not null check (length(trim(reason)) >= 40),
  created_at timestamptz not null default now()
);
create function public.prevent_catalogue_repair_rewrite() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'catalogue repairs are append-only'; end $$;
create trigger catalogue_repairs_immutable before update or delete on public.catalogue_repairs
  for each row execute function public.prevent_catalogue_repair_rewrite();
create trigger catalogue_repairs_no_truncate before truncate on public.catalogue_repairs
  for each statement execute function public.prevent_catalogue_repair_rewrite();
alter table public.catalogue_repairs enable row level security;
revoke all on public.catalogue_repairs from public, anon, authenticated, service_role;
grant select on public.catalogue_repairs to service_role;
revoke all on function public.prevent_catalogue_repair_rewrite() from public, anon, authenticated, service_role;

-- An active strong barcode association: GTIN origin = this Tesco offer, at this store.
create function public.barcode_association_sku(p_tesco_offer uuid, p_gtin text, p_store text) returns text
language sql stable security definer set search_path = '' as $$
  select c.resolved_sku from public.current_barcode_associations c
  where c.gtin_origin_store_product_id = p_tesco_offer and ltrim(c.gtin, '0') = ltrim(p_gtin, '0')
    and c.store = p_store and c.status = 'active'
  limit 1
$$;
revoke all on function public.barcode_association_sku(uuid, text, text) from public, anon, authenticated, service_role;

-- 1. Split a mixed record ----------------------------------------------------------------------------------------
create function public.apply_barcode_regroup(p_policy_version text, p_tesco_offer uuid, p_gtin text, p_offers uuid[],
  p_canonical_name text, p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  t record; c record; o record; n uuid; repair uuid; evidence_of_mix boolean := false;
  members uuid[] := array[p_tesco_offer] || coalesce(p_offers, '{}');
  before jsonb;
begin
  if p_gtin !~ '^[0-9]{8,14}$' or length(trim(coalesce(p_canonical_name, ''))) < 6 or length(trim(coalesce(p_reason, ''))) < 40
     or jsonb_typeof(p_checks) is distinct from 'object' then
    raise exception 'regroup needs a GTIN, a canonical name, a reason and checks';
  end if;
  select id, product_id, store, store_sku into t from public.store_products where id = p_tesco_offer for update;
  if t.id is null or t.store <> 'tesco' or t.product_id is null then raise exception 'not a Tesco offer on a record'; end if;
  select id, canonical_name, category, default_unit, default_quantity into c from public.products where id = t.product_id;
  -- Every member: on the same record, one per store, unshared SKU; non-Tesco members are exactly the SKU their
  -- retailer's own search resolved for this GTIN from this Tesco offer.
  if (select count(distinct store) from public.store_products where id = any(members)) <> cardinality(members)
     or (select count(*) from public.store_products where id = any(members)) <> cardinality(members) then
    raise exception 'members must be distinct offers of distinct stores';
  end if;
  for o in select id, product_id, store, store_sku from public.store_products where id = any(members) for update loop
    if o.product_id is distinct from t.product_id then raise exception 'member % is on another record', o.id; end if;
    if o.store_sku is null or (select count(*) from public.store_products d where d.store = o.store and d.store_sku = o.store_sku) <> 1 then
      raise exception 'member % SKU missing or shared', o.id;
    end if;
    if o.store <> 'tesco' and public.barcode_association_sku(t.id, p_gtin, o.store) is distinct from o.store_sku then
      raise exception 'member % is not the SKU its retailer resolved for the GTIN', o.id;
    end if;
  end loop;
  -- Independent evidence that the record is mixed: a remaining offer whose own retailer resolved ANOTHER SKU.
  for o in select id, store, store_sku from public.store_products where product_id = t.product_id and not (id = any(members)) loop
    if o.store = 'tesco' then raise exception 'another Tesco offer remains on the record; not a clean split'; end if;
    if public.barcode_association_sku(t.id, p_gtin, o.store) is not null
       and o.store_sku is not null and public.barcode_association_sku(t.id, p_gtin, o.store) <> o.store_sku then evidence_of_mix := true; end if;
  end loop;
  if not evidence_of_mix then raise exception 'no independent evidence that the record is mixed'; end if;
  -- A positive pair decision between a member and a remaining offer would be silently broken: refuse.
  if exists (select 1 from public.retailer_offer_pair_reviews r
      join public.store_products a on a.id = r.left_offer_id join public.store_products b on b.id = r.right_offer_id
      where r.classification in ('exact_product', 'comparable_alternative')
        and ((r.left_offer_id = any(members)) <> (r.right_offer_id = any(members)))
        and (a.product_id = t.product_id or b.product_id = t.product_id)) then
    raise exception 'a pair decision links the split groups';
  end if;
  select jsonb_build_object('record', to_jsonb(p.*), 'offers', (select jsonb_agg(to_jsonb(s.*)) from public.store_products s where s.product_id = t.product_id))
    into before from public.products p where p.id = t.product_id;
  insert into public.products(canonical_name, category, default_unit, default_quantity)
    values (trim(p_canonical_name), c.category, c.default_unit, c.default_quantity) returning id into n;
  update public.store_products set product_id = n where id = any(members);
  insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, from_product_id, to_product_id, moved_offer_ids, before_state, checks, reason)
    values (p_policy_version, 'regroup', ltrim(p_gtin, '0'), t.id, t.product_id, n, members, before, p_checks, p_reason) returning id into repair;
  return repair;
end $$;
revoke all on function public.apply_barcode_regroup(text, uuid, text, uuid[], text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_barcode_regroup(text, uuid, text, uuid[], text, jsonb, text) to service_role;

-- 2. SuperValu attach --------------------------------------------------------------------------------------------
create function public.attach_barcode_supervalu_offer(p_policy_version text, p_tesco_offer uuid, p_gtin text,
  p_sku text, p_url text, p_name text, p_brand text, p_response jsonb, p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; offer uuid; repair uuid; run uuid;
begin
  if p_gtin !~ '^[0-9]{8,14}$' or p_sku !~ '^[0-9]{5,14}$' or length(trim(coalesce(p_name, ''))) < 3
     or length(trim(coalesce(p_reason, ''))) < 40 or jsonb_typeof(p_checks) is distinct from 'object' then
    raise exception 'attach needs GTIN, SKU, name, reason and checks';
  end if;
  if p_url !~ ('^https://shop\.supervalu\.ie/sm/delivery/rsid/5550/product/[a-z0-9-]+-id-' || p_sku || '$') then
    raise exception 'not a SuperValu product URL for this SKU';
  end if;
  select id, product_id, store into t from public.store_products where id = p_tesco_offer;
  if t.id is null or t.store <> 'tesco' or t.product_id is null then raise exception 'not a Tesco offer on a record'; end if;
  if public.barcode_association_sku(t.id, p_gtin, 'supervalu') is distinct from p_sku then
    raise exception 'SuperValu did not resolve this SKU for the GTIN';
  end if;
  if exists (select 1 from public.store_products where store = 'supervalu' and store_sku = p_sku) then raise exception 'SKU already owned'; end if;
  if exists (select 1 from public.store_products where product_id = t.product_id and store = 'supervalu' and store_sku is not null) then
    raise exception 'record already has a SuperValu offer';
  end if;
  -- The direct capture: SuperValu's own product page for this SKU, fetched at exactly this URL, recently.
  if p_response->>'sku' is distinct from p_sku or p_response->>'product_url' is distinct from p_url
     or p_response->>'requested_url' is distinct from p_url or p_response->>'final_url' is distinct from p_url
     or p_response->>'source_kind' is distinct from 'captured_product' or p_response->>'store' is distinct from 'supervalu'
     or (p_response->>'retrieved_at')::timestamptz < now() - interval '1 day' or (p_response->>'retrieved_at')::timestamptz > now() + interval '5 minutes'
     or length(coalesce(p_response->>'body_text', '')) = 0 or length(coalesce(p_response->'identity'->>'title', '')) = 0 then
    raise exception 'direct SuperValu capture missing or not bound to this SKU';
  end if;
  insert into public.store_products(product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, url_status)
    values (t.product_id, 'supervalu', p_sku, p_url, trim(p_name), nullif(trim(coalesce(p_brand, '')), ''), false, 'resolved') returning id into offer;
  insert into public.scrape_runs(run_id, store, started_at, finished_at, target_count, attempted_count, fetched, extracted, inserted, unchanged_count, failed,
      retrieval_method, threshold_pct, status)
    values ('barcode_attach_supervalu_' || to_char(now(), 'YYYYMMDDHH24MISSMS'), 'supervalu', now(), now(), 1, 1, 1, 1, 0, 0, 0, 'vercel_direct_product_page', 0, 'success')
    returning id into run;
  insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at, content_type, body_text,
      parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
    values ('supervalu', p_sku, p_url, p_url, p_url, (p_response->>'retrieved_at')::timestamptz, coalesce(p_response->>'content_type', 'text/html'),
      p_response->>'body_text', p_response->>'parser_version', 'captured_product', p_response->>'source_path', p_response->'identity', run, offer);
  insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, to_product_id, created_offer_id, before_state, checks, reason)
    values (p_policy_version, 'attach_supervalu', ltrim(p_gtin, '0'), t.id, t.product_id, offer,
      jsonb_build_object('offers', (select jsonb_agg(to_jsonb(s.*)) from public.store_products s where s.product_id = t.product_id and s.id <> offer)),
      p_checks, p_reason) returning id into repair;
  return offer;
end $$;
revoke all on function public.attach_barcode_supervalu_offer(text, uuid, text, text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.attach_barcode_supervalu_offer(text, uuid, text, text, text, text, text, jsonb, jsonb, text) to service_role;
