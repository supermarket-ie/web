import { describe, expect, it } from 'vitest';
import { GATE_UNAVAILABLE, withApifyLeaseWait } from './tesco-apify-lease-wait';

const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

describe('withApifyLeaseWait', () => {
  it('retries ONLY the lease refusal until the lease is free', async () => {
    const c = clock(); let calls = 0; const log: Record<string, unknown>[] = [];
    const r = await withApifyLeaseWait(async () => { calls += 1; if (calls < 4) throw new Error(GATE_UNAVAILABLE); return 'ran'; },
      { waitMs: 10 * 60_000, ...c, log: e => log.push(e) });
    expect(r).toBe('ran');
    expect(calls).toBe(4);
    expect(log.filter(e => e.event === 'lease_wait')).toHaveLength(3);
  });
  it('gives up at the deadline and rethrows the refusal', async () => {
    const c = clock(); let calls = 0;
    await expect(withApifyLeaseWait(async () => { calls += 1; throw new Error(GATE_UNAVAILABLE); }, { waitMs: 3 * 60_000, ...c }))
      .rejects.toThrow(GATE_UNAVAILABLE);
    expect(calls).toBe(4); // t=0,1,2,3 min
  });
  it('never retries other errors, and waitMs=0 keeps the old fail-fast behaviour', async () => {
    const c = clock(); let calls = 0;
    await expect(withApifyLeaseWait(async () => { calls += 1; throw new Error('apify_reserve_tesco_request: pacing_not_elapsed'); }, { waitMs: 60 * 60_000, ...c }))
      .rejects.toThrow(/pacing_not_elapsed/);
    expect(calls).toBe(1);
    calls = 0;
    await expect(withApifyLeaseWait(async () => { calls += 1; throw new Error(GATE_UNAVAILABLE); }, { waitMs: 0, ...c })).rejects.toThrow(GATE_UNAVAILABLE);
    expect(calls).toBe(1);
  });
});
