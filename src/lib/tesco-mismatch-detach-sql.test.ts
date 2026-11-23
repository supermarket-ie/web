// detach_tesco_offer (migration 20261124130000) on the real barcode / repair / onboarding migrations.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7f000000-0000-0000-0000-0000000000c1';
const T = '7f000000-0000-0000-0000-0000000000a1', S = '7f000000-0000-0000-0000-0000000000b1';
const E = '7f000000-0000-0000-0000-0000000000e1';
let db: PGlite;
const raw = (o: Record<string, unknown> = {}) => JSON.stringify({ name: 'Pringles Sour Cream & Onion Crisps 165G', brand_name: 'Pringles', gtin: '05053990101863', ...o });
const evidence = (id: string, offer: string, sku: string, r: string, age = '1 hour') =>
  db.exec(`insert into public.tesco_apify_provider_evidence(id, store_product_id, sku, raw_item, captured_at) values ('${id}', '${offer}', '${sku}', '${r}'::jsonb, now() - interval '${age}')`);
const detach = (offer = T, ev = E, category: string | null = 'Snacks') => db.query<{ id: string }>(
  `select public.detach_tesco_offer('tesco-detach-v1', $1, $2, $3, '{"klass":"genuine_mismatch","reasons":["measureConflict"]}'::jsonb,
    'Retained Tesco page states 165g; the record is the 40g product (test reason).') id`, [offer, ev, category]);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.products (id uuid primary key default gen_random_uuid(), canonical_name text not null, category text not null, default_unit text, default_quantity text, brand text);
    create table public.store_products (id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id), store text, store_sku text, store_url text,
      store_product_name text, brand text, is_own_brand boolean, url_status text, gtin text);
    create table public.scrape_runs (id uuid primary key default gen_random_uuid(), run_id text, store text, started_at timestamptz, finished_at timestamptz, target_count int,
      attempted_count int, fetched int, extracted int, inserted int, unchanged_count int, failed int, retrieval_method text, threshold_pct numeric, status text);
    create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());
    -- Minimal stub of the production provider-evidence table (columns the detach function reads).
    create table public.tesco_apify_provider_evidence (id uuid primary key default gen_random_uuid(), store_product_id uuid, sku text, raw_item jsonb, captured_at timestamptz not null default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123090000_barcode_catalogue_repairs', '20261124090000_barcode_tesco_onboarding',
    '20261124120000_barcode_tesco_onboarding_category', '20261124130000_tesco_mismatch_detach'])
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.products(id, canonical_name, brand, category) values ('${P}', 'Pringles Sour Cream & Onion 40g', 'Pringles', 'Snacks');
    insert into public.store_products(id, product_id, store, store_sku, store_url, url_status) values
      ('${T}', '${P}', 'tesco', '300000001', 'https://www.tesco.ie/shop/en-IE/products/300000001', 'resolved'),
      ('${S}', '${P}', 'supervalu', '1017371000', 'u', 'resolved');`);
  await evidence(E, T, '300000001', raw());
});
afterEach(async () => { await db.close(); });

describe('detach_tesco_offer', () => {
  it('moves the Tesco offer onto a new record named from its retained page and writes a ledger row', async () => {
    const n = (await asService(() => detach())).rows[0].id;
    expect((await db.query<Record<string, unknown>>(`select canonical_name, brand, category from public.products where id = $1`, [n])).rows[0])
      .toEqual({ canonical_name: 'Pringles Sour Cream & Onion Crisps 165G', brand: 'Pringles', category: 'Snacks' });
    expect((await db.query<{ product_id: string }>(`select product_id from public.store_products where id = $1`, [T])).rows[0].product_id).toBe(n);
    expect((await db.query<{ product_id: string }>(`select product_id from public.store_products where id = $1`, [S])).rows[0].product_id).toBe(P);
    const r = (await db.query<Record<string, unknown>>(`select kind, gtin, from_product_id, to_product_id from public.catalogue_repairs where tesco_offer_id = $1`, [T])).rows;
    expect(r).toEqual([{ kind: 'detach_tesco', gtin: '5053990101863', from_product_id: P, to_product_id: n }]);
  });
  it('refuses: no category, unbound/old/incomplete/own-label evidence, offer already alone', async () => {
    await expect(asService(() => detach(T, E, null))).rejects.toThrow(/catalogue category/);
    await expect(asService(() => detach(T, E, 'Wine'))).rejects.toThrow(/catalogue category/);
    await evidence('7f000000-0000-0000-0000-0000000000e2', S, '1017371000', raw());
    await expect(asService(() => detach(T, '7f000000-0000-0000-0000-0000000000e2'))).rejects.toThrow(/not bound/);
    await evidence('7f000000-0000-0000-0000-0000000000e3', T, '300000001', raw(), '40 days');
    await expect(asService(() => detach(T, '7f000000-0000-0000-0000-0000000000e3'))).rejects.toThrow(/too old/);
    await evidence('7f000000-0000-0000-0000-0000000000e4', T, '300000001', raw({ gtin: null }));
    await expect(asService(() => detach(T, '7f000000-0000-0000-0000-0000000000e4'))).rejects.toThrow(/identity incomplete/);
    await evidence('7f000000-0000-0000-0000-0000000000e5', T, '300000001', raw({ brand_name: 'Tesco', name: 'Tesco Sour Cream Crisps 150G' }));
    await expect(asService(() => detach(T, '7f000000-0000-0000-0000-0000000000e5'))).rejects.toThrow(/own-label/);
    await expect(asService(() => detach(S, E))).rejects.toThrow(/not a Tesco offer/);
    await asService(() => detach());
    await expect(asService(() => detach())).rejects.toThrow(/already alone/);
    expect((await db.query(`select 1 from public.catalogue_repairs where kind = 'detach_tesco'`)).rows).toHaveLength(1);
  });
  it('browser roles cannot call it', async () => {
    const sig = 'public.detach_tesco_offer(text,uuid,uuid,text,jsonb,text)';
    const r = (await db.query<{ a: boolean; u: boolean }>(`select has_function_privilege('anon', '${sig}', 'execute') a, has_function_privilege('authenticated', '${sig}', 'execute') u`)).rows[0];
    expect(r).toEqual({ a: false, u: false });
  });
});
