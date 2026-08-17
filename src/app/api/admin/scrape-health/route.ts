import { createClient } from '@supabase/supabase-js';
import { getStalePrices, FRESHNESS_TARGETS } from '@/lib/scrape-health';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STORES = ['tesco', 'supervalu', 'dunnes', 'aldi'] as const;
type Store = typeof STORES[number];

export async function GET(req: Request) {
  // Auth: Bearer token matching ADMIN_API_KEY env var
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
  const t7d  = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000).toISOString();

  // ---- 1. Latest run per store (with full detail) ----
  const latestRuns: Record<string, unknown> = {};
  await Promise.all(
    STORES.map(async (store: Store) => {
      const { data } = await supabase
        .from('scrape_runs')
        .select('*')
        .eq('store', store)
        .not('status', 'eq', 'running')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      latestRuns[store] = data ?? null;
    })
  );

  // ---- 2. Run history (last 8 per store = ~4 weeks of Mon/Thu) ----
  const runHistory: Record<string, unknown[]> = {};
  await Promise.all(
    STORES.map(async (store: Store) => {
      const { data } = await supabase
        .from('scrape_runs')
        .select('run_id, retrieval_method, started_at, finished_at, duration_seconds, status, target_count, attempted_count, fetched, extracted, inserted, unchanged_count, failed, silently_skipped_count, coverage_pct, threshold_pct, threshold_breached, scrapingbee_requests, scrapingbee_credits, error_summary')
        .eq('store', store)
        .order('started_at', { ascending: false })
        .limit(8);
      runHistory[store] = data ?? [];
    })
  );

  // ---- 3. Recent failure classifications (last 30 days, grouped) ----
  const { data: failureRows } = await supabase
    .from('scrape_failures')
    .select('canonical_name, store, failure_stage, failure_reason, is_retryable, consecutive_failures')
    .gte('created_at', t30d);

  // Group by store → failure_reason → count
  const failuresByStore: Record<string, Record<string, number>> = {};
  const topFailureProducts: Record<string, { name: string; count: number; reason: string; retryable: boolean }[]> = {};

  for (const store of STORES) {
    failuresByStore[store] = {};
    const storeFailures = (failureRows ?? []).filter(f => f.store === store);

    // Reason distribution
    for (const f of storeFailures) {
      failuresByStore[store][f.failure_reason] = (failuresByStore[store][f.failure_reason] ?? 0) + 1;
    }

    // Top failing products
    const productCounts = new Map<string, { count: number; reason: string; retryable: boolean }>();
    for (const f of storeFailures) {
      if (!productCounts.has(f.canonical_name)) {
        productCounts.set(f.canonical_name, { count: 0, reason: f.failure_reason, retryable: f.is_retryable });
      }
      productCounts.get(f.canonical_name)!.count++;
    }
    topFailureProducts[store] = [...productCounts.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  // ---- 4. Threshold breaches (last 30 days) ----
  const { data: breaches } = await supabase
    .from('scrape_runs')
    .select('run_id, store, retrieval_method, started_at, coverage_pct, threshold_pct, status')
    .eq('threshold_breached', true)
    .gte('started_at', t30d)
    .order('started_at', { ascending: false });

  // ---- 5. Freshness (stale products per store) ----
  const freshness: Record<string, { stale_count: number; target_days: number; oldest_price: string | null }> = {};
  await Promise.all(
    STORES.map(async (store: Store) => {
      const targetDays = FRESHNESS_TARGETS[store] ?? 7;
      const { count, oldest } = await getStalePrices(store, targetDays);
      freshness[store] = {
        stale_count: count,
        target_days: targetDays,
        oldest_price: oldest ? oldest.toISOString() : null,
      };
    })
  );

  // ---- 6. Tesco ScrapingBee usage summary (last 30 days) ----
  const { data: sbRuns } = await supabase
    .from('scrape_runs')
    .select('run_id, started_at, scrapingbee_requests, scrapingbee_credits, coverage_pct, status')
    .eq('store', 'tesco')
    .gte('started_at', t30d)
    .not('scrapingbee_requests', 'is', null)
    .order('started_at', { ascending: false });

  const sbSummary = {
    runs: sbRuns ?? [],
    total_requests_30d: (sbRuns ?? []).reduce((s, r) => s + (r.scrapingbee_requests ?? 0), 0),
    total_credits_30d:  (sbRuns ?? []).reduce((s, r) => s + (r.scrapingbee_credits  ?? 0), 0),
  };

  // ---- 7. Overall health score ----
  // Simple: count stores with latest status = success/degraded/failed
  const healthByStore: Record<string, string> = {};
  for (const store of STORES) {
    const latest = latestRuns[store] as { status?: string; threshold_breached?: boolean } | null;
    healthByStore[store] = latest?.status ?? 'unknown';
  }

  return Response.json({
    generated_at: now.toISOString(),
    health: healthByStore,
    latest_runs: latestRuns,
    run_history: runHistory,
    failures_by_store: failuresByStore,
    top_failing_products: topFailureProducts,
    threshold_breaches: breaches ?? [],
    freshness,
    scrapingbee: sbSummary,
  });
}
