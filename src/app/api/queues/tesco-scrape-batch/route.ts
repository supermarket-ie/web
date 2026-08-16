import { handleCallback } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';
import {
  TransientTescoError,
  finalizePermanentFailure,
  type TescoBatchMessage,
} from '@/lib/tesco-queue-worker';
import { processTescoProductDirect } from '@/lib/tesco-direct-worker';
import {
  claimTescoEgress,
  markTescoEgressBlocked,
  markTescoEgressSuccess,
  releaseTescoEgress,
} from '@/lib/tesco-egress';

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

async function runIsActive(runUuid: string) {
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .select('status')
    .eq('id', runUuid)
    .maybeSingle();
  if (error) throw new Error(`Failed checking Tesco run status: ${error.message}`);
  return data?.status === 'running';
}

async function failRunForBlockedEgress(runUuid: string, label: string) {
  const { error } = await supabaseAdmin
    .from('scrape_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      threshold_breached: true,
      error_summary: `Tesco egress ${label} was blocked during queued processing; quarantined for 48 hours`,
    })
    .eq('id', runUuid);
  if (error) throw new Error(`Failed marking blocked Tesco run: ${error.message}`);
}

export const POST = handleCallback<TescoBatchMessage>(
  async (message, metadata) => {
    if (process.env.TESCO_VERCEL_WORKER_ENABLED !== 'true') {
      throw new Error('TESCO_VERCEL_WORKER_ENABLED is not true');
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Tesco queue worker Supabase credential is not configured');
    }
    if (!message?.runUuid || !Array.isArray(message.products) || message.products.length === 0) {
      throw new Error('Invalid Tesco queue message');
    }

    // A previous batch may already have detected an Akamai block and failed the
    // run. In that case acknowledge this delivery without making another Tesco
    // request, so the queue drains harmlessly.
    if (!(await runIsActive(message.runUuid))) {
      console.warn('[tesco-queue] run is no longer active; suppressing batch', {
        runId: message.runId,
        batchIndex: message.batchIndex,
      });
      return;
    }

    // The egress pool is a real semaphore for the configured network identity.
    // With one Vercel Static-IP identity this serialises batches; when that
    // identity is cooling down no outbound Tesco request is made.
    const lease = await claimTescoEgress(180);
    if (!lease) {
      throw new Error('No Tesco egress identity is currently available for this batch');
    }

    const spacingMs = Math.max(500, Math.min(Number(process.env.TESCO_VERCEL_PRODUCT_SPACING_MS || 1500), 10_000));
    let blocked = false;

    try {
      for (let index = 0; index < message.products.length; index += 1) {
        const product = message.products[index];

        // A queue batch can be delivered more than once. Check the durable receipt
        // before making any outbound Tesco request so redelivery is safe and cheap.
        if (await alreadyFinalized(message.runUuid, product.storeProductId)) {
          console.log('[tesco-queue] skipping already-finalized product', {
            runId: message.runId,
            storeProductId: product.storeProductId,
            deliveryCount: metadata.deliveryCount,
          });
          continue;
        }

        try {
          await processTescoProductDirect(message, product);
        } catch (error) {
          if (error instanceof TransientTescoError) {
            if (error.reason === 'blocked_challenge') {
              blocked = true;
              await markTescoEgressBlocked(lease.egressKey, 48);
              await failRunForBlockedEgress(message.runUuid, lease.label);
              console.warn('[tesco-queue] confirmed transport block; stopping run immediately', {
                runId: message.runId,
                batchIndex: message.batchIndex,
                storeProductId: product.storeProductId,
                egress: lease.label,
              });
              return;
            }

            if (metadata.deliveryCount < MAX_TRANSIENT_DELIVERIES) {
              await recordRetryAttempt(message, error, metadata.deliveryCount);
              console.warn('[tesco-queue] transient direct-fetch failure; retrying batch', {
                runId: message.runId,
                batchIndex: message.batchIndex,
                storeProductId: product.storeProductId,
                deliveryCount: metadata.deliveryCount,
                reason: error.reason,
                egress: lease.label,
              });
              throw error;
            }

            await finalizePermanentFailure(
              message,
              product,
              `transient_exhausted_${error.reason}`,
              error.message,
              0,
              0,
              0,
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

      await markTescoEgressSuccess(lease.egressKey);
      console.log('[tesco-queue] controlled-egress batch complete', {
        runId: message.runId,
        batchIndex: message.batchIndex,
        totalBatches: message.totalBatches,
        products: message.products.length,
        deliveryCount: metadata.deliveryCount,
        egress: lease.label,
      });
    } finally {
      // mark_success / mark_blocked already clear the lease; release is
      // intentionally idempotent and leaves a block cooldown intact.
      if (!blocked) await releaseTescoEgress(lease.egressKey).catch(() => undefined);
    }
  },
  {
    visibilityTimeoutSeconds: 600,
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(300, Math.max(20, 20 * 2 ** Math.max(0, metadata.deliveryCount - 1))),
    }),
  },
);
