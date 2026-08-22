import { send } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';

const TOPIC = 'dunnes-discovery-batches';

type Target = {
  product_id: string;
  canonical_name: string;
  brand: string;
  usage_quantity?: number | null;
  usage_occurrences?: number | null;
};

type Message = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  targets: Target[];
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parsePositiveInt(url.searchParams.get('limit'), 250, 500);
  const batchSize = parsePositiveInt(url.searchParams.get('batch_size'), 5, 20);
  const staggerSeconds = parsePositiveInt(url.searchParams.get('stagger_seconds'), 2, 60);

  const { data, error } = await supabaseAdmin.rpc('select_dunnes_discovery_targets', {
    p_limit: limit,
    p_offset: 0,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const targets = (data ?? []) as Target[];
  if (!targets.length) return Response.json({ status: 'no_products', queued: 0 });

  const targetIds = targets.map(t => t.product_id).filter(Boolean);
  if (targetIds.length) {
    const { error: supersedeError } = await supabaseAdmin
      .from('store_product_alternative_candidates')
      .update({
        status: 'rejected',
        reason: 'Superseded by a newer usage-ranked Dunnes discovery pass.',
        last_seen_at: new Date().toISOString(),
      })
      .eq('store', 'dunnes')
      .eq('status', 'candidate')
      .in('product_id', targetIds);
    if (supersedeError) return Response.json({ error: supersedeError.message }, { status: 500 });
  }

  const runId = `dunnes_usage_discovery_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const { data: run, error: runError } = await supabaseAdmin
    .from('scrape_runs')
    .insert({
      run_id: runId,
      store: 'dunnes',
      started_at: new Date().toISOString(),
      target_count: targets.length,
      attempted_count: 0,
      fetched: 0,
      extracted: 0,
      inserted: 0,
      unchanged_count: 0,
      failed: 0,
      retrieval_method: 'dunnes_usage_ranked_discovery_queue',
      threshold_pct: 0,
      status: 'running',
    })
    .select('id')
    .single();
  if (runError) return Response.json({ error: runError.message }, { status: 500 });

  const totalBatches = Math.ceil(targets.length / batchSize);
  let queued = 0;
  try {
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const message: Message = {
        runUuid: run.id,
        runId,
        batchIndex,
        totalBatches,
        targets: targets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize),
      };
      await send(TOPIC, message, {
        idempotencyKey: `${run.id}:${batchIndex}`,
        retentionSeconds: 86_400,
        delaySeconds: batchIndex * staggerSeconds,
      });
      queued += message.targets.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_summary: `Queue publish failed after ${queued}/${targets.length}: ${message.slice(0, 500)}`,
    }).eq('id', run.id);
    return Response.json({ error: 'Queue publish failed', run_id: runId, queued }, { status: 502 });
  }

  return Response.json({
    status: 'queued',
    run_id: runId,
    run_uuid: run.id,
    target_count: targets.length,
    queued,
    batches_enqueued: totalBatches,
    batch_size: batchSize,
    stagger_seconds: staggerSeconds,
  });
}
