// Shared request governor for the AUTOMATED Dunnes/SuperValu collection path.
//
// Every outbound product, search, and retry request goes through
// `withRetailerRequestSlot`, which consults the durable Supabase governor
// (token-bucket rate limit + circuit breaker) so limits and cooldowns hold
// across concurrent SQS-consumer tasks and survive restarts.
//
// Design guarantees enforced here:
//  - A blocked retailer (open breaker) raises RetailerBlockedError — a distinct
//    signal that must never be collapsed into "no search results".
//  - Waiting for a rate-limit slot or a shared cooldown is NOT a network retry:
//    it sleeps and re-acquires without consuming the product's retry budget and
//    without finalising the product as failed.
//  - Tesco is not governed here (separate supervised egress gate).

import { supabaseAdmin } from '@/lib/supabase';

export type GovernedStore = 'dunnes' | 'supervalu';

export type GovernorConfig = {
  maxPerMinute: number;
  windowSeconds: number;
  breakerTripThreshold: number;
  breakerCooldownSeconds: number;
  // Half-open probe lease duration: how long the single probe holder has to
  // resolve before the lease expires and another probe may be granted.
  probeLeaseSeconds: number;
  // Upper bound on total time spent waiting for rate-limit slots for a single
  // request acquisition, so a pathological backlog cannot wedge a worker.
  maxAcquireWaitMs: number;
};

// Conservative defaults; every value is env-tunable without a redeploy.
export function governorConfig(store: GovernedStore): GovernorConfig {
  const prefix = store === 'dunnes' ? 'DUNNES' : 'SUPERVALU';
  const num = (name: string, fallback: number, min: number, max: number) => {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(Math.floor(parsed), min), max);
  };
  return {
    maxPerMinute: num(`${prefix}_MAX_REQUESTS_PER_MINUTE`, 30, 1, 100_000),
    windowSeconds: num(`${prefix}_RATE_WINDOW_SECONDS`, 60, 1, 3_600),
    breakerTripThreshold: num(`${prefix}_BREAKER_TRIP_THRESHOLD`, 5, 1, 1_000),
    breakerCooldownSeconds: num(`${prefix}_BREAKER_COOLDOWN_SECONDS`, 900, 30, 86_400),
    probeLeaseSeconds: num(`${prefix}_BREAKER_PROBE_LEASE_SECONDS`, 60, 5, 900),
    maxAcquireWaitMs: num(`${prefix}_MAX_ACQUIRE_WAIT_MS`, 120_000, 1_000, 900_000),
  };
}

// Raised when the retailer's circuit breaker is open. Callers must treat this as
// "do not attempt / retailer paused", NOT as a product-level failure. It is
// deliberately a different type from the workers' Transient*Error (network
// retry) and from a not-found/no-match outcome.
export class RetailerBlockedError extends Error {
  constructor(
    public readonly store: GovernedStore,
    public readonly retryAfterMs: number,
    public readonly consecutiveDenials: number,
  ) {
    super(`${store} collection paused by circuit breaker (retry after ${Math.ceil(retryAfterMs / 1000)}s)`);
    this.name = 'RetailerBlockedError';
  }
}

export type SlotDecision = {
  decision: 'allowed' | 'wait' | 'blocked';
  retryAfterMs: number;
  breakerOpen: boolean;
  windowCount: number;
  consecutiveDenials: number;
  // Generation of the breaker state this slot was granted under, and the
  // exclusive half-open probe token when this 'allowed' is a probe. A later
  // success is bound to these so a stale success cannot clear a newer cooldown.
  generation: number;
  probeToken: string | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

// --- Pure helpers (unit-tested) -------------------------------------------

// Parse an HTTP Retry-After header. Supports delta-seconds and an HTTP-date.
// Returns milliseconds to wait (>= 0), or null when absent/unparseable. `now`
// is injectable for deterministic tests. Long values are preserved (not
// silently clamped here); the caller decides how to honour very long delays.
export function parseRetryAfterMs(headerValue: string | null, now: number = Date.now()): number | null {
  if (headerValue == null) return null;
  const trimmed = headerValue.trim();
  if (trimmed === '') return null;
  // delta-seconds (a non-negative integer)
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now);
}

// Full-jitter exponential backoff: random in [0, base] where base grows per
// attempt and is capped. Honours an explicit Retry-After hint when present
// (jittered a little on top so coordinated retries still spread), and never
// returns below a small floor. `rand` is injectable for deterministic tests.
export function backoffDelayMs(params: {
  attempt: number; // 1-based delivery/attempt counter
  retryAfterMs?: number | null;
  baseMs?: number;
  capMs?: number;
  rand?: () => number;
}): number {
  const base = params.baseMs ?? 1_000;
  const cap = params.capMs ?? 180_000;
  const rand = params.rand ?? Math.random;
  if (params.retryAfterMs != null && params.retryAfterMs > 0) {
    // Honour the server's hint in full, plus up to 1s of jitter so a cohort of
    // identical Retry-After values does not resume in lock-step.
    return Math.min(cap, params.retryAfterMs + Math.floor(rand() * 1_000));
  }
  const exponential = Math.min(cap, base * 2 ** Math.max(0, params.attempt - 1));
  // Full jitter: a random point in [floor, exponential].
  const floor = Math.min(base, exponential);
  return Math.floor(floor + rand() * Math.max(0, exponential - floor));
}

// Classify an outbound response/error into a denial reason the breaker should
// count, or null when it is a normal (non-denial) outcome. HTTP 403/429 and
// timeouts/network errors are denials; 404/"not found"/no-match are NOT.
export function denialReason(input: { status?: number | null; errorReason?: string | null }): string | null {
  const status = input.status ?? null;
  if (status === 403 || status === 429) return `http_${status}`;
  if (status != null && status >= 500) return `http_${status}`;
  const reason = input.errorReason ?? null;
  if (reason && /timeout|network_error|aborted/i.test(reason)) return reason;
  return null;
}

// Classification of a thrown request error: whether it is a denial (and its
// reason), plus any server Retry-After the governor should persist durably.
export type ErrorClassification = { reason: string | null; retryAfterMs?: number | null };

// --- Supabase-backed governor I/O -----------------------------------------

// Detect "the governor RPCs are not provisioned yet" (migration not applied).
// Unlike the earlier design, this NO LONGER fails open: unavailable safeguards
// must DEFER collection (make no retailer request), so this condition is
// surfaced as a RetailerBlockedError by the caller.
export function isGovernorNotProvisioned(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = error.message ?? '';
  // PostgREST PGRST202 = function not found in schema cache; Postgres 42883 =
  // undefined_function; defensive text match for either phrasing.
  return code === 'PGRST202'
    || code === '42883'
    || /could not find the function|does not exist|schema cache/i.test(message);
}

// Raised when the governor itself is unavailable (RPCs not provisioned). Callers
// MUST defer — never make the retailer request — when they see this.
export class GovernorUnavailableError extends Error {
  constructor(public readonly store: GovernedStore, public readonly context: string, message: string) {
    super(`${store} governor unavailable (${context}): ${message}`);
    this.name = 'GovernorUnavailableError';
  }
}

export async function acquireSlotOnce(store: GovernedStore, config: GovernorConfig): Promise<SlotDecision> {
  const { data, error } = await supabaseAdmin.rpc('acquire_retailer_request_slot', {
    p_store: store,
    p_max_per_minute: config.maxPerMinute,
    p_window_seconds: config.windowSeconds,
    p_breaker_cooldown_seconds: config.breakerCooldownSeconds,
    p_probe_lease_seconds: config.probeLeaseSeconds,
  });
  if (error) {
    if (isGovernorNotProvisioned(error)) throw new GovernorUnavailableError(store, 'acquire', error.message ?? '');
    throw new Error(`Failed acquiring ${store} request slot: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    out_decision: string; out_retry_after_ms: number; out_breaker_open: boolean;
    out_window_count: number; out_consecutive_denials: number;
    out_generation: number; out_probe_token: string | null;
  } | null;
  if (!row) throw new Error(`Empty slot decision for ${store}`);
  return {
    decision: row.out_decision as SlotDecision['decision'],
    retryAfterMs: Number(row.out_retry_after_ms ?? 0),
    breakerOpen: Boolean(row.out_breaker_open),
    windowCount: Number(row.out_window_count ?? 0),
    consecutiveDenials: Number(row.out_consecutive_denials ?? 0),
    generation: Number(row.out_generation ?? 0),
    probeToken: row.out_probe_token ?? null,
  };
}

export async function recordRetailerDenial(
  store: GovernedStore,
  reason: string,
  config: GovernorConfig,
  retryAfterMs?: number | null,
) {
  const { error } = await supabaseAdmin.rpc('record_retailer_denial', {
    p_store: store,
    p_reason: reason,
    p_trip_threshold: config.breakerTripThreshold,
    p_cooldown_seconds: config.breakerCooldownSeconds,
    p_retry_after_ms: retryAfterMs != null && retryAfterMs > 0 ? Math.floor(retryAfterMs) : null,
  });
  if (error) {
    if (isGovernorNotProvisioned(error)) throw new GovernorUnavailableError(store, 'denial', error.message ?? '');
    throw new Error(`Failed recording ${store} denial: ${error.message}`);
  }
}

// Increment and return the count of REAL transient network attempts for a
// product in this run. Called ONLY after an actual request failed transiently,
// so the exhaustion decision is independent of SQS delivery count. A paused
// redelivery (breaker/rate-limit) makes no request and never calls this.
export async function recordNetworkAttempt(runUuid: string, storeProductId: string, reason: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('record_retailer_network_attempt', {
    p_run_uuid: runUuid,
    p_store_product_id: storeProductId,
    p_reason: reason,
  });
  if (error) throw new Error(`Failed recording network attempt: ${error.message}`);
  return Number(data ?? 0);
}

// Record a success, bound to the generation + probe token of the slot that was
// granted, so only the current-generation probe can clear the breaker.
export async function recordRetailerSuccess(store: GovernedStore, generation?: number, probeToken?: string | null) {
  const { error } = await supabaseAdmin.rpc('record_retailer_success', {
    p_store: store,
    p_generation: generation ?? null,
    p_probe_token: probeToken ?? null,
  });
  if (error) {
    if (isGovernorNotProvisioned(error)) throw new GovernorUnavailableError(store, 'success', error.message ?? '');
    throw new Error(`Failed recording ${store} success: ${error.message}`);
  }
}

// Acquire a rate-limit slot, waiting through 'wait' decisions (bounded), and
// run `fn`. Rules:
//  - 'blocked' (breaker open) -> throw RetailerBlockedError immediately.
//  - 'wait' -> sleep the governor-provided interval and re-acquire. This is NOT
//    a network retry; it never touches the product's retry budget.
//  - 'allowed' -> run fn. If fn's result/error is a denial (403/429/timeout),
//    record it (advancing the breaker) and rethrow so the worker's own bounded
//    network retry applies. A non-denial outcome records a success (closing a
//    half-open breaker) and is returned/thrown unchanged.
//
// `classifyError` maps fn's thrown error to an ErrorClassification: a denial
// reason (or null) plus any server Retry-After to persist. A `true` return and
// a bare-string return are accepted for convenience.
export async function withRetailerRequestSlot<T>(
  store: GovernedStore,
  fn: () => Promise<T>,
  options: {
    config?: GovernorConfig;
    classifyError?: (error: unknown) => ErrorClassification | string | null;
    now?: () => number;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const config = options.config ?? governorConfig(store);
  const now = options.now ?? Date.now;
  const doSleep = options.sleepFn ?? sleep;
  const deadline = now() + config.maxAcquireWaitMs;

  const classify = (error: unknown): ErrorClassification => {
    const raw = options.classifyError ? options.classifyError(error) : null;
    if (raw == null) return { reason: null };
    if (typeof raw === 'string') return { reason: raw };
    return raw;
  };

  // If the governor itself is unavailable (RPCs not provisioned), DEFER — make
  // no retailer request. Surface it as a RetailerBlockedError so the worker
  // redelivers the batch later without finalising any product.
  let slot: SlotDecision;
  // Acquire loop: only 'wait' spins here, bounded by maxAcquireWaitMs.
  for (;;) {
    try {
      slot = await acquireSlotOnce(store, config);
    } catch (error) {
      if (error instanceof GovernorUnavailableError) {
        throw new RetailerBlockedError(store, config.breakerCooldownSeconds * 1000, 0);
      }
      throw error;
    }
    if (slot.decision === 'blocked') {
      throw new RetailerBlockedError(store, slot.retryAfterMs, slot.consecutiveDenials);
    }
    if (slot.decision === 'wait') {
      if (now() >= deadline) {
        // Rate-limit wait exhausted: surface so the worker redelivers the batch
        // later (not a product failure). Distinct from a match outcome.
        throw new RetailerBlockedError(store, slot.retryAfterMs, slot.consecutiveDenials);
      }
      await doSleep(Math.min(slot.retryAfterMs, config.maxAcquireWaitMs));
      continue;
    }
    break; // allowed
  }

  // Slot granted: perform the request. Success/denial are bound to this slot's
  // generation + probe token so only the current-generation probe can recover.
  const recordUnavailableAsDefer = (error: unknown): never => {
    if (error instanceof GovernorUnavailableError) {
      throw new RetailerBlockedError(store, config.breakerCooldownSeconds * 1000, 0);
    }
    throw error;
  };

  let result: T;
  try {
    result = await fn();
  } catch (error) {
    const { reason, retryAfterMs } = classify(error);
    try {
      if (reason) {
        await recordRetailerDenial(store, reason, config, retryAfterMs);
      } else {
        // A non-denial failure (e.g. a parse error) still proves the retailer
        // is reachable, so a current-generation probe may clear the breaker.
        await recordRetailerSuccess(store, slot.generation, slot.probeToken);
      }
    } catch (recordError) {
      recordUnavailableAsDefer(recordError);
    }
    throw error;
  }

  try {
    await recordRetailerSuccess(store, slot.generation, slot.probeToken);
  } catch (recordError) {
    recordUnavailableAsDefer(recordError);
  }
  return result;
}
