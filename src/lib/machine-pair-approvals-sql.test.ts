// Machine pair approvals (migration 20261122090000) on the REAL ledger, durable-approval and barcode migrations.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const P = '7c000000-0000-0000-0000-0000000000c1', P2 = '7c000000-0000-0000-0000-0000000000c2';
const T = '7c000000-0000-0000-0000-0000000000a1', S = '7c000000-0000-0000-0000-0000000000b1', D = '7c000000-0000-0000-0000-0000000000d1';
const TSKU = '258147391', SSKU = '1017371000', DSKU = '100118355', GTIN = '5000157062673';
const TURL = `https://www.tesco.ie/shop/en-IE/products/${TSKU}`;
const SURL = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/heinz-cream-of-tomato-soup-400-g-id-${SSKU}`;
const DURL = `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/heinz-cream-of-tomato-soup-400g/${DSKU}`;
const DAPI = `https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/${DSKU}`;
const POLICY = 'barcode-exact-v1';
const tescoParsed = (o: Record<string, unknown> = {}) => JSON.stringify({ products: [{ sku: TSKU, name: 'Heinz Cream Of Tomato Soup 400G', brand: 'HEINZ', gtin: `0${GTIN}`,
  quantity: { grams: 400 }, identityDetails: { packSize: [{ units: 'G', value: 400 }] }, ...o }] });
const identity = (o: Record<string, unknown> = {}) => JSON.stringify({ title: 'Heinz Cream of Tomato Soup (400 g)', brand: 'Heinz', manufacturer: null, manufacturerProductCode: null,
  gtin: null, description: 'x', ingredients: null, quantity: null, packSize: null, packCount: null, variant: null, flavour: null, formulation: null, ...o });

let db: PGlite;
async function page(o: Record<string, unknown> = {}, at = `now() - interval '1 hour'`) {
  return (await db.query<{ id: string }>(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
    values ($1, $1, 'ok', 200, $2, $3::jsonb, ${at}) returning id`, [TURL, 'c'.repeat(64), tescoParsed(o)])).rows[0].id;
}
async function response(store: 'supervalu' | 'dunnes', o: { identity?: Record<string, unknown>; at?: string; kind?: string; requested?: string; offer?: string } = {}) {
  const sku = store === 'supervalu' ? SSKU : DSKU, url = store === 'supervalu' ? SURL : DURL;
  const kind = o.kind ?? (store === 'supervalu' ? 'captured_product' : 'captured_product_api');
  const req = o.requested ?? (kind === 'captured_product_api' ? DAPI : url);
  return (await db.query<{ id: string }>(`insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at,
    content_type, body_text, parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
    values ($1, $2, $3, $4, $4, ${o.at ?? `now() - interval '1 hour'`}, 'application/json', '{"x":1}', 'retailer-identity-response-v3', $5, '$.product', $6::jsonb, gen_random_uuid(), $7) returning id`,
    [store, sku, url, req, kind, identity(o.identity), o.offer ?? (store === 'supervalu' ? S : D)])).rows[0].id;
}
async function association(store: 'supervalu' | 'dunnes', sku = store === 'supervalu' ? SSKU : DSKU) {
  const body = `{"total":1,"items":[{"sku":"${sku}"}],"s":"${store}${sku}"}`;
  const ep = store === 'supervalu' ? 'https://storefrontgateway.supervalu.ie/api/stores/5550/search' : 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search';
  await db.query(`insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, response_body, resolved_sku, outcome, tier, title_agreement, rule_version, observed_at)
    values ($1, 'gtin13', 'tesco', $2, $3, '{"table":"tesco_apify_provider_evidence","field":"raw_item.gtin","tesco_name":"Heinz Cream Of Tomato Soup 400G","tesco_brand":"HEINZ"}',
    $4, 'sku_found_by_gtin_search', $1, $5, 200, 1, '[]', $6, $7, $8, 'identity_consistent', 'strong', 1, 'barcode-v5', now() - interval '2 hours')`,
    [GTIN, TSKU, T, store, `${ep}?q=${GTIN}`, createHash('sha256').update(body).digest('hex'), body, sku]);
}
const approve = (a: string, b: string, sa: string, sb: string, o: { gtin?: string; model?: string; policy?: string } = {}) => db.query<{ id: string }>(
  `select public.record_machine_pair_approval($1, $2, $3, $4, $5, $6, '{"identity":"brand_pack_variant"}'::jsonb, 'Barcode-exact machine approval (test).', $7::jsonb) as id`,
  [o.policy ?? POLICY, a, b, sa, sb, o.gtin ?? GTIN, o.model ?? '{}']);
const asService = async <R,>(f: () => Promise<R>) => { await db.exec('set role service_role'); try { return await f(); } finally { await db.exec('reset role'); } };
const status = async () => (await db.query<{ status: string; reviewer: string }>(`select status, reviewer from public.current_pair_review_status()`)).rows;

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
    '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals', '20261123120000_pair_status_performance']) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  await db.exec(`insert into public.store_products values
    ('${T}', '${P}', 'tesco', '${TSKU}', '${TURL}', 'Heinz Cream Of Tomato Soup 400G'),
    ('${S}', '${P}', 'supervalu', '${SSKU}', '${SURL}', 'Heinz Cream of Tomato Soup (400 g)'),
    ('${D}', '${P}', 'dunnes', '${DSKU}', '${DURL}', 'Heinz Cream Of Tomato Soup 400g');`);
});
afterEach(async () => { await db.close(); });

describe('machine pair approvals (real migrations)', () => {
  it('service_role approves a fully evidenced Tesco–SuperValu pair through the unchanged ledger triggers', async () => {
    await association('supervalu');
    const t = await page(), s = await response('supervalu');
    const id = (await asService(() => approve(T, S, t, s))).rows[0].id;
    const r = (await db.query<Record<string, unknown>>(`select decision_kind, reviewer, policy_version, classification, left_sku, right_sku, machine_evidence->>'gtin' g
      from public.retailer_offer_pair_reviews where id = $1`, [id])).rows[0];
    expect(r).toMatchObject({ decision_kind: 'machine', reviewer: `machine:${POLICY}`, policy_version: POLICY, classification: 'exact_product', left_sku: TSKU, right_sku: SSKU, g: GTIN });
    expect(await status()).toEqual([{ status: 'active', reviewer: `machine:${POLICY}` }]);
    expect((await db.query(`select 1 from public.machine_pair_decisions where decision = 'approved' and review_id = $1`, [id])).rows).toHaveLength(1);
  });
  it('a Dunnes side binds to its SKU-bound product API capture; a non-API URL cannot claim that kind', async () => {
    await association('dunnes');
    const t = await page(), d = await response('dunnes');
    await asService(() => approve(T, D, t, d));
    expect((await status())[0].status).toBe('active');
    await expect(response('dunnes', { requested: DURL })).rejects.toThrow(/source_kind_check/);
    await expect(response('supervalu', { kind: 'captured_product_api', requested: DAPI })).rejects.toThrow(/source_kind_check/);
  });
  it('a machine-approved pair suspends automatically when the product identity changes', async () => {
    await association('supervalu');
    await asService(async () => approve(T, S, await page(), await response('supervalu')));
    await asService(() => db.query(`insert into public.retailer_identity_observations(store_product_id, store, sku, source_kind, product_url, requested_url, final_url,
      body_sha256, parser_version, identity, observed_at) values ($1, 'supervalu', $2, 'captured_product', $3, $3, $3, $4, 'retailer-identity-response-v3', $5::jsonb, now())`,
      [S, SSKU, SURL, 'd'.repeat(64), identity({ title: 'Heinz Cream of Tomato Soup Reduced Salt (400 g)' })]));
    expect((await status())[0].status).toBe('suspended_identity_changed');
  });

  describe('refusals (nothing is written)', () => {
    const refuses = async (f: () => Promise<unknown>, msg: RegExp) => {
      await expect(asService(f)).rejects.toThrow(msg);
      expect((await db.query(`select 1 from public.retailer_offer_pair_reviews`)).rows).toHaveLength(0);
      expect((await db.query(`select 1 from public.machine_pair_decisions`)).rows).toHaveLength(0);
    };
    it('no barcode association, or one resolving another SKU', async () => {
      await refuses(async () => approve(T, S, await page(), await response('supervalu')), /no active barcode association/);
      await association('supervalu', '1017371999');
      await refuses(async () => approve(T, S, await page(), await response('supervalu')), /no active barcode association/);
    });
    it('offers on different catalogue records, or a shared SKU', async () => {
      await association('supervalu');
      await db.exec(`update public.store_products set product_id = '${P2}' where id = '${S}'`);
      await refuses(async () => approve(T, S, await page(), await response('supervalu')), /same catalogue record/);
      await db.exec(`update public.store_products set product_id = '${P}' where id = '${S}';
        insert into public.store_products values (gen_random_uuid(), '${P2}', 'supervalu', '${SSKU}', '${SURL}', 'dup')`);
      await refuses(async () => approve(T, S, await page(), await response('supervalu')), /SKU missing or shared/);
    });
    it('brand, pack and GTIN contradictions in the stamped evidence', async () => {
      await association('supervalu');
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { identity: { brand: 'Batchelors' } })), /brand contradiction/);
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { identity: { quantity: { grams: 500 } } })), /pack contradiction/);
      await refuses(async () => approve(T, S, await page({ gtin: '5000157062680' }), await response('supervalu')), /GTIN contradiction/);
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { identity: { gtin: '5000157062680' } })), /GTIN contradiction/);
    });
    it('own-label products', async () => {
      await association('supervalu');
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { identity: { brand: 'SuperValu', title: 'SuperValu Cream of Tomato Soup (400 g)' } })), /brand contradiction|own-label/);
    });
    it('stale sources (beyond the 12-day machine limit) and evidence outside the ledger horizon', async () => {
      await association('supervalu');
      await refuses(async () => approve(T, S, await page({}, `now() - interval '13 days'`), await response('supervalu')), /freshness limit/);
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { at: `now() - interval '13 days'` })), /freshness limit/);
    });
    it('a model verdict other than exact, an unknown policy, or a missing GTIN', async () => {
      await association('supervalu');
      await refuses(async () => approve(T, S, await page(), await response('supervalu'), { model: '{"verdict":"different","model":"m"}' }), /model verdict/);
      await refuses(async () => approve(T, S, await page(), await response('supervalu'), { policy: 'made-up-v9' }), /unknown machine policy/);
      await refuses(async () => approve(T, S, await page(), await response('supervalu'), { gtin: '' }), /needs a GTIN/);
    });
    it('a source that belongs to another offer does not bind (existing ledger trigger)', async () => {
      await association('supervalu');
      await refuses(async () => approve(T, S, await page(), await response('supervalu', { offer: D })), /does not bind/);
    });
  });

  describe('review findings', () => {
    it('a human decision on the pair (any classification) is never overridden by the machine', async () => {
      await association('supervalu');
      await db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer)
        values ('${T}', '${S}', 'not_comparable', 'Owner: different products.', 'owner')`);
      await expect(asService(async () => approve(T, S, await page(), await response('supervalu')))).rejects.toThrow(/human decision exists/);
      expect((await db.query(`select 1 from public.retailer_offer_pair_reviews where decision_kind = 'machine'`)).rows).toHaveLength(0);
    });
    it('a Dunnes–SuperValu pair needs the origin Tesco page to state the GTIN', async () => {
      await association('supervalu'); await association('dunnes');
      const d = await response('dunnes'), s1 = await response('supervalu');
      await expect(asService(() => approve(D, S, d, s1))).rejects.toThrow(/origin Tesco page does not state the GTIN/);
      await page({ gtin: '5000157062680' });
      await expect(asService(() => approve(D, S, d, s1))).rejects.toThrow(/origin Tesco page does not state the GTIN/);
      await page();
      await asService(() => approve(D, S, d, s1));
      expect((await status())[0].status).toBe('active');
    });
    it('a Tesco page that states no GTIN cannot support a machine approval', async () => {
      await association('supervalu');
      await expect(asService(async () => approve(T, S, await page({ gtin: null }), await response('supervalu')))).rejects.toThrow(/does not state the GTIN/);
    });
    it('brand agreement is whole-word: Kerry is not Kerrygold', async () => {
      await association('supervalu');
      await expect(asService(async () => approve(T, S, await page({ brand: 'Kerrygold' }), await response('supervalu', { identity: { brand: 'Kerry' } })))).rejects.toThrow(/brand contradiction/);
      await asService(async () => approve(T, S, await page({ brand: 'Heinz' }), await response('supervalu', { identity: { brand: 'Heinz Foods' } })));
    });
    it('an approved audit row cannot be forged for another pair', async () => {
      await association('supervalu');
      const id = (await asService(async () => approve(T, S, await page(), await response('supervalu')))).rows[0].id;
      await expect(asService(() => db.exec(`insert into public.machine_pair_decisions(policy_version, left_offer_id, right_offer_id, decision, review_id)
        values ('${POLICY}', '${T}', '${D}', 'approved', '${id}')`))).rejects.toThrow(/must reference its machine review/);
    });
  });

  describe('access control and identification', () => {
    it('service_role still cannot write the ledger directly, and anon cannot call the machine path', async () => {
      await expect(asService(() => db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer)
        values ('${S}', '${T}', 'unverified', 'attempted service write', 'svc')`))).rejects.toThrow(/permission denied/);
      await db.exec('set role anon');
      await expect(db.query(`select public.record_machine_pair_approval('${POLICY}', '${T}', '${S}', null, null, '${GTIN}', '{}', 'x', '{}')`)).rejects.toThrow(/permission denied/);
      await db.exec('reset role');
    });
    it('a human row cannot claim a machine identity, and a machine row cannot omit its policy', async () => {
      const t = await page(), s = await response('supervalu');
      const ins = (reviewer: string, extra = '') => db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification,
        left_source_kind, left_source_id, left_source_hash, left_captured_at, right_source_kind, right_source_id, right_source_hash, right_captured_at,
        rationale, reviewer, checked_attributes${extra ? ', decision_kind' : ''})
        select '${T}', '${S}', 'exact_product', 'tesco_page', p.id, p.body_sha256, p.created_at, 'retailer_response', e.id, e.body_sha256, e.retrieved_at,
          'Operator review of captured evidence.', '${reviewer}', '["brand","product_name","pack_size"]'${extra}
        from public.tesco_direct_collection_pages p, public.retailer_identity_responses e where p.id = '${t}' and e.id = '${s}'`);
      await expect(ins(`machine:${POLICY}`)).rejects.toThrow(/machine_decision_identified/);
      await expect(ins('owner', `, 'machine'`)).rejects.toThrow(/machine_decision_identified/);
      await ins('owner');   // the human operator route is unchanged
      expect((await db.query(`select decision_kind from public.retailer_offer_pair_reviews`)).rows).toEqual([{ decision_kind: 'human' }]);
    });
    it('policies and decisions are append-only; service_role can record holds but not fake an approval', async () => {
      await expect(db.exec(`update public.pair_approval_policies set rules = '{}'`)).rejects.toThrow(/append-only/);
      await asService(() => db.exec(`insert into public.machine_pair_decisions(policy_version, left_offer_id, right_offer_id, gtin, decision, reasons)
        values ('${POLICY}', '${T}', '${S}', '${GTIN}', 'held', '["supervalu:no_direct_capture"]')`));
      await expect(asService(() => db.exec(`update public.machine_pair_decisions set decision = 'approved'`))).rejects.toThrow();
      await expect(asService(() => db.exec(`insert into public.machine_pair_decisions(policy_version, left_offer_id, right_offer_id, decision, review_id)
        values ('${POLICY}', '${T}', '${S}', 'approved', gen_random_uuid())`))).rejects.toThrow();
      await expect(asService(() => db.exec(`select * from public.pair_approval_policies`))).resolves.toBeDefined();
    });
  });
});
