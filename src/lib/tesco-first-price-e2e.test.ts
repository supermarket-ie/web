// END-TO-END: evidence-only acquisition -> AI-verified single-use approval ->
// first trusted price write, through the PRODUCTION TypeScript collector and
// approval code against PGlite carrying the REAL migrations and finaliser.
// Only the Apify provider and the AI model are stubbed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApifyDb, pgliteSupabase } from './test-support/apify-pglite';
import { collectTescoApify, type ApifyFetchResult } from './tesco-apify-collection';
import { prepareFirstPriceApprovals } from './tesco-first-price-approval';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';
import { assessmentSchema } from './tesco-identity-assessment';

const T = '7e000000-0000-0000-0000-000000000001'; // unproven, never observed
const TP = '7e000000-0000-0000-0000-0000000000a1';
const SKU = '305123456';
const URL = `https://www.tesco.ie/shop/en-IE/products/${SKU}`;
const R = '7e000000-0000-0000-0000-000000000002';  // proven, branded, wrong SKU (repair lead)
const RP = '7e000000-0000-0000-0000-0000000000a2';
const R_OLD = '253050178';
const R_NEW = '305429764';
const NAME = 'Nutella Hazelnut Chocolate Spread 350g';

let db: PGlite;
let sb: SupabaseClient;
const fetched: string[] = [];

const item = (sku: string, over: Partial<ApifyItem> = {}): ApifyItem => ({
  product_id: sku, gtin: null as unknown as string, name: 'Nutella Hazelnut Chocolate Spread 350G', brand_name: 'Nutella',
  price: 3.5, clubcard_price: null, currency: 'EUR', region: 'IE', pack_size: '350', pack_size_unit: 'G',
  net_contents: '350g', in_stock: true, status: 'AvailableForSale', has_promotion: false, promotions: [],
  scraped_at: new Date(Date.now() + 2000).toISOString(), url: `https://www.tesco.ie/groceries/en-IE/products/${sku}`, ...over,
});
function fakeApify(items: Record<string, ApifyItem>) {
  return async (url: string): Promise<ApifyFetchResult> => {
    fetched.push(url);
    const sku = url.slice(url.lastIndexOf('/') + 1);
    const it = items[sku] ?? item(sku);
    return {
      response: { outcome: 'ok', status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
      provider: {
        provider: 'apify', actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: `r-${fetched.length}`, datasetId: 'd',
        requestedUrl: url, sku, bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string,
        rawItem: it, rawItemSha256: 'b'.repeat(64), runUsageUsd: 0.0005, runUsageIsTerminal: true,
        freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(),
          afterSubmit: true, productScrapedEvents: 1, level: 'after_submit_asserted' as never,
          preconditionMet: true, limitation: 'provider-asserted', reason: 'test' },
      },
    };
  };
}
const facts = { sku_matches: true, brand_matches: true, barcode_matches: 'match', product_type_matches: true,
  flavour_formulation_matches: true, quantity_matches: true, pack_count_matches: true, selling_unit_matches: true };
const model = (decision: string) => async () => assessmentSchema.parse({ decision, facts,
  rationale: 'Brand, product type, flavour and the 350g pack all match the canonical product and both fresh peers.' });
const deps = (over: Record<string, unknown> = {}) => ({
  sb, fetchApify: fakeApify({}), campaign: 'e2e', budgetUsd: 10, perRequestUsd: 0.002,
  // Each "sleep" between requests models the elapsed pacing interval.
  sleep: async () => { await db.exec(`update public.tesco_egress_pool set last_success_at = null`); },
  assessOptions: { runModel: model('verified_exact') as never }, aiRetries: 0, ...over,
});
const n = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
// Models 25 hours passing for every request already made (the 24h exclusion).
const elapse25h = () => db.exec(`update public.tesco_direct_collection_pages set created_at = created_at - interval '25 hours';
  update public.tesco_egress_pool set last_success_at = null`);

beforeEach(async () => {
  fetched.length = 0;
  db = await createApifyDb();
  sb = pgliteSupabase(db);
  await db.exec(`
    insert into public.products(id, canonical_name, brand, ean) values
      ('${TP}','${NAME}','Nutella',null), ('${RP}','Pedigree Rodeo with Beef 7 Pack','Pedigree',null);
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
      ('${T}','${TP}','tesco','${SKU}','${URL}','${NAME}','Nutella',false,null,'resolved'),
      ('${R}','${RP}','tesco','${R_OLD}','https://www.tesco.ie/shop/en-IE/products/${R_OLD}','Pedigree Rodeo Beef','Pedigree',false,null,'resolved'),
      ('7e000000-0000-0000-0000-0000000000d1','${TP}','dunnes','d1',null,'${NAME}','Nutella',false,null,'resolved'),
      ('7e000000-0000-0000-0000-0000000000c1','${TP}','supervalu','s1',null,'${NAME}','Nutella',false,null,'resolved');
    insert into public.price_observations(store_product_id, price, observed_at, source) values
      ('7e000000-0000-0000-0000-0000000000d1', 3.4, now() - interval '1 day', 'dunnes'),
      ('7e000000-0000-0000-0000-0000000000c1', 3.6, now() - interval '1 day', 'supervalu');
    insert into public.scrape_runs(id, store, run_id, status, started_at) values ('7e000000-0000-0000-0000-0000000000ff','tesco','seed','success', now());
    insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('7e000000-0000-0000-0000-0000000000ff','${R}','success');
  `);
});
afterEach(async () => { await db.close(); });

describe('first trusted price: evidence -> approval -> guarded write (real migrations)', () => {
  it('writes the first price ONLY after evidence-only acquisition and an AI-verified, single-use approval', async () => {
    // 0. Before anything: expansion with the first-price path enabled never
    //    requests the unproven mapping (R, proven, is an ordinary candidate).
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    await elapse25h(); fetched.length = 0;

    // 1. EVIDENCE-ONLY acquisition (first-price evidence + one repair-target lead).
    const ev = await collectTescoApify('evidence', 10, deps({
      fetchApify: fakeApify({ [R_NEW]: item(R_NEW, { name: 'Pedigree Rodeo Adult Dog Treats Beef 7 Sticks 123g', brand_name: 'Pedigree' }) }),
      selection: { priorityIds: [T], repairTargets: [{ mappingId: R, targetSku: R_NEW }] },
    }));
    expect(ev.evidenceRecorded).toBe(2);
    expect(ev.accepted).toBe(0);
    expect(fetched).toEqual([URL, `https://www.tesco.ie/shop/en-IE/products/${R_NEW}`]);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id in ($1,$2)`, [T, R])).toBe(0);
    expect(await n(`select count(*)::int n from public.scrape_product_receipts where store_product_id = $1`, [T])).toBe(0);
    expect(await n(`select count(*)::int n from public.tesco_apify_provider_evidence where store_product_id = $1 and requested_url = $2`, [T, URL])).toBe(1);
    // The repair lead changed NO mapping and is a completed evidence-only source.
    expect((await db.query<{ store_sku: string }>(`select store_sku from public.store_products where id = $1`, [R])).rows[0].store_sku).toBe(R_OLD);
    const repairPage = (await db.query<{ ok: boolean }>(`select tesco_internal.completed_apify_evidence_source(id) ok
      from public.tesco_direct_collection_pages where requested_url = $1`, [`https://www.tesco.ie/shop/en-IE/products/${R_NEW}`])).rows[0];
    expect(repairPage.ok).toBe(true);

    // 2. APPROVAL from the retained evidence (minutes old; no 24h wait needed).
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, assessOptions: { runModel: model('verified_exact') as never } });
    expect(ap).toMatchObject({ assessed: 1, approved: 1, recorded: 1 });
    const approval = (await db.query<{ id: string; consumed_at: string | null; evidence_provider_id: string }>(
      `select id, consumed_at, evidence_provider_id from public.tesco_first_price_approvals where store_product_id = $1`, [T])).rows[0];
    expect(approval.consumed_at).toBeNull();
    expect(approval.evidence_provider_id).toBeTruthy();

    // 3. The 24h request exclusion is preserved: no request until it elapses.
    fetched.length = 0;
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    await elapse25h(); fetched.length = 0;

    // 4. FIRST PRICE: fresh live fetch, deterministic gate + fresh AI verdict,
    //    live fingerprint == approved fingerprint, consumed atomically.
    const exp = await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).toContain(URL);
    expect(exp.perProduct.find(p => p.sku === SKU)?.accepted).toBe(true);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(1);
    expect(await n(`select count(*)::int n from public.scrape_product_receipts where store_product_id = $1 and outcome = 'success'`, [T])).toBe(1);
    const consumed = (await db.query<{ consumed_at: string | null; consumed_run_id: string }>(
      `select consumed_at, consumed_run_id from public.tesco_first_price_approvals where id = $1`, [approval.id])).rows[0];
    expect(consumed.consumed_at).not.toBeNull();
    expect(consumed.consumed_run_id).toBe(exp.runId);

    // 5. Nothing left to do: the mapping is now priced and proven.
    await elapse25h();
    fetched.length = 0;
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(1);
  });

  it('records NO approval and writes NO price when the AI is not verified_exact', async () => {
    await collectTescoApify('evidence', 10, deps({ selection: { priorityIds: [T] } }));
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, assessOptions: { runModel: model('uncertain') as never } });
    expect(ap).toMatchObject({ assessed: 1, approved: 0, recorded: 0 });
    await elapse25h(); fetched.length = 0;
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
  });

  it('HOLDS and leaves the approval unconsumed when the live page differs from the approved evidence', async () => {
    await collectTescoApify('evidence', 10, deps({ selection: { priorityIds: [T] } }));
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, assessOptions: { runModel: model('verified_exact') as never } });
    expect(ap.recorded).toBe(1);
    await elapse25h(); fetched.length = 0;
    // Same SKU, but the live product now reads as a different pack.
    const exp = await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true,
      fetchApify: fakeApify({ [SKU]: item(SKU, { name: 'Nutella Hazelnut Chocolate Spread 750G', pack_size: '750', net_contents: '750g' }) }) }));
    expect(fetched).toContain(URL);
    const t = exp.perProduct.find(p => p.sku === SKU)!;
    expect(t.accepted).toBe(false);
    expect(t.reasons.length).toBeGreaterThan(0);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
    expect(await n(`select count(*)::int n from public.tesco_first_price_approvals where store_product_id = $1 and consumed_at is null`, [T])).toBe(1);
  });

  it('an evidence run never writes a price, even if a finalise is attempted directly', async () => {
    const begin = (await sb.rpc('apify_begin_tesco_run', { p_egress_key: 'apify-tesco-ie-20261108', p_mode: 'evidence', p_target_count: 1, p_owner: 'fargate-e2e-owner' })).data as { runId: string; leaseToken: string };
    const snap = (await sb.rpc('apify_mapping_snapshot', { p_store_product_id: T })).data;
    const res = await sb.rpc('apify_finalise_tesco_page', { p_run_id: begin.runId, p_egress_key: 'apify-tesco-ie-20261108',
      p_lease_token: begin.leaseToken, p_owner: 'fargate-e2e-owner', p_store_product_id: T, p_mode: 'expansion',
      p_regular_price: 3.5, p_previous_price: null, p_store_product_name: 'x', p_assessed_snapshot: snap });
    expect(res.error?.message).toContain('evidence_run_never_writes_price');
  });
});
