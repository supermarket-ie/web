import './setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  __setSafeguardClientForTests,
} from '../supabase';
import {
  checkRateLimits,
  ensureConversation,
  mintGuestCookie,
  reserveSpend,
  settleSpend,
  verifyGuestCookie,
} from '../safeguards';

/**
 * These tests exercise the decision layer of the safeguards against a FAKE
 * Supabase whose `rpc` is a programmable mock. Combined with the SQL migration
 * (whose atomicity is in plpgsql), this proves the fail-closed + threshold
 * behaviour the route depends on without a live database.
 */

type RpcImpl = (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown };

function fakeClient(impl: RpcImpl): SupabaseClient {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => Promise.resolve(impl(fn, args)),
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  process.env.AGENT_GUEST_COOKIE_SECRET = 'test-guest-secret';
});

afterEach(() => {
  __setSafeguardClientForTests(null);
  vi.restoreAllMocks();
});

describe('guest cookie signing', () => {
  it('round-trips a minted guest cookie', () => {
    const { guestKey, cookieValue } = mintGuestCookie();
    expect(verifyGuestCookie(cookieValue)).toBe(guestKey);
  });

  it('rejects a tampered or unsigned cookie', () => {
    const { cookieValue } = mintGuestCookie();
    const tampered = (cookieValue[0] === '0' ? '1' : '0') + cookieValue.slice(1);
    expect(verifyGuestCookie(tampered)).toBeNull();
    expect(verifyGuestCookie('no-signature')).toBeNull();
    expect(verifyGuestCookie(undefined)).toBeNull();
  });
});

describe('checkRateLimits', () => {
  it('passes through the RPC allow decision', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: { allowed: true, reason: 'ok' }, error: null })));
    await expect(checkRateLimits('guest:a', 'conv-1')).resolves.toEqual({ allowed: true, reason: 'ok' });
  });

  it.each([
    'hour_limit',
    'day_limit',
    'concurrent_limit',
    'conversation_limit',
  ])('surfaces the %s rejection reason', async reason => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: { allowed: false, reason }, error: null })));
    await expect(checkRateLimits('guest:a', 'conv-1')).resolves.toEqual({ allowed: false, reason });
  });

  it('FAILS CLOSED when the RPC errors', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: null, error: { message: 'db down' } })));
    await expect(checkRateLimits('guest:a', 'conv-1')).resolves.toEqual({ allowed: false, reason: 'check_failed' });
  });

  it('FAILS CLOSED when the RPC throws (unreachable)', async () => {
    __setSafeguardClientForTests({
      rpc: () => Promise.reject(new Error('network')),
    } as unknown as SupabaseClient);
    await expect(checkRateLimits('guest:a', 'conv-1')).resolves.toEqual({ allowed: false, reason: 'check_failed' });
  });

  it('FAILS CLOSED on a malformed RPC payload', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: { nope: true }, error: null })));
    await expect(checkRateLimits('guest:a', 'conv-1')).resolves.toEqual({ allowed: false, reason: 'check_failed' });
  });
});

describe('ensureConversation', () => {
  it('returns the conversation row when allowed', async () => {
    __setSafeguardClientForTests(
      fakeClient(() => ({ data: { allowed: true, reason: 'ok', conversation_id: 'conv-9', message_count: 3 }, error: null })),
    );
    await expect(ensureConversation(null, 'guest:a', null)).resolves.toEqual({
      ok: true,
      conversation: { id: 'conv-9', message_count: 3 },
      reason: 'ok',
    });
  });

  it('rejects an over-cap conversation', async () => {
    __setSafeguardClientForTests(
      fakeClient(() => ({ data: { allowed: false, reason: 'conversation_limit' }, error: null })),
    );
    const result = await ensureConversation('conv-x', 'guest:a', null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('conversation_limit');
  });

  it('FAILS CLOSED when the ensure RPC errors', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: null, error: { message: 'down' } })));
    const result = await ensureConversation(null, 'guest:a', null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('check_failed');
  });
});

describe('spend circuit breaker', () => {
  it('returns a reservation id when under the ceiling', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: { ok: true, reservation_id: 'res-1' }, error: null })));
    await expect(reserveSpend(5)).resolves.toEqual({ ok: true, reservationId: 'res-1', reason: 'ok' });
  });

  it('rejects when the daily ceiling is hit', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: { ok: false, reservation_id: null }, error: null })));
    await expect(reserveSpend(5)).resolves.toEqual({ ok: false, reservationId: null, reason: 'ceiling' });
  });

  it('FAILS CLOSED when the reserve RPC errors', async () => {
    __setSafeguardClientForTests(fakeClient(() => ({ data: null, error: { message: 'down' } })));
    await expect(reserveSpend(5)).resolves.toEqual({ ok: false, reservationId: null, reason: 'reserve_failed' });
  });

  it('FAILS CLOSED when the reserve RPC is unreachable', async () => {
    __setSafeguardClientForTests({
      rpc: () => Promise.reject(new Error('unreachable')),
    } as unknown as SupabaseClient);
    await expect(reserveSpend(5)).resolves.toEqual({ ok: false, reservationId: null, reason: 'reserve_failed' });
  });

  it('settles a reservation without throwing even if the RPC errors', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    __setSafeguardClientForTests(
      fakeClient((fn, args) => {
        calls.push({ fn, args });
        return { data: null, error: { message: 'late' } };
      }),
    );
    await expect(settleSpend('res-1', 2.5)).resolves.toBeUndefined();
    expect(calls[0].fn).toBe('agent_bedrock_spend_settle');
    expect(calls[0].args).toMatchObject({ p_reservation_id: 'res-1', p_actual_cents: 2.5 });
  });
});
