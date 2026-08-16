import { send } from '@vercel/queue';
import { createDunnesScrapeRun, selectDunnesProducts, type DunnesBatchMessage } from '@/lib/dunnes-queue-worker';
import { createSupervaluScrapeRun, selectSupervaluProducts, type SupervaluBatchMessage } from '@/lib/supervalu-direct-worker';
import { createAldiScrapeRun, selectAldiProducts, type AldiBatchMessage } from '@/lib/aldi-direct-worker';
import { supabaseAdmin } from '@/lib/supabase';

const SUPPORTED = ['dunnes', 'supervalu', 'aldi'] as const;
type Store = (typeof SUPPORTED)[number];

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function enabled(store: Store) {
  if (process.env.NON_TESCO_VERCEL_WORKERS_ENABLED !== 'true') return false;
  if (store === 'dunnes') return process.env.DUNNES_VERCEL_WORKER_ENABLED === 'true';
  if (store === 'supervalu') return process.env.SUPERVALU_VERCEL_WORKER_ENABLED === 'true';
  return process.env.ALDI_VERCEL_WORKER_ENABLED === 'true';
}

function parseStores(raw: string | null): Store[] {
  if (!raw) return [...SUPPORTED];
  const requested = raw.split(',').map((value) => value.trim().toLowerCase());
  return SUPPORTED.filter((store) => requested.includes(store));
}

function parseLimit(raw: string | null) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 25;
  return Math.min(Math.floor(parsed), 1000);
}

async function markPublishFailure(runUuid: string, store: Store, queued: number, target: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await supabaseAdmin.from('scrape_runs').update({
    status: 'failed',
    finished_at: new Date().toISOString(),
    error_summary: `Queue publish failed for ${store} after ${queued}/${target}: ${message.slice(0, 300)}`,
  }).eq('id', runUuid);
}

async function queueDunnes(limit: number) {
  const products = await selectDunnesProducts(limit);
  if (!products.length) return { store: 'dunnes' as const, status: 'no_products', queued: 0 };
  const runId = `vercel_dunnes_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runUuid = await createDunnesScrapeRun(runId, products.length);
  const batchSize = 5;
  let queued = 0;
  try {
    for (let index = 0; index < Math.ceil(products.length / batchSize); index += 1) {
      const message: DunnesBatchMessage = {
        runUuid, runId, batchIndex: index, totalBatches: Math.ceil(products.length / batchSize),
        products: products.slice(index * batchSize, (index + 1) * batchSize),
      };
      await send('dunnes-scrape-batches', message, {
        idempotencyKey: `${runUuid}:${index}`, retentionSeconds: 86_400, delaySeconds: index * 3,
      });
      queued += message.products.length;
    }
  } catch (error) {
    await markPublishFailure(runUuid, 'dunnes', queued, products.length, error);
    throw error;
  }
  return { store: 'dunnes' as const, status: 'queued', queued, run_id: runId, run_uuid: runUuid };
}

async function queueSupervalu(limit: number) {
  const products = await selectSupervaluProducts(limit);
  if (!products.length) return { store: 'supervalu' as const, status: 'no_products', queued: 0 };
  const runId = `vercel_supervalu_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runUuid = await createSupervaluScrapeRun(runId, products.length);
  const batchSize = 3;
  let queued = 0;
  try {
    for (let index = 0; index < Math.ceil(products.length / batchSize); index += 1) {
      const message: SupervaluBatchMessage = {
        runUuid, runId, batchIndex: index, totalBatches: Math.ceil(products.length / batchSize),
        products: products.slice(index * batchSize, (index + 1) * batchSize),
      };
      await send('supervalu-scrape-batches', message, {
        idempotencyKey: `${runUuid}:${index}`, retentionSeconds: 86_400, delaySeconds: index * 2,
      });
      queued += message.products.length;
    }
  } catch (error) {
    await markPublishFailure(runUuid, 'supervalu', queued, products.length, error);
    throw error;
  }
  return { store: 'supervalu' as const, status: 'queued', queued, run_id: runId, run_uuid: runUuid };
}

async function queueAldi(limit: number) {
  const products = await selectAldiProducts(limit);
  if (!products.length) return { store: 'aldi' as const, status: 'no_products', queued: 0 };
  const runId = `vercel_aldi_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const runUuid = await createAldiScrapeRun(runId, products.length);
  const batchSize = 3;
  let queued = 0;
  try {
    for (let index = 0; index < Math.ceil(products.length / batchSize); index += 1) {
      const message: AldiBatchMessage = {
        runUuid, runId, batchIndex: index, totalBatches: Math.ceil(products.length / batchSize),
        products: products.slice(index * batchSize, (index + 1) * batchSize),
      };
      await send('aldi-scrape-batches', message, {
        idempotencyKey: `${runUuid}:${index}`, retentionSeconds: 86_400, delaySeconds: index * 2,
      });
      queued += message.products.length;
    }
  } catch (error) {
    await markPublishFailure(runUuid, 'aldi', queued, products.length, error);
    throw error;
  }
  return { store: 'aldi' as const, status: 'queued', queued, run_id: runId, run_uuid: runUuid };
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Worker misconfigured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const stores = parseStores(url.searchParams.get('stores'));
  if (!stores.length) return Response.json({ error: 'No supported stores requested' }, { status: 400 });
  const limit = parseLimit(url.searchParams.get('limit'));

  const results: Array<Record<string, unknown>> = [];
  for (const store of stores) {
    if (!enabled(store)) {
      results.push({ store, status: 'disabled' });
      continue;
    }
    try {
      if (store === 'dunnes') results.push(await queueDunnes(limit));
      else if (store === 'supervalu') results.push(await queueSupervalu(limit));
      else results.push(await queueAldi(limit));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ store, status: 'error', error: message.slice(0, 300) });
    }
  }

  return Response.json({ status: 'accepted', limit, stores: results });
}

export async function POST() {
  return Response.json({ error: 'Method not allowed; use GET' }, { status: 405 });
}
