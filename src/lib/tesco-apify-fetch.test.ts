import { describe, expect, it } from 'vitest';
import { parseTescoCollectedPage } from './tesco-direct-collection-core';
import {
  renderApifyProductPage,
  verifyApifyFreshness,
  createApifyFetchPage,
  createApifyRunClient,
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
    usageIsTerminal: false,
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

describe('verifyApifyFreshness — best-available precondition + documented limitation', () => {
  // scraped_at after our submit is the BEST AVAILABLE (provider-asserted) signal,
  // NOT an independent freshness proof. There is no per-batch audit.
  const submit = '2026-11-08T18:51:18.000Z';
  const base = { requestSubmittedAt: submit, runFinishedAt: '2026-11-08T18:51:22.652Z', itemsReturned: 1 };

  it('precondition met when scraped_at is strictly after submit; carries the limitation', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:21Z', productScrapedEvents: 1 });
    expect(f.preconditionMet).toBe(true);
    expect(f.level).toBe('after_submit_asserted');
    expect(f.limitation).toMatch(/WRITES PERMITTED WITHOUT INDEPENDENTLY ESTABLISHED FRESHNESS/);
    expect(f.reason).toMatch(/provider-asserted, NOT independently verified/);
  });

  it('HOLDS when scraped_at is at/before submit (possible cached replay) — regardless of billing', () => {
    const atSubmit = verifyApifyFreshness({ ...base, scrapedAt: submit, productScrapedEvents: 1 });
    const before = verifyApifyFreshness({ ...base, scrapedAt: '2026-11-08T18:51:10Z', productScrapedEvents: 1 });
    expect(atSubmit.preconditionMet).toBe(false);
    expect(before.preconditionMet).toBe(false);
    expect(before.level).toBe('not_after_submit');
  });

  it('billing present does NOT qualify a stale timestamp', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: '2026-10-01T00:00:00Z', productScrapedEvents: 5 });
    expect(f.preconditionMet).toBe(false);
  });

  it('HOLDS when the provider returns no scraped_at', () => {
    const f = verifyApifyFreshness({ ...base, scrapedAt: null, productScrapedEvents: 1 });
    expect(f.preconditionMet).toBe(false);
    expect(f.level).toBe('no_timestamp');
  });

  it('HOLDS an implausibly-future scraped_at', () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const f = verifyApifyFreshness({ requestSubmittedAt: new Date().toISOString(), runFinishedAt: null, itemsReturned: 1, scrapedAt: future, productScrapedEvents: 1 });
    expect(f.preconditionMet).toBe(false);
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
    expect((captured as { freshness: { preconditionMet: boolean } }).freshness.preconditionMet).toBe(true);
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

describe('createApifyRunClient — outgoing provider monetary limit (maxTotalChargeUsd)', () => {
  // Capture the actual POST URL the client sends so we can assert the cap.
  function capturingFetch(postedUrls: string[]): typeof fetch {
    const runId = 'RUN'; const dsId = 'DS';
    return (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST' && u.includes('/runs')) {
        postedUrls.push(u);
        return { ok: true, json: async () => ({ data: { id: runId, defaultDatasetId: dsId, actId: 'A', status: 'SUCCEEDED', startedAt: '2026-11-09T00:00:00Z', finishedAt: '2026-11-09T00:00:01Z', usageTotalUsd: 0.0005, chargedEventCounts: { 'product-scraped': 1 } } }) } as Response;
      }
      if (u.includes(`/actor-runs/${runId}`)) {
        return { ok: true, json: async () => ({ data: { id: runId, status: 'SUCCEEDED', defaultDatasetId: dsId, actId: 'A', startedAt: '2026-11-09T00:00:00Z', finishedAt: '2026-11-09T00:00:01Z', usageTotalUsd: 0.0005, chargedEventCounts: {} } }) } as Response;
      }
      if (u.includes(`/datasets/${dsId}/items`)) {
        return { ok: true, json: async () => ([]) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  }

  it('sets maxTotalChargeUsd on the outgoing run request to the PER-CALL ceiling', async () => {
    const posted: string[] = [];
    const client = createApifyRunClient({ token: 'apify_api_x', maxItems: 1, fetchImpl: capturingFetch(posted), pollMs: 0 });
    await client.runProductUrls([URL_322], 0.002);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain('maxTotalChargeUsd=0.002');
  });

  it('a MISSING usageTotalUsd becomes null (explicitly unknown), never 0, and is not terminal', async () => {
    const runId = 'RUN'; const dsId = 'DS';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      // Note: the run objects deliberately omit usageTotalUsd.
      if (init?.method === 'POST' && u.includes('/runs')) {
        return { ok: true, json: async () => ({ data: { id: runId, defaultDatasetId: dsId, actId: 'A', status: 'SUCCEEDED', startedAt: '2026-11-09T00:00:00Z', finishedAt: '2026-11-09T00:00:01Z', chargedEventCounts: {} } }) } as Response;
      }
      if (u.includes(`/actor-runs/${runId}`)) return { ok: true, json: async () => ({ data: { id: runId, status: 'SUCCEEDED', defaultDatasetId: dsId, actId: 'A', startedAt: '2026-11-09T00:00:00Z', finishedAt: '2026-11-09T00:00:01Z', chargedEventCounts: {} } }) } as Response;
      if (u.includes(`/datasets/${dsId}/items`)) return { ok: true, json: async () => ([]) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    const client = createApifyRunClient({ token: 'apify_api_x', maxItems: 1, fetchImpl, pollMs: 0 });
    const run = await client.runProductUrls([URL_322]);
    expect(run.usageTotalUsd).toBeNull();
    expect(run.usageIsTerminal).toBe(false);
  });

  it('clamps the outgoing limit to the SMALLER of per-call and client default', async () => {
    const posted: string[] = [];
    // client default 0.5, per-call 0.002 → outgoing must be 0.002 (the smaller).
    const client = createApifyRunClient({ token: 'apify_api_x', maxItems: 1, maxTotalChargeUsd: 0.5, fetchImpl: capturingFetch(posted), pollMs: 0 });
    await client.runProductUrls([URL_322], 0.002);
    expect(posted[0]).toContain('maxTotalChargeUsd=0.002');
    expect(posted[0]).not.toContain('maxTotalChargeUsd=0.5');
  });
});

describe('createApifyFetchPage — caught provider error returns network_error with NO provider identity', () => {
  it('a thrown runProductUrls becomes network_error and emits no provider identity', async () => {
    const throwing: ApifyRunClient = { runProductUrls: async () => { throw new Error('UND_ERR_HEADERS_TIMEOUT'); } };
    let captured: unknown = null;
    const fetchPage = createApifyFetchPage({ client: throwing, onProviderIdentity: (i) => { captured = i; } });
    const res = await fetchPage(URL_322, 0.002);
    expect(res.outcome).toBe('network_error');
    expect(captured).toBeNull(); // no provider identity → collector must NOT settle an estimate
  });
});
