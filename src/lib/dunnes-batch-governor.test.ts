import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetailerBlockedError } from './retailer-request-governor';
import { TransientDunnesError } from './dunnes-queue-worker-base';

// Mock the worker internals and collaborators the batch route calls.
const mock = vi.hoisted(() => ({
  process: vi.fn(),
  permanentFail: vi.fn(),
  send: vi.fn().mockResolvedValue({ messageId: 'requeued' }),
  attempts: new Map<string, number>(),
}));
vi.mock('@/lib/dunnes-queue-worker', () => ({
  TransientDunnesError,
  processDunnesProduct: mock.process,
  finalizeDunnesPermanentFailure: mock.permanentFail,
}));
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
  },
}));
vi.mock('@/lib/agent-events', () => ({ publishAgentProductChange: vi.fn().mockResolvedValue(undefined) }));
// handleCallback registers the consumer; send is used for the pause re-enqueue.
vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('./queue')>('./queue');
  return { ...actual, send: mock.send };
});
// Count REAL network attempts durably, keyed per product, in-memory for the test.
vi.mock('./retailer-request-governor', async () => {
  const actual = await vi.importActual<typeof import('./retailer-request-governor')>('./retailer-request-governor');
  return {
    ...actual,
    recordNetworkAttempt: vi.fn(async (_run: string, productId: string) => {
      const n = (mock.attempts.get(productId) ?? 0) + 1;
      mock.attempts.set(productId, n);
      return n;
    }),
  };
});

import { getConsumer } from './queue/registry';

function message(products = [{ storeProductId: 'p1', canonicalName: 'Milk', storeProductName: 'Milk', storeUrl: null, storeSku: null, previousPrice: null }]) {
  return { runUuid: 'run-uuid', runId: 'run', batchIndex: 0, totalBatches: 1, products };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.attempts.clear();
  mock.send.mockResolvedValue({ messageId: 'requeued' });
  vi.stubEnv('QUEUE_BACKEND', 'sqs');
  vi.stubEnv('DUNNES_VERCEL_WORKER_ENABLED', 'true');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('DUNNES_VERCEL_PRODUCT_SPACING_MS', '0');
});
afterEach(() => vi.unstubAllEnvs());

describe('dunnes batch route — pause re-enqueue and network-attempt exhaustion', () => {
  it('on pause: re-enqueues remaining products as a fresh message, acks this delivery, and does NOT finalise a product', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    mock.process.mockRejectedValueOnce(new RetailerBlockedError('dunnes', 300_000, 6));

    // The handler throws a requeue sentinel; the retry closure maps it to ack.
    await expect(consumer.handler(message(), { deliveryCount: 1, messageId: 'm1' })).rejects.toBeTruthy();
    expect(mock.send).toHaveBeenCalledTimes(1); // remaining work re-enqueued fresh
    expect(mock.permanentFail).not.toHaveBeenCalled(); // never a product failure

    // retry() acknowledges the paused delivery so its receive count can't climb
    // toward the DLQ threshold.
    let thrown: unknown;
    mock.process.mockReset();
    mock.process.mockRejectedValueOnce(new RetailerBlockedError('dunnes', 300_000, 6));
    try { await consumer.handler(message(), { deliveryCount: 1, messageId: 'm1' }); } catch (e) { thrown = e; }
    const decision = consumer.options.retry!(thrown, { deliveryCount: 9, messageId: 'm1' });
    expect(decision).toEqual({ acknowledge: true });
  });

  it('paused redeliveries do NOT consume the per-product network-retry budget', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;

    // Five successive paused deliveries (high deliveryCount) -> re-enqueue each
    // time, never a permanent failure, and NO network attempts recorded.
    for (let dc = 1; dc <= 5; dc += 1) {
      mock.process.mockRejectedValueOnce(new RetailerBlockedError('dunnes', 300_000, 6));
      try { await consumer.handler(message(), { deliveryCount: dc, messageId: 'm' }); } catch { /* requeued sentinel */ }
    }
    expect(mock.permanentFail).not.toHaveBeenCalled();
    expect(mock.attempts.get('p1') ?? 0).toBe(0); // zero real attempts
  });

  it('finalises permanently only after MAX real network attempts, regardless of deliveryCount', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    const transient = new TransientDunnesError('429', message().products[0], 'http_429', 60_000);

    // deliveryCount stays 1 throughout (as if every redelivery was a fresh
    // message); only REAL attempts accumulate. Attempts 1-3 rethrow.
    for (let i = 1; i <= 3; i += 1) {
      mock.process.mockRejectedValueOnce(transient);
      await expect(consumer.handler(message(), { deliveryCount: 1, messageId: 'm' })).rejects.toBe(transient);
      expect(mock.permanentFail).not.toHaveBeenCalled();
    }
    // 4th real attempt -> permanent failure.
    mock.process.mockRejectedValueOnce(transient);
    await consumer.handler(message(), { deliveryCount: 1, messageId: 'm' });
    expect(mock.permanentFail).toHaveBeenCalledTimes(1);
    expect(mock.attempts.get('p1')).toBe(4);
  });

  it('retry() honours a long Retry-After for a transient failure (not clamped to the exponential window)', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    const transient = new TransientDunnesError('429', message().products[0], 'http_429', 600_000);
    const d = consumer.options.retry!(transient, { deliveryCount: 1, messageId: 'm' }) as { afterSeconds: number };
    expect(d.afterSeconds).toBeGreaterThanOrEqual(600);
  });
});
