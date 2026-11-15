-- Tesco verified canonical -> Tesco SKU links from catalogue evidence.
--
-- A link records that a canonical product's CURRENT Tesco mapping (same SKU) is
-- independently identified by a BARCODE: the Tesco catalogue item's GTIN equals
-- the canonical EAN or a Dunnes/SuperValu peer GTIN for the same canonical
-- product. It is evidence for the collector, NOT a price and NOT a mapping
-- change. Replacement SKUs never become links here; they go through the
-- supervised (postgres bridge) repair. The collector still requires the live
-- page to carry the same SKU + GTIN, the deterministic gate to fail only on
-- canonical-description gaps, the AI verified_exact verdict, and (for a first
-- price) the single-use approval with both peers independently matching.
-- Written ONLY through the SECURITY DEFINER RPCs below; service_role: SELECT.

create table if not exists public.tesco_verified_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  tesco_sku text not null check (tesco_sku ~ '^[0-9]{6,12}$'),
  tesco_url text not null,
  gtin text not null check (gtin ~ '^[0-9]{8,14}$'),
  barcode_source text not null check (barcode_source in ('canonical_ean', 'peer_gtin')),
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
  v_source text;
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

  -- Independent barcode: the canonical EAN, else a Dunnes/SuperValu peer GTIN.
  if ltrim(coalesce(v_snapshot->>'canonical_ean', ''), '0') = v_code then v_source := 'canonical_ean';
  elsif exists (select 1 from public.store_products x
    where x.product_id = (v_snapshot->>'product_id')::uuid and x.store in ('dunnes', 'supervalu')
      and ltrim(coalesce(x.gtin, ''), '0') = v_code) then v_source := 'peer_gtin';
  else raise exception 'barcode_not_independent'; end if;

  update public.tesco_verified_links set status = 'reopened', reopened_at = now(), reopened_reason = 'superseded_by_new_link'
    where store_product_id = p_store_product_id and status = 'active';
  insert into public.tesco_verified_links (product_id, store_product_id, tesco_sku, tesco_url, gtin, barcode_source,
    mapping_snapshot, catalogue_item, catalogue_raw_sha256, catalogue_captured_at, provider_run_id, identity_fingerprint, evidence)
  values ((v_snapshot->>'product_id')::uuid, p_store_product_id, v_sku, v_snapshot->>'store_url', p_gtin, v_source,
    v_snapshot, p_catalogue_item, p_catalogue_raw_sha256, p_catalogue_captured_at, p_provider_run_id, p_identity_fingerprint,
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
