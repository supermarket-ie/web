import { createClient } from '@supabase/supabase-js';
import { FRESHNESS_TARGETS, getStalePrices } from '@/lib/scrape-health';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const STORES = ['tesco', 'supervalu', 'dunnes', 'aldi'] as const;
const COVERAGE_STORES = ['supervalu', 'dunnes'] as const;

type CoverageRow = {
  store: string;
  catalogue_products: number;
  mapped_products: number;
  resolved_products: number;
  live_trusted_products: number;
  ever_observed_products: number;
  never_observed_products: number;
  stale_products: number;
  expiring_within_24h: number;
  demanded_units: number;
  live_demanded_units: number;
  top_100_demanded_live: number;
  live_coverage_pct: number;
  demand_coverage_pct: number;
  latest_run_id: string | null;
  latest_run_status: string | null;
  latest_run_started_at: string | null;
  latest_run_finished_at: string | null;
  latest_run_coverage_pct: number | null;
  latest_run_threshold_pct: number | null;
  latest_auxiliary_run_id: string | null;
  latest_auxiliary_run_scope: string | null;
  latest_auxiliary_run_status: string | null;
  latest_auxiliary_run_coverage_pct: number | null;
};

function isAuthorized(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(token && process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY);
}

function coverageAlerts(rows: CoverageRow[], history: Array<Record<string, unknown>>) {
  const alerts: Array<{ severity: 'warning' | 'critical'; store: string; code: string; message: string }> = [];

  for (const row of rows) {
    if (Number(row.live_coverage_pct) < 50) {
      alerts.push({
        severity: Number(row.live_coverage_pct) < 35 ? 'critical' : 'warning',
        store: row.store,
        code: 'trusted_coverage_below_target',
        message: `${row.store} trusted coverage is ${Number(row.live_coverage_pct).toFixed(1)}% versus the 50% target`,
      });
    }
    if (row.expiring_within_24h > 0) {
      alerts.push({
        severity: 'warning',
        store: row.store,
        code: 'prices_expiring_within_24h',
        message: `${row.expiring_within_24h} ${row.store} products are due to age out within 24 hours`,
      });
    }
    if (row.latest_run_status === 'degraded' || row.latest_run_status === 'failed') {
      alerts.push({
        severity: row.latest_run_status === 'failed' ? 'critical' : 'warning',
        store: row.store,
        code: 'latest_run_unhealthy',
        message: `${row.store} latest run is ${row.latest_run_status} at ${Number(row.latest_run_coverage_pct ?? 0).toFixed(1)}%`,
      });
    }

    const storeHistory = history
      .filter((item) => item.store === row.store)
      .sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
    if (storeHistory.length >= 2) {
      const current = Number(storeHistory[0].live_coverage_pct ?? 0);
      const previous = Number(storeHistory[1].live_coverage_pct ?? 0);
      if (previous - current >= 3) {
        alerts.push({
          severity: 'critical',
          store: row.store,
          code: 'coverage_regression',
          message: `${row.store} trusted coverage fell ${(previous - current).toFixed(1)} percentage points since the previous snapshot`,
        });
      }
    }
  }

  return alerts;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  const t30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const latestRunQueries = STORES.map((store) => {
    let query = supabase
      .from('scrape_runs')
      .select('*')
      .eq('store', store)
      .neq('status', 'running');
    if (store === 'supervalu' || store === 'dunnes') query = query.eq('run_scope', 'scheduled_full');
    return query.order('started_at', { ascending: false }).limit(1).maybeSingle();
  });

  const runHistoryQueries = STORES.map((store) => supabase
    .from('scrape_runs')
    .select('id, run_id, run_scope, retrieval_method, started_at, finished_at, duration_seconds, status, target_count, attempted_count, fetched, extracted, inserted, unchanged_count, failed, silently_skipped_count, coverage_pct, threshold_pct, threshold_breached, scrapingbee_requests, scrapingbee_credits, error_summary')
    .eq('store', store)
    .order('started_at', { ascending: false })
    .limit(8));

  const [
    latestRunResults,
    runHistoryResults,
    coverageResult,
    comparisonResult,
    categoriesResult,
    coverageHistoryResult,
    failuresResult,
    breachesResult,
  ] = await Promise.all([
    Promise.all(latestRunQueries),
    Promise.all(runHistoryQueries),
    supabase.from('retailer_coverage_current').select('*').order('store'),
    supabase.from('retailer_comparison_coverage_current').select('*').maybeSingle(),
    supabase.from('retailer_category_coverage_current').select('*').gte('catalogue_products', 10).order('neither_live', { ascending: false }),
    supabase.from('retailer_coverage_snapshots').select('*').gte('captured_at', t30d).order('captured_at', { ascending: false }),
    supabase.from('scrape_failures').select('run_id, canonical_name, store, failure_stage, failure_reason, is_retryable, consecutive_failures').gte('created_at', t30d),
    supabase.from('scrape_runs').select('run_id, store, run_scope, retrieval_method, started_at, coverage_pct, threshold_pct, status').eq('threshold_breached', true).gte('started_at', t30d).order('started_at', { ascending: false }),
  ]);

  const errors = [coverageResult, comparisonResult, categoriesResult, coverageHistoryResult, failuresResult, breachesResult]
    .map((result) => result.error)
    .filter(Boolean);
  if (errors.length > 0) {
    console.error('[scrape-health] failed to load observability data', errors);
    return Response.json({ error: 'Failed to load retailer coverage health' }, { status: 500 });
  }

  const latestRuns = Object.fromEntries(STORES.map((store, index) => [store, latestRunResults[index].data ?? null]));
  const runHistory = Object.fromEntries(STORES.map((store, index) => [store, runHistoryResults[index].data ?? []]));
  const failureRows = failuresResult.data ?? [];
  const failuresByStore: Record<string, Record<string, number>> = {};
  const latestRunFailures: Record<string, Record<string, number>> = {};
  const topFailureProducts: Record<string, { name: string; count: number; reason: string; retryable: boolean }[]> = {};

  for (const store of STORES) {
    const storeFailures = failureRows.filter((failure) => failure.store === store);
    failuresByStore[store] = {};
    latestRunFailures[store] = {};
    const productCounts = new Map<string, { count: number; reason: string; retryable: boolean }>();
    const latestRunUuid = (latestRuns[store] as { id?: string } | null)?.id;

    for (const failure of storeFailures) {
      failuresByStore[store][failure.failure_reason] = (failuresByStore[store][failure.failure_reason] ?? 0) + 1;
      if (latestRunUuid && failure.run_id === latestRunUuid) {
        latestRunFailures[store][failure.failure_reason] = (latestRunFailures[store][failure.failure_reason] ?? 0) + 1;
      }
      const current = productCounts.get(failure.canonical_name) ?? {
        count: 0,
        reason: failure.failure_reason,
        retryable: failure.is_retryable,
      };
      current.count += 1;
      productCounts.set(failure.canonical_name, current);
    }

    topFailureProducts[store] = [...productCounts.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  const coverage = (coverageResult.data ?? []) as CoverageRow[];
  const coverageHistory = (coverageHistoryResult.data ?? []) as Array<Record<string, unknown>>;
  const alerts = coverageAlerts(coverage, coverageHistory);
  const comparison = comparisonResult.data as { both_live_pct?: number } | null;
  if (comparison && Number(comparison.both_live_pct ?? 0) < 40) {
    alerts.push({
      severity: Number(comparison.both_live_pct ?? 0) < 30 ? 'critical' : 'warning',
      store: 'combined',
      code: 'dual_retailer_coverage_below_target',
      message: `Dual-retailer coverage is ${Number(comparison.both_live_pct ?? 0).toFixed(1)}% versus the 40% target`,
    });
  }

  const freshnessEntries = await Promise.all(STORES.map(async (store) => {
    const targetDays = FRESHNESS_TARGETS[store] ?? 7;
    const stale = await getStalePrices(store, targetDays);
    return [store, {
      stale_count: stale.count,
      target_days: targetDays,
      oldest_price: stale.oldest?.toISOString() ?? null,
    }] as const;
  }));
  const tescoRuns = (runHistory.tesco ?? []) as Array<{ scrapingbee_requests?: number | null; scrapingbee_credits?: number | null }>;

  return Response.json({
    generated_at: now.toISOString(),
    health: Object.fromEntries(STORES.map((store) => [store, (latestRuns[store] as { status?: string } | null)?.status ?? 'unknown'])),
    alerts,
    coverage,
    comparison: comparisonResult.data,
    category_coverage: categoriesResult.data ?? [],
    coverage_history: coverageHistory,
    latest_runs: latestRuns,
    latest_auxiliary_runs: Object.fromEntries(coverage.map((row) => [row.store, {
      run_id: row.latest_auxiliary_run_id,
      run_scope: row.latest_auxiliary_run_scope,
      status: row.latest_auxiliary_run_status,
      coverage_pct: row.latest_auxiliary_run_coverage_pct,
    }])),
    run_history: runHistory,
    latest_run_failures: latestRunFailures,
    failures_by_store: failuresByStore,
    top_failing_products: topFailureProducts,
    threshold_breaches: breachesResult.data ?? [],
    freshness: Object.fromEntries(freshnessEntries),
    scrapingbee: {
      runs: tescoRuns,
      total_requests_30d: tescoRuns.reduce((sum, run) => sum + (run.scrapingbee_requests ?? 0), 0),
      total_credits_30d: tescoRuns.reduce((sum, run) => sum + (run.scrapingbee_credits ?? 0), 0),
    },
    targets: {
      retailer_live_coverage_pct: 50,
      dual_retailer_coverage_pct: 40,
      top_100_demanded_live: 80,
      supervalu_run_coverage_pct: 85,
      dunnes_run_coverage_pct: 75,
      coverage_regression_points: 3,
    },
    coverage_stores: COVERAGE_STORES,
  });
}
