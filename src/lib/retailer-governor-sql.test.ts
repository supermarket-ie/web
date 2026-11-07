import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the REAL retailer_request_governor migration into PGlite and exercises
 * the atomic RPCs directly, proving the cross-worker/restart guarantees:
 *  - the token bucket enforces the per-retailer ceiling within a window and
 *    refills when the window elapses;
 *  - concurrent acquisitions share one durable counter (no overspend);
 *  - repeated denials trip the breaker, which then BLOCKS requests until the
 *    cooldown elapses, then allows a single half-open probe;
 *  - a success resets the denial streak and closes the breaker;
 *  - state is durable (a "restart" is just re-reading the same row).
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(here, '../../supabase/migrations/20261107150000_retailer_request_governor.sql');

let db: PGlite;

type SlotRow = { out_decision: string; out_retry_after_ms: number; out_breaker_open: boolean; out_window_count: number; out_consecutive_denials: number };
type Slot = { decision: string; retry_after_ms: number; breaker_open: boolean; window_count: number; consecutive_denials: number };

async function acquire(store: string, maxPerMinute = 3, windowSeconds = 60, cooldown = 900): Promise<Slot> {
  const r = await db.query<SlotRow>(
    'select * from public.acquire_retailer_request_slot($1,$2,$3,$4)',
    [store, maxPerMinute, windowSeconds, cooldown],
  );
  const row = r.rows[0];
  return {
    decision: row.out_decision,
    retry_after_ms: row.out_retry_after_ms,
    breaker_open: row.out_breaker_open,
    window_count: row.out_window_count,
    consecutive_denials: row.out_consecutive_denials,
  };
}
async function denial(store: string, reason: string, threshold = 3, cooldown = 900) {
  const r = await db.query<{ out_breaker_open: boolean; out_consecutive_denials: number; out_breaker_open_until: string | null }>(
    'select * from public.record_retailer_denial($1,$2,$3,$4)',
    [store, reason, threshold, cooldown],
  );
  const row = r.rows[0];
  return { breaker_open: row.out_breaker_open, consecutive_denials: row.out_consecutive_denials, breaker_open_until: row.out_breaker_open_until };
}
async function success(store: string) {
  await db.query('select public.record_retailer_success($1)', [store]);
}
async function state(store: string) {
  const r = await db.query<{ breaker_open: boolean; consecutive_denials: number; window_count: number; total_requests: string }>(
    'select breaker_open, consecutive_denials, window_count, total_requests from public.retailer_request_governor where store = $1',
    [store],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('truncate public.retailer_request_governor;'); });

describe('token bucket (per-retailer ceiling)', () => {
  it('allows up to the ceiling then tells later callers to wait', async () => {
    expect((await acquire('dunnes', 3)).decision).toBe('allowed');
    expect((await acquire('dunnes', 3)).decision).toBe('allowed');
    expect((await acquire('dunnes', 3)).decision).toBe('allowed');
    const fourth = await acquire('dunnes', 3);
    expect(fourth.decision).toBe('wait');
    expect(fourth.retry_after_ms).toBeGreaterThan(0);
  });

  it('counts EVERY request (searches, retries, checks) toward the same bucket', async () => {
    await acquire('dunnes', 10);
    await acquire('dunnes', 10);
    await acquire('dunnes', 10);
    expect((await state('dunnes')).window_count).toBe(3);
    expect(Number((await state('dunnes')).total_requests)).toBe(3);
  });

  it('keeps separate buckets per retailer', async () => {
    await acquire('dunnes', 1);
    expect((await acquire('dunnes', 1)).decision).toBe('wait');
    // SuperValu is unaffected by Dunnes spending its budget.
    expect((await acquire('supervalu', 1)).decision).toBe('allowed');
  });

  it('refills when the window elapses', async () => {
    await acquire('dunnes', 1);
    expect((await acquire('dunnes', 1)).decision).toBe('wait');
    // Simulate the window elapsing by ageing window_started_at.
    await db.query("update public.retailer_request_governor set window_started_at = now() - interval '61 seconds' where store = 'dunnes'");
    const after = await acquire('dunnes', 1);
    expect(after.decision).toBe('allowed');
    expect(after.window_count).toBe(1); // window reset
  });
});

describe('concurrent acquisition shares one durable counter', () => {
  it('ten parallel acquires against a ceiling of 4 grant exactly 4 and wait the rest', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => acquire('supervalu', 4)),
    );
    const allowed = results.filter((r) => r.decision === 'allowed').length;
    const waited = results.filter((r) => r.decision === 'wait').length;
    expect(allowed).toBe(4);
    expect(waited).toBe(6);
    // The persisted counter reflects only the granted requests.
    expect((await state('supervalu')).window_count).toBe(4);
  });
});

describe('circuit breaker', () => {
  it('trips after the denial threshold and then BLOCKS requests', async () => {
    await acquire('dunnes', 100); // reachable before the storm
    expect((await denial('dunnes', 'http_429', 3)).breaker_open).toBe(false); // 1
    expect((await denial('dunnes', 'http_429', 3)).breaker_open).toBe(false); // 2
    const tripped = await denial('dunnes', 'http_429', 3); // 3 -> trip
    expect(tripped.breaker_open).toBe(true);
    expect(tripped.breaker_open_until).toBeTruthy();

    // While open, acquisition is refused with 'blocked' and a retry hint.
    const blocked = await acquire('dunnes', 100);
    expect(blocked.decision).toBe('blocked');
    expect(blocked.breaker_open).toBe(true);
    expect(blocked.retry_after_ms).toBeGreaterThan(0);
  });

  it('allows a single half-open probe once the cooldown elapses', async () => {
    await denial('supervalu', 'http_403', 1); // threshold 1 -> immediate trip
    expect((await acquire('supervalu', 100)).decision).toBe('blocked');
    // Age the cooldown out.
    await db.query("update public.retailer_request_governor set breaker_open_until = now() - interval '1 second' where store = 'supervalu'");
    // Next acquire half-opens and is allowed (the probe).
    const probe = await acquire('supervalu', 100);
    expect(probe.decision).toBe('allowed');
    expect(probe.breaker_open).toBe(false);
  });

  it('a success resets the denial streak and closes the breaker', async () => {
    await denial('dunnes', 'timeout', 3);
    await denial('dunnes', 'timeout', 3);
    expect((await state('dunnes')).consecutive_denials).toBe(2);
    await success('dunnes');
    const s = await state('dunnes');
    expect(s.consecutive_denials).toBe(0);
    expect(s.breaker_open).toBe(false);
  });

  it('a denial after a half-open probe re-opens the breaker (does not reset the streak on its own)', async () => {
    await denial('dunnes', 'http_429', 2); // 1
    const trip = await denial('dunnes', 'http_429', 2); // 2 -> trip
    expect(trip.breaker_open).toBe(true);
    await db.query("update public.retailer_request_governor set breaker_open_until = now() - interval '1 second' where store = 'dunnes'");
    expect((await acquire('dunnes', 100)).decision).toBe('allowed'); // half-open probe
    // Probe fails -> another denial re-trips immediately (streak already >= threshold).
    const reopened = await denial('dunnes', 'http_429', 2);
    expect(reopened.breaker_open).toBe(true);
  });
});

describe('durability across a restart', () => {
  it('re-reads persisted window and breaker state (a restart is just a new query)', async () => {
    await acquire('dunnes', 2);
    await denial('dunnes', 'http_429', 5);
    // "Restart": nothing cached in a process; the next acquire reads the row.
    const s = await state('dunnes');
    expect(s.window_count).toBe(1);
    expect(s.consecutive_denials).toBe(1);
    // A fresh acquire continues the SAME window (not reset by a restart).
    const next = await acquire('dunnes', 2);
    expect(next.decision).toBe('allowed');
    expect(next.window_count).toBe(2);
  });
});
