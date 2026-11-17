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
