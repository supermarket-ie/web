import { handleCallback } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';
import {
  TransientDunnesError,
  finalizeDunnesPermanentFailure,
  processDunnesProduct,
  type DunnesBatchMessage,
} from '@/lib/dunnes-queue-worker';

const MAX_TRANSIENT_DELIVERIES = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin
    .from('scrape_product_receipts')
    .select('store_product_id')
    .eq('run_id', runUuid)
    .eq('store_product_id', storeProductId)
    .maybeSingle();
  if (error) throw new Error(`Failed checking Dunnes idempotency receipt: ${error.message}`);
  return Boolean(data);
}

export const POST = handleCallback<DunnesBatchMessage>(
  async (message, metadata) => {
    if (process.env.DUNNES_VERCEL_WORKER_ENABLED !== 'true') {
      throw new Error('DUNNES_VERCEL_WORKER_ENABLED is not true');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Dunnes queue worker Supabase credential is not configured');
    }
    if (!message?.runUuid || !Array.isArray(message.products) || message.products.length === 0) {
      throw new Error('Invalid Dunnes queue message');
    }

    const spacingMs = Math.max(100, Math.min(Number(process.env.DUNNES_VERCEL_PRODUCT_SPACING_MS || 300), 5_000));

    for (let index = 0; index < message.products.length; index += 1) {
      const product = message.products[index];
      if (await alreadyFinalized(message.runUuid, product.storeProductId)) continue;

      try {
        await processDunnesProduct(message, product);
      } catch (error) {
        if (error instanceof TransientDunnesError) {
          if (metadata.deliveryCount < MAX_TRANSIENT_DELIVERIES) {
            console.warn('[dunnes-queue] transient API failure; retrying batch', {
              runId: message.runId,
              batchIndex: message.batchIndex,
              storeProductId: product.storeProductId,
              deliveryCount: metadata.deliveryCount,
              reason: error.reason,
            });
            throw error;
          }

          await finalizeDunnesPermanentFailure(
            message,
            product,
            `transient_exhausted_${error.reason}`,
            error.message,
          );
          console.warn('[dunnes-queue] transient retries exhausted', {
            runId: message.runId,
            storeProductId: product.storeProductId,
            deliveryCount: metadata.deliveryCount,
            reason: error.reason,
          });
        } else {
          throw error;
        }
      }

      if (index + 1 < message.products.length) await sleep(spacingMs);
    }

    console.log('[dunnes-queue] batch complete', {
      runId: message.runId,
      batchIndex: message.batchIndex,
      totalBatches: message.totalBatches,
      products: message.products.length,
      deliveryCount: metadata.deliveryCount,
    });
  },
  {
    visibilityTimeoutSeconds: 300,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(180, Math.max(10, 10 * 2 ** Math.max(0, metadata.deliveryCount - 1))),
    }),
  },
);
