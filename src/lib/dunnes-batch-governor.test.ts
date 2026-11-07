import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetailerBlockedError } from './retailer-request-governor';
import { TransientDunnesError } from './dunnes-queue-worker-base';

// Mock the worker internals the batch route calls, so we can drive specific
// outcomes (paused / transient / success) without real network or Supabase.
const mock = vi.hoisted(() => ({ process: vi.fn(), permanentFail: vi.fn(), finalizedIds: new Set<string>() }));
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

// The registry is populated as a side effect of importing the route under SQS.
import { getConsumer } from './queue/registry';

function message(products = [{ storeProductId: 'p1', canonicalName: 'Milk', storeProductName: 'Milk', storeUrl: null, storeSku: null, previousPrice: null }]) {
  return { runUuid: 'run-uuid', runId: 'run', batchIndex: 0, totalBatches: 1, products };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('QUEUE_BACKEND', 'sqs');
  vi.stubEnv('DUNNES_VERCEL_WORKER_ENABLED', 'true');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.stubEnv('DUNNES_VERCEL_PRODUCT_SPACING_MS', '0');
});
afterEach(() => vi.unstubAllEnvs());

describe('dunnes batch route — paused retailer and backoff', () => {
  it('defers the batch (rethrows) and does NOT finalise the product when the breaker is open', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    mock.process.mockRejectedValueOnce(new RetailerBlockedError('dunnes', 300_000, 6));

    await expect(consumer.handler(message(), { deliveryCount: 1, messageId: 'm1' }))
      .rejects.toBeInstanceOf(RetailerBlockedError);
    // Crucially: a paused retailer never records a product failure.
    expect(mock.permanentFail).not.toHaveBeenCalled();
  });

  it('retries a transient error within budget, then finalises as permanent only after exhaustion', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    const transient = new TransientDunnesError('429', message().products[0], 'http_429', 60_000);

    // Within budget -> rethrow (SQS will redeliver), no permanent failure.
    mock.process.mockRejectedValueOnce(transient);
    await expect(consumer.handler(message(), { deliveryCount: 1, messageId: 'm1' })).rejects.toBe(transient);
    expect(mock.permanentFail).not.toHaveBeenCalled();

    // At the delivery cap -> finalise as a permanent (retryable) failure.
    mock.process.mockRejectedValueOnce(transient);
    await consumer.handler(message(), { deliveryCount: 4, messageId: 'm1' });
    expect(mock.permanentFail).toHaveBeenCalledTimes(1);
  });

  it('retry() honours a long Retry-After hint and defers a paused batch beyond the exponential window', async () => {
    await import('@/app/api/queues/dunnes-scrape-batch/route');
    const consumer = getConsumer('dunnes-scrape-batches')!;
    const retry = consumer.options.retry!;

    // Long Retry-After (10 min) is honoured (jitter adds up to ~1s), far above
    // the plain exponential schedule for an early delivery.
    const transient = new TransientDunnesError('429', message().products[0], 'http_429', 600_000);
    const d1 = retry(transient, { deliveryCount: 1, messageId: 'm' }) as { afterSeconds: number };
    expect(d1.afterSeconds).toBeGreaterThanOrEqual(600);

    // A paused retailer defers at least 30s.
    const d2 = retry(new RetailerBlockedError('dunnes', 300_000, 6), { deliveryCount: 1, messageId: 'm' }) as { afterSeconds: number };
    expect(d2.afterSeconds).toBeGreaterThanOrEqual(300);
  });
});
