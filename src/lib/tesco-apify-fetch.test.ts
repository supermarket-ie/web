import { describe, expect, it } from 'vitest';
import { parseTescoCollectedPage } from './tesco-direct-collection-core';
import {
  renderApifyProductPage,
  verifyApifyFreshness,
  createApifyFetchPage,
  type ApifyItem,
  type ApifyRunClient,
  type ApifyRunResult,
} from './tesco-apify-fetch';

const URL_322 = 'https://www.tesco.ie/shop/en-IE/products/322842145';

// A representative Apify item (shape taken from the real acceptance run).
function apifyItem(overrides: Partial<ApifyItem> = {}): ApifyItem {
  return {
    product_id: '322842145',
    tpnb: '97324097',
    gtin: '01220000500242',
    name: 'CALIFIA FARMS Extra Creamy Oat Milk 1L',
    brand_name: 'CALIFIA FARMS',
    price: 3.69,
    clubcard_price: null,
    currency: 'EUR',
    region: 'IE',
    pack_size: '1',
    pack_size_unit: 'L',
    net_contents: '1l ℮',
    in_stock: true,
    status: 'AvailableForSale',
    has_promotion: false,
    promotions: [],
    scraped_at: '2026-11-08T18:51:22Z',
    url: 'https://www.tesco.ie/groceries/en-IE/products/322842145',
    ...overrides,
  };
}

function fakeRun(items: ApifyItem[], overrides: Partial<ApifyRunResult> = {}): ApifyRunResult {
  return {
    actorId: 'v6Dx4kBtxWYDAd55V',
    runId: 'run1',
    datasetId: 'ds1',
    buildId: 'build1',
    buildNumber: '1.0.0',
    startedAt: '2026-11-08T18:51:18.551Z',
    finishedAt: '2026-11-08T18:51:22.652Z',
    items,
    productScrapedEvents: items.length,
    actorStartEvents: 1,
    usageTotalUsd: 0.0018 * items.length,
    ...overrides,
  };
}

function fakeClient(run: ApifyRunResult): ApifyRunClient {
  return { runProductUrls: async () => run };
}

describe('renderApifyProductPage → parseTescoCollectedPage (single parser, single identity path)', () => {
  it('renders an item the existing Tesco parser reads into a correct TescoCollectedProduct', () => {
    const html = renderApifyProductPage(URL_322, apifyItem());
    const page = parseTescoCollectedPage(html, URL_322);
    expect(page.listing).toBeNull();
    expect(page.products).toHaveLength(1);
    const p = page.products[0];
    expect(p.sku).toBe('322842145');
    expect(p.url).toBe(URL_322);
    expect(p.name).toBe('CALIFIA FARMS Extra Creamy Oat Milk 1L');
    expect(p.brand).toBe('CALIFIA FARMS');
    expect(p.gtin).toBe('01220000500242');
    expect(p.price).toBe(3.69);
    expect(p.currency).toBe('EUR');
    expect(p.available).toBe(true);
    expect(p.quantity).toEqual({ millilitres: 1000 });
  });

  it('drops Clubcard/promo so the parser can only ever see the regular shelf price', () => {
    const html = renderApifyProductPage(URL_322, apifyItem({
      price: 3.5,
      clubcard_price: 2.8,
      has_promotion: true,
      promotions: [{ description: '€2.80 Clubcard Price', is_clubcard_price: true }],
    }));
    const p = parseTescoCollectedPage(html, URL_322).products[0];
    // Regular shelf price only; the Clubcard 2.80 is not reachable by the parser.
    expect(p.price).toBe(3.5);
    expect(html).not.toContain('2.8');
  });

  it('rejects an item whose product_id does not match the requested SKU', () => {
    expect(() => renderApifyProductPage(URL_322, apifyItem({ product_id: '999999999' }))).toThrow();
  });

  it('rejects a non-Irish or non-EUR item', () => {
    expect(() => renderApifyProductPage(URL_322, apifyItem({ region: 'UK' }))).toThrow();
    expect(() => renderApifyProductPage(URL_322, apifyItem({ currency: 'GBP' }))).toThrow();
  });

  it('an out-of-stock item parses as unavailable (so identity holds, no price write)', () => {
    const html = renderApifyProductPage(URL_322, apifyItem({ in_stock: false, status: 'OutOfStock' }));
    const p = parseTescoCollectedPage(html, URL_322).products[0];
    expect(p.available).toBe(false);
  });
});

describe('verifyApifyFreshness — reflects the ESTABLISHED actor behaviour', () => {
  // Established empirically: scraped_at tracks the actor's per-run retrieval
  // time; billing is inconsistent and is NOT a freshness signal; no cache field
  // exists so an uncached upstream read cannot be independently proven. Minimum
  // required freshness = scraped_at present and in-window.
  const base = {
    runStartedAt: '2026-11-08T18:51:18.551Z',
    runFinishedAt: '2026-11-08T18:51:22.652Z',
    itemsReturned: 1,
  };

  it('meets required freshness when scraped_at is in-window (regardless of billing)', () => {
    const billed = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:22Z', productScrapedEvents: 1 });
    const unbilled = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:22Z', productScrapedEvents: 0 });
    expect(billed.requiredFreshnessMet).toBe(true);
    expect(unbilled.requiredFreshnessMet).toBe(true); // billing is NOT a freshness signal
    expect(billed.level).toBe('in_window_unproven_cache');
    // It never claims proof of an uncached upstream read.
    expect(billed.reason).toMatch(/not independently provable/);
  });

  it('holds (required freshness NOT met) when scraped_at is outside the run window', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: '2026-10-01T00:00:00Z', productScrapedEvents: 1 });
    expect(f.requiredFreshnessMet).toBe(false);
    expect(f.withinRunWindow).toBe(false);
    expect(f.level).toBe('stale_or_out_of_window');
  });

  it('holds when the provider returns no scraped_at at all', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: null, productScrapedEvents: 1 });
    expect(f.requiredFreshnessMet).toBe(false);
    expect(f.level).toBe('no_timestamp');
  });
});

describe('createApifyFetchPage — the transport', () => {
  it('returns an ok page and emits provider identity with the body hash + freshness', async () => {
    const run = fakeRun([apifyItem()]);
    let captured: unknown = null;
    const fetchPage = createApifyFetchPage({ client: fakeClient(run), onProviderIdentity: (i) => { captured = i; } });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('ok');
    expect(res.status).toBe(200);
    expect(res.html).toContain('application/discover+json');
    const parsed = parseTescoCollectedPage(res.html, URL_322);
    expect(parsed.products[0].price).toBe(3.69);
    expect(captured).toMatchObject({
      provider: 'apify', actorId: 'v6Dx4kBtxWYDAd55V', runId: 'run1', datasetId: 'ds1', sku: '322842145',
    });
    expect((captured as { freshness: { requiredFreshnessMet: boolean } }).freshness.requiredFreshnessMet).toBe(true);
    expect((captured as { bodySha256: string }).bodySha256).toMatch(/^[a-f0-9]{64}$/);
    // Provider-origin evidence hash is distinct from the synthetic adapter HTML hash.
    const c = captured as { bodySha256: string; rawItemSha256: string };
    expect(c.rawItemSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(c.rawItemSha256).not.toBe(c.bodySha256);
  });

  it('a missing item becomes a 404 http_error (resource unavailable, not an egress denial)', async () => {
    const run = fakeRun([]);
    const fetchPage = createApifyFetchPage({ client: fakeClient(run) });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('http_error');
    expect(res.status).toBe(404);
  });

  it('a provider failure becomes a network_error (collector holds, never a silent success)', async () => {
    const client: ApifyRunClient = { runProductUrls: async () => { throw new Error('provider down'); } };
    const fetchPage = createApifyFetchPage({ client });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('network_error');
  });

  it('with requireVerifiedFreshness, an out-of-window item is held as a transport error (no ok page)', async () => {
    // scraped_at long before the run window → required freshness not met → hold.
    const run = fakeRun([apifyItem({ scraped_at: '2026-01-01T00:00:00Z' })]);
    const fetchPage = createApifyFetchPage({ client: fakeClient(run), requireVerifiedFreshness: true });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('network_error');
  });

  it('with requireVerifiedFreshness, an in-window item returns an ok page (billing irrelevant)', async () => {
    const run = fakeRun([apifyItem()], { productScrapedEvents: 0 });
    const fetchPage = createApifyFetchPage({ client: fakeClient(run), requireVerifiedFreshness: true });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('ok');
  });

  it('rejects a non-product URL', async () => {
    const fetchPage = createApifyFetchPage({ client: fakeClient(fakeRun([])) });
    await expect(fetchPage('https://www.tesco.ie/shop/en-IE/search?query=milk')).rejects.toThrow();
  });
});
