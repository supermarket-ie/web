// onboard_barcode_tesco_offer (migration 20261124090000) on the real barcode / repair migrations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7f000000-0000-0000-0000-0000000000c1', S = '7f000000-0000-0000-0000-0000000000b1';
const GTIN = '5000157062673', TSKU = '300000001', SSKU = '1017371000';
let db: PGlite;
const obs = (o: Record<string, unknown> = {}) => {
  const body = `{"total":1,"items":[{"sku":"${o.resolved_sku ?? SSKU}"}],"s":"${JSON.stringify(o).length}"}`;
  return { gtin: GTIN, gtin_kind: 'gtin13', gtin_origin_sku: TSKU, gtin_origin_evidence: { table: 'tesco_catalogue_jsonl', field: 'item.gtin', tesco_name: 'Heinz Cream Of Tomato Soup 400G', tesco_brand: 'Heinz' },
    store: 'supervalu', query: GTIN, endpoint: `https://storefrontgateway.supervalu.ie/api/stores/5550/search?q=${GTIN}`, result_total: 1, result_items: [], response_body: body,
    response_sha256: createHash('sha256').update(body).digest('hex'), resolved_sku: SSKU, outcome: 'identity_consistent', tier: 'strong', title_agreement: 1, rule_version: 'barcode-v5',
    observed_at: new Date(Date.now() - 3600e3).toISOString(), ...o };
};
const onboard = (target: string | null, observations: unknown[], sku = TSKU, name = 'Heinz Cream Of Tomato Soup 400G') => db.query<{ id: string }>(
  `select public.onboard_barcode_tesco_offer('barcode-onboard-v1', $1, $2, 'Heinz', $3, $4, $5::jsonb, '{"identity":"strong"}'::jsonb,
    'Tesco catalogue SKU whose GTIN SuperValu resolved to exactly one SKU (test reason).') id`, [sku, name, GTIN, target, JSON.stringify(observations)]);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.products (id uuid primary key default gen_random_uuid(), canonical_name text not null, category text, default_unit text, default_quantity text, brand text);
    create table public.store_products (id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id), store text, store_sku text, store_url text,
      store_product_name text, brand text, is_own_brand boolean, url_status text, gtin text);
    create table public.scrape_runs (id uuid primary key default gen_random_uuid(), run_id text, store text, started_at timestamptz, finished_at timestamptz, target_count int,
      attempted_count int, fetched int, extracted int, inserted int, unchanged_count int, failed int, retrieval_method text, threshold_pct numeric, status text);
    create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123090000_barcode_catalogue_repairs', '20261124090000_barcode_tesco_onboarding'])
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.products(id, canonical_name) values ('${P}', 'Heinz Cream of Tomato Soup 400g');
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values ('${S}', '${P}', 'supervalu', '${SSKU}', 'u', 'Heinz Cream of Tomato Soup (400 g)', 'resolved');`);
});
afterEach(async () => { await db.close(); });

describe('onboard_barcode_tesco_offer', () => {
  it('attaches the Tesco offer to the record owning the resolved SKU, with bound observations and a ledger row', async () => {
    const offer = (await asService(() => onboard(P, [obs()]))).rows[0].id;
    const r = (await db.query<Record<string, unknown>>(`select product_id, store, store_sku, store_url, gtin from public.store_products where id = $1`, [offer])).rows[0];
    expect(r).toMatchObject({ product_id: P, store: 'tesco', store_sku: TSKU, store_url: `https://www.tesco.ie/shop/en-IE/products/${TSKU}`, gtin: GTIN });
    expect((await db.query(`select 1 from public.current_barcode_associations where gtin_origin_store_product_id = $1 and status = 'active'`, [offer])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.catalogue_repairs where kind = 'onboard_tesco' and created_offer_id = $1`, [offer])).rows).toHaveLength(1);
  });
  it('creates a new record named from Tesco when the resolved SKU is not in the catalogue', async () => {
    const offer = (await asService(() => onboard(null, [obs({ resolved_sku: '1099999000' })]))).rows[0].id;
    const r = (await db.query<{ canonical_name: string; brand: string }>(`select p.canonical_name, p.brand from public.store_products s join public.products p on p.id = s.product_id where s.id = $1`, [offer])).rows[0];
    expect(r).toEqual({ canonical_name: 'Heinz Cream Of Tomato Soup 400G', brand: 'Heinz' });
  });
  it('refuses: SKU already present, SKU owned by another record, target without the SKU, stale/weak/other-GTIN observation, own-label, tampered body', async () => {
    await asService(() => onboard(P, [obs()]));
    await expect(asService(() => onboard(P, [obs()]))).rejects.toThrow(/already in the catalogue/);
    await expect(asService(() => onboard(null, [obs({ gtin_origin_sku: '300000002' })], '300000002'))).rejects.toThrow(/belongs to another record/);
    await db.exec(`insert into public.products(id, canonical_name) values ('7f000000-0000-0000-0000-0000000000c2', 'Other')`);
    await expect(asService(() => onboard('7f000000-0000-0000-0000-0000000000c2', [obs({ resolved_sku: '1099999000', gtin_origin_sku: '300000003' })], '300000003'))).rejects.toThrow(/owns none/);
    await expect(asService(() => onboard(null, [obs({ resolved_sku: '1099999001', gtin_origin_sku: '300000004', observed_at: new Date(Date.now() - 5 * 864e5).toISOString() })], '300000004'))).rejects.toThrow(/recent strong/);
    await expect(asService(() => onboard(null, [obs({ resolved_sku: '1099999002', gtin_origin_sku: '300000005', tier: 'review' })], '300000005'))).rejects.toThrow(/recent strong/);
    await expect(asService(() => onboard(null, [obs({ resolved_sku: '1099999003', gtin_origin_sku: '300000006', gtin: '5000157062680' })], '300000006'))).rejects.toThrow(/recent strong/);
    await expect(asService(() => onboard(null, [obs({ resolved_sku: '1099999004', gtin_origin_sku: '300000007' })], '300000007', 'Tesco Cream Of Tomato Soup 400G'))).rejects.toThrow(/own-label/);
    await expect(asService(() => onboard(null, [{ ...obs({ resolved_sku: '1099999005', gtin_origin_sku: '300000008' }), response_sha256: 'a'.repeat(64) }], '300000008'))).rejects.toThrow(/check constraint/);
    expect((await db.query(`select 1 from public.store_products where store = 'tesco'`)).rows).toHaveLength(1);
  });
  it('browser roles cannot call it', async () => {
    const r = (await db.query<{ a: boolean; u: boolean }>(`select has_function_privilege('anon', 'public.onboard_barcode_tesco_offer(text,text,text,text,text,uuid,jsonb,jsonb,text)', 'execute') a,
      has_function_privilege('authenticated', 'public.onboard_barcode_tesco_offer(text,text,text,text,text,uuid,jsonb,jsonb,text)', 'execute') u`)).rows[0];
    expect(r).toEqual({ a: false, u: false });
  });
});
