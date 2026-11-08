import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectTescoApify, type ApifyFetchResult } from './tesco-apify-collection';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';

// A minimal fake Supabase that records RPC calls and serves the reads the
// selector performs. The guard logic lives in the DB RPCs (migration-tested
// separately); here we test the runner's control flow: it reserves, fetches,
// records, finalises on accept, holds on identity reasons, stops on pause and
// on budget.
type Row = Record<string, unknown>;

function makeFakeSb(opts: {
  mappings: Row[]; latest: Row[]; receipts: Row[]; recent: Row[];
  recordResult?: (args: Row) => { finalised: boolean; paused?: boolean };
}): { sb: SupabaseClient; calls: Array<{ fn: string; args: Row }> } {
  const calls: Array<{ fn: string; args: Row }> = [];
  const table = (name: string) => {
    const dataFor = (): Row[] => name === 'store_products' ? opts.mappings
      : name === 'latest_prices' ? opts.latest
      : name === 'scrape_product_receipts' ? opts.receipts
      : name === 'tesco_direct_collection_pages' ? opts.recent : [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain; builder.eq = chain; builder.not = chain; builder.gte = chain;
    builder.order = chain;
    builder.range = async (from: number) => ({ data: from === 0 ? dataFor() : [], error: null });
    return builder;
  };
  const sb = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: Row) => {
      calls.push({ fn, args });
      if (fn === 'apify_begin_tesco_run') return { data: 'run-1', error: null };
      if (fn === 'apify_reserve_tesco_request') return { data: true, error: null };
      if (fn === 'apify_record_tesco_page') {
        const r = opts.recordResult ? opts.recordResult(args) : { finalised: !!args.p_accept };
        return { data: r, error: null };
      }
      if (fn === 'apify_record_identity_verification') return { data: 'ver-1', error: null };
      if (fn === 'apify_close_tesco_run') return { data: null, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

function item(over: Partial<ApifyItem> = {}): ApifyItem {
  return {
    product_id: '254877356', gtin: '05000119309228', name: 'Tesco Easy Cook Long Grain Rice 1Kg',
    brand_name: 'TESCO', price: 1.35, clubcard_price: null, currency: 'EUR', region: 'IE',
    pack_size: '1000', pack_size_unit: 'G', net_contents: '1kg e', in_stock: true,
    status: 'AvailableForSale', has_promotion: false, promotions: [], scraped_at: new Date().toISOString(),
    url: 'https://www.tesco.ie/groceries/en-IE/products/254877356', ...over,
  };
}

function okFetch(it: ApifyItem): (url: string) => Promise<ApifyFetchResult> {
  return async (url: string) => ({
    response: { outcome: 'ok', status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
    provider: {
      provider: 'apify', actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: 'r', datasetId: 'd',
      requestedUrl: url, sku: '254877356', bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string,
      rawItem: it, rawItemSha256: 'b'.repeat(64),
      freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(), afterSubmit: true, productScrapedEvents: 1, level: 'fresh_after_submit', requiredFreshnessMet: true, reason: 'ok' },
    },
  });
}

// One renewal-eligible mapping whose canonical identity matches the live item.
function fixtures() {
  const id = '11111111-1111-1111-1111-111111111111';
  return {
    id,
    mappings: [{
      id, product_id: 'p1', store_sku: '254877356',
      store_url: 'https://www.tesco.ie/shop/en-IE/products/254877356',
      store_product_name: 'Tesco Easy Cook Long Grain Rice 1kg', brand: 'Tesco', is_own_brand: true,
      url_status: 'resolved', gtin: '05000119309228',
      products: { canonical_name: 'Long Grain Rice 1kg', brand: null, ean: '05000119309228' },
    }],
    latest: [{ store_product_id: id, observed_at: '2026-10-01T00:00:00Z', price: 1.3 }],
    receipts: [{ store_product_id: id, outcome: 'success' }],
    recent: [] as Row[],
  };
}

describe('collectTescoApify — control flow through the RPC transport', () => {
  it('finalises an accepted renewal and records a reusable identity verification', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, {
      sb, fetchApify: okFetch(item()), budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
    });
    expect(res.requested).toBe(1);
    expect(res.accepted).toBe(1);
    expect(res.held).toBe(0);
    expect(calls.map(c => c.fn)).toEqual(expect.arrayContaining([
      'apify_begin_tesco_run', 'apify_reserve_tesco_request', 'apify_record_tesco_page',
      'apify_record_identity_verification', 'apify_close_tesco_run',
    ]));
    const rec = calls.find(c => c.fn === 'apify_record_tesco_page')!.args;
    expect(rec.p_accept).toBe(true);
    expect(rec.p_regular_price).toBe(1.35);
  });

  it('HOLDS (no finalise) when the live item identity conflicts with the mapping', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Live item is a DIFFERENT product (brand/name/gtin mismatch) — identity holds.
    const conflicting = item({ name: 'Califia Farms Oat Milk 1L', brand_name: 'CALIFIA FARMS', gtin: '01220000500242', pack_size: '1', pack_size_unit: 'L' });
    const res = await collectTescoApify('renewal', 10, {
      sb, fetchApify: okFetch(conflicting), budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
    });
    expect(res.requested).toBe(1);
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    const rec = calls.find(c => c.fn === 'apify_record_tesco_page')!.args;
    expect(rec.p_accept).toBe(false);
    expect(rec.p_regular_price).toBeNull();
    // No reusable verification recorded for a held product.
    expect(calls.some(c => c.fn === 'apify_record_identity_verification')).toBe(false);
  });

  it('HOLDS (no finalise) when provider freshness is not verified, even if identity matches', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Identity matches, but the provider says freshness NOT met.
    const staleFetch: (url: string) => Promise<ApifyFetchResult> = async (url) => {
      const r = await okFetch(item())(url);
      return { response: r.response, provider: { ...r.provider!, freshness: { ...r.provider!.freshness, requiredFreshnessMet: false, level: 'not_after_submit' } } };
    };
    const res = await collectTescoApify('renewal', 10, {
      sb, fetchApify: staleFetch, budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
    });
    expect(res.accepted).toBe(0);
    const rec = calls.find(c => c.fn === 'apify_record_tesco_page')!.args;
    expect(rec.p_accept).toBe(false);
    expect(calls.some(c => c.fn === 'apify_record_identity_verification')).toBe(false);
  });

  it('stops before exceeding the campaign budget', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, {
      sb, fetchApify: okFetch(item()), budgetUsd: 0.001, perRequestUsd: 0.002, sleep: async () => {},
    });
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
  });

  it('skips a product the reservation RPC refuses (recently attempted) without fetching', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Force the reserve RPC to refuse.
    const sb2 = { ...sb, rpc: async (fn: string, args: Row) => {
      calls.push({ fn, args });
      if (fn === 'apify_begin_tesco_run') return { data: 'run-1', error: null };
      if (fn === 'apify_reserve_tesco_request') return { data: null, error: { message: 'attempt_already_recorded' } };
      if (fn === 'apify_close_tesco_run') return { data: null, error: null };
      return { data: null, error: null };
    } } as unknown as SupabaseClient;
    let fetched = 0;
    const res = await collectTescoApify('renewal', 10, {
      sb: sb2, fetchApify: async (u) => { fetched++; return okFetch(item())(u); },
      budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
    });
    expect(fetched).toBe(0);
    expect(res.requested).toBe(0);
  });
});
