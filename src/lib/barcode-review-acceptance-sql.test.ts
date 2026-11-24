// AI-accepted REVIEW-tier barcode associations (migration 20261126090000) on the REAL barcode, ledger and machine-approval migrations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7d000000-0000-0000-0000-0000000000c1', P2 = '7d000000-0000-0000-0000-0000000000c2';
const T = '7d000000-0000-0000-0000-0000000000a1', D = '7d000000-0000-0000-0000-0000000000d1', S = '7d000000-0000-0000-0000-0000000000b1';
const TSKU = '258147391', DSKU = '100118355', SSKU = '1017371000', GTIN = '5000157062673';
const TURL = `https://www.tesco.ie/shop/en-IE/products/${TSKU}`;
const DURL = `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/heinz-cream-of-tomato-soup-400g/${DSKU}`;
const DAPI = `https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/${DSKU}`;
const SURL = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/heinz-cream-of-tomato-soup-400-g-id-${SSKU}`;
const REVIEW = 'barcode-review-ai-v1', EXACT = 'barcode-exact-v1';
const facts = { brand_matches: true, product_type_matches: true, flavour_formulation_matches: true, variant_matches: true, quantity_matches: true, pack_count_matches: true, age_stage_matches: true };
const model = (o: Record<string, unknown> = {}, f: Record<string, boolean> = {}) => JSON.stringify({ decision: 'verified_exact', rationale: 'Same brand, type, flavour and 400g single tin; wording only.', facts: { ...facts, ...f }, ...o });
const checks = (o: Record<string, string> = {}) => JSON.stringify({ structural: 'pass', wording_only: 'pass', barcode_fresh_search: 'pass', ...o });
const tescoParsed = (o: Record<string, unknown> = {}) => JSON.stringify({ products: [{ sku: TSKU, name: 'Heinz Cream Of Tomato Soup 400G', brand: 'HEINZ', gtin: `0${GTIN}`,
  quantity: { grams: 400 }, identityDetails: { packSize: [{ units: 'G', value: 400 }] }, ...o }] });
const identity = (o: Record<string, unknown> = {}) => JSON.stringify({ title: 'Heinz Cream of Tomato Soup 400g', brand: 'Heinz', manufacturer: null, manufacturerProductCode: null,
  gtin: null, description: 'x', ingredients: null, quantity: null, packSize: null, packCount: null, variant: null, flavour: null, formulation: null, ...o });
let db: PGlite;
const page = async () => (await db.query<{ id: string }>(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
  values ($1, $1, 'ok', 200, $2, $3::jsonb, now() - interval '1 hour') returning id`, [TURL, 'c'.repeat(64), tescoParsed()])).rows[0].id;
async function dunnesResponse(o: { identity?: Record<string, unknown>; at?: string; offer?: string } = {}) {
  return (await db.query<{ id: string }>(`insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at,
    content_type, body_text, parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
    values ('dunnes', $1, $2, $3, $3, ${o.at ?? `now() - interval '1 hour'`}, 'application/json', '{"x":1}', 'retailer-identity-response-v3', 'captured_product_api', '$.product', $4::jsonb, gen_random_uuid(), $5) returning id`,
    [DSKU, DURL, DAPI, identity(o.identity), o.offer ?? D])).rows[0].id;
}
async function observation(o: { tier?: 'strong' | 'review' | 'not_found'; store?: 'dunnes' | 'supervalu'; sku?: string; at?: string; origin?: string } = {}) {
  const store = o.store ?? 'dunnes', sku = o.sku ?? (store === 'dunnes' ? DSKU : SSKU), tier = o.tier ?? 'review';
  const ep = store === 'supervalu' ? 'https://storefrontgateway.supervalu.ie/api/stores/5550/search' : 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search';
  const body = `{"total":1,"items":[{"sku":"${sku}"}],"s":"${store}${sku}${tier}${o.at ?? ''}"}`;
  const found = tier !== 'not_found';
  await db.query(`insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, response_body, resolved_sku, outcome, tier, review_reasons, title_agreement, rule_version, observed_at)
    values ($1, 'gtin13', 'tesco', $2, $3, '{"table":"tesco_apify_provider_evidence","field":"raw_item.gtin","tesco_name":"Heinz Cream Of Tomato Soup 400G","tesco_brand":"HEINZ"}',
    $4, 'sku_found_by_gtin_search', $1, $5, 200, $6, '[]', $7, $8, $9, $10, $11, $12::jsonb, 0.9, 'barcode-v5', ${o.at ?? `now() - interval '2 hours'`})`,
    [GTIN, TSKU, o.origin ?? T, store, `${ep}?q=${GTIN}`, found ? 1 : 0, createHash('sha256').update(body).digest('hex'), body, found ? sku : null,
      found ? 'identity_consistent' : 'not_found', found ? tier : null, tier === 'review' ? '["extra_words:|cream"]' : '[]']);
}
const accept = (o: { origin?: string; store?: string; offer?: string; response: string; model?: string; checks?: string }) => db.query<{ id: string }>(
  `select public.accept_barcode_review_association($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'Review-tier GTIN resolution accepted (test) after SKU-bound structural checks and AI corroboration.') id`,
  [o.origin ?? T, GTIN, o.store ?? 'dunnes', o.offer ?? D, o.response, o.model ?? model(), o.checks ?? checks()]);
const approve = (policy: string, a: string, b: string, sa: string, sb: string, basis = 'ai_review') => db.query<{ id: string }>(
  `select public.record_machine_pair_approval($1, $2, $3, $4, $5, $6, $7::jsonb, 'Review-policy machine approval (test).', '{"source":"none","verdict":"exact"}'::jsonb) as id`,
  [policy, a, b, sa, sb, GTIN, JSON.stringify({ identity: 'brand_pack_variant', association_basis: basis })]);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };
const acceptStatus = async () => (await db.query<{ status: string }>(`select status from public.current_barcode_review_acceptances`)).rows.map(r => r.status);

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.store_products (id uuid primary key, product_id uuid, store text, store_sku text, store_url text, store_product_name text);
    create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
      outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
  for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123120000_pair_status_performance', '20261126090000_barcode_review_acceptances'])
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.store_products values
    ('${T}', '${P}', 'tesco', '${TSKU}', '${TURL}', 'Heinz Cream Of Tomato Soup 400G'),
    ('${D}', '${P}', 'dunnes', '${DSKU}', '${DURL}', 'Heinz Cream of Tomato Soup 400g'),
    ('${S}', '${P}', 'supervalu', '${SSKU}', '${SURL}', 'Heinz Cream of Tomato Soup (400 g)');`);
});
afterEach(async () => { await db.close(); });

describe('AI-accepted review-tier associations', () => {
  it('POSITIVE: an accepted review association is ACTIVE with its own provenance, and the review policy approves the pair', async () => {
    await observation();
    await asService(async () => accept({ response: await dunnesResponse() }));
    expect(await acceptStatus()).toEqual(['active']);
    // The strong view is untouched: a review observation is never a strong association.
    expect((await db.query(`select 1 from public.current_barcode_associations where status = 'active'`)).rows).toHaveLength(0);
    // The review observation stays 'needs_review' (strong basis, unusable); only the acceptance is active.
    expect((await db.query<{ status: string; basis: string }>(`select status, basis from public.current_machine_associations order by basis`)).rows)
      .toEqual([{ status: 'active', basis: 'ai_review' }, { status: 'needs_review', basis: 'strong' }]);
    const id = (await asService(async () => approve(REVIEW, T, D, await page(), await dunnesResponse()))).rows[0].id;
    const r = (await db.query<Record<string, unknown>>(`select decision_kind, reviewer, policy_version, machine_evidence->'checks'->>'association_basis' basis from public.retailer_offer_pair_reviews where id = $1`, [id])).rows[0];
    expect(r).toEqual({ decision_kind: 'machine', reviewer: `machine:${REVIEW}`, policy_version: REVIEW, basis: 'ai_review' });
  });
  it('NEGATIVE: barcode-exact-v1 never uses an AI-accepted review association', async () => {
    await observation();
    await asService(async () => accept({ response: await dunnesResponse() }));
    await expect(asService(async () => approve(EXACT, T, D, await page(), await dunnesResponse(), 'strong'))).rejects.toThrow(/no active barcode association/);
  });
  it('NEGATIVE: the review policy needs an AI-accepted side and the declared basis', async () => {
    // Strong association only: the exact policy handles it; the review policy refuses.
    await observation({ tier: 'strong' });
    await expect(asService(async () => approve(REVIEW, T, D, await page(), await dunnesResponse()))).rejects.toThrow(/no active AI-accepted review association/);
    await expect(asService(async () => approve(REVIEW, T, D, await page(), await dunnesResponse(), 'strong'))).rejects.toThrow(/association_basis ai_review/);
    await asService(async () => approve(EXACT, T, D, await page(), await dunnesResponse(), 'strong'));
  });
  it('NEGATIVE: acceptance refuses anything but a review-tier resolution of this SKU from this origin', async () => {
    await observation({ tier: 'strong' });
    await expect(asService(async () => accept({ response: await dunnesResponse() }))).rejects.toThrow(/not a review-tier resolution/);
  });
  it('NEGATIVE: wrong record, shared SKU, other offer\'s capture, stale or own-label capture', async () => {
    await observation();
    await db.exec(`update public.store_products set product_id = '${P2}' where id = '${D}'`);
    await expect(asService(async () => accept({ response: await dunnesResponse() }))).rejects.toThrow(/origin record/);
    await db.exec(`update public.store_products set product_id = '${P}' where id = '${D}'; insert into public.store_products values (gen_random_uuid(), '${P2}', 'dunnes', '${DSKU}', 'x', 'dup')`);
    await expect(asService(async () => accept({ response: await dunnesResponse() }))).rejects.toThrow(/SKU is shared/);
    await db.exec(`delete from public.store_products where product_id = '${P2}'`);
    await expect(asService(async () => accept({ response: await dunnesResponse({ offer: S }) }))).rejects.toThrow(/capture missing|mismatched/);
    await expect(asService(async () => accept({ response: await dunnesResponse({ at: `now() - interval '9 days'` }) }))).rejects.toThrow(/too old/);
    await expect(asService(async () => accept({ response: await dunnesResponse({ identity: { brand: 'Dunnes Stores', title: 'Dunnes Stores Tomato Soup 400g' } }) }))).rejects.toThrow(/own-label/);
    await expect(asService(async () => accept({ response: await dunnesResponse({ identity: { brand: null } }) }))).rejects.toThrow(/brand missing/);
  });
  it('NEGATIVE: the AI must say verified_exact with EVERY material fact true, and every deterministic check must pass', async () => {
    await observation();
    const r = await dunnesResponse();
    for (const k of Object.keys(facts))
      await expect(asService(() => accept({ response: r, model: model({}, { [k]: false }) }))).rejects.toThrow(new RegExp(`AI fact ${k}`));
    await expect(asService(() => accept({ response: r, model: model({ decision: 'uncertain' }) }))).rejects.toThrow(/verified_exact/);
    await expect(asService(() => accept({ response: r, model: model({ rationale: 'ok' }) }))).rejects.toThrow(/verified_exact/);
    await expect(asService(() => accept({ response: r, checks: checks({ structural: 'fail' }) }))).rejects.toThrow(/check structural/);
    await expect(asService(() => accept({ response: r, checks: checks({ wording_only: 'fail' }) }))).rejects.toThrow(/check wording_only/);
    expect((await db.query(`select 1 from public.retailer_barcode_review_acceptances`)).rows).toHaveLength(0);
  });
  it('a newer observation that differs SUSPENDS the acceptance, and the review policy then refuses the pair', async () => {
    await observation({ at: `now() - interval '3 hours'` });
    await asService(async () => accept({ response: await dunnesResponse() }));
    expect(await acceptStatus()).toEqual(['active']);
    await observation({ tier: 'not_found', at: `now() - interval '1 hour'` });
    expect(await acceptStatus()).toEqual(['suspended_observation_changed']);
    await expect(asService(async () => approve(REVIEW, T, D, await page(), await dunnesResponse()))).rejects.toThrow(/no active barcode association/);
  });
  it('an offer moved to another SKU or record suspends the acceptance', async () => {
    await observation();
    await asService(async () => accept({ response: await dunnesResponse() }));
    await db.exec(`update public.store_products set product_id = '${P2}' where id = '${D}'`);
    expect(await acceptStatus()).toEqual(['suspended_offer_changed']);
  });
  it('acceptances are append-only, one per observation, and not callable by browser roles', async () => {
    await observation();
    const r = await dunnesResponse();
    await asService(() => accept({ response: r }));
    await expect(asService(() => accept({ response: r }))).rejects.toThrow(/unique|duplicate/);
    await expect(asService(() => db.exec(`update public.retailer_barcode_review_acceptances set reason = 'x'`))).rejects.toThrow(/permission denied|append_only/);
    await db.exec('set role anon');
    await expect(db.query(`select public.accept_barcode_review_association('${T}', '${GTIN}', 'dunnes', '${D}', '${r}', '{}', '{}', 'x')`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
});
