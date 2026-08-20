import { send } from '@vercel/queue';
import { createDunnesScrapeRun, selectDunnesProducts, type DunnesBatchMessage } from '@/lib/dunnes-queue-worker-fixed';
import { supabaseAdmin } from '@/lib/supabase';

const TOPIC = 'dunnes-scrape-batches';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export async function GET(request: Request): Promise<Response> {
  if (process.env.DUNNES_VERCEL_WORKER_ENABLED !== 'true') {
    return Response.json({ error: 'Worker disabled' }, { status: 503 });
  }
  if (!process.env.CRON_SECRET || !authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[dunnes-scrape-trigger] SUPABASE_SERVICE_ROLE_KEY is missing');
    return Response.json({ error: 'Worker misconfigured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const configuredLimit = parsePositiveInt(process.env.DUNNES_VERCEL_RUN_LIMIT ?? null, 50, 1000);
  const limit = parsePositiveInt(url.searchParams.get('limit'), configuredLimit, 1000);
  const batchSize = parsePositiveInt(process.env.DUNNES_VERCEL_BATCH_SIZE ?? null, 5, 20);
  const staggerSeconds = parsePositiveInt(process.env.DUNNES_VERCEL_BATCH_STAGGER_SECONDS ?? null, 3, 120);
  const query = url.searchParams.get('q')?.trim() || undefined;

  const products = await selectDunnesProducts(limit, query);
  if (products.length === 0) return Response.json({ status: 'no_products', queued: 0 });

  const runId = `vercel_dunnes_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runUuid = await createDunnesScrapeRun(runId, products.length);
  const totalBatches = Math.ceil(products.length / batchSize);
  let queued = 0;

  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const batch: DunnesBatchMessage = {
        runUuid,
        runId,
        batchIndex,
        totalBatches,
        products: products.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
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
    console.error('[dunnes-scrape-trigger] queue publish failed', { runId, queued, message });
    await supabaseAdmin
      .from('scrape_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_summary: `Queue publish failed after ${queued}/${products.length} products: ${message.slice(0, 300)}`,
      })
      .eq('id', runUuid);
    return Response.json({ error: 'Queue publish failed', run_id: runId, queued }, { status: 502 });
  }

  return Response.json({
    status: 'queued',
    transport: 'instacart_api',
    run_id: runId,
    run_uuid: runUuid,
    target_count: products.length,
    batches_enqueued: totalBatches,
    batch_size: batchSize,
    stagger_seconds: staggerSeconds,
    filter: query ?? null,
  });
}

export async function POST(): Promise<Response> {
  return Response.json({ error: 'Method not allowed; use GET' }, { status: 405 });
}
