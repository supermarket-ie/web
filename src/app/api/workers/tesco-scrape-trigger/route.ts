import { send } from '@vercel/queue';
import { createTescoScrapeRun, selectTescoProducts, type TescoBatchMessage } from '@/lib/tesco-queue-worker';
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

  if (!process.env.SCRAPINGBEE_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[tesco-scrape-trigger] Required server-side scraper credentials are missing');
    return Response.json({ error: 'Worker misconfigured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const configuredLimit = parsePositiveInt(process.env.TESCO_VERCEL_RUN_LIMIT ?? null, 500, 500);
  const limit = parsePositiveInt(url.searchParams.get('limit'), configuredLimit, 500);
  const batchSize = parsePositiveInt(process.env.TESCO_VERCEL_BATCH_SIZE ?? null, 3, 10);
  const staggerSeconds = parsePositiveInt(process.env.TESCO_VERCEL_BATCH_STAGGER_SECONDS ?? null, 20, 300);
  const query = url.searchParams.get('q')?.trim() || undefined;

  const products = await selectTescoProducts(limit, query);
  if (products.length === 0) {
    return Response.json({ status: 'no_products', queued: 0 });
  }

  const runId = `vercel_tesco_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runUuid = await createTescoScrapeRun(runId, products.length);
  const totalBatches = Math.ceil(products.length / batchSize);
  let queued = 0;

  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const batch: TescoBatchMessage = {
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
    console.error('[tesco-scrape-trigger] queue publish failed', { runId, queued, message });
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

  console.log('[tesco-scrape-trigger] queued run', {
    runId,
    target: products.length,
    batches: totalBatches,
    batchSize,
    staggerSeconds,
    query: query ?? null,
  });

  return Response.json({
    status: 'queued',
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
