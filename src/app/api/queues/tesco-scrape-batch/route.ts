import { handleCallback } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';
import {
  TransientTescoError,
  finalizePermanentFailure,
  processTescoProduct,
  type TescoBatchMessage,
} from '@/lib/tesco-queue-worker';

const MAX_TRANSIENT_DELIVERIES = 4;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordRetryAttempt(message: TescoBatchMessage, error: TransientTescoError, deliveryCount: number) {
  const { error: rpcError } = await supabaseAdmin.rpc('record_tesco_scrape_attempt', {
    p_run_uuid: message.runUuid,
    p_store_product_id: error.product.storeProductId,
    p_delivery_count: deliveryCount,
    p_scrapingbee_requests: error.scrapingbeeRequests,
    p_scrapingbee_credits: error.scrapingbeeCredits,
  });
  if (rpcError) throw new Error(`Failed recording Tesco retry attempt: ${rpcError.message}`);
}

async function alreadyFinalized(runUuid: string, storeProductId: string) {
  const { data, error } = await supabaseAdmin
    .from('scrape_product_receipts')
    .select('store_product_id')
    .eq('run_id', runUuid)
    .eq('store_product_id', storeProductId)
    .maybeSingle();
  if (error) throw new Error(`Failed checking Tesco idempotency receipt: ${error.message}`);
  return Boolean(data);
}

export const POST = handleCallback<TescoBatchMessage>(
  async (message, metadata) => {
    if (process.env.TESCO_VERCEL_WORKER_ENABLED !== 'true') {
      throw new Error('TESCO_VERCEL_WORKER_ENABLED is not true');
    }
    if (!process.env.SCRAPINGBEE_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Tesco queue worker credentials are not configured');
    }
    if (!message?.runUuid || !Array.isArray(message.products) || message.products.length === 0) {
      throw new Error('Invalid Tesco queue message');
    }

    const spacingMs = Math.max(500, Math.min(Number(process.env.TESCO_VERCEL_PRODUCT_SPACING_MS || 1500), 10_000));

    for (let index = 0; index < message.products.length; index += 1) {
      const product = message.products[index];

      // A queue batch can be delivered more than once. Check the durable receipt
      // before making any paid ScrapingBee request so redelivery is both safe and cheap.
      if (await alreadyFinalized(message.runUuid, product.storeProductId)) {
        console.log('[tesco-queue] skipping already-finalized product', {
          runId: message.runId,
          storeProductId: product.storeProductId,
          deliveryCount: metadata.deliveryCount,
        });
        continue;
      }

      try {
        await processTescoProduct(message, product);
      } catch (error) {
        if (error instanceof TransientTescoError) {
          if (metadata.deliveryCount < MAX_TRANSIENT_DELIVERIES) {
            await recordRetryAttempt(message, error, metadata.deliveryCount);
            console.warn('[tesco-queue] transient fetch failure; retrying batch', {
              runId: message.runId,
              batchIndex: message.batchIndex,
              storeProductId: product.storeProductId,
              deliveryCount: metadata.deliveryCount,
              reason: error.reason,
            });
            throw error;
          }

          await finalizePermanentFailure(
            message,
            product,
            `transient_exhausted_${error.reason}`,
            error.message,
            0,
            error.scrapingbeeRequests,
            error.scrapingbeeCredits,
            'fetching',
          );
          console.warn('[tesco-queue] transient retries exhausted; product finalized as failure', {
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

    console.log('[tesco-queue] batch complete', {
      runId: message.runId,
      batchIndex: message.batchIndex,
      totalBatches: message.totalBatches,
      products: message.products.length,
      deliveryCount: metadata.deliveryCount,
    });
  },
  {
    visibilityTimeoutSeconds: 600,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(300, Math.max(20, 20 * 2 ** Math.max(0, metadata.deliveryCount - 1))),
    }),
  },
);
