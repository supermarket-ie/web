import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A single shared mock RPC that simulates the durable Supabase governor row.
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mock.rpc } }));

import {
  parseRetryAfterMs,
  backoffDelayMs,
  denialReason,
  isGovernorNotProvisioned,
  acquireSlotOnce,
  RetailerBlockedError,
  GovernorUnavailableError,
  withRetailerRequestSlot,
  governorConfig,
  type GovernorConfig,
} from './retailer-request-governor';

const CONFIG: GovernorConfig = {
  maxPerMinute: 30,
  windowSeconds: 60,
  breakerTripThreshold: 5,
  breakerCooldownSeconds: 900,
  probeLeaseSeconds: 60,
  maxAcquireWaitMs: 120_000,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

// --- parseRetryAfterMs ------------------------------------------------------

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds, including long values', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs('3600')).toBe(3_600_000); // one hour, preserved
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-11-07T10:00:00Z');
    expect(parseRetryAfterMs('Sat, 07 Nov 2026 10:02:00 GMT', now)).toBe(120_000);
    expect(parseRetryAfterMs('Sat, 07 Nov 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('returns null when absent or unparseable', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('soon')).toBeNull();
  });
});

// --- backoffDelayMs ---------------------------------------------------------

describe('backoffDelayMs', () => {
  it('honours a Retry-After hint (plus bounded jitter) over exponential', () => {
    expect(backoffDelayMs({ attempt: 1, retryAfterMs: 120_000, rand: () => 0.5 })).toBe(120_500);
  });

  it('applies full jitter to exponential backoff (varies with rand)', () => {
    const low = backoffDelayMs({ attempt: 3, baseMs: 1_000, capMs: 180_000, rand: () => 0 });
    const high = backoffDelayMs({ attempt: 3, baseMs: 1_000, capMs: 180_000, rand: () => 1 });
    expect(low).toBe(1_000);
    expect(high).toBe(4_000);
    expect(high).toBeGreaterThan(low);
  });
});

// --- denialReason -----------------------------------------------------------

describe('denialReason — denials vs non-denials', () => {
  it('counts 403, 429 and 5xx as denials', () => {
    expect(denialReason({ status: 403 })).toBe('http_403');
    expect(denialReason({ status: 429 })).toBe('http_429');
    expect(denialReason({ status: 503 })).toBe('http_503');
  });
  it('counts timeouts and network errors as denials', () => {
    expect(denialReason({ errorReason: 'timeout' })).toBe('timeout');
    expect(denialReason({ errorReason: 'network_error' })).toBe('network_error');
  });
  it('does NOT count 404 / not-found / no-match as denials', () => {
    expect(denialReason({ status: 404 })).toBeNull();
    expect(denialReason({ errorReason: 'no_confident_match' })).toBeNull();
    expect(denialReason({ status: 200 })).toBeNull();
  });
});

// --- governorConfig env tuning ---------------------------------------------

describe('governorConfig', () => {
  it('defaults to 30 req/min per retailer', () => {
    expect(governorConfig('dunnes').maxPerMinute).toBe(30);
    expect(governorConfig('supervalu').maxPerMinute).toBe(30);
  });
  it('is env-tunable per retailer without a redeploy', () => {
    vi.stubEnv('DUNNES_MAX_REQUESTS_PER_MINUTE', '45');
    vi.stubEnv('SUPERVALU_MAX_REQUESTS_PER_MINUTE', '20');
    expect(governorConfig('dunnes').maxPerMinute).toBe(45);
    expect(governorConfig('supervalu').maxPerMinute).toBe(20);
  });
});

// --- withRetailerRequestSlot: orchestration --------------------------------

type Decision = { decision: string; retry_after_ms?: number; consecutive_denials?: number; generation?: number; probe_token?: string | null };

function scriptGovernor(decisions: Decision[]) {
  const calls = {
    acquire: 0,
    denials: [] as Array<{ reason: string; retryAfterMs: number | null }>,
    successes: [] as Array<{ generation: number | null; probeToken: string | null }>,
  };
  mock.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === 'acquire_retailer_request_slot') {
      const d = decisions[Math.min(calls.acquire, decisions.length - 1)];
      calls.acquire += 1;
      return Promise.resolve({ data: [{
        out_decision: d.decision,
        out_retry_after_ms: d.retry_after_ms ?? 0,
        out_breaker_open: d.decision === 'blocked' || Boolean(d.probe_token),
        out_window_count: 1,
        out_consecutive_denials: d.consecutive_denials ?? 0,
        out_generation: d.generation ?? 0,
        out_probe_token: d.probe_token ?? null,
      }], error: null });
    }
    if (name === 'record_retailer_denial') {
      calls.denials.push({ reason: String(args.p_reason), retryAfterMs: (args.p_retry_after_ms as number | null) ?? null });
      return Promise.resolve({ data: null, error: null });
    }
    if (name === 'record_retailer_success') {
      calls.successes.push({ generation: (args.p_generation as number | null) ?? null, probeToken: (args.p_probe_token as string | null) ?? null });
      return Promise.resolve({ data: null, error: null });
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return calls;
}

describe('withRetailerRequestSlot', () => {
  it('runs the request and records success when allowed', async () => {
    const calls = scriptGovernor([{ decision: 'allowed' }]);
    expect(await withRetailerRequestSlot('dunnes', async () => 'ok', { config: CONFIG })).toBe('ok');
    expect(calls.acquire).toBe(1);
    expect(calls.successes).toHaveLength(1);
    expect(calls.denials).toEqual([]);
  });

  it('throws RetailerBlockedError (not a result) when the breaker is open', async () => {
    scriptGovernor([{ decision: 'blocked', retry_after_ms: 300_000, consecutive_denials: 6 }]);
    const fn = vi.fn();
    await expect(withRetailerRequestSlot('dunnes', fn, { config: CONFIG })).rejects.toBeInstanceOf(RetailerBlockedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('waits through rate-limit "wait" decisions WITHOUT running the request, then proceeds', async () => {
    const calls = scriptGovernor([
      { decision: 'wait', retry_after_ms: 1_500 },
      { decision: 'wait', retry_after_ms: 1_500 },
      { decision: 'allowed' },
    ]);
    const slept: number[] = [];
    const fn = vi.fn().mockResolvedValue('done');
    expect(await withRetailerRequestSlot('supervalu', fn, { config: CONFIG, sleepFn: async (ms) => { slept.push(ms); } })).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1); // waiting never invokes the request
    expect(calls.acquire).toBe(3);
    expect(slept).toEqual([1_500, 1_500]);
  });

  it('bounds total rate-limit waiting and surfaces a distinct pause when exhausted', async () => {
    scriptGovernor([{ decision: 'wait', retry_after_ms: 1_000 }]);
    let t = 0;
    const fn = vi.fn();
    await expect(withRetailerRequestSlot('dunnes', fn, {
      config: { ...CONFIG, maxAcquireWaitMs: 5_000 },
      now: () => { const v = t; t += 6_000; return v; },
      sleepFn: async () => {},
    })).rejects.toBeInstanceOf(RetailerBlockedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('records a denial (with Retry-After) and rethrows on a 403/429/timeout', async () => {
    const calls = scriptGovernor([{ decision: 'allowed' }]);
    const boom = Object.assign(new Error('blocked'), { reason: 'http_429' });
    await expect(withRetailerRequestSlot('dunnes', async () => { throw boom; }, {
      config: CONFIG,
      classifyError: (e) => ({ reason: (e as { reason?: string }).reason ?? null, retryAfterMs: 600_000 }),
    })).rejects.toBe(boom);
    expect(calls.denials).toEqual([{ reason: 'http_429', retryAfterMs: 600_000 }]);
    expect(calls.successes).toHaveLength(0);
  });

  it('treats a non-denial failure as reachability success (bound to the slot generation/probe)', async () => {
    const calls = scriptGovernor([{ decision: 'allowed', generation: 7, probe_token: 'probe-abc' }]);
    const parseError = new Error('bad json');
    await expect(withRetailerRequestSlot('supervalu', async () => { throw parseError; }, {
      config: CONFIG,
      classifyError: () => null,
    })).rejects.toBe(parseError);
    expect(calls.denials).toEqual([]);
    expect(calls.successes).toEqual([{ generation: 7, probeToken: 'probe-abc' }]);
  });

  it('binds a probe success to the exact generation + probe token the slot granted', async () => {
    const calls = scriptGovernor([{ decision: 'allowed', generation: 12, probe_token: 'probe-xyz' }]);
    await withRetailerRequestSlot('dunnes', async () => 'ok', { config: CONFIG });
    expect(calls.successes).toEqual([{ generation: 12, probeToken: 'probe-xyz' }]);
  });
});

// --- Removed fail-open: unavailable safeguards DEFER, not proceed -----------

describe('governor unavailable (RPCs not provisioned) DEFERS collection', () => {
  it('detects the not-provisioned condition by code or message', () => {
    expect(isGovernorNotProvisioned({ code: 'PGRST202' })).toBe(true);
    expect(isGovernorNotProvisioned({ code: '42883' })).toBe(true);
    expect(isGovernorNotProvisioned({ message: 'Could not find the function public.acquire_retailer_request_slot' })).toBe(true);
    expect(isGovernorNotProvisioned({ code: '', message: 'connection reset' })).toBe(false);
    expect(isGovernorNotProvisioned(null)).toBe(false);
  });

  it('acquireSlotOnce THROWS GovernorUnavailableError when the RPC is absent (no fail-open)', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(acquireSlotOnce('dunnes', CONFIG)).rejects.toBeInstanceOf(GovernorUnavailableError);
  });

  it('withRetailerRequestSlot defers (RetailerBlockedError) and makes NO request when the governor is unavailable', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const fn = vi.fn();
    await expect(withRetailerRequestSlot('dunnes', fn, { config: CONFIG })).rejects.toBeInstanceOf(RetailerBlockedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('still throws on a genuine RPC error', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'permission denied' } });
    await expect(acquireSlotOnce('supervalu', CONFIG)).rejects.toThrow(/permission denied/);
  });
});

describe('shared-governor contract across workers/restarts', () => {
  it('each concurrent request acquires its own slot (no client-side budget caching)', async () => {
    scriptGovernor([{ decision: 'allowed' }]);
    await Promise.all(Array.from({ length: 10 }, () => withRetailerRequestSlot('dunnes', async () => 'r', { config: CONFIG })));
    expect(mock.rpc.mock.calls.filter(([n]) => n === 'acquire_retailer_request_slot')).toHaveLength(10);
  });
});
