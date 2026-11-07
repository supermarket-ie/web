import { handleCallback } from '@/lib/queue';
import { supabaseAdmin } from '@/lib/supabase';
import { publishAgentProductChange } from '@/lib/agent-events';
import {
  TransientDunnesError,
  finalizeDunnesPermanentFailure,
  processDunnesProduct,
  type DunnesBatchMessage,
} from '@/lib/dunnes-queue-worker';
import { RetailerBlockedError, backoffDelayMs } from '@/lib/retailer-request-governor';

const MAX_TRANSIENT_DELIVERIES = 4;
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin.from('scrape_product_receipts').select('store_product_id').eq('run_id', runUuid).eq('store_product_id', storeProductId).maybeSingle();
  if (error) throw new Error(`Failed checking Dunnes idempotency receipt: ${error.message}`);
  return Boolean(data);
}

export const POST = handleCallback<DunnesBatchMessage>('dunnes-scrape-batches', async (message, metadata) => {
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
      // Circuit breaker open or rate-limit wait exhausted: the retailer is
      // paused, NOT this product failing. Redeliver the whole batch later
      // without finalising any product and without spending its network retry
      // budget. Unfinalised products are simply picked up on redelivery (the
      // idempotency receipt skips the ones already done).
      if (error instanceof RetailerBlockedError) {
        console.warn('[dunnes-queue] retailer paused; deferring batch', { runId: message.runId, batchIndex: message.batchIndex, deliveryCount: metadata.deliveryCount, retryAfterMs: error.retryAfterMs, consecutiveDenials: error.consecutiveDenials });
        throw error;
      }
      if (error instanceof TransientDunnesError) {
        if (metadata.deliveryCount < MAX_TRANSIENT_DELIVERIES) {
          console.warn('[dunnes-queue] transient API failure; retrying batch', { runId: message.runId, batchIndex: message.batchIndex, storeProductId: product.storeProductId, deliveryCount: metadata.deliveryCount, reason: error.reason });
          throw error;
        }
        await finalizeDunnesPermanentFailure(message, product, `transient_exhausted_${error.reason}`, error.message);
        finalized = true;
        console.warn('[dunnes-queue] transient retries exhausted', { runId: message.runId, storeProductId: product.storeProductId, deliveryCount: metadata.deliveryCount, reason: error.reason });
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
    // A paused retailer (breaker open / wait exhausted): defer at least the
    // breaker's own hint, so we don't re-probe before the cooldown.
    if (error instanceof RetailerBlockedError) {
      const seconds = Math.ceil(backoffDelayMs({ attempt: metadata.deliveryCount, retryAfterMs: error.retryAfterMs, baseMs: 30_000, capMs: 900_000 }) / 1000);
      return { afterSeconds: Math.max(30, seconds) };
    }
    // Honour a server Retry-After when present (up to SQS's 900s delivery cap);
    // otherwise exponential — both with jitter so a cohort of failing batches
    // does not retry in lock-step. The exponential schedule stays modest
    // (base 10s) while an explicit long Retry-After is respected rather than
    // clamped to the exponential ceiling.
    const retryAfterMs = error instanceof TransientDunnesError ? error.retryAfterMs : null;
    const capMs = retryAfterMs != null ? 900_000 : 180_000;
    const seconds = Math.ceil(backoffDelayMs({ attempt: metadata.deliveryCount, retryAfterMs, baseMs: 10_000, capMs }) / 1000);
    return { afterSeconds: Math.max(10, seconds) };
  },
});
