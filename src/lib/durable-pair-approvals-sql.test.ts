// Durable pair approvals: the REAL ledger, identity-response and durable-approval migrations in PGlite.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const T = '7a000000-0000-0000-0000-0000000000a1', S = '7a000000-0000-0000-0000-0000000000b1', P = '7a000000-0000-0000-0000-0000000000c1';
const TSKU = '258147391', SSKU = '1017371000';
const TURL = `https://www.tesco.ie/shop/en-IE/products/${TSKU}`;
const SURL = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/heinz-cream-of-tomato-soup-400-g-id-${SSKU}`;
const tescoParsed = (name = 'Heinz Cream Of Tomato Soup 400G') => JSON.stringify({ listing: null, products: [{ sku: TSKU, name, brand: 'HEINZ', gtin: '05000157062673', quantity: { grams: 400 }, identityDetails: { packSize: [{ units: 'G', value: 400 }] } }] });
const svIdentity = (title = 'Heinz Cream Of Tomato Soup (400 g)', ingredients = 'Tomatoes (89%), Water') => JSON.stringify({ title, brand: 'Heinz', manufacturer: null, manufacturerProductCode: null, gtin: null, description: 'A timeless classic', ingredients, quantity: 0, packSize: null, packCount: null, variant: null, flavour: null, formulation: null });

let db: PGlite;
const status = async (offsetDays = 0) => (await db.query<{ status: string; left_evidence_at: string; right_evidence_at: string }>(
  `select status, left_evidence_at, right_evidence_at from public.current_pair_review_status(now() + make_interval(days => $1))`, [offsetDays])).rows;

async function tescoPage(name?: string, at = `now() - interval '1 hour'`) {
  return (await db.query<{ id: string; created_at: string }>(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
    values ($1, $1, 'ok', 200, $2, $3::jsonb, ${at}) returning id, created_at::text`, [TURL, 'c'.repeat(64), tescoParsed(name)])).rows[0];
}
async function svResponse() {
  return (await db.query<{ id: string; body_sha256: string; retrieved_at: string }>(`insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at,
    content_type, body_text, parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
    values ('supervalu', $1, $2, $2, $2, now() - interval '1 hour', 'text/html', '<html>page</html>', 'retailer-identity-response-v3', 'captured_product', 'script[4].__PRELOADED_STATE__.product', $3::jsonb, gen_random_uuid(), $4)
    returning id, body_sha256, retrieved_at::text`, [SSKU, SURL, svIdentity(), S])).rows[0];
}
async function approve(classification = 'exact_product') {
  const t = await tescoPage(), s = await svResponse();
  // pair_order: left_offer_id::text < right_offer_id::text (T < S here)
  await db.query(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification,
    left_source_kind, left_source_id, left_source_hash, left_captured_at, right_source_kind, right_source_id, right_source_hash, right_captured_at,
    rationale, reviewer, checked_attributes)
    values ($1, $2, $3, 'tesco_page', $4, $5, $6, 'retailer_response', $7, $8, $9, 'Same brand, product, variant and pack.', 'owner', '["brand","product_name","pack_size"]'::jsonb)`,
    [T, S, classification, t.id, 'c'.repeat(64), t.created_at, s.id, s.body_sha256, s.retrieved_at]);
}
const observe = (over: { title?: string; ingredients?: string; sku?: string; url?: string; at?: string } = {}) => db.query(`insert into public.retailer_identity_observations(store_product_id, store, sku, source_kind,
    product_url, requested_url, final_url, body_sha256, parser_version, identity, observed_at)
    values ($1, 'supervalu', $2, 'captured_product', $3, $3, $3, $4, 'retailer-identity-response-v3', $5::jsonb, ${over.at ?? 'now()'})`,
  [S, over.sku ?? SSKU, over.url ?? SURL, 'd'.repeat(64), svIdentity(over.title, over.ingredients)]);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; -- as in Supabase
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.store_products (id uuid primary key, product_id uuid, store text, store_sku text, store_url text, store_product_name text);
    create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals']) {
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  }
  await db.exec(`insert into public.store_products values
    ('${T}', '${P}', 'tesco', '${TSKU}', '${TURL}', 'Heinz Cream Of Tomato Soup 400G'),
    ('${S}', '${P}', 'supervalu', '${SSKU}', '${SURL}', 'Heinz Cream Of Tomato Soup (400 g)');`);
});
afterEach(async () => { await db.close(); });

describe('durable pair approvals (real migrations)', () => {
  it('stamps approval-time SKUs and identity fingerprints in the database', async () => {
    await approve();
    const r = (await db.query<Record<string, string>>(`select left_sku, right_sku, left_identity_fingerprint, right_identity_fingerprint from public.retailer_offer_pair_reviews`)).rows[0];
    expect(r.left_sku).toBe(TSKU);
    expect(r.right_sku).toBe(SSKU);
    expect(r.left_identity_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(r.right_identity_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it('stays active beyond 14 days without re-review while monitoring evidence keeps confirming the same identity', async () => {
    await approve();
    expect((await status())[0].status).toBe('active');
    // 15 days on, with no new observation: suspended for stale evidence (never silently kept).
    expect((await status(15))[0].status).toBe('suspended_no_recent_evidence');
    // A routine capture today with the same identity (only marketing copy differs) keeps it active.
    await observe();
    await db.exec(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
      values ('${TURL}', '${TURL}', 'ok', 200, '${'e'.repeat(64)}', '${tescoParsed()}'::jsonb, now())`);
    expect((await status(10))[0].status).toBe('active');
  });
  it('cosmetic title formatting does not suspend; a material identity change does', async () => {
    await approve();
    await observe({ title: 'Heinz  Cream of Tomato Soup (400 g)' });
    expect((await status())[0].status).toBe('active');
    await observe({ title: 'Heinz Cream Of Tomato Soup Reduced Salt (400 g)' });
    expect((await status())[0].status).toBe('suspended_identity_changed');
  });
  it('a formulation (ingredients) change suspends the pair', async () => {
    await approve();
    await observe({ ingredients: 'Tomatoes (75%), Water, Sugar' });
    expect((await status())[0].status).toBe('suspended_identity_changed');
  });
  it('a changed Tesco page identity suspends the pair', async () => {
    await approve();
    await tescoPage('Heinz Cream Of Tomato Soup 300G', 'now()');
    expect((await status())[0].status).toBe('suspended_identity_changed');
  });
  it('SKU reassignment or SKU reuse suspends the pair', async () => {
    await approve();
    await db.exec(`update public.store_products set store_sku = '1017371999' where id = '${S}'`);
    expect((await status())[0].status).toBe('suspended_sku_changed');
    await db.exec(`update public.store_products set store_sku = '${SSKU}' where id = '${S}';
      insert into public.store_products values ('7a000000-0000-0000-0000-0000000000b2', '${P}', 'supervalu', '${SSKU}', null, 'other');`);
    expect((await status())[0].status).toBe('suspended_sku_changed');
  });
  it('expires for human re-review after 365 days even if nothing changed', async () => {
    await approve();
    expect((await status(366))[0].status).toBe('expired_needs_review');
  });
  it('observations must bind to the offer as it is now, be live, and are immutable', async () => {
    await expect(observe({ sku: '1017371999' })).rejects.toThrow(/does not bind/);
    await expect(observe({ url: 'https://shop.supervalu.ie/other' })).rejects.toThrow(/does not bind/);
    await expect(observe({ at: `now() - interval '3 days'` })).rejects.toThrow(/time invalid/);
    await observe();
    await expect(db.exec(`update public.retailer_identity_observations set sku = sku`)).rejects.toThrow(/immutable/);
    await expect(db.exec(`delete from public.retailer_identity_observations`)).rejects.toThrow(/immutable/);
  });
  it('the service role can read status and write observations, but can never write approvals', async () => {
    await approve();
    await db.exec(`set role service_role`);
    expect((await status())[0].status).toBe('active');
    await observe();
    await expect(db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer)
      values ('${T}', '${S}', 'unverified', 'attempted service write', 'svc')`)).rejects.toThrow(/permission denied/);
    await expect(db.exec(`update public.retailer_identity_observations set identity_fingerprint = 'x'`)).rejects.toThrow();
    await db.exec(`reset role`);
  });
  it('negative or unverified decisions are not returned as approvals', async () => {
    await approve('comparable_alternative');
    expect((await status())[0]).toMatchObject({ status: 'active' });
    const t = await tescoPage();
    await db.query(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer)
      values ($1, $2, 'not_comparable', 'Later review: different products.', 'owner')`, [T, S]);
    expect(t.id).toBeTruthy();
    expect(await status()).toEqual([]);
  });
});
