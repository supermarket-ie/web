// Pure, testable detection for retailer-refresh health alerts.
//
// Reused by the scrape-watchdog cron (src/app/api/cron/scrape-watchdog/route.ts).
// It takes the durable observability data the watchdog already reads and returns
// a typed list of issues with severity. Keeping this pure (no I/O) makes the
// four alert conditions unit-testable:
//   1. missed_run     — an expected scheduled run (Mon/Thu) did not happen
//   2. degraded_streak— the last N scheduled_full runs were degraded/failed
//   3. coverage_expiry— trusted coverage is low or about to expire
//   4. comparison_drop— genuine three-retailer comparisons fell sharply
//
// It changes NO scraper or matching logic; it is observability only.

export type AlertSeverity = 'high' | 'medium';

export type RetailerHealthIssue = {
  store: string | null; // null for cross-retailer issues
  kind:
    | 'missed_run'
    | 'stuck_run'
    | 'failed_run'
    | 'degraded_latest'
    | 'degraded_streak'
    | 'coverage_low'
    | 'coverage_expiring'
    | 'coverage_regression'
    | 'comparison_low'
    | 'comparison_drop'
    | 'telemetry_unavailable';
  severity: AlertSeverity;
  message: string;
};

export type ScrapeRunRow = {
  id: string;
  store: string;
  run_id: string;
  status: string; // running | success | degraded | failed | timeout
  started_at: string;
  finished_at: string | null;
  coverage_pct: number | null;
  threshold_pct: number | null;
  error_summary: string | null;
  run_scope: string; // scheduled_full | targeted_validation | canary | ...
};

export type CoverageRow = {
  store: string;
  live_coverage_pct: number | null;
  expiring_within_24h: number | null;
};

export type CoverageSnapshot = {
  store: string;
  live_coverage_pct: number | null;
  captured_at: string;
};

export type ComparisonRow = { both_live_pct: number | null } | null;

export type ComparisonSnapshot = {
  // Optional history of the three-retailer (both-live) comparison percentage.
  both_live_pct: number | null;
  captured_at: string;
};

export type RetailerHealthInput = {
  now: number;
  // Stores that are ACTIVELY scheduled (derive from ENABLED EventBridge
  // schedules). A deliberately-disabled retailer (e.g. Tesco) is NOT alerted as
  // "missed", but its coverage expiry is still worth surfacing if present.
  scheduledStores: string[];
  // All stores to evaluate for coverage/health (scheduled + any with data).
  stores: string[];
  runs: ScrapeRunRow[];
  coverage: CoverageRow[];
  coverageSnapshots: CoverageSnapshot[];
  comparison: ComparisonRow;
  comparisonSnapshots?: ComparisonSnapshot[];
  telemetryUnavailable?: boolean;
};

// Tunables (conservative; documented in the alerting proposal).
export const STUCK_HOURS = 3;
export const MISSED_RUN_GRACE_HOURS = 26; // after a Mon/Thu 05:10 slot
export const DEGRADED_STREAK = 3; // consecutive scheduled_full degraded/failed
export const COVERAGE_LOW_PCT = 50;
export const COVERAGE_REGRESSION_PP = 3; // percentage-point drop between snapshots
export const COMPARISON_LOW_PCT = 40;
export const COMPARISON_DROP_PP = 10; // absolute pp fall in both_live_pct vs baseline
export const COMPARISON_DROP_REL = 0.3; // or a 30% relative fall

const HOUR = 3_600_000;
const DAY = 86_400_000;

function hoursSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / HOUR;
}

// The scheduled retailer cron is Mon & Thu 05:10 UTC. Given "now", return the
// most recent scheduled slot strictly in the past (as epoch ms), or null if the
// cadence can't be computed.
export function previousScheduledSlot(now: number, hourUtc = 5, minuteUtc = 10): number | null {
  // Walk back day by day up to 8 days to find the latest Mon(1)/Thu(4) slot < now.
  for (let back = 0; back <= 8; back += 1) {
    const d = new Date(now - back * DAY);
    const dow = d.getUTCDay(); // Sun=0, Mon=1, Thu=4
    if (dow === 1 || dow === 4) {
      const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, minuteUtc, 0, 0);
      if (slot < now) return slot;
    }
  }
  return null;
}

export function evaluateRetailerHealth(input: RetailerHealthInput): RetailerHealthIssue[] {
  const issues: RetailerHealthIssue[] = [];
  const { now, runs } = input;
  const scheduled = new Set(input.scheduledStores);

  for (const store of input.stores) {
    // scheduled_full runs for this store, newest first.
    const scheduledRuns = runs
      .filter((r) => r.store === store && r.run_scope === 'scheduled_full')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    const latest = scheduledRuns[0] ?? null;

    // 1. Missed scheduled run — only for actively-scheduled stores. Expected a
    //    run shortly after the previous Mon/Thu slot; none within the grace
    //    window => missed. This is the 29-Oct failure mode.
    if (scheduled.has(store)) {
      const slot = previousScheduledSlot(now);
      if (slot != null && now - slot <= 8 * DAY) {
        const ranForSlot = scheduledRuns.some((r) => {
          const t = new Date(r.started_at).getTime();
          return t >= slot - HOUR && t <= slot + MISSED_RUN_GRACE_HOURS * HOUR;
        });
        const pastGrace = now - slot > MISSED_RUN_GRACE_HOURS * HOUR;
        if (!ranForSlot && pastGrace) {
          issues.push({
            store,
            kind: 'missed_run',
            severity: 'high',
            message: `${store}: no scheduled_full run for the ${new Date(slot).toISOString()} slot (grace ${MISSED_RUN_GRACE_HOURS}h elapsed) — the schedule may be disabled or failing to launch`,
          });
        }
      }
    }

    if (!latest) {
      if (scheduled.has(store)) {
        issues.push({ store, kind: 'missed_run', severity: 'high', message: `${store}: no scheduled_full run on record` });
      }
      continue;
    }

    // Stuck / failed latest.
    const latestAge = hoursSince(latest.started_at, now);
    if (latest.status === 'running' && latestAge > STUCK_HOURS) {
      issues.push({ store, kind: 'stuck_run', severity: 'high', message: `${store}: run ${latest.run_id} has been running for ${latestAge.toFixed(1)}h` });
    } else if (latest.status === 'failed') {
      issues.push({ store, kind: 'failed_run', severity: 'high', message: `${store}: latest scheduled run ${latest.run_id} failed${latest.error_summary ? ` — ${latest.error_summary}` : ''}` });
    } else if (latest.status === 'degraded') {
      const cov = latest.coverage_pct == null ? 'unknown' : `${Number(latest.coverage_pct).toFixed(1)}%`;
      const thr = latest.threshold_pct == null ? 'threshold' : `${Number(latest.threshold_pct).toFixed(1)}% threshold`;
      issues.push({ store, kind: 'degraded_latest', severity: 'medium', message: `${store}: latest run ${latest.run_id} degraded — ${cov} vs ${thr}` });
    }

    // 2. Degraded/failed STREAK — the last N scheduled_full runs all unhealthy.
    //    A single degraded run is normal catalogue drift; a sustained streak is
    //    a signal. Reported once (does not double-count the latest-degraded).
    const lastN = scheduledRuns.slice(0, DEGRADED_STREAK);
    if (
      lastN.length === DEGRADED_STREAK &&
      lastN.every((r) => r.status === 'degraded' || r.status === 'failed' || r.threshold_pct != null && r.coverage_pct != null && Number(r.coverage_pct) < Number(r.threshold_pct))
    ) {
      issues.push({
        store,
        kind: 'degraded_streak',
        severity: 'high',
        message: `${store}: ${DEGRADED_STREAK} consecutive scheduled_full runs degraded/failed (${lastN.map((r) => r.status).join(', ')}) — investigate matching/catalogue drift`,
      });
    }
  }

  // Coverage + comparison telemetry.
  if (input.telemetryUnavailable) {
    issues.push({ store: null, kind: 'telemetry_unavailable', severity: 'medium', message: 'retailer coverage telemetry could not be loaded' });
  } else {
    for (const row of input.coverage) {
      const live = Number(row.live_coverage_pct ?? 0);
      if (live < COVERAGE_LOW_PCT) {
        issues.push({ store: row.store, kind: 'coverage_low', severity: live <= 0 ? 'high' : 'medium', message: `${row.store}: trusted catalogue coverage is ${live.toFixed(1)}% (target ${COVERAGE_LOW_PCT}%)` });
      }
      if (Number(row.expiring_within_24h ?? 0) > 0) {
        issues.push({ store: row.store, kind: 'coverage_expiring', severity: 'high', message: `${row.store}: ${row.expiring_within_24h} trusted prices expire within 24h` });
      }
      // 3. Coverage regression between the two most recent snapshots.
      const hist = input.coverageSnapshots
        .filter((s) => s.store === row.store)
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
      if (hist.length >= 2) {
        const drop = Number(hist[1].live_coverage_pct ?? 0) - Number(hist[0].live_coverage_pct ?? 0);
        if (drop >= COVERAGE_REGRESSION_PP) {
          issues.push({ store: row.store, kind: 'coverage_regression', severity: 'medium', message: `${row.store}: catalogue coverage fell ${drop.toFixed(1)} percentage points` });
        }
      }
    }

    // 4. Three-retailer comparison health: absolute floor AND significant decline.
    const both = input.comparison ? Number(input.comparison.both_live_pct ?? 0) : null;
    if (both != null) {
      if (both < COMPARISON_LOW_PCT) {
        issues.push({ store: null, kind: 'comparison_low', severity: both <= 0 ? 'high' : 'medium', message: `cross-retailer: only ${both.toFixed(1)}% of products are live at both retailers (target ${COMPARISON_LOW_PCT}%)` });
      }
      const snaps = (input.comparisonSnapshots ?? [])
        .slice()
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
      if (snaps.length >= 1) {
        const baseline = Number(snaps[0].both_live_pct ?? 0);
        const absDrop = baseline - both;
        const relDrop = baseline > 0 ? absDrop / baseline : 0;
        if (absDrop >= COMPARISON_DROP_PP || relDrop >= COMPARISON_DROP_REL) {
          issues.push({
            store: null,
            kind: 'comparison_drop',
            severity: 'high',
            message: `cross-retailer: three-retailer comparisons fell from ${baseline.toFixed(1)}% to ${both.toFixed(1)}% (−${absDrop.toFixed(1)}pp, ${(relDrop * 100).toFixed(0)}%)`,
          });
        }
      }
    }
  }

  return issues;
}

export function summariseSeverity(issues: RetailerHealthIssue[]): { high: number; medium: number } {
  return {
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
  };
}
