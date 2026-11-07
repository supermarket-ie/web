import { handleCallback, send } from '@/lib/queue';
import { supabaseAdmin } from '@/lib/supabase';
import { publishAgentProductChange } from '@/lib/agent-events';
import {
  TransientDunnesError,
  finalizeDunnesPermanentFailure,
  processDunnesProduct,
  type DunnesBatchMessage,
} from '@/lib/dunnes-queue-worker';
import { RetailerBlockedError, backoffDelayMs, recordNetworkAttempt } from '@/lib/retailer-request-governor';

const TOPIC = 'dunnes-scrape-batches';
// Max REAL transient network attempts per product before a permanent failure.
// Counted durably per (run, product) — NOT from SQS delivery count — so paused
// redeliveries (breaker/rate-limit) never consume this budget.
const MAX_NETWORK_ATTEMPTS = 4;

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin.from('scrape_product_receipts').select('store_product_id').eq('run_id', runUuid).eq('store_product_id', storeProductId).maybeSingle();
  if (error) throw new Error(`Failed checking Dunnes idempotency receipt: ${error.message}`);
  return Boolean(data);
}

// Thrown after a paused batch has been re-enqueued as a FRESH message. The retry
// closure acknowledges (deletes) the current delivery, so the SQS receive count
// resets and a long pause can never push still-valid work to the DLQ.
class DunnesBatchRequeued extends Error {
  constructor() { super('dunnes batch re-enqueued after pause'); this.name = 'DunnesBatchRequeued'; }
}

export const POST = handleCallback<DunnesBatchMessage>(TOPIC, async (message, metadata) => {
  if (process.env.DUNNES_VERCEL_WORKER_ENABLED !== 'true') throw new Error('DUNNES_VERCEL_WORKER_ENABLED is not true');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Dunnes queue worker Supabase credential is not configured');
  if (!message?.runUuid || !Array.isArray(message.products) || message.products.length === 0) throw new Error('Invalid Dunnes queue message');
  const spacingMs = Math.max(100, Math.min(Number(process.env.DUNNES_VERCEL_PRODUCT_SPACING_MS || 300), 5_000));

  for (let index = 0; index < message.products.length; index += 1) {
    const product = message.products[index];
    if (await alreadyFinalized(message.runUuid, product.storeProductId)) continue;
    let finalized = false;
    try {
      await processDunnesProduct(message, product);
      finalized = true;
    } catch (error) {
      // Retailer paused (breaker open / rate-limit wait exhausted / governor
      // unavailable). This is NOT a product failure and made NO network request
      // for this product. Re-enqueue the remaining unfinalised products as a
      // FRESH message (idempotency receipts skip any already done) and ack this
      // delivery, so paused redeliveries never accrue toward the DLQ threshold
      // or a product's network-retry budget.
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
          console.warn('[dunnes-queue] retailer paused; re-enqueued remaining batch', { runId: message.runId, batchIndex: message.batchIndex, remaining: remaining.length, delaySeconds, retryAfterMs: error.retryAfterMs });
        }
        throw new DunnesBatchRequeued();
      }
      if (error instanceof TransientDunnesError) {
        // A REAL network attempt failed transiently. Count it durably and give
        // up only after MAX_NETWORK_ATTEMPTS genuine attempts (not deliveries).
        const attempts = await recordNetworkAttempt(message.runUuid, product.storeProductId, error.reason);
        if (attempts < MAX_NETWORK_ATTEMPTS) {
          console.warn('[dunnes-queue] transient API failure; retrying batch', { runId: message.runId, batchIndex: message.batchIndex, storeProductId: product.storeProductId, attempts, reason: error.reason });
          throw error;
        }
        await finalizeDunnesPermanentFailure(message, product, `transient_exhausted_${error.reason}`, error.message);
        finalized = true;
        console.warn('[dunnes-queue] transient retries exhausted', { runId: message.runId, storeProductId: product.storeProductId, attempts, reason: error.reason });
      } else throw error;
    }

    if (finalized) {
      try {
        await publishAgentProductChange({ canonicalName: product.canonicalName, store: 'dunnes', runUuid: message.runUuid, storeProductId: product.storeProductId, previousPrice: product.previousPrice, observedPrice: null });
      } catch (eventError) {
        console.error('[dunnes-agent-event] publish failed', { canonicalName: product.canonicalName, storeProductId: product.storeProductId, error: eventError instanceof Error ? eventError.message : String(eventError) });
      }
    }
    if (index + 1 < message.products.length) await sleep(spacingMs);
  }
  console.log('[dunnes-queue] batch complete', { runId: message.runId, batchIndex: message.batchIndex, totalBatches: message.totalBatches, products: message.products.length, deliveryCount: metadata.deliveryCount });
}, {
  visibilityTimeoutSeconds: 300,
  retry: (error, metadata) => {
    // Paused batch already re-enqueued as a fresh message: ACK this delivery so
    // its receive count cannot climb toward the DLQ threshold.
    if (error instanceof DunnesBatchRequeued) {
      return { acknowledge: true };
    }
    // A transient network failure: honour a server Retry-After when present
    // (up to SQS's 900s delivery cap) else exponential — both jittered so a
    // cohort of failing batches does not retry in lock-step.
    const retryAfterMs = error instanceof TransientDunnesError ? error.retryAfterMs : null;
    const capMs = retryAfterMs != null ? 900_000 : 180_000;
    const seconds = Math.ceil(backoffDelayMs({ attempt: metadata.deliveryCount, retryAfterMs, baseMs: 10_000, capMs }) / 1000);
    return { afterSeconds: Math.max(10, seconds) };
  },
});
