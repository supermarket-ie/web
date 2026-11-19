// Peer freshness is read per OFFER (latest_prices by store_product_id), and the
// targeted queue restricts a run to exact mapping ids. Real migrations (PGlite).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApifyDb, pgliteSupabase } from './test-support/apify-pglite';
import { collectTescoApify, loadFreshPeerOffers, parseTargetIds, selectApifyMappings, type ApifyFetchResult } from './tesco-apify-collection';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';

const TP = '7d000000-0000-0000-0000-0000000000a1';
const T = '7d000000-0000-0000-0000-000000000001';
const D = '7d000000-0000-0000-0000-0000000000d1';
const S = '7d000000-0000-0000-0000-0000000000c1';
const TP2 = '7d000000-0000-0000-0000-0000000000a2';
const T2 = '7d000000-0000-0000-0000-000000000002';
const D2 = '7d000000-0000-0000-0000-0000000000d2';
const S2 = '7d000000-0000-0000-0000-0000000000c2';
const NAME = 'Haribo Starmix Bag 160g';
const NAME2 = 'Haribo Goldbears Bag 160g';
let db: PGlite; let sb: SupabaseClient;
const fetched: string[] = [];
const item = (sku: string, name: string): ApifyItem => ({
  product_id: sku, gtin: null as unknown as string, name, brand_name: 'Haribo', price: 1.5, clubcard_price: null, currency: 'EUR',
  region: 'IE', pack_size: '160', pack_size_unit: 'G', net_contents: '160g', in_stock: true, status: 'AvailableForSale',
  has_promotion: false, promotions: [], scraped_at: new Date(Date.now() + 2000).toISOString(), url: `https://www.tesco.ie/groceries/en-IE/products/${sku}`,
});
const fakeApify = async (url: string): Promise<ApifyFetchResult> => {
  fetched.push(url);
  const sku = url.slice(url.lastIndexOf('/') + 1);
  const it = item(sku, sku === '306944060' ? NAME : NAME2);
  return {
    response: { outcome: 'ok', status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
    provider: { provider: 'apify', actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: `r-${fetched.length}`, datasetId: 'd',
      requestedUrl: url, sku, bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string, rawItem: it, rawItemSha256: 'b'.repeat(64),
      runUsageUsd: 0.0005, runUsageIsTerminal: true,
      freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(), afterSubmit: true,
        productScrapedEvents: 1, level: 'after_submit_asserted' as never, preconditionMet: true, limitation: 'provider-asserted', reason: 'test' } },
  };
};
const deps = () => ({ sb, fetchApify: fakeApify, campaign: 'e2e-fresh', budgetUsd: 10, perRequestUsd: 0.002,
  sleep: async () => { await db.exec(`update public.tesco_egress_pool set last_success_at = null`); }, aiRetries: 0 });

beforeEach(async () => {
  fetched.length = 0;
  db = await createApifyDb(); sb = pgliteSupabase(db);
  await db.exec(`
    insert into public.products(id, canonical_name, brand, ean) values ('${TP}','${NAME}','Haribo',null), ('${TP2}','${NAME2}','Haribo',null);
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
      ('${T}','${TP}','tesco','306944060','https://www.tesco.ie/shop/en-IE/products/306944060','${NAME}','Haribo',false,null,'resolved'),
      ('${D}','${TP}','dunnes','d1',null,'${NAME}','Haribo',false,null,'resolved'),
      ('${S}','${TP}','supervalu','s1',null,'${NAME}','Haribo',false,null,'resolved'),
      ('${T2}','${TP2}','tesco','311262559','https://www.tesco.ie/shop/en-IE/products/311262559','${NAME2}','Haribo',false,null,'resolved'),
      ('${D2}','${TP2}','dunnes','d2',null,'${NAME2}','Haribo',false,null,'resolved'),
      ('${S2}','${TP2}','supervalu','s2',null,'${NAME2}','Haribo',false,null,'resolved');
    -- Product 1: SuperValu fresh, Dunnes STALE (10 days). Product 2: both fresh.
    insert into public.price_observations(store_product_id, price, observed_at, source) values
      ('${S}', 1.6, now() - interval '1 day', 'supervalu'),
      ('${D}', 1.5, now() - interval '10 days', 'dunnes'),
      ('${S2}', 1.6, now() - interval '1 day', 'supervalu'),
      ('${D2}', 1.5, now() - interval '1 day', 'dunnes');
  `);
});
afterEach(async () => { await db.close(); });

describe('peer freshness is per offer', () => {
  it('a stale Dunnes offer is not a fresh peer, even when SuperValu is fresh', async () => {
    const peers = await loadFreshPeerOffers(sb, [TP, TP2]);
    expect(peers.filter(p => p.product_id === TP).map(p => p.store)).toEqual(['supervalu']);
    expect(peers.filter(p => p.product_id === TP2).map(p => p.store).sort()).toEqual(['dunnes', 'supervalu']);
    const stale = peers.find(p => p.id === D);
    expect(stale).toBeUndefined();
  });
  it('the first-price evidence cohort (both fresh peers) excludes the stale-Dunnes product', async () => {
    const sel = await selectApifyMappings(sb, 'evidence', 10);
    expect(sel.map(m => m.id)).toEqual([T2]);
    expect(sel[0].peers.map(p => p.store).sort()).toEqual(['dunnes', 'supervalu']);
  });
});

describe('targeted queue (APIFY_TARGET_IDS)', () => {
  it('only the listed mapping ids are eligible; others are never requested', async () => {
    await db.exec(`update public.price_observations set observed_at = now() - interval '1 day' where store_product_id = '${D}'`);
    const sel = await selectApifyMappings(sb, 'evidence', 10, false, { targetIds: [T] });
    expect(sel.map(m => m.id)).toEqual([T]);
    await collectTescoApify('evidence', 10, { ...deps(), selection: { targetIds: [T] } });
    expect(fetched).toEqual(['https://www.tesco.ie/shop/en-IE/products/306944060']);
  });
  it('a target id that fails eligibility is still not requested (rules unchanged)', async () => {
    const sel = await selectApifyMappings(sb, 'evidence', 10, false, { targetIds: [T] }); // T: stale Dunnes peer
    expect(sel).toEqual([]);
  });
  it('parseTargetIds fails closed on malformed input and de-duplicates', () => {
    expect(parseTargetIds(undefined)).toBeNull();
    expect(parseTargetIds(' ')).toBeNull();
    expect(parseTargetIds(`${T},${T}, ${T2}`)).toEqual([T, T2]);
    expect(() => parseTargetIds(`${T},not-a-uuid`)).toThrow();
  });
});
