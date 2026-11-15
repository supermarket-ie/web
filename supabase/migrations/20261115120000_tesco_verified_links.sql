-- Tesco verified canonical -> Tesco SKU links from catalogue evidence.
--
-- A link records that a canonical product's CURRENT Tesco mapping (same SKU) is
-- independently identified by a BARCODE whose PROVENANCE is recorded as
-- non-Tesco (product_barcode_provenance: captured from a Dunnes or SuperValu
-- page). REVISION (owner review of PR #407, before apply): a canonical EAN is
-- NOT independent by itself — measured 15 Nov 2026, 306 of 313 canonical EANs
-- equal the Tesco mapping's own GTIN and none equals a peer GTIN, so seeing it
-- again in Tesco's catalogue is the same evidence twice. Links are revalidated
-- (reopened) when the canonical product, any of its retailer offers, the
-- Tesco SKU's ownership or the barcode provenance changes, even if the Tesco
-- SKU and barcode stay the same. It is evidence for the collector, NOT a price and NOT a mapping
-- change. Replacement SKUs never become links here; they go through the
-- supervised (postgres bridge) repair. The collector still requires the live
-- page to carry the same SKU + GTIN, the deterministic gate to fail only on
-- canonical-description gaps, the AI verified_exact verdict, and (for a first
-- price) the single-use approval with both peers independently matching.
-- Written ONLY through the SECURITY DEFINER RPCs below; service_role: SELECT.

-- Independently sourced barcodes. Written ONLY by record_product_barcode_provenance
-- from a Dunnes/SuperValu offer of the canonical product; never from Tesco.
create table if not exists public.product_barcode_provenance (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  gtin text not null check (gtin ~ '^[0-9]{8,14}$'),
  source_store text not null check (source_store in ('dunnes', 'supervalu')),
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  source_url text not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);
alter table public.product_barcode_provenance enable row level security;
revoke all on public.product_barcode_provenance from public, anon, authenticated, service_role;
grant select on public.product_barcode_provenance to service_role;
create unique index if not exists product_barcode_provenance_one_live
  on public.product_barcode_provenance (store_product_id, ltrim(gtin, '0')) where revoked_at is null;

create or replace function public.record_product_barcode_provenance(
  p_store_product_id uuid, p_gtin text, p_source_url text, p_evidence_sha256 text, p_captured_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_sp record; v_id uuid;
begin
  if p_gtin is null or p_gtin !~ '^[0-9]{8,14}$' then raise exception 'gtin_invalid'; end if;
  if p_evidence_sha256 is null or p_evidence_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'evidence_hash_invalid'; end if;
  if p_captured_at is null or p_captured_at > now() + interval '5 minutes' or p_captured_at < now() - interval '14 days'
  then raise exception 'captured_at_invalid'; end if;
  select id, product_id, store into v_sp from public.store_products where id = p_store_product_id;
  if v_sp.id is null or v_sp.store not in ('dunnes', 'supervalu') then raise exception 'source_must_be_dunnes_or_supervalu'; end if;
  if p_source_url is null or p_source_url !~ '^https://' then raise exception 'source_url_invalid'; end if;
  insert into public.product_barcode_provenance (product_id, gtin, source_store, store_product_id, source_url, evidence_sha256, captured_at)
  values (v_sp.product_id, p_gtin, v_sp.store, v_sp.id, p_source_url, p_evidence_sha256, p_captured_at)
  on conflict (store_product_id, ltrim(gtin, '0')) where revoked_at is null do update set captured_at = excluded.captured_at,
    evidence_sha256 = excluded.evidence_sha256, source_url = excluded.source_url
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_product_barcode_provenance(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_product_barcode_provenance(uuid, text, text, text, timestamptz) to service_role;

create table if not exists public.tesco_verified_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  tesco_sku text not null check (tesco_sku ~ '^[0-9]{6,12}$'),
  tesco_url text not null,
  gtin text not null check (gtin ~ '^[0-9]{8,14}$'),
  barcode_source text not null check (barcode_source in ('dunnes', 'supervalu')),
  barcode_provenance_id uuid not null references public.product_barcode_provenance(id) on delete cascade,
  method text not null default 'barcode_exact' check (method = 'barcode_exact'),
  mapping_snapshot jsonb not null,
  catalogue_item jsonb not null,           -- name, brand, pack, net contents, category path
  catalogue_raw_sha256 text not null check (catalogue_raw_sha256 ~ '^[a-f0-9]{64}$'),
  catalogue_captured_at timestamptz not null,
  provider_run_id text not null,
  identity_fingerprint text not null check (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'reopened')),
  verified_at timestamptz not null default now(),
  reopened_at timestamptz,
  reopened_reason text
);
alter table public.tesco_verified_links enable row level security;
revoke all on public.tesco_verified_links from public, anon, authenticated, service_role;
grant select on public.tesco_verified_links to service_role;
create unique index if not exists tesco_verified_links_one_active
  on public.tesco_verified_links (store_product_id) where status = 'active';

create or replace function public.apify_record_verified_link(
  p_store_product_id uuid,
  p_gtin text,
  p_catalogue_item jsonb,
  p_catalogue_raw_sha256 text,
  p_catalogue_captured_at timestamptz,
  p_provider_run_id text,
  p_identity_fingerprint text,
  p_evidence jsonb,
  p_expected_snapshot jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_sku text;
  v_code text := ltrim(coalesce(p_gtin, ''), '0');
  v_prov record;
  v_id uuid;
begin
  if p_expected_snapshot is null or jsonb_typeof(p_expected_snapshot) <> 'object' then raise exception 'expected_snapshot_required'; end if;
  if p_gtin is null or p_gtin !~ '^[0-9]{8,14}$' then raise exception 'gtin_invalid'; end if;
  if p_catalogue_raw_sha256 is null or p_catalogue_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_identity_fingerprint is null or p_identity_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'link_hashes_invalid'; end if;

  perform 1 from public.store_products s where s.id = p_store_product_id and s.store = 'tesco' for update;
  if not found then raise exception 'mapping_not_found'; end if;
  v_snapshot := public.apify_mapping_snapshot(p_store_product_id);
  if v_snapshot is distinct from p_expected_snapshot then raise exception 'expected_snapshot_changed'; end if;
  v_sku := v_snapshot->>'store_sku';
  if v_snapshot->>'url_status' <> 'resolved'
    or v_snapshot->>'store_url' <> 'https://www.tesco.ie/shop/en-IE/products/' || v_sku
  then raise exception 'mapping_not_resolved'; end if;
  if jsonb_array_length(coalesce(v_snapshot->'same_sku_canonical_names', '[]'::jsonb)) > 1
  then raise exception 'shared_sku_requires_review'; end if;

  -- The catalogue item is for THIS mapping's SKU and carries THIS GTIN.
  if p_catalogue_item->>'sku' is distinct from v_sku
    or ltrim(coalesce(p_catalogue_item->>'gtin', ''), '0') <> v_code
  then raise exception 'catalogue_item_mismatch'; end if;
  if p_catalogue_captured_at < now() - interval '14 days' then raise exception 'catalogue_evidence_stale'; end if;
  -- Evidence must come from a budgeted, final-charge-settled catalogue run.
  if not exists (select 1 from public.tesco_apify_budget_reservations r
    where r.provider_run_id = p_provider_run_id and r.campaign like 'tesco-catalogue-%' and r.state = 'settled')
  then raise exception 'catalogue_run_not_settled'; end if;

  -- Independent barcode: ONLY a live provenance row for THIS canonical product,
  -- captured from a Dunnes/SuperValu offer that still belongs to it. A matching
  -- canonical EAN alone is not independent (it is usually Tesco-sourced).
  select pb.id, pb.source_store into v_prov from public.product_barcode_provenance pb
    join public.store_products x on x.id = pb.store_product_id
    where pb.product_id = (v_snapshot->>'product_id')::uuid and pb.revoked_at is null
      and ltrim(pb.gtin, '0') = v_code and x.product_id = pb.product_id and x.store = pb.source_store
    order by pb.captured_at desc limit 1;
  if v_prov.id is null then raise exception 'barcode_not_independent'; end if;

  update public.tesco_verified_links set status = 'reopened', reopened_at = now(), reopened_reason = 'superseded_by_new_link'
    where store_product_id = p_store_product_id and status = 'active';
  insert into public.tesco_verified_links (product_id, store_product_id, tesco_sku, tesco_url, gtin, barcode_source,
    barcode_provenance_id, mapping_snapshot, catalogue_item, catalogue_raw_sha256, catalogue_captured_at, provider_run_id, identity_fingerprint, evidence)
  values ((v_snapshot->>'product_id')::uuid, p_store_product_id, v_sku, v_snapshot->>'store_url', p_gtin, v_prov.source_store,
    v_prov.id, v_snapshot, p_catalogue_item, p_catalogue_raw_sha256, p_catalogue_captured_at, p_provider_run_id, p_identity_fingerprint,
    coalesce(p_evidence, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.apify_record_verified_link(uuid, text, jsonb, text, timestamptz, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apify_record_verified_link(uuid, text, jsonb, text, timestamptz, text, text, jsonb, jsonb) to service_role;

-- Reopen a link when the live identity no longer matches it (SKU, GTIN or
-- identity fingerprint changed, or the mapping changed). Idempotent.
create or replace function public.apify_reopen_verified_link(p_link_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  update public.tesco_verified_links set status = 'reopened', reopened_at = now(), reopened_reason = left(trim(p_reason), 300)
    where id = p_link_id and status = 'active';
  return found;
end;
$$;
revoke all on function public.apify_reopen_verified_link(uuid, text) from public, anon, authenticated;
grant execute on function public.apify_reopen_verified_link(uuid, text) to service_role;

comment on table public.tesco_verified_links is
  'Barcode-verified canonical->Tesco SKU links (same SKU as the current mapping) from settled catalogue runs. Evidence only; never a price or a mapping change. service_role: SELECT only.';

-- ---------------------------------------------------------------------------
-- REVALIDATION: reopen active links whenever the evidence they rest on changes,
-- even if the Tesco SKU and barcode are unchanged. A reopened link is never
-- used; re-linking needs fresh catalogue evidence through the RPC above.
-- ---------------------------------------------------------------------------
create schema if not exists tesco_internal;
create or replace function tesco_internal.reopen_links(p_product_ids uuid[], p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.tesco_verified_links set status = 'reopened', reopened_at = now(), reopened_reason = left(p_reason, 300)
    where status = 'active' and product_id = any(p_product_ids);
$$;
revoke all on function tesco_internal.reopen_links(uuid[], text) from public, anon, authenticated, service_role;

-- Canonical product identity changed (name, brand, EAN, quantity/unit).
create or replace function tesco_internal.links_on_product_change() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if (to_jsonb(new) - 'created_at' - 'image_url' - 'description' - 'ingredients' - 'search_profile' - 'category')
     is distinct from (to_jsonb(old) - 'created_at' - 'image_url' - 'description' - 'ingredients' - 'search_profile' - 'category') then
    perform tesco_internal.reopen_links(array[new.id], 'canonical_product_changed');
  end if;
  return new;
end;
$fn$;
revoke all on function tesco_internal.links_on_product_change() from public, anon, authenticated, service_role;
drop trigger if exists links_on_product_change on public.products;
create trigger links_on_product_change after update on public.products
  for each row execute function tesco_internal.links_on_product_change();

-- Any retailer offer of the canonical product changed, appeared or vanished
-- (the Tesco mapping itself, a peer whose barcode was the evidence, or a new
-- owner of the linked Tesco SKU). Volatile URL-check bookkeeping and nutrition
-- columns are ignored.
create or replace function tesco_internal.links_on_offer_change() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_ignore text[] := array['created_at','url_last_checked_at','url_last_error','nutrition_updated_at','calories_per_100',
    'carbs_per_100','fat_per_100','fibre_per_100','protein_per_100','salt_per_100','saturated_fat_per_100','sugar_per_100'];
  v_old jsonb; v_new jsonb; v_ids uuid[] := array[]::uuid[];
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_ignore; v_new := to_jsonb(new) - v_ignore;
    if v_old is not distinct from v_new then return new; end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then v_ids := v_ids || old.product_id; end if;
  if tg_op in ('UPDATE', 'INSERT') then v_ids := v_ids || new.product_id; end if;
  -- A Tesco offer that now (or no longer) owns a linked SKU changes ownership.
  v_ids := v_ids || coalesce((select array_agg(l.product_id) from public.tesco_verified_links l
    where l.status = 'active' and l.tesco_sku in (
      case when tg_op <> 'INSERT' and old.store = 'tesco' then old.store_sku end,
      case when tg_op <> 'DELETE' and new.store = 'tesco' then new.store_sku end)), array[]::uuid[]);
  perform tesco_internal.reopen_links(v_ids, 'retailer_offer_changed:' || lower(tg_op));
  return coalesce(new, old);
end;
$fn$;
revoke all on function tesco_internal.links_on_offer_change() from public, anon, authenticated, service_role;
drop trigger if exists links_on_offer_change on public.store_products;
create trigger links_on_offer_change after insert or update or delete on public.store_products
  for each row execute function tesco_internal.links_on_offer_change();

-- The barcode's provenance was revoked, changed or deleted.
create or replace function tesco_internal.links_on_provenance_change() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  update public.tesco_verified_links set status = 'reopened', reopened_at = now(), reopened_reason = 'barcode_provenance_changed'
    where status = 'active' and barcode_provenance_id = old.id;
  return coalesce(new, old);
end;
$fn$;
revoke all on function tesco_internal.links_on_provenance_change() from public, anon, authenticated, service_role;
drop trigger if exists links_on_provenance_change on public.product_barcode_provenance;
drop trigger if exists links_on_provenance_delete on public.product_barcode_provenance;
create trigger links_on_provenance_change after update on public.product_barcode_provenance
  for each row when (old.revoked_at is null and (new.revoked_at is not null or ltrim(new.gtin, '0') <> ltrim(old.gtin, '0')
    or new.product_id <> old.product_id or new.store_product_id <> old.store_product_id))
  execute function tesco_internal.links_on_provenance_change();
create trigger links_on_provenance_delete after delete on public.product_barcode_provenance
  for each row when (old.revoked_at is null) execute function tesco_internal.links_on_provenance_change();
