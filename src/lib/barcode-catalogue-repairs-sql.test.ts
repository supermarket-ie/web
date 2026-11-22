// Barcode catalogue repairs (migration 20261123090000) on the real barcode / ledger / machine migrations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7d000000-0000-0000-0000-0000000000c1';
const T = '7d000000-0000-0000-0000-0000000000a1', S2 = '7d000000-0000-0000-0000-0000000000b2', D1 = '7d000000-0000-0000-0000-0000000000d1';
const GTIN = '5000157062673', TSKU = '258147391', S1SKU = '1017371000', S2SKU = '1099999000', DSKU = '100118355';
const SURL = (sku: string) => `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/heinz-cream-of-tomato-soup-400-g-id-${sku}`;
const POLICY = 'barcode-repair-v1';
let db: PGlite;
async function association(store: 'supervalu' | 'dunnes', sku: string) {
  const body = `{"total":1,"items":[{"sku":"${sku}"}],"s":"${store}${sku}"}`;
  const ep = store === 'supervalu' ? 'https://storefrontgateway.supervalu.ie/api/stores/5550/search' : 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search';
  await db.query(`insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, response_body, resolved_sku, outcome, tier, title_agreement, rule_version, observed_at)
    values ($1, 'gtin13', 'tesco', $2, $3, '{"table":"t","field":"f","tesco_name":"Heinz Cream Of Tomato Soup 400G","tesco_brand":"HEINZ"}',
    $4, 'sku_found_by_gtin_search', $1, $5, 200, 1, '[]', $6, $7, $8, 'identity_consistent', 'strong', 1, 'barcode-v5', now() - interval '2 hours')`,
    [GTIN, TSKU, T, store, `${ep}?q=${GTIN}`, createHash('sha256').update(body).digest('hex'), body, sku]);
}
const regroup = (offers: string[], name = 'Heinz Cream Of Tomato Soup 400G') => db.query<{ id: string }>(
  `select public.apply_barcode_regroup($1, $2, $3, $4::uuid[], $5, '{"remainder":"conflict"}'::jsonb, 'Barcode-proven split of a mixed canonical record (test reason text).') id`,
  [POLICY, T, GTIN, `{${offers.join(',')}}`, name]);
const resp = (o: Record<string, unknown> = {}) => JSON.stringify({ store: 'supervalu', sku: S1SKU, product_url: SURL(S1SKU), requested_url: SURL(S1SKU), final_url: SURL(S1SKU),
  source_kind: 'captured_product', retrieved_at: new Date().toISOString(), content_type: 'text/html', body_text: '<html>page</html>', parser_version: 'retailer-identity-response-v3',
  source_path: 'script[1]', identity: { title: 'Heinz Cream of Tomato Soup (400 g)', brand: 'Heinz' }, ...o });
const attach = (o: { url?: string; sku?: string; response?: string } = {}) => db.query<{ id: string }>(
  `select public.attach_barcode_supervalu_offer($1, $2, $3, $4, $5, 'Heinz Cream of Tomato Soup (400 g)', 'Heinz', $6::jsonb, '{"identity":"strong"}'::jsonb,
    'SuperValu search resolved this SKU for the Tesco GTIN; direct page captured (test).') id`,
  [POLICY, T, GTIN, o.sku ?? S1SKU, o.url ?? SURL(o.sku ?? S1SKU), o.response ?? resp()]);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.products (id uuid primary key default gen_random_uuid(), canonical_name text not null, category text, default_unit text, default_quantity text);
    create table public.store_products (id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id), store text, store_sku text, store_url text,
      store_product_name text, brand text, is_own_brand boolean, url_status text);
    create table public.scrape_runs (id uuid primary key default gen_random_uuid(), run_id text, store text, started_at timestamptz, finished_at timestamptz, target_count int,
      attempted_count int, fetched int, extracted int, inserted int, unchanged_count int, failed int, retrieval_method text, threshold_pct numeric, status text);
    create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123090000_barcode_catalogue_repairs'])
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.products(id, canonical_name, category) values ('${P}', 'Complimints Sugar Free Strawberry', 'Sweets');
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values
    ('${T}', '${P}', 'tesco', '${TSKU}', 'https://www.tesco.ie/shop/en-IE/products/${TSKU}', 'Heinz Cream Of Tomato Soup 400G', 'resolved'),
    ('${S2}', '${P}', 'supervalu', '${S2SKU}', '${SURL(S2SKU)}', 'Complimints Sugar Free Strawberry (20 g)', 'resolved'),
    ('${D1}', '${P}', 'dunnes', '${DSKU}', 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/x/${DSKU}', 'Heinz Cream Of Tomato Soup 400g', 'resolved');`);
});
afterEach(async () => { await db.close(); });

describe('barcode regroup (split a mixed record)', () => {
  it('moves the Tesco offer and its barcode-resolved partners to a new record, leaving the conflicting offer and a full ledger row', async () => {
    await association('supervalu', S1SKU); await association('dunnes', DSKU);
    const id = (await asService(() => regroup([D1]))).rows[0].id;
    const rows = (await db.query<{ id: string; product_id: string }>(`select id, product_id from public.store_products order by id`)).rows;
    const moved = rows.filter(r => r.id === T || r.id === D1).map(r => r.product_id);
    expect(new Set(moved).size).toBe(1);
    expect(moved[0]).not.toBe(P);
    expect(rows.find(r => r.id === S2)!.product_id).toBe(P);
    const rep = (await db.query<Record<string, unknown>>(`select kind, from_product_id, to_product_id, moved_offer_ids, before_state->'record'->>'canonical_name' n from public.catalogue_repairs where id = $1`, [id])).rows[0];
    expect(rep).toMatchObject({ kind: 'regroup', from_product_id: P, to_product_id: moved[0], n: 'Complimints Sugar Free Strawberry' });
    expect((await db.query<{ canonical_name: string }>(`select canonical_name from public.products where id = $1`, [moved[0]])).rows[0].canonical_name).toBe('Heinz Cream Of Tomato Soup 400G');
    await expect(db.exec(`delete from public.catalogue_repairs`)).rejects.toThrow(/append-only/);
  });
  it('refuses without independent evidence the record is mixed (no remaining offer resolved otherwise)', async () => {
    await association('dunnes', DSKU);   // SuperValu never resolved anything: S2 is not contradicted by its own retailer
    await expect(asService(() => regroup([D1]))).rejects.toThrow(/no independent evidence/);
    await association('supervalu', S2SKU); // SuperValu resolved S2 itself: S2 is the product, not a mixed record
    await expect(asService(() => regroup([D1]))).rejects.toThrow(/no independent evidence/);
  });
  it('a member that is not the SKU its retailer resolved, or on another record, is refused', async () => {
    await association('supervalu', S1SKU); await association('dunnes', '100000001');
    await expect(asService(() => regroup([D1]))).rejects.toThrow(/not the SKU its retailer resolved/);
  });
  it('service_role cannot write the ledger directly; a NEGATIVE pair decision across the groups does not block a split', async () => {
    await association('supervalu', S1SKU);
    await expect(asService(() => db.exec(`insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, to_product_id, before_state, checks, reason)
      values ('${POLICY}', 'regroup', '${GTIN}', '${T}', '${P}', '{}', '{}', '${'x'.repeat(50)}')`))).rejects.toThrow(/permission denied/);
    await db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer) values ('${T}', '${S2}', 'not_comparable', 'Owner: different products.', 'owner')`);
    // a NEGATIVE decision does not block a split (it agrees with it)
    await asService(() => regroup([]));
  });
});

describe('SuperValu attach', () => {
  it('creates the SuperValu offer SuperValu resolved, with its direct capture, on the Tesco record', async () => {
    await association('supervalu', S1SKU);
    await db.exec(`update public.store_products set product_id = null where id = '${S2}'`);
    const offer = (await asService(() => attach())).rows[0].id;
    const r = (await db.query<Record<string, unknown>>(`select s.product_id, s.store_sku, s.url_status, e.source_kind, e.sku from public.store_products s
      join public.retailer_identity_responses e on e.store_product_id = s.id where s.id = $1`, [offer])).rows[0];
    expect(r).toMatchObject({ product_id: P, store_sku: S1SKU, url_status: 'resolved', source_kind: 'captured_product', sku: S1SKU });
    expect((await db.query(`select 1 from public.catalogue_repairs where kind = 'attach_supervalu' and created_offer_id = $1`, [offer])).rows).toHaveLength(1);
  });
  it('refuses: record already has a SuperValu offer, SKU not resolved by SuperValu, wrong URL, unbound or stale capture', async () => {
    await association('supervalu', S1SKU);
    await expect(asService(() => attach())).rejects.toThrow(/already has a SuperValu offer/);
    await db.exec(`update public.store_products set product_id = null where id = '${S2}'`);
    await expect(asService(() => attach({ sku: '1012345000' }))).rejects.toThrow(/did not resolve/);
    await expect(asService(() => attach({ url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/x-id-1012345000' }))).rejects.toThrow(/product URL/);
    await expect(asService(() => attach({ response: resp({ requested_url: 'https://shop.supervalu.ie/search?q=x' }) }))).rejects.toThrow(/not bound/);
    await expect(asService(() => attach({ response: resp({ retrieved_at: new Date(Date.now() - 3 * 864e5).toISOString() }) }))).rejects.toThrow(/not bound/);
    expect((await db.query(`select 1 from public.store_products where store_sku = '${S1SKU}'`)).rows).toHaveLength(0);
  });
});
