import { createClient } from '@supabase/supabase-js';
import { getStalePrices, FRESHNESS_TARGETS } from '@/lib/scrape-health';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STORES = ['tesco', 'supervalu', 'dunnes', 'aldi'] as const;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.ADMIN_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const t30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Last 8 runs per store (4 weeks of Mon/Thu = 8 runs)
  const runsPerStore: Record<string, unknown[]> = {};
  await Promise.all(
    STORES.map(async (store) => {
      const { data } = await supabase
        .from('scrape_runs')
        .select('*')
        .eq('store', store)
        .order('started_at', { ascending: false })
        .limit(8);
      runsPerStore[store] = data ?? [];
    })
  );

  // 2. Top 20 most frequent failures in last 30 days
  const { data: failureRows } = await supabase
    .from('scrape_failures')
    .select('canonical_name, store, failure_reason, is_retryable')
    .gte('created_at', t30d);

  // Group and count
  const failureCounts = new Map<string, { count: number; is_retryable: boolean; store: string; failure_reason: string; canonical_name: string }>();
  for (const f of failureRows ?? []) {
    const key = `${f.canonical_name}::${f.store}::${f.failure_reason}`;
    if (!failureCounts.has(key)) {
      failureCounts.set(key, {
        count: 0,
        canonical_name: f.canonical_name,
        store: f.store,
        failure_reason: f.failure_reason,
        is_retryable: f.is_retryable,
      });
    }
    failureCounts.get(key)!.count++;
  }
  const topFailures = Array.from(failureCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // 3. Freshness — stale product counts per store
  const freshness: Record<string, { stale_count: number; target_days: number; oldest_price: string | null }> = {};
  await Promise.all(
    STORES.map(async (store) => {
      const targetDays = FRESHNESS_TARGETS[store] ?? 7;
      const { count, oldest } = await getStalePrices(store, targetDays);
      freshness[store] = {
        stale_count: count,
        target_days: targetDays,
        oldest_price: oldest ? oldest.toISOString() : null,
      };
    })
  );

  // 4. Threshold breaches in last 30 days
  const { data: breaches } = await supabase
    .from('scrape_runs')
    .select('run_id, store, started_at, coverage_pct, threshold_pct')
    .eq('threshold_breached', true)
    .gte('started_at', t30d)
    .order('started_at', { ascending: false });

  return Response.json({
    generated_at: now.toISOString(),
    runs: runsPerStore,
    top_failures: topFailures,
    freshness,
    threshold_breaches: breaches ?? [],
  });
}
