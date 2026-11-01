import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { verifySessionToken } from '../auth';
import { safeguardSupabase } from './supabase';

/**
 * Shared, atomic, fail-closed safeguards for the stateless agent PoC.
 *
 * Everything durable lives in Supabase; this module holds NO per-session state,
 * so two ECS tasks with no sticky routing enforce the same limits. Every RPC is
 * `security definer` + atomic (UPDATE ... RETURNING) server-side, and every
 * decision here FAILS CLOSED: if a check errors or is unreachable, the turn is
 * rejected with a customer-friendly message rather than allowed through.
 */

// Env:
//   AGENT_GUEST_COOKIE_SECRET — HMAC secret for signing the `sm_guest` cookie.
//                               Falls back to MAGIC_LINK_SECRET so a single
//                               secret can govern both in a minimal deployment.
export const GUEST_COOKIE_NAME = 'sm_guest';

function guestSecret(): string {
  const secret = process.env.AGENT_GUEST_COOKIE_SECRET ?? process.env.MAGIC_LINK_SECRET;
  if (!secret) throw new Error('AGENT_GUEST_COOKIE_SECRET (or MAGIC_LINK_SECRET) is required');
  return secret;
}

function sign(value: string): string {
  return createHmac('sha256', guestSecret()).update(value).digest('hex');
}

/** Mint a fresh signed guest id: `<uuid>.<hmac>`. */
export function mintGuestCookie(): { guestKey: string; cookieValue: string } {
  const guestKey = randomUUID();
  return { guestKey, cookieValue: `${guestKey}.${sign(guestKey)}` };
}

/** Verify a signed guest cookie, returning the guest key or null if tampered. */
export function verifyGuestCookie(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const guestKey = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = sign(guestKey);
  try {
    const macBuf = Buffer.from(mac, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (macBuf.length !== expBuf.length) return null;
    return timingSafeEqual(macBuf, expBuf) ? guestKey : null;
  } catch {
    return null;
  }
}

export type ResolvedIdentity = {
  /** The key used for all rate limits — the subscriber id when signed in, else the guest id. */
  guestKey: string;
  isGuest: boolean;
  subscriberId: string | null;
  /** Set only when a fresh guest cookie must be written on the response. */
  setCookieValue: string | null;
  /** First-hop client IP, a SECONDARY signal recorded for metrics only. */
  clientIp: string | null;
};

function firstForwardedIp(req: NextRequest): string | null {
  const header = req.headers.get('x-forwarded-for');
  if (!header) return null;
  const first = header.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Resolve the caller. A valid `sm_session` cookie yields a signed-in subscriber
 * (keyed by subscriber id); otherwise a signed `sm_guest` cookie identifies a
 * guest, minting one when absent or tampered.
 */
export function resolveGuestKey(req: NextRequest): ResolvedIdentity {
  const clientIp = firstForwardedIp(req);
  const session = verifySessionToken(req.cookies.get('sm_session')?.value);
  if (session?.subscriberId) {
    return {
      guestKey: `sub:${session.subscriberId}`,
      isGuest: false,
      subscriberId: session.subscriberId,
      setCookieValue: null,
      clientIp,
    };
  }
  const existing = verifyGuestCookie(req.cookies.get(GUEST_COOKIE_NAME)?.value);
  if (existing) {
    return { guestKey: `guest:${existing}`, isGuest: true, subscriberId: null, setCookieValue: null, clientIp };
  }
  const minted = mintGuestCookie();
  return {
    guestKey: `guest:${minted.guestKey}`,
    isGuest: true,
    subscriberId: null,
    setCookieValue: minted.cookieValue,
    clientIp,
  };
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------
export type RateReason =
  | 'ok'
  | 'hour_limit'
  | 'day_limit'
  | 'concurrent_limit'
  | 'conversation_limit'
  | 'conversation_missing'
  | 'check_failed';

export type RateDecision = { allowed: boolean; reason: RateReason };

const RATE_MESSAGES: Record<RateReason, string> = {
  ok: '',
  hour_limit: 'You’ve reached the hourly limit for the assistant. Please try again a little later.',
  day_limit: 'You’ve reached today’s limit for the assistant. Please come back tomorrow.',
  concurrent_limit: 'Your previous message is still being answered. Please wait for it to finish before sending another.',
  conversation_limit: 'This conversation has reached its length limit. Please start a new conversation to continue.',
  conversation_missing: 'I couldn’t find that conversation. Please start a new one.',
  check_failed: 'The assistant is briefly unavailable. Please try again in a moment.',
};

export function rateLimitMessage(reason: RateReason): string {
  return RATE_MESSAGES[reason] ?? RATE_MESSAGES.check_failed;
}

/**
 * Atomic rate check via the `agent_guest_rate_check` RPC. The RPC claims an
 * active-request lock on success. FAILS CLOSED: any RPC error -> not allowed.
 */
export async function checkRateLimits(guestKey: string, conversationId: string): Promise<RateDecision> {
  try {
    const { data, error } = await safeguardSupabase().rpc('agent_guest_rate_check', {
      p_guest_key: guestKey,
      p_conversation_id: conversationId,
    });
    if (error) return { allowed: false, reason: 'check_failed' };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') return { allowed: false, reason: 'check_failed' };
    return { allowed: row.allowed, reason: (row.reason ?? (row.allowed ? 'ok' : 'check_failed')) as RateReason };
  } catch {
    return { allowed: false, reason: 'check_failed' };
  }
}

/** Release the concurrent-request lock claimed by checkRateLimits. Best-effort. */
export async function releaseActiveRequest(guestKey: string): Promise<void> {
  try {
    await safeguardSupabase().rpc('agent_guest_release', { p_guest_key: guestKey });
  } catch {
    // Non-fatal: the lock also auto-expires via its updated_at staleness window.
  }
}

// ---------------------------------------------------------------------------
// Spend circuit breaker
// ---------------------------------------------------------------------------
export type SpendReservation = { ok: boolean; reservationId: string | null; reason: 'ok' | 'ceiling' | 'reserve_failed' };

export function spendBlockedMessage(): string {
  return 'The assistant is busy right now. Please try again shortly.';
}

/**
 * Reserve estimated spend BEFORE the model call. Keyed by UTC day with a
 * $10/day ceiling enforced atomically inside the RPC. FAILS CLOSED: any error
 * -> not reserved -> the turn must be rejected.
 */
export async function reserveSpend(estimateCents: number): Promise<SpendReservation> {
  try {
    const { data, error } = await safeguardSupabase().rpc('agent_bedrock_spend_reserve', {
      p_estimate_cents: estimateCents,
    });
    if (error) return { ok: false, reservationId: null, reason: 'reserve_failed' };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.ok !== 'boolean') return { ok: false, reservationId: null, reason: 'reserve_failed' };
    return {
      ok: row.ok,
      reservationId: row.reservation_id ?? null,
      reason: row.ok ? 'ok' : 'ceiling',
    };
  } catch {
    return { ok: false, reservationId: null, reason: 'reserve_failed' };
  }
}

/** Reconcile a reservation to the actual spend after the model call. Best-effort. */
export async function settleSpend(reservationId: string, actualCents: number): Promise<void> {
  try {
    await safeguardSupabase().rpc('agent_bedrock_spend_settle', {
      p_reservation_id: reservationId,
      p_actual_cents: actualCents,
    });
  } catch {
    // Non-fatal: an unsettled reservation remains counted against the ceiling
    // (fail-safe over-counting), reconciled by the daily rollover.
  }
}

// ---------------------------------------------------------------------------
// Conversation + turn bookkeeping (all writable in preview via safeguard client)
// ---------------------------------------------------------------------------
export type ConversationRow = { id: string; message_count: number };

/**
 * Ensure a conversation row exists for the turn via the
 * `agent_conversation_ensure` RPC, which also enforces the ≤15 messages/conv
 * cap atomically and returns the row. FAILS CLOSED on error.
 */
export async function ensureConversation(
  conversationId: string | null,
  guestKey: string,
  subscriberId: string | null,
): Promise<{ ok: boolean; conversation: ConversationRow | null; reason: RateReason }> {
  try {
    const { data, error } = await safeguardSupabase().rpc('agent_conversation_ensure', {
      p_conversation_id: conversationId,
      p_guest_key: guestKey,
      p_subscriber_id: subscriberId,
    });
    if (error) return { ok: false, conversation: null, reason: 'check_failed' };
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== 'boolean') return { ok: false, conversation: null, reason: 'check_failed' };
    if (!row.allowed) return { ok: false, conversation: null, reason: (row.reason ?? 'conversation_limit') as RateReason };
    return {
      ok: true,
      conversation: { id: row.conversation_id, message_count: row.message_count ?? 0 },
      reason: 'ok',
    };
  } catch {
    return { ok: false, conversation: null, reason: 'check_failed' };
  }
}

export type TurnRecord = {
  conversationId: string;
  guestKey: string;
  subscriberId: string | null;
  inputTokens: number;
  outputTokens: number;
  estCostCents: number;
  outcome: string;
  model: string;
  clientIp: string | null;
};

/**
 * Record a completed turn: write the `agent_turns` row (token counts + outcome
 * only, NEVER prompt text), bump the conversation message_count/last_active and
 * release the active-request lock. Best-effort; a bookkeeping failure must not
 * fail an otherwise-successful turn.
 */
export async function recordTurn(turn: TurnRecord): Promise<void> {
  try {
    await safeguardSupabase().rpc('agent_turn_record', {
      p_conversation_id: turn.conversationId,
      p_guest_key: turn.guestKey,
      p_subscriber_id: turn.subscriberId,
      p_input_tokens: turn.inputTokens,
      p_output_tokens: turn.outputTokens,
      p_est_cost_cents: turn.estCostCents,
      p_outcome: turn.outcome,
      p_model: turn.model,
    });
  } catch {
    // Non-fatal.
  }
  if (turn.clientIp) {
    // SECONDARY signal only — never a hard block. Logged for metrics.
    console.info('[agent-poc] turn', { guestKey: turn.guestKey, outcome: turn.outcome, clientIp: turn.clientIp });
  }
}
