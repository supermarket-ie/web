import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ selectDunnes: vi.fn(), selectSupervalu: vi.fn(), createRun: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/queue', () => ({ send: mock.send }));
vi.mock('@/lib/preview-guard', () => ({ retailerCollectionBlocked: () => false }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/dunnes-queue-worker-fixed', () => ({
  selectDunnesProducts: mock.selectDunnes, createDunnesScrapeRun: mock.createRun,
}));
vi.mock('@/lib/supervalu-direct-worker-fixed', () => ({
  selectSupervaluProducts: mock.selectSupervalu, createSupervaluScrapeRun: mock.createRun,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  for (const store of ['DUNNES', 'SUPERVALU']) {
    vi.stubEnv(`${store}_VERCEL_WORKER_ENABLED`, 'true');
    vi.stubEnv(`${store}_VERCEL_BATCH_SIZE`, '');
    vi.stubEnv(`${store}_VERCEL_BATCH_STAGGER_SECONDS`, '');
  }
  mock.createRun.mockResolvedValue('run-uuid');
  mock.send.mockResolvedValue({ messageId: 'message-id' });
});
afterEach(() => vi.unstubAllEnvs());

describe('daily full-inventory producers', () => {
  it.each([['supervalu', 1851], ['dunnes', 1053]] as const)(
    'queues every selected %s product exactly once, including products after 1,000', async (store, count) => {
      const products = Array.from({ length: count }, (_, i) => ({ storeProductId: `product-${i}` }));
      const selector = store === 'supervalu' ? mock.selectSupervalu : mock.selectDunnes;
      selector.mockResolvedValue(products);
      const { GET } = store === 'supervalu'
        ? await import('@/app/api/workers/supervalu-scrape-trigger/route')
        : await import('@/app/api/workers/dunnes-scrape-trigger/route');
      const response = await GET(new Request(`https://example.com/api/workers/${store}-scrape-trigger?limit=2500&scope=scheduled_full`, {
        headers: { authorization: 'Bearer test-secret' },
      }));
      expect(response.status).toBe(200);
      expect(selector).toHaveBeenCalledWith(2500, undefined, undefined);
      expect(await response.json()).toMatchObject({ target_count: count, run_scope: 'scheduled_full' });
      const queued = mock.send.mock.calls.flatMap((call) => call[1].products);
      expect(queued).toEqual(products);
      expect(new Set(queued.map((p) => p.storeProductId)).size).toBe(count);
      expect(mock.createRun).toHaveBeenCalledWith(expect.any(String), count, 'scheduled_full');
    },
  );

  it('still rejects an unauthenticated full refresh before selecting or queuing', async () => {
    const { GET } = await import('@/app/api/workers/supervalu-scrape-trigger/route');
    const response = await GET(new Request('https://example.com/?limit=2500&scope=scheduled_full'));
    expect(response.status).toBe(401);
    expect(mock.selectSupervalu).not.toHaveBeenCalled();
    expect(mock.send).not.toHaveBeenCalled();
  });
});
