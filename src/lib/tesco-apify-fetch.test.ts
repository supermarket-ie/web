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
    // Default a few seconds in the FUTURE vs now so the transport's internal
    // request-submit reference is strictly before it (active freshness proof).
    scraped_at: new Date(Date.now() + 2000).toISOString(),
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

describe('verifyApifyFreshness — active per-request proof (owner rule: timestamps/billing alone are insufficient)', () => {
  // Reference point is OUR request submit time. Only a scraped_at strictly AFTER
  // submit qualifies; a prior/equal stamp (possible replay) HOLDS; billing is
  // audit-only.
  const submit = '2026-11-08T18:51:18.000Z';
  const base = { requestSubmittedAt: submit, runFinishedAt: '2026-11-08T18:51:22.652Z', itemsReturned: 1 };

  it('qualifies ONLY when scraped_at is strictly after our submit time', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:21Z', productScrapedEvents: 1 });
    expect(f.requiredFreshnessMet).toBe(true);
    expect(f.level).toBe('fresh_after_submit');
    expect(f.afterSubmit).toBe(true);
  });

  it('HOLDS when scraped_at is at/before submit (possible cached replay) — regardless of billing', () => {
    const atSubmit = verifyApifyFreshness({ ...base, scrapedAt: submit, productScrapedEvents: 1 });
    const before = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:10Z', productScrapedEvents: 1 });
    expect(atSubmit.requiredFreshnessMet).toBe(false);
    expect(before.requiredFreshnessMet).toBe(false);
    expect(before.level).toBe('not_after_submit');
    expect(before.reason).toMatch(/cached\/replayed/);
  });

  it('billing being present does NOT by itself qualify a stale timestamp', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: '2026-10-01T00:00:00Z', productScrapedEvents: 5 });
    expect(f.requiredFreshnessMet).toBe(false);
  });

  it('HOLDS when the provider returns no scraped_at', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: null, productScrapedEvents: 1 });
    expect(f.requiredFreshnessMet).toBe(false);
    expect(f.level).toBe('no_timestamp');
  });

  it('HOLDS an implausibly-future scraped_at', () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = verifyApifyFreshness({ requestSubmittedAt: new Date().toISOString(), runFinishedAt: null, itemsReturned: 1, scrapedAt: future, productScrapedEvents: 1 });
    expect(f.requiredFreshnessMet).toBe(false);
    expect(f.level).toBe('implausible_future');
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

  it('fail-closed by DEFAULT: a stale (pre-submit) scraped_at is held as a transport error', async () => {
    // scraped_at well before our submit → not fresh → hold. No explicit flag.
    const run = fakeRun([apifyItem({ scraped_at: '2026-01-01T00:00:00Z' })]);
    const fetchPage = createApifyFetchPage({ client: fakeClient(run) });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('network_error');
  });

  it('an after-submit scraped_at returns an ok page (billing irrelevant to freshness)', async () => {
    const run = fakeRun([apifyItem()], { productScrapedEvents: 0 });
    const fetchPage = createApifyFetchPage({ client: fakeClient(run) });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('ok');
  });

  it('with requireVerifiedFreshness:false (diagnostics only), a stale item still returns ok (never used for price writes)', async () => {
    const run = fakeRun([apifyItem({ scraped_at: '2026-01-01T00:00:00Z' })]);
    const fetchPage = createApifyFetchPage({ client: fakeClient(run), requireVerifiedFreshness: false });
    const res = await fetchPage(URL_322);
    expect(res.outcome).toBe('ok');
  });

  it('rejects a non-product URL', async () => {
    const fetchPage = createApifyFetchPage({ client: fakeClient(fakeRun([])) });
    await expect(fetchPage('https://www.tesco.ie/shop/en-IE/search?query=milk')).rejects.toThrow();
  });
});
