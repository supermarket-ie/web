import { describe, expect, it, vi } from 'vitest';
import { fetchTescoCollectedPage, parseTescoCollectedPage, tescoListingUrl, tescoPauseUntil, tescoProductUrl, tescoResourceUnavailable, validateTescoCollectedIdentity, type TescoCollectedProduct } from './tesco-direct-collection-core';

const sku = '123456789';
const milk = { __typename: 'ProductType', id: sku, tpnc: sku, title: 'Tesco Whole Milk 1L', brandName: 'TESCO', gtin: '05000000000001', price: { actual: 1.15 }, isForSale: true, status: 'AvailableForSale', details: { packSize: [{ value: '1', units: 'L' }] }, promotions: [{ afterDiscount: 0.01 }] };
function page(cache: Record<string, unknown>, locale = 'en-IE') {
  return `<p>€1.15</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': { props: { config: { global: { locale } }, apolloCache: cache } } })}</script><script type="application/ld+json">{"priceCurrency":"GBP","price":99}</script>`;
}
function pdp(product = milk) { return page({ ROOT_QUERY: { [`product({"tpnc":"${sku}"})`]: { __ref: `ProductType:${sku}` } }, [`ProductType:${sku}`]: product }); }
function listing(query = 'milk', pageNumber = 1) {
  return page({ ROOT_QUERY: { [`search(${JSON.stringify({ page: pageNumber, query })})`]: { info: { page: pageNumber, pageSize: 24, total: 25 }, results: [{ node: { __ref: `ProductType:${sku}` } }] } }, [`ProductType:${sku}`]: milk, 'ProductType:999999999': { ...milk, id: '999999999', tpnc: '999999999', title: 'Unrelated recommendation' } });
}
const mapping = { storeProductId: 'mapping', canonicalName: 'Whole Milk 1L', canonicalBrand: null, storeProductName: milk.title, storeBrand: 'TESCO', isOwnBrand: true, storeSku: sku, storeUrl: tescoProductUrl(sku), duplicateSkuCount: 1, isFresh: false };
const candidate: TescoCollectedProduct = { sku, url: tescoProductUrl(sku), name: milk.title, price: 1.15, currency: 'EUR', available: true, brand: 'TESCO', gtin: null, quantity: { millilitres: 1000 } };

describe('Tesco structured collection', () => {
  it('uses the exact product root, regular price and Irish evidence, not JSON-LD or promotions', () => {
    const parsed = parseTescoCollectedPage(pdp(), tescoProductUrl(sku));
    expect(parsed.products[0]).toMatchObject({ sku, price: 1.15, currency: 'EUR', quantity: { millilitres: 1000 } });
  });
  it('rejects another market, missing euro evidence and mismatched structured identity', () => {
    expect(() => parseTescoCollectedPage(pdp().replace('en-IE', 'en-GB'), tescoProductUrl(sku))).toThrow();
    expect(() => parseTescoCollectedPage(pdp().replace('€', '£'), tescoProductUrl(sku))).toThrow();
    expect(() => parseTescoCollectedPage(pdp({ ...milk, tpnc: '999999999' }), tescoProductUrl(sku))).toThrow();
  });
  it('takes only listing references and produces bounded pagination', () => {
    const parsed = parseTescoCollectedPage(listing(), tescoListingUrl('milk'));
    expect(parsed.products.map(p => p.sku)).toEqual([sku]);
    expect(parsed.listing?.nextUrl).toBe(tescoListingUrl('milk', 2));
    expect(parseTescoCollectedPage(listing('milk', 2), tescoListingUrl('milk', 2)).listing?.nextUrl).toBeNull();
    expect(() => parseTescoCollectedPage(listing(), tescoListingUrl('bread'))).toThrow();
    expect(() => parseTescoCollectedPage(listing(), tescoListingUrl('milk', 2))).toThrow();
  });
  it('fails closed on SKU, pack, prepared-meal and availability conflicts', () => {
    expect(validateTescoCollectedIdentity(mapping, candidate)).toEqual([]);
    expect(validateTescoCollectedIdentity(mapping, { ...candidate, sku: '999999999' })).toContain('different_sku_requires_mapping_review');
    expect(validateTescoCollectedIdentity(mapping, { ...candidate, name: 'Tesco Whole Milk 500Ml', quantity: { millilitres: 500 } })).not.toEqual([]);
    expect(validateTescoCollectedIdentity({ ...mapping, canonicalName: 'Minced Beef' }, { ...candidate, name: 'Fit Foods Pasta Bolognese with Minced Beef & Tomato Sauce 400g' })).toContain('raw_ingredient_prepared_meal_conflict');
    expect(validateTescoCollectedIdentity(mapping, { ...candidate, available: false })).not.toEqual([]);
    expect(validateTescoCollectedIdentity({ ...mapping, duplicateSkuCount: 2, duplicateCanonicalNames: ['Whole Milk 1L', 'Low Fat Milk 1L'] }, candidate)).not.toEqual([]);
  });
});

describe('Tesco transport stop rules', () => {
  it('records the local deadline before headers without retrying or leaking error text', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new DOMException('private diagnostic', 'AbortError')), { once: true });
      }));
      const pending = fetchTescoCollectedPage(tescoProductUrl(sku), fetcher);
      await vi.advanceTimersByTimeAsync(20_000);
      const response = await pending;
      expect(response).toMatchObject({ outcome: 'network_error', status: null, elapsedMs: 20_000,
        transport: { phase: 'headers', timedOut: true, headersElapsedMs: null, redirectCount: 0, errorName: 'AbortError', errorCode: null } });
      expect(JSON.stringify(response)).not.toContain('private diagnostic');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('preserves denial, rate limit and Retry-After when the body fails', async () => {
    for (const status of [401, 403, 429, 200, 404]) {
      const body = new ReadableStream({ start(controller) { controller.error(new Error('private body failure')); } });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status, headers: { 'Retry-After': '7200' } }));
      const response = await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher);
      expect(response).toMatchObject({ status, retryAfter: '7200',
        outcome: status === 401 || status === 403 ? 'access_block' : status === 429 ? 'rate_limited' : 'network_error',
        transport: { phase: 'body', timedOut: false, errorName: 'Error' } });
      expect(tescoResourceUnavailable(response)).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(response)).not.toContain('private body failure');
      const pause = Date.parse(tescoPauseUntil(response.outcome, response.retryAfter, 0)!);
      expect(pause).toBe(status === 401 || status === 403 ? 48 * 3600_000 : 7200_000);
    }
  });
  it('distinguishes a body deadline from a headers deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => new Response(new ReadableStream({
        start(controller) { init!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true }); },
      }), { status: 200 }));
      const pending = fetchTescoCollectedPage(tescoProductUrl(sku), fetcher);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toMatchObject({ outcome: 'network_error', status: 200,
        transport: { phase: 'body', timedOut: true, headersElapsedMs: 0 } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('retains only allowlisted network error codes and marks prior redirects', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: tescoProductUrl('987654321') } }))
      .mockRejectedValueOnce(new TypeError('private connection details', { cause: { code: 'ECONNRESET' } }));
    const response = await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher);
    expect(response).toMatchObject({ outcome: 'network_error', status: null, transport: {
      phase: 'headers', timedOut: false, redirectCount: 1, errorCode: 'ECONNRESET', errorName: 'TypeError',
    } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(response)).not.toContain('private connection details');
    const unknown = await fetchTescoCollectedPage(tescoProductUrl(sku), vi.fn<typeof fetch>().mockRejectedValue({ code: 'sensitive unknown value' }));
    expect(unknown.transport).toMatchObject({ errorName: 'UnknownError', errorCode: null });
  });
  it('skips only missing resources and permanent Irish-homepage redirects, retaining denial stops', async () => {
    for (const status of [404, 410]) {
      const response = await fetchTescoCollectedPage(tescoProductUrl(sku), vi.fn<typeof fetch>().mockResolvedValue(new Response('Missing', { status })));
      expect(tescoResourceUnavailable(response)).toBe(true);
      expect(tescoResourceUnavailable({ ...response, retryAfter: '600' })).toBe(false);
      const challenge = await fetchTescoCollectedPage(tescoProductUrl(sku), vi.fn<typeof fetch>().mockResolvedValue(new Response('<title>Access Denied</title>', { status })));
      expect(tescoResourceUnavailable(challenge)).toBe(false);
    }
    for (const [location, status, skippable] of [
      ['https://www.tesco.ie/shop/en-IE/', 301, true],
      ['https://www.tesco.ie/shop/en-IE/', 302, false],
      ['https://www.tesco.ie/shop/en-IE/browse/frozen-food/vegetables/steamed-vegetables-rice-and-pasta', 301, true],
      ['https://www.tesco.ie/shop/en-IE/browse/fresh-food/fruit', 301, true],
      ['https://www.tesco.ie/shop/en-IE/browse/fruit?challenge=1', 301, false],
      ['https://www.tesco.ie/shop/en-IE/browse/security-check', 301, false],
      ['https://www.tesco.ie/shop/en-IE/browse/fruit', 302, false],
      ['https://www.tesco.ie/account/login', 301, false],
      ['https://example.com/', 301, false],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status, headers: { location } }));
      const response = await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher);
      expect(tescoResourceUnavailable(response)).toBe(skippable);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('does not retry 403, even without a recognizable challenge body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher)).outcome).toBe('access_block');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry 429 and retains Retry-After', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Slow down', { status: 429, headers: { 'Retry-After': '7200' } }));
    expect(await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher)).toMatchObject({ outcome: 'rate_limited', retryAfter: '7200' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('detects a challenge returned with HTTP 200', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<title>Access Denied</title>', { status: 200 }));
    expect((await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher)).outcome).toBe('access_block');
  });
  it('rejects cross-origin and login redirects without sending a second request', async () => {
    for (const location of ['https://example.com/', 'https://www.tesco.ie/account/login']) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
      expect((await fetchTescoCollectedPage(tescoProductUrl(sku), fetcher)).outcome).toBe('unsafe_redirect');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('keeps 48h challenge quarantine and honors longer Retry-After values', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(tescoPauseUntil('access_block', '60', now)).toBe('2026-10-01T10:00:00.000Z');
    expect(tescoPauseUntil('rate_limited', '7200', now)).toBe('2026-09-29T12:00:00.000Z');
    expect(tescoPauseUntil('rate_limited', 'Tue, 29 Sep 2026 14:00:00 GMT', now)).toBe('2026-09-29T14:00:00.000Z');
    expect(tescoPauseUntil('access_block', '259200', now)).toBe('2026-10-02T10:00:00.000Z');
    expect(tescoPauseUntil('rate_limited', 'nonsense', now)).toBe('2026-09-29T10:15:00.000Z');
  });
});

