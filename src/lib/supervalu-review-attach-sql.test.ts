// SuperValu REVIEW-tier attach (migration 20261128090000) on the REAL barcode, repair, ledger and acceptance migrations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7f100000-0000-0000-0000-0000000000c1', T = '7f100000-0000-0000-0000-0000000000a1';
const TSKU = '258147391', SSKU = '1017371000', GTIN = '5000157062673';
const URL = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/heinz-cream-of-tomato-soup-400-g-id-${SSKU}`;
const facts = { brand_matches: true, product_type_matches: true, flavour_formulation_matches: true, variant_matches: true, quantity_matches: true, pack_count_matches: true, age_stage_matches: true };
const model = (o: Record<string, unknown> = {}, f: Record<string, boolean> = {}) => ({ decision: 'verified_exact', rationale: 'Same brand, type, flavour and 400g tin; wording only.', facts: { ...facts, ...f }, ...o });
const checks = (o: Record<string, string> = {}) => ({ structural: 'pass', wording_only: 'pass', barcode_fresh_search: 'pass', ...o });
let db: PGlite;

async function observation(o: { tier?: 'strong' | 'review' | 'not_found'; sku?: string; at?: string; origin?: string; gtin?: string } = {}) {
  const sku = o.sku ?? SSKU, tier = o.tier ?? 'review', found = tier !== 'not_found', gtin = o.gtin ?? GTIN;
  const body = `{"total":1,"items":[{"sku":"${sku}"}],"s":"${sku}${tier}${o.at ?? ''}${gtin}"}`;
  await db.query(`insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, response_body, resolved_sku, outcome, tier, review_reasons, title_agreement, rule_version, observed_at)
    values ($1, 'gtin13', 'tesco', $2, $3, '{"table":"tesco_apify_provider_evidence","field":"raw_item.gtin","tesco_name":"Heinz Cream Of Tomato Soup 400G","tesco_brand":"HEINZ"}',
    'supervalu', 'sku_found_by_gtin_search', $1, $4, 200, $5, '[]', $6, $7, $8, $9, $10, $11::jsonb, 0.9, 'barcode-v5', ${o.at ?? `now() - interval '1 hour'`})`,
    [gtin, TSKU, o.origin ?? T, `https://storefrontgateway.supervalu.ie/api/stores/5550/search?q=${gtin}`, found ? 1 : 0, createHash('sha256').update(body).digest('hex'), body,
      found ? sku : null, found ? 'identity_consistent' : 'not_found', found ? tier : null, tier === 'review' ? '["extra_words:|cream"]' : '[]']);
}
const capture = (o: Record<string, unknown> = {}, identity: Record<string, unknown> = {}) => ({ store: 'supervalu', sku: SSKU, product_url: URL, requested_url: URL, final_url: URL,
  retrieved_at: new Date(Date.now() - 600e3).toISOString(), content_type: 'text/html', body_text: '<html>Heinz</html>', parser_version: 'retailer-identity-response-v3',
  source_kind: 'captured_product', source_path: '$', identity: { title: 'Heinz Cream of Tomato Soup (400 g)', brand: 'Heinz', ...identity }, ...o });
const attach = (o: { sku?: string; url?: string; name?: string; brand?: string | null; response?: unknown; model?: unknown; checks?: unknown; gtin?: string } = {}) => db.query<{ id: string }>(
  `select public.attach_review_supervalu_offer($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
    'SuperValu review-tier GTIN resolution attached (test) after SKU-bound structural checks and AI corroboration.') id`,
  [T, o.gtin ?? GTIN, o.sku ?? SSKU, o.url ?? URL, o.name ?? 'Heinz Cream of Tomato Soup (400 g)', o.brand === undefined ? 'Heinz' : o.brand,
    JSON.stringify(o.response ?? capture()), JSON.stringify(o.model ?? model()), JSON.stringify(o.checks ?? checks())]);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };
const count = async (sql: string) => (await db.query(sql)).rows.length;
const nothingWritten = async () => {
  expect(await count(`select 1 from public.store_products where store = 'supervalu'`)).toBe(0);
  expect(await count(`select 1 from public.retailer_barcode_review_acceptances`)).toBe(0);
  expect(await count(`select 1 from public.catalogue_repairs`)).toBe(0);
};

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
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123090000_barcode_catalogue_repairs', '20261123120000_pair_status_performance',
    '20261126090000_barcode_review_acceptances', '20261128090000_supervalu_review_attach'])
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.products(id, canonical_name, category, brand) values ('${P}', 'Heinz Cream Of Tomato Soup 400G', 'Tinned', 'Heinz');
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values
      ('${T}', '${P}', 'tesco', '${TSKU}', 'https://www.tesco.ie/shop/en-IE/products/${TSKU}', 'Heinz Cream Of Tomato Soup 400G', 'resolved');`);
});
afterEach(async () => { await db.close(); });

describe('attach_review_supervalu_offer', () => {
  it('POSITIVE: attaches the offer, its capture, a repair row and an ACTIVE AI acceptance in one transaction', async () => {
    await observation();
    const offer = (await asService(() => attach())).rows[0].id;
    expect((await db.query(`select product_id, store, store_sku, store_url from public.store_products where id = $1`, [offer])).rows[0])
      .toEqual({ product_id: P, store: 'supervalu', store_sku: SSKU, store_url: URL });
    expect(await count(`select 1 from public.retailer_identity_responses where store_product_id = '${offer}' and source_kind = 'captured_product'`)).toBe(1);
    expect((await db.query(`select policy_version, kind, checks->>'association_basis' b from public.catalogue_repairs`)).rows)
      .toEqual([{ policy_version: 'barcode-review-ai-v1', kind: 'attach_supervalu', b: 'ai_review' }]);
    expect((await db.query(`select status from public.current_barcode_review_acceptances`)).rows).toEqual([{ status: 'active' }]);
    // Distinct from strong associations: the strong view still reports the observation as needs_review, never active.
    expect((await db.query(`select status from public.current_barcode_associations`)).rows).toEqual([{ status: 'needs_review' }]);
    expect((await db.query(`select basis, status from public.current_machine_associations order by basis`)).rows)
      .toEqual([{ basis: 'ai_review', status: 'active' }, { basis: 'strong', status: 'needs_review' }]);
  });
  it('NEGATIVE: a STRONG observation is not handled here (the strong attach path owns it)', async () => {
    await observation({ tier: 'strong' });
    await expect(asService(() => attach())).rejects.toThrow(/not a review-tier resolution/);
    await nothingWritten();
  });
  it('NEGATIVE: incorrect SKU (observation resolved another SKU, or the URL/capture is for another SKU)', async () => {
    await observation({ sku: '1017371999' });
    await expect(asService(() => attach())).rejects.toThrow(/not a review-tier resolution/);
    await observation({ at: `now() - interval '1 minute'` });
    await expect(asService(() => attach({ url: URL.replace(SSKU, '1017371999') }))).rejects.toThrow(/SuperValu product URL/);
    await expect(asService(() => attach({ response: capture({ sku: '1017371999' }) }))).rejects.toThrow(/capture missing or not bound/);
    await nothingWritten();
  });
  it('NEGATIVE: shared or already-owned SKU, or a record that already has a SuperValu offer', async () => {
    await observation();
    await db.exec(`insert into public.store_products(product_id, store, store_sku, store_url) values (null, 'supervalu', '${SSKU}', 'x')`);
    await expect(asService(() => attach())).rejects.toThrow(/SKU already owned/);
    await db.exec(`delete from public.store_products where store = 'supervalu'; insert into public.store_products(product_id, store, store_sku, store_url) values ('${P}', 'supervalu', '1017371555', 'x')`);
    await expect(asService(() => attach())).rejects.toThrow(/already has a SuperValu offer/);
  });
  it('NEGATIVE: wrong barcode (another GTIN, a newer not-found observation, or another Tesco origin)', async () => {
    await observation();
    await expect(asService(() => attach({ gtin: '5000157062680' }))).rejects.toThrow(/not a review-tier resolution/);
    await observation({ tier: 'not_found', at: `now() - interval '1 minute'` });
    await expect(asService(() => attach())).rejects.toThrow(/not a review-tier resolution/);
    await nothingWritten();
  });
  it('NEGATIVE: pack and variant differences, and retailer-only material words, never pass (application checks + AI facts)', async () => {
    await observation();
    await expect(asService(() => attach({ checks: checks({ structural: 'fail' }) }))).rejects.toThrow(/check structural/);
    await expect(asService(() => attach({ checks: checks({ wording_only: 'fail' }) }))).rejects.toThrow(/check wording_only/);
    for (const k of ['quantity_matches', 'pack_count_matches', 'variant_matches', 'flavour_formulation_matches', 'brand_matches', 'age_stage_matches', 'product_type_matches'])
      await expect(asService(() => attach({ model: model({}, { [k]: false }) }))).rejects.toThrow(new RegExp(`AI fact ${k}`));
    await nothingWritten();
  });
  it('NEGATIVE: own-label or brandless SuperValu products', async () => {
    await observation();
    await expect(asService(() => attach({ brand: 'SuperValu', name: 'SuperValu Tomato Soup (400 g)', response: capture({}, { title: 'SuperValu Tomato Soup (400 g)', brand: 'SuperValu' }) })))
      .rejects.toThrow(/own-label/);
    await expect(asService(() => attach({ brand: null, response: capture({}, { brand: null }) }))).rejects.toThrow(/brand missing/);
    await nothingWritten();
  });
  it('NEGATIVE: stale evidence (observation older than 2 days, capture older than 1 day)', async () => {
    await observation({ at: `now() - interval '3 days'` });
    await expect(asService(() => attach())).rejects.toThrow(/too old/);
    await observation({ at: `now() - interval '1 minute'` });
    await expect(asService(() => attach({ response: capture({ retrieved_at: new Date(Date.now() - 2 * 864e5).toISOString() }) }))).rejects.toThrow(/capture missing or not bound/);
    await nothingWritten();
  });
  it('NEGATIVE: AI uncertain, rejected or without a rationale', async () => {
    await observation();
    for (const m of [model({ decision: 'uncertain' }), model({ decision: 'rejected' }), model({ rationale: 'ok' })])
      await expect(asService(() => attach({ model: m }))).rejects.toThrow(/verified_exact/);
    await nothingWritten();
  });
  it('repeated execution attaches once; the second call is refused and writes nothing', async () => {
    await observation();
    await asService(() => attach());
    await expect(asService(() => attach())).rejects.toThrow(/SKU already owned|already has a SuperValu offer/);
    expect(await count(`select 1 from public.store_products where store = 'supervalu'`)).toBe(1);
    expect(await count(`select 1 from public.retailer_barcode_review_acceptances`)).toBe(1);
  });
  it('concurrent attachment: two sessions racing for the same SKU produce exactly one offer', async () => {
    await observation();
    // PGlite is single-connection: model the race by interleaving two transactions that both pass the checks.
    await db.exec('set role service_role');
    const a = attach(), b = attach();
    const results = await Promise.allSettled([a, b]);
    await db.exec('reset role');
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await count(`select 1 from public.store_products where store = 'supervalu'`)).toBe(1);
    expect(await count(`select 1 from public.retailer_barcode_review_acceptances`)).toBe(1);
  });
  it('browser roles cannot call it; the strong attach function is unchanged', async () => {
    const sig = 'public.attach_review_supervalu_offer(uuid,text,text,text,text,text,jsonb,jsonb,jsonb,text)';
    const r = (await db.query<{ a: boolean; u: boolean; s: boolean }>(`select has_function_privilege('anon', '${sig}', 'execute') a,
      has_function_privilege('authenticated', '${sig}', 'execute') u, has_function_privilege('service_role', '${sig}', 'execute') s`)).rows[0];
    expect(r).toEqual({ a: false, u: false, s: true });
    await observation();
    await expect(asService(() => db.query(`select public.attach_barcode_supervalu_offer('barcode-repair-v1', $1, $2, $3, $4, 'Heinz Cream of Tomato Soup (400 g)', 'Heinz', $5::jsonb, '{}'::jsonb,
      'Strong attach must still require an active strong association (test reason).')`, [T, GTIN, SSKU, URL, JSON.stringify(capture())]))).rejects.toThrow(/did not resolve this SKU/);
  });
});
