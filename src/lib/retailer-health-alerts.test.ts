import { describe, it, expect } from 'vitest';
import {
  evaluateRetailerHealth,
  previousScheduledSlot,
  type RetailerHealthInput,
  type ScrapeRunRow,
  DEGRADED_STREAK,
} from './retailer-health-alerts';

// Saturday, after the daily retailer slots and their two-hour completion grace.
const NOW = Date.UTC(2026, 10, 7, 9, 0, 0);

function run(partial: Partial<ScrapeRunRow>): ScrapeRunRow {
  return {
    id: partial.id ?? crypto.randomUUID(),
    store: partial.store ?? 'dunnes',
    run_id: partial.run_id ?? 'vercel_dunnes_x',
    status: partial.status ?? 'success',
    started_at: partial.started_at ?? new Date(NOW - 3_600_000).toISOString(),
    finished_at: partial.finished_at ?? new Date(NOW - 3_000_000).toISOString(),
    coverage_pct: partial.coverage_pct ?? 86,
    threshold_pct: partial.threshold_pct ?? 75,
    error_summary: partial.error_summary ?? null,
    run_scope: partial.run_scope ?? 'scheduled_full',
  };
}

function baseInput(overrides: Partial<RetailerHealthInput> = {}): RetailerHealthInput {
  return {
    now: NOW,
    scheduledStores: ['dunnes', 'supervalu'],
    stores: ['dunnes', 'supervalu'],
    runs: [],
    coverage: [
      { store: 'dunnes', live_coverage_pct: 80, expiring_within_24h: 0 },
      { store: 'supervalu', live_coverage_pct: 80, expiring_within_24h: 0 },
    ],
    coverageSnapshots: [],
    comparison: { both_live_pct: 60 },
    comparisonSnapshots: [{ both_live_pct: 60, captured_at: new Date(NOW - 86_400_000).toISOString() }],
    ...overrides,
  };
}

describe('previousScheduledSlot', () => {
  it('returns the daily 05:10 UTC slot even on Saturday', () => {
    const slot = previousScheduledSlot(NOW);
    expect(slot).not.toBeNull();
    const d = new Date(slot!);
    expect(d.getUTCDay()).toBe(6);
    expect(d.getUTCHours()).toBe(5);
    expect(d.getUTCMinutes()).toBe(10);
    expect(slot!).toBeLessThan(NOW);
  });

  it('returns yesterday before or exactly at the daily slot', () => {
    expect(previousScheduledSlot(Date.UTC(2026, 10, 7, 5, 10))).toBe(Date.UTC(2026, 10, 6, 5, 10));
    expect(previousScheduledSlot(Date.UTC(2026, 10, 7, 4))).toBe(Date.UTC(2026, 10, 6, 5, 10));
  });
});

describe('evaluateRetailerHealth — healthy baseline', () => {
  it('returns NO issues when a recent scheduled_full run exists and coverage is healthy', () => {
    const input = baseInput({
      runs: [
        run({ store: 'dunnes', started_at: new Date(NOW - 3.5 * 3_600_000).toISOString(), status: 'success' }),
        run({ store: 'supervalu', started_at: new Date(NOW - 3.5 * 3_600_000).toISOString(), status: 'degraded', coverage_pct: 74, threshold_pct: 85 }),
      ],
      coverage: [
        { store: 'dunnes', live_coverage_pct: 80, expiring_within_24h: 0 },
        { store: 'supervalu', live_coverage_pct: 80, expiring_within_24h: 0 },
      ],
    });
    const issues = evaluateRetailerHealth(input);
    // SuperValu's single degraded latest is a medium issue; Dunnes clean.
    expect(issues.some((i) => i.kind === 'missed_run')).toBe(false);
    expect(issues.some((i) => i.store === 'dunnes')).toBe(false);
    expect(issues.some((i) => i.kind === 'degraded_streak')).toBe(false);
  });
});

describe('condition 1: missed scheduled run', () => {
  it('detects a missed Saturday run even when Friday succeeded', () => {
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ started_at: '2026-11-06T05:11:00Z' })],
    });
    expect(evaluateRetailerHealth(input).some((i) => i.kind === 'missed_run')).toBe(true);
  });

  it('keeps yesterday accountable before today has passed its completion grace', () => {
    const input = baseInput({
      now: Date.UTC(2026, 10, 7, 6), stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ started_at: '2026-11-05T05:11:00Z' })],
    });
    expect(evaluateRetailerHealth(input).some((i) => i.kind === 'missed_run')).toBe(true);
  });

  it('honours SuperValu\'s 05:20 slot and its completion grace', () => {
    const input = baseInput({
      now: Date.UTC(2026, 10, 7, 7, 15), stores: ['supervalu'], scheduledStores: ['supervalu'],
      runs: [run({ store: 'supervalu', started_at: '2026-11-06T05:21:00Z' })],
    });
    expect(evaluateRetailerHealth(input).some((i) => i.kind === 'missed_run')).toBe(false);
    input.now = Date.UTC(2026, 10, 7, 7, 25);
    expect(evaluateRetailerHealth(input).some((i) => i.kind === 'missed_run')).toBe(true);
  });
  it('flags a missed run when no scheduled_full ran for the latest slot and grace elapsed', () => {
    // Latest Dunnes scheduled_full is 8 days ago -> missed the recent slot.
    const input = baseInput({
      now: NOW,
      runs: [run({ store: 'dunnes', started_at: new Date(NOW - 8 * 86_400_000).toISOString() })],
      // keep supervalu fresh so only dunnes is missed
      coverage: [{ store: 'dunnes', live_coverage_pct: 80, expiring_within_24h: 0 }],
      stores: ['dunnes'],
      scheduledStores: ['dunnes'],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.store === 'dunnes' && i.kind === 'missed_run' && i.severity === 'high')).toBe(true);
  });

  it('does NOT flag a missed run for a store that is not actively scheduled (e.g. Tesco disabled)', () => {
    const input = baseInput({
      stores: ['tesco'],
      scheduledStores: [], // tesco intentionally not scheduled
      runs: [], // no runs at all
      coverage: [{ store: 'tesco', live_coverage_pct: 80, expiring_within_24h: 0 }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'missed_run')).toBe(false);
  });

  it('does NOT flag a missed run when a run happened within the grace window of the slot', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'],
      scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      coverage: [{ store: 'dunnes', live_coverage_pct: 80, expiring_within_24h: 0 }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'missed_run')).toBe(false);
  });
});

describe('daily price freshness', () => {
  it('flags overdue displayed prices even when the daily run succeeded', () => {
    const input = baseInput({
      stores: ['supervalu'], scheduledStores: ['supervalu'],
      runs: [run({ store: 'supervalu', started_at: '2026-11-07T05:21:00Z', status: 'success' })],
      coverage: [{ store: 'supervalu', live_coverage_pct: 80, expiring_within_24h: 0, daily_overdue_products: 356 }],
    });
    expect(evaluateRetailerHealth(input)).toContainEqual(expect.objectContaining({
      store: 'supervalu', kind: 'daily_refresh_overdue', severity: 'high', message: expect.stringContaining('356'),
    }));
  });

  it('does not apply the daily target to intentionally unscheduled retailers', () => {
    const input = baseInput({
      stores: ['tesco'], scheduledStores: [], runs: [],
      coverage: [{ store: 'tesco', live_coverage_pct: 80, expiring_within_24h: 0, daily_overdue_products: 100 }],
    });
    expect(evaluateRetailerHealth(input).some((i) => i.kind === 'daily_refresh_overdue')).toBe(false);
  });
});

describe('condition 2: degraded/failed streak', () => {
  it(`flags a streak of ${DEGRADED_STREAK} consecutive degraded scheduled_full runs`, () => {
    const slot = previousScheduledSlot(NOW)!;
    const degraded = Array.from({ length: DEGRADED_STREAK }, (_, i) =>
      run({ store: 'supervalu', run_id: `sv_${i}`, started_at: new Date(slot - i * 3.5 * 86_400_000 + 60_000).toISOString(), status: 'degraded', coverage_pct: 73, threshold_pct: 85 }),
    );
    const input = baseInput({ stores: ['supervalu'], scheduledStores: ['supervalu'], runs: degraded, coverage: [{ store: 'supervalu', live_coverage_pct: 80, expiring_within_24h: 0 }] });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.store === 'supervalu' && i.kind === 'degraded_streak' && i.severity === 'high')).toBe(true);
  });

  it('does NOT flag a streak when a healthy run breaks it', () => {
    const slot = previousScheduledSlot(NOW)!;
    const runs = [
      run({ store: 'supervalu', run_id: 's1', started_at: new Date(slot + 60_000).toISOString(), status: 'degraded', coverage_pct: 73, threshold_pct: 85 }),
      run({ store: 'supervalu', run_id: 's2', started_at: new Date(slot - 3.5 * 86_400_000).toISOString(), status: 'success', coverage_pct: 90, threshold_pct: 85 }),
      run({ store: 'supervalu', run_id: 's3', started_at: new Date(slot - 7 * 86_400_000).toISOString(), status: 'degraded', coverage_pct: 73, threshold_pct: 85 }),
    ];
    const input = baseInput({ stores: ['supervalu'], scheduledStores: ['supervalu'], runs, coverage: [{ store: 'supervalu', live_coverage_pct: 80, expiring_within_24h: 0 }] });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'degraded_streak')).toBe(false);
  });
});

describe('condition 3: coverage low / expiring / regression', () => {
  it('flags zero trusted coverage as HIGH (the Dunnes-expired scenario)', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      coverage: [{ store: 'dunnes', live_coverage_pct: 0, expiring_within_24h: 0 }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.store === 'dunnes' && i.kind === 'coverage_low' && i.severity === 'high')).toBe(true);
  });

  it('flags prices expiring within 24h as HIGH', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      coverage: [{ store: 'dunnes', live_coverage_pct: 80, expiring_within_24h: 120 }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'coverage_expiring' && i.severity === 'high')).toBe(true);
  });

  it('flags a coverage regression of >= 3 percentage points between snapshots', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      coverage: [{ store: 'dunnes', live_coverage_pct: 55, expiring_within_24h: 0 }],
      coverageSnapshots: [
        { store: 'dunnes', live_coverage_pct: 55, captured_at: new Date(NOW - 3_600_000).toISOString() }, // newest
        { store: 'dunnes', live_coverage_pct: 60, captured_at: new Date(NOW - 2 * 86_400_000).toISOString() }, // older, higher
      ],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'coverage_regression')).toBe(true);
  });
});

describe('condition 4: three-retailer comparison decline', () => {
  it('flags a sharp absolute drop in both-live comparisons vs baseline', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      comparison: { both_live_pct: 48 },
      comparisonSnapshots: [{ both_live_pct: 62, captured_at: new Date(NOW - 86_400_000).toISOString() }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'comparison_drop' && i.severity === 'high')).toBe(true);
  });

  it('flags the collapse to zero as both a low floor and a drop', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      comparison: { both_live_pct: 0 },
      comparisonSnapshots: [{ both_live_pct: 25, captured_at: new Date(NOW - 86_400_000).toISOString() }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'comparison_low')).toBe(true);
    expect(issues.some((i) => i.kind === 'comparison_drop')).toBe(true);
  });

  it('does NOT flag when comparisons are stable and above the floor', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      comparison: { both_live_pct: 61 },
      comparisonSnapshots: [{ both_live_pct: 62, captured_at: new Date(NOW - 86_400_000).toISOString() }],
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'comparison_drop' || i.kind === 'comparison_low')).toBe(false);
  });
});

describe('telemetry unavailable', () => {
  it('flags a medium issue when coverage telemetry cannot be loaded', () => {
    const slot = previousScheduledSlot(NOW)!;
    const input = baseInput({
      stores: ['dunnes'], scheduledStores: ['dunnes'],
      runs: [run({ store: 'dunnes', started_at: new Date(slot + 60_000).toISOString() })],
      telemetryUnavailable: true,
    });
    const issues = evaluateRetailerHealth(input);
    expect(issues.some((i) => i.kind === 'telemetry_unavailable')).toBe(true);
  });
});
