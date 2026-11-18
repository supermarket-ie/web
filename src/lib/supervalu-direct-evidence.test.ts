import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/retailer-request-governor', () => ({ withRetailerRequestSlot: vi.fn(), parseRetryAfterMs: vi.fn() }));
vi.mock('@/lib/queue', () => ({ send: vi.fn() }));

import { directPageEvidence, type SupervaluQueueProduct } from './supervalu-direct-worker-base';

const sku = '1020898000', title = 'Schwartz Chilli Powder Mild  (38 g)';
const storeUrl = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/schwartz-chilli-powder-mild-38-g-id-${sku}`;
const body = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify({ product: { sku, name: title, price: { amount: 3.4 } } })}; window.__X__ = {};</script>`;
const product: SupervaluQueueProduct = { storeProductId: 'sp', canonicalName: 'Chilli Powder', storeProductName: title, storeUrl, storeSku: sku, previousPrice: 3.4 };
const candidate = { name: title, sku, price: 3.4, wasPrice: null, onPromotion: false };
const args = { finalUrl: storeUrl, contentType: 'text/html', body };

describe('SuperValu direct-page evidence retention guard', () => {
  it('the daily refresh (no captureEvidence) never retains a ~1.5 MB page body', () => {
    expect(directPageEvidence(product, candidate, args)).toBeNull();
    expect(directPageEvidence({ ...product, captureEvidence: false }, candidate, args)).toBeNull();
  });
  it('an explicit evidence run retains a captured_product bound to the mapped SKU', () => {
    expect(directPageEvidence({ ...product, captureEvidence: true }, candidate, args)).toMatchObject({ source_kind: 'captured_product', sku, store: 'supervalu' });
  });
  it('a redirect still never yields captured_product, even on an evidence run', () => {
    const redirected = directPageEvidence({ ...product, captureEvidence: true }, candidate, { ...args, finalUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/home' });
    expect(redirected?.source_kind).toBe('captured_listing');
  });
});

describe('SuperValu identity observations (durable pair approvals)', () => {
  it('every direct product page yields a lightweight observation, even on the daily refresh', async () => {
    const { directPageObservation } = await import('./supervalu-direct-worker-base');
    expect(directPageObservation(product, candidate, args)).toMatchObject({ source_kind: 'captured_product', sku, store: 'supervalu', product_url: storeUrl });
  });
  it('a redirected page is not an observation', async () => {
    const { directPageObservation } = await import('./supervalu-direct-worker-base');
    expect(directPageObservation(product, candidate, { ...args, finalUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/home' })).toBeNull();
  });
  it('the observation row carries the hash and identity but never the page body', async () => {
    const insert = vi.fn(async (row: Record<string, unknown>) => { void row; return { error: null }; });
    vi.resetModules();
    vi.doMock('./supabase', () => ({ supabaseAdmin: { from: () => ({ insert }) } }));
    const { recordIdentityObservation } = await import('./retailer-identity-retention');
    const { directPageObservation } = await import('./supervalu-direct-worker-base');
    await recordIdentityObservation(directPageObservation(product, candidate, args), 'run', 'sp');
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ store_product_id: 'sp', sku, source_kind: 'captured_product', body_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(row).not.toHaveProperty('body_text');
    vi.doUnmock('./supabase');
  });
});
