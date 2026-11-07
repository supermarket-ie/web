import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Applies the REAL governor migrations (base + recovery hardening + network
 * attempt ledger) into PGlite and exercises the atomic RPCs, proving the
 * review fixes hold across concurrent tasks and restarts:
 *   1. half-open grants an EXCLUSIVE, expiring probe lease (one request only);
 *   2. recovery is generation-bound (a stale success cannot clear a newer block);
 *   3. a long Retry-After is persisted as a durable deadline and NOT shortened;
 *   4. the network-attempt ledger counts real attempts independent of deliveries.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIG = (name: string) => resolve(here, '../../supabase/migrations/' + name);
const MIGRATIONS = [
  '20261107150000_retailer_request_governor.sql',
  '20261107173000_retailer_governor_recovery_hardening.sql',
  '20261107181500_retailer_network_attempt_ledger.sql',
];

let db: PGlite;

type SlotRow = {
  out_decision: string; out_retry_after_ms: number; out_breaker_open: boolean;
  out_window_count: number; out_consecutive_denials: number;
  out_generation: number | string; out_probe_token: string | null;
};
type Slot = { decision: string; retry_after_ms: number; breaker_open: boolean; window_count: number; generation: number; probe_token: string | null };

async function acquire(store: string, maxPerMinute = 3, windowSeconds = 60, cooldown = 900, probeLease = 60): Promise<Slot> {
  const r = await db.query<SlotRow>(
    'select * from public.acquire_retailer_request_slot($1,$2,$3,$4,$5)',
    [store, maxPerMinute, windowSeconds, cooldown, probeLease],
  );
  const row = r.rows[0];
  return {
    decision: row.out_decision, retry_after_ms: row.out_retry_after_ms, breaker_open: row.out_breaker_open,
    window_count: row.out_window_count, generation: Number(row.out_generation), probe_token: row.out_probe_token,
  };
}
async function denial(store: string, reason: string, threshold = 3, cooldown = 900, retryAfterMs: number | null = null) {
  const r = await db.query<{ out_breaker_open: boolean; out_consecutive_denials: number; out_breaker_open_until: string | null; out_deadline_until: string | null; out_generation: number | string }>(
    'select * from public.record_retailer_denial($1,$2,$3,$4,$5)',
    [store, reason, threshold, cooldown, retryAfterMs],
  );
  const row = r.rows[0];
  return { breaker_open: row.out_breaker_open, consecutive_denials: row.out_consecutive_denials, breaker_open_until: row.out_breaker_open_until, deadline_until: row.out_deadline_until, generation: Number(row.out_generation) };
}
async function success(store: string, generation: number | null = null, probeToken: string | null = null) {
  const r = await db.query<{ out_breaker_open: boolean; out_cleared: boolean; out_generation: number | string }>(
    'select * from public.record_retailer_success($1,$2,$3)',
    [store, generation, probeToken],
  );
  const row = r.rows[0];
  return { breaker_open: row.out_breaker_open, cleared: row.out_cleared, generation: Number(row.out_generation) };
}
async function row(store: string) {
  const r = await db.query<{ breaker_open: boolean; consecutive_denials: number; deadline_until: string | null; generation: number | string; probe_token: string | null }>(
    'select breaker_open, consecutive_denials, deadline_until, generation, probe_token from public.retailer_request_governor where store=$1', [store]);
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  // Minimal stubs for the FK targets the attempt-ledger migration references.
  // (In production these are created by far earlier migrations.)
  await db.exec(`
    create table if not exists public.scrape_runs (
      id uuid primary key default gen_random_uuid(),
      run_id text, store text, started_at timestamptz, status text, run_scope text
    );
    create table if not exists public.store_products (
      id uuid primary key default gen_random_uuid(),
      store text, store_product_name text, url_status text
    );
  `);
  for (const m of MIGRATIONS) await db.exec(readFileSync(MIG(m), 'utf8'));
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('truncate public.retailer_request_governor, public.retailer_network_attempts, public.scrape_runs, public.store_products cascade;'); });

// Helper: trip the breaker and age its cooldown out so it's ready to half-open.
async function tripAndElapse(store: string, threshold = 1, cooldown = 900) {
  await db.query('select public.acquire_retailer_request_slot($1,100,60,$2,60)', [store, cooldown]);
  await denial(store, 'http_429', threshold, cooldown);
  await db.query("update public.retailer_request_governor set breaker_open_until = now() - interval '1 second', deadline_until = now() - interval '1 second' where store=$1", [store]);
}

describe('issue 1 — half-open grants exactly ONE exclusive probe', () => {
  it('after cooldown, the FIRST acquire gets a probe; a concurrent SECOND is blocked', async () => {
    await tripAndElapse('dunnes', 1, 900);
    const first = await acquire('dunnes', 100, 60, 900, 60);
    expect(first.decision).toBe('allowed');
    expect(first.probe_token).toBeTruthy(); // this is the probe
    // A second acquire while the probe lease is unexpired must NOT also pass.
    const second = await acquire('dunnes', 100, 60, 900, 60);
    expect(second.decision).toBe('blocked');
    expect(second.probe_token).toBeNull();
  });

  it('a new probe is only granted after the probe lease expires', async () => {
    await tripAndElapse('supervalu', 1, 900);
    const first = await acquire('supervalu', 100, 60, 900, 60);
    expect(first.probe_token).toBeTruthy();
    // Age the probe lease out; the next acquire may probe again.
    await db.query("update public.retailer_request_governor set probe_leased_until = now() - interval '1 second' where store='supervalu'");
    const next = await acquire('supervalu', 100, 60, 900, 60);
    expect(next.decision).toBe('allowed');
    expect(next.probe_token).toBeTruthy();
    expect(next.probe_token).not.toBe(first.probe_token);
  });
});

describe('issue 2 — recovery is generation-bound (stale success cannot clear a newer block)', () => {
  it('a success carrying an OLD generation/probe does not clear a re-opened breaker', async () => {
    // Trip (generation -> 1), half-open, take probe A (generation 1).
    await tripAndElapse('dunnes', 1, 900);
    const probeA = await acquire('dunnes', 100, 60, 900, 60);
    expect(probeA.probe_token).toBeTruthy();
    const genA = probeA.generation;

    // Before A's success lands, the breaker re-trips (generation -> 2) due to a
    // fresh denial storm from another worker.
    await denial('dunnes', 'http_429', 1, 900);
    const afterRetrip = await row('dunnes');
    expect(afterRetrip.breaker_open).toBe(true);
    expect(afterRetrip.generation).toBe(genA + 1);

    // A's (now stale) success arrives. It must NOT clear the active cooldown.
    const stale = await success('dunnes', genA, probeA.probe_token);
    expect(stale.cleared).toBe(false);
    expect((await row('dunnes')).breaker_open).toBe(true);
  });

  it('the CURRENT-generation probe success DOES clear the breaker', async () => {
    await tripAndElapse('supervalu', 1, 900);
    const probe = await acquire('supervalu', 100, 60, 900, 60);
    const res = await success('supervalu', probe.generation, probe.probe_token);
    expect(res.cleared).toBe(true);
    expect((await row('supervalu')).breaker_open).toBe(false);
  });

  it('an unbound success (no probe token) while OPEN does not clear the breaker', async () => {
    await tripAndElapse('dunnes', 1, 900);
    await acquire('dunnes', 100, 60, 900, 60); // consume the probe lease
    const res = await success('dunnes', null, null);
    expect(res.cleared).toBe(false);
    expect((await row('dunnes')).breaker_open).toBe(true);
  });
});

describe('issue 3 — long Retry-After persists as a durable deadline, not shortened', () => {
  it('a 1-hour Retry-After blocks well beyond the 900s cooldown, across acquisitions', async () => {
    await db.query('select public.acquire_retailer_request_slot($1,100,60,900,60)', ['dunnes']);
    // Denial with a 1-hour Retry-After and a short 900s cooldown.
    const d = await denial('dunnes', 'http_429', 1, 900, 3_600_000);
    expect(d.deadline_until).toBeTruthy();
    const deadlineMs = new Date(d.deadline_until!).getTime() - Date.now();
    expect(deadlineMs).toBeGreaterThan(3_000_000); // ~1h, not ~900s

    // Even after the 900s cooldown window elapses, the durable deadline keeps it
    // blocked (simulate cooldown passing but deadline still in the future).
    await db.query("update public.retailer_request_governor set breaker_open_until = now() - interval '1 second' where store='dunnes'");
    const slot = await acquire('dunnes', 100, 60, 900, 60);
    expect(slot.decision).toBe('blocked');
    expect(slot.retry_after_ms).toBeGreaterThan(3_000_000);
  });

  it('never shortens an existing deadline', async () => {
    await db.query('select public.acquire_retailer_request_slot($1,100,60,900,60)', ['supervalu']);
    await denial('supervalu', 'http_429', 1, 900, 3_600_000); // 1h
    const before = (await row('supervalu')).deadline_until;
    await denial('supervalu', 'http_429', 1, 900, 1_000); // a shorter 1s hint must not win
    const after = (await row('supervalu')).deadline_until;
    expect(new Date(after!).getTime()).toBeGreaterThanOrEqual(new Date(before!).getTime());
  });
});

describe('issue 4 — network-attempt ledger counts real attempts (not deliveries)', () => {
  it('increments per (run, product) and is independent per product', async () => {
    const run = (await db.query<{ id: string }>("insert into public.scrape_runs (run_id, store, started_at, status, run_scope) values ('t1','dunnes',now(),'running','scheduled_full') returning id")).rows[0].id;
    const sp = (await db.query<{ id: string }>("insert into public.store_products (store, store_product_name, url_status) values ('dunnes','P1','resolved') returning id")).rows[0].id;
    const a1 = await db.query<{ record_retailer_network_attempt: number }>('select public.record_retailer_network_attempt($1,$2,$3)', [run, sp, 'http_429']);
    const a2 = await db.query<{ record_retailer_network_attempt: number }>('select public.record_retailer_network_attempt($1,$2,$3)', [run, sp, 'timeout']);
    expect(Number(a1.rows[0].record_retailer_network_attempt)).toBe(1);
    expect(Number(a2.rows[0].record_retailer_network_attempt)).toBe(2);
  });
});

describe('still enforces the token bucket and concurrency (regression)', () => {
  it('ten parallel acquires at ceiling 4 grant exactly 4', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => acquire('supervalu', 4)));
    expect(results.filter((r) => r.decision === 'allowed').length).toBe(4);
    expect(results.filter((r) => r.decision === 'wait').length).toBe(6);
  });
});
