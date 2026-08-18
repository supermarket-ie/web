import { handleCallback } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';
import { publishAgentProductChange } from '@/lib/agent-events';
import {
  TransientSupervaluError,
  finalizeSupervaluPermanentFailure,
  processSupervaluProduct,
  type SupervaluBatchMessage,
} from '@/lib/supervalu-direct-worker';

const MAX_TRANSIENT_DELIVERIES = 4;
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin.from('scrape_product_receipts').select('store_product_id').eq('run_id', runUuid).eq('store_product_id', storeProductId).maybeSingle();
  if (error) throw new Error(`Failed checking SuperValu idempotency receipt: ${error.message}`);
  return Boolean(data);
}

export const POST = handleCallback<SupervaluBatchMessage>(async (message, metadata) => {
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
      if (error instanceof TransientSupervaluError) {
        if (metadata.deliveryCount < MAX_TRANSIENT_DELIVERIES) {
          console.warn('[supervalu-queue] transient direct-fetch failure; retrying batch', { runId: message.runId, batchIndex: message.batchIndex, storeProductId: product.storeProductId, deliveryCount: metadata.deliveryCount, reason: error.reason });
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
}, { visibilityTimeoutSeconds: 300, retry: (_error, metadata) => ({ afterSeconds: Math.min(180, Math.max(10, 10 * 2 ** Math.max(0, metadata.deliveryCount - 1))) }) });
