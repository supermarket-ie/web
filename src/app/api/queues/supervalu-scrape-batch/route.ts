import { handleCallback, send } from '@/lib/queue';
import { supabaseAdmin } from '@/lib/supabase';
import { publishAgentProductChange } from '@/lib/agent-events';
import {
  TransientSupervaluError,
  finalizeSupervaluPermanentFailure,
  processSupervaluProduct,
  type SupervaluBatchMessage,
} from '@/lib/supervalu-direct-worker';
import { RetailerBlockedError, backoffDelayMs, recordNetworkAttempt } from '@/lib/retailer-request-governor';

const TOPIC = 'supervalu-scrape-batches';
// Max REAL transient network attempts per product before a permanent failure,
// counted durably per (run, product) — NOT from SQS delivery count.
const MAX_NETWORK_ATTEMPTS = 4;

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin.from('scrape_product_receipts').select('store_product_id').eq('run_id', runUuid).eq('store_product_id', storeProductId).maybeSingle();
  if (error) throw new Error(`Failed checking SuperValu idempotency receipt: ${error.message}`);
  return Boolean(data);
}

// Thrown after a paused batch has been re-enqueued as a FRESH message; the retry
// closure acknowledges this delivery so paused redeliveries never DLQ valid work.
class SupervaluBatchRequeued extends Error {
  constructor() { super('supervalu batch re-enqueued after pause'); this.name = 'SupervaluBatchRequeued'; }
}

export const POST = handleCallback<SupervaluBatchMessage>(TOPIC, async (message, metadata) => {
  if (process.env.SUPERVALU_VERCEL_WORKER_ENABLED !== 'true') throw new Error('SUPERVALU_VERCEL_WORKER_ENABLED is not true');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SuperValu queue worker Supabase credential is not configured');
  if (!message?.runUuid || !Array.isArray(message.products) || message.products.length === 0) throw new Error('Invalid SuperValu queue message');
  const spacingMs = Math.max(200, Math.min(Number(process.env.SUPERVALU_VERCEL_PRODUCT_SPACING_MS || 750), 5_000));

  for (let index = 0; index < message.products.length; index += 1) {
    const product = message.products[index];
    if (await alreadyFinalized(message.runUuid, product.storeProductId)) continue;
    let finalized = false;
    try {
      await processSupervaluProduct(message, product);
      finalized = true;
    } catch (error) {
      // Retailer paused (breaker open / rate-limit wait / governor unavailable):
      // NOT a product failure and NO network request made. Re-enqueue the
      // remaining unfinalised products as a FRESH message and ack this delivery,
      // so paused redeliveries never accrue toward the DLQ or the per-product
      // network-retry budget.
      if (error instanceof RetailerBlockedError) {
        const remaining: typeof message.products = [];
        for (let j = index; j < message.products.length; j += 1) {
          const p = message.products[j];
          if (!(await alreadyFinalized(message.runUuid, p.storeProductId))) remaining.push(p);
        }
        if (remaining.length > 0) {
          const delaySeconds = Math.min(900, Math.max(30, Math.ceil(error.retryAfterMs / 1000)));
          await send(TOPIC, { ...message, products: remaining }, {
            idempotencyKey: `${message.runUuid}:pause:${message.batchIndex}:${remaining[0].storeProductId}`,
            retentionSeconds: 86_400,
            delaySeconds,
          });
          console.warn('[supervalu-queue] retailer paused; re-enqueued remaining batch', { runId: message.runId, batchIndex: message.batchIndex, remaining: remaining.length, delaySeconds, retryAfterMs: error.retryAfterMs });
        }
        throw new SupervaluBatchRequeued();
      }
      if (error instanceof TransientSupervaluError) {
        // A REAL network attempt failed transiently. Count it durably and give
        // up only after MAX_NETWORK_ATTEMPTS genuine attempts (not deliveries).
        const attempts = await recordNetworkAttempt(message.runUuid, product.storeProductId, error.reason);
        if (attempts < MAX_NETWORK_ATTEMPTS) {
          console.warn('[supervalu-queue] transient direct-fetch failure; retrying batch', { runId: message.runId, batchIndex: message.batchIndex, storeProductId: product.storeProductId, attempts, reason: error.reason });
          throw error;
        }
        await finalizeSupervaluPermanentFailure(message, product, `transient_exhausted_${error.reason}`, error.message);
        finalized = true;
      } else throw error;
    }

    if (finalized) {
      try {
        await publishAgentProductChange({ canonicalName: product.canonicalName, store: 'supervalu', runUuid: message.runUuid, storeProductId: product.storeProductId, previousPrice: product.previousPrice, observedPrice: null });
      } catch (eventError) {
        console.error('[supervalu-agent-event] publish failed', { canonicalName: product.canonicalName, storeProductId: product.storeProductId, error: eventError instanceof Error ? eventError.message : String(eventError) });
      }
    }
    if (index + 1 < message.products.length) await sleep(spacingMs);
  }
  console.log('[supervalu-queue] batch complete', { runId: message.runId, batchIndex: message.batchIndex, totalBatches: message.totalBatches, products: message.products.length, deliveryCount: metadata.deliveryCount });
}, {
  visibilityTimeoutSeconds: 300,
  retry: (error, metadata) => {
    if (error instanceof SupervaluBatchRequeued) {
      return { acknowledge: true };
    }
    const retryAfterMs = error instanceof TransientSupervaluError ? error.retryAfterMs : null;
    const capMs = retryAfterMs != null ? 900_000 : 180_000;
    const seconds = Math.ceil(backoffDelayMs({ attempt: metadata.deliveryCount, retryAfterMs, baseMs: 10_000, capMs }) / 1000);
    return { afterSeconds: Math.max(10, seconds) };
  },
});
