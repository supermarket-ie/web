import { beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.hoisted(() => vi.fn());
const createRun = vi.hoisted(() => vi.fn(async () => 'run-uuid'));
const send = vi.hoisted(() => vi.fn<(topic: string, message: unknown, options?: unknown) => Promise<undefined>>(async () => undefined));
vi.mock('@/lib/queue', () => ({ send }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/preview-guard', () => ({ retailerCollectionBlocked: () => false, RETAILER_COLLECTION_BLOCKED_REASON: 'blocked' }));
vi.mock('@/lib/supervalu-direct-worker-fixed', () => ({ selectSupervaluProducts: select, createSupervaluScrapeRun: createRun }));

import { GET } from './route';

const product = { storeProductId: 'sp', canonicalName: 'Chilli Powder', storeProductName: 'Schwartz', storeUrl: 'https://shop.supervalu.ie/x/product/y-id-1020898000', storeSku: '1020898000', previousPrice: 3.4 };
const call = (qs: string) => GET(new Request(`https://example.test/api/workers/supervalu-scrape-trigger?${qs}`, { headers: { authorization: 'Bearer secret' } }));
const queuedProducts = () => send.mock.calls.flatMap(c => (c[1] as { products: Array<Record<string, unknown>> }).products);

describe('supervalu-scrape-trigger evidence runs', () => {
  beforeEach(() => {
    process.env.SUPERVALU_VERCEL_WORKER_ENABLED = 'true';
    process.env.CRON_SECRET = 'secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    select.mockReset().mockResolvedValue([product]);
    createRun.mockClear(); send.mockClear();
  });
  it('the scheduled full run never flags evidence capture', async () => {
    const res = await call('limit=2500&scope=scheduled_full');
    expect(res.status).toBe(200);
    expect(queuedProducts().every(p => p.captureEvidence === undefined)).toBe(true);
  });
  it('a small filtered targeted evidence run flags every queued product', async () => {
    const res = await call('limit=1&q=Schwartz%20Chilli&evidence=1');
    expect(res.status).toBe(200);
    expect((await res.json()).evidence_capture).toBe(true);
    expect(queuedProducts()).toEqual([expect.objectContaining({ captureEvidence: true, storeSku: '1020898000' })]);
  });
  it.each([
    ['scheduled scope', 'limit=2500&scope=scheduled_full&evidence=1'],
    ['no filter', 'limit=5&evidence=1'],
    ['limit above 25', 'limit=26&q=Schwartz&evidence=1'],
    ['unknown value', 'limit=1&q=Schwartz&evidence=true'],
  ])('refuses evidence with %s before creating any run', async (_label, qs) => {
    const res = await call(qs);
    expect(res.status).toBe(400);
    expect(createRun).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
