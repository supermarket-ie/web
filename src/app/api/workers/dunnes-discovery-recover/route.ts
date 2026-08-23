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

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from('scrape_runs')
    .select('id, run_id, target_count, attempted_count, status')
    .eq('store', 'dunnes')
    .eq('retrieval_method', 'dunnes_usage_ranked_discovery_queue')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) return Response.json({ error: runError.message }, { status: 500 });
  if (!run) return Response.json({ status: 'no_running_discovery' });

  const targetCount = Math.max(1, Number(run.target_count ?? 250));
  const { data: selected, error: targetError } = await supabaseAdmin.rpc('select_dunnes_discovery_targets', {
    p_limit: targetCount,
    p_offset: 0,
  });
  if (targetError) return Response.json({ error: targetError.message }, { status: 500 });

  const { data: receipts, error: receiptError } = await supabaseAdmin
    .from('dunnes_discovery_receipts')
    .select('product_id')
    .eq('run_id', run.id);
  if (receiptError) return Response.json({ error: receiptError.message }, { status: 500 });

  const completed = new Set((receipts ?? []).map(row => row.product_id));
  const missing = ((selected ?? []) as Target[]).filter(target => !completed.has(target.product_id));

  if (!missing.length) {
    return Response.json({ status: 'no_missing_products', run_id: run.run_id, attempted_count: run.attempted_count });
  }

  const delayStepSeconds = 4;
  const totalBatches = missing.length;
  let queued = 0;

  for (let i = 0; i < missing.length; i += 1) {
    const message: Message = {
      runUuid: run.id,
      runId: run.run_id,
      batchIndex: i,
      totalBatches,
      targets: [missing[i]],
    };
    await send(TOPIC, message, {
      idempotencyKey: `${run.id}:recovery:${missing[i].product_id}`,
      retentionSeconds: 86_400,
      delaySeconds: i * delayStepSeconds,
    });
    queued += 1;
  }

  return Response.json({
    status: 'recovery_queued',
    run_id: run.run_id,
    run_uuid: run.id,
    already_completed: completed.size,
    missing_count: missing.length,
    queued,
    stagger_seconds: delayStepSeconds,
  });
}
