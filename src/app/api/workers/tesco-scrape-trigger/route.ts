import { send } from '@vercel/queue';
import {
  createTescoScrapeRun,
  selectTescoProducts,
  TransientTescoError,
  type TescoBatchMessage,
} from '@/lib/tesco-queue-worker';
import { processTescoProductDirect } from '@/lib/tesco-direct-worker';
import {
  claimTescoEgress,
  markTescoEgressBlocked,
  markTescoEgressSuccess,
  releaseTescoEgress,
} from '@/lib/tesco-egress';
import { supabaseAdmin } from '@/lib/supabase';

const TOPIC = 'tesco-scrape-batches';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  return Boolean(secret && auth === `Bearer ${secret}`);
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function failRun(runUuid: string, summary: string) {
  await supabaseAdmin
    .from('scrape_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      threshold_breached: true,
      error_summary: summary.slice(0, 500),
    })
    .eq('id', runUuid);
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.TESCO_VERCEL_WORKER_ENABLED !== 'true') {
    return Response.json({ error: 'Worker disabled' }, { status: 503 });
  }

  if (!process.env.CRON_SECRET) {
    console.error('[tesco-scrape-trigger] CRON_SECRET is not configured');
    return Response.json({ error: 'Worker misconfigured' }, { status: 503 });
  }

  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[tesco-scrape-trigger] SUPABASE_SERVICE_ROLE_KEY is missing');
    return Response.json({ error: 'Worker misconfigured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const configuredLimit = parsePositiveInt(process.env.TESCO_VERCEL_RUN_LIMIT ?? null, 500, 500);
  const limit = parsePositiveInt(url.searchParams.get('limit'), configuredLimit, 500);
  const batchSize = parsePositiveInt(process.env.TESCO_VERCEL_BATCH_SIZE ?? null, 3, 10);
  const staggerSeconds = parsePositiveInt(process.env.TESCO_VERCEL_BATCH_STAGGER_SECONDS ?? null, 20, 300);
  const query = url.searchParams.get('q')?.trim() || undefined;

  // The pool is deliberately empty until a real, controllable egress identity
  // (for example Vercel Static IP in dub1) has been provisioned and approved.
  // Claiming before even selecting/queuing prevents accidental use of ordinary
  // Vercel egress and enforces the configured cooldown.
  const lease = await claimTescoEgress(180);
  if (!lease) {
    return Response.json({
      error: 'No Tesco egress identity is currently available',
      status: 'cooldown_or_unconfigured',
    }, { status: 503 });
  }

  let runUuid: string | null = null;
  try {
    const products = await selectTescoProducts(limit, query);
    if (products.length === 0) {
      await releaseTescoEgress(lease.egressKey);
      return Response.json({ status: 'no_products', queued: 0 });
    }

    const runId = `vercel_tesco_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    runUuid = await createTescoScrapeRun(runId, products.length);

    // One and only one canary request path must succeed before any queue batches
    // are published. The canary is part of the run and is protected by the same
    // idempotent finalisation receipt as normal queue work.
    const canary = products[0];
    const canaryMessage: TescoBatchMessage = {
      runUuid,
      runId,
      batchIndex: -1,
      totalBatches: Math.ceil(Math.max(0, products.length - 1) / batchSize),
      products: [canary],
    };

    try {
      await processTescoProductDirect(canaryMessage, canary);
      await markTescoEgressSuccess(lease.egressKey);
    } catch (error) {
      if (error instanceof TransientTescoError && error.reason === 'blocked_challenge') {
        await markTescoEgressBlocked(lease.egressKey, 48);
        await failRun(runUuid, `Tesco egress ${lease.label} blocked during canary; quarantined for 48 hours`);
        return Response.json({
          error: 'Tesco egress blocked during canary',
          status: 'blocked',
          egress: lease.label,
          cooldown_hours: 48,
          run_id: runId,
        }, { status: 503 });
      }

      await releaseTescoEgress(lease.egressKey);
      const message = error instanceof Error ? error.message : String(error);
      await failRun(runUuid, `Tesco canary transport failed on ${lease.label}: ${message}`);
      return Response.json({
        error: 'Tesco canary failed',
        status: 'transport_failure',
        egress: lease.label,
        run_id: runId,
      }, { status: 503 });
    }

    const remaining = products.slice(1);
    if (remaining.length === 0) {
      return Response.json({
        status: 'canary_complete',
        transport: 'direct_controlled_egress',
        run_id: runId,
        run_uuid: runUuid,
        target_count: 1,
        queued: 0,
        egress: lease.label,
        filter: query ?? null,
      });
    }

    const totalBatches = Math.ceil(remaining.length / batchSize);
    let queued = 0;

    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        const batch: TescoBatchMessage = {
          runUuid,
          runId,
          batchIndex,
          totalBatches,
          products: remaining.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
        };

        await send(TOPIC, batch, {
          idempotencyKey: `${runUuid}:${batchIndex}`,
          retentionSeconds: 86_400,
          delaySeconds: batchIndex * staggerSeconds,
        });
        queued += batch.products.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[tesco-scrape-trigger] queue publish failed', { runId, queued, message });
      await failRun(runUuid, `Queue publish failed after ${queued}/${remaining.length} queued products: ${message}`);
      return Response.json({ error: 'Queue publish failed', run_id: runId, queued }, { status: 502 });
    }

    console.log('[tesco-scrape-trigger] canary passed; queued controlled-egress run', {
      runId,
      egress: lease.label,
      target: products.length,
      queued,
      batches: totalBatches,
      batchSize,
      staggerSeconds,
      query: query ?? null,
    });

    return Response.json({
      status: 'queued',
      transport: 'direct_controlled_egress',
      canary: 'passed',
      egress: lease.label,
      run_id: runId,
      run_uuid: runUuid,
      target_count: products.length,
      batches_enqueued: totalBatches,
      queued_after_canary: queued,
      batch_size: batchSize,
      stagger_seconds: staggerSeconds,
      filter: query ?? null,
    });
  } catch (error) {
    await releaseTescoEgress(lease.egressKey).catch(() => undefined);
    if (runUuid) {
      const message = error instanceof Error ? error.message : String(error);
      await failRun(runUuid, `Tesco trigger failed before queueing: ${message}`).catch(() => undefined);
    }
    throw error;
  }
}

export async function POST(): Promise<Response> {
  return Response.json({ error: 'Method not allowed; use GET' }, { status: 405 });
}
