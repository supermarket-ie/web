import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake query builder: records the reviewed_at lower bound and returns the queued result.
const calls = vi.hoisted(() => ({ since: [] as string[], result: { data: [] as unknown[] | null, error: null as unknown },
  // Default: the durable-approval migration is not applied yet (PostgREST: function not found).
  rpc: { data: null as unknown[] | null, error: { code: 'PGRST202', message: 'Could not find the function public.current_pair_review_status' } as unknown } }));
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    gte: (_col: string, value: string) => { calls.since.push(value); return builder; },
    order: () => builder,
    range: async () => calls.result,
  };
  return { supabaseAdmin: { from: () => builder, rpc: async () => calls.rpc } };
});
import { getCurrentPairReviews, resetPairReviewCache } from './comparison-reviews';

const now = Date.parse('2026-11-17T12:00:00Z');
const at = '2026-11-17T10:00:00Z';
const row = { left_offer_id: 'a', right_offer_id: 'b', classification: 'exact_product', left_source_hash: 'a'.repeat(64),
  right_source_hash: 'b'.repeat(64), left_captured_at: at, right_captured_at: at, reviewed_at: at, rationale: 'r', reviewer: 'owner' };

describe('getCurrentPairReviews', () => {
  beforeEach(() => { resetPairReviewCache(); calls.since.length = 0; calls.result = { data: [row], error: null };
    calls.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.current_pair_review_status' } }; });
  it('limits the read to the 14-day horizon in SQL', async () => {
    expect(await getCurrentPairReviews(now)).toHaveLength(1);
    expect(calls.since).toEqual(['2026-11-03T12:00:00.000Z']);
  });
  it('serves repeat reads within 60s from cache and refetches after', async () => {
    await getCurrentPairReviews(now);
    await getCurrentPairReviews(now + 30_000);
    expect(calls.since).toHaveLength(1);
    await getCurrentPairReviews(now + 61_000);
    expect(calls.since).toHaveLength(2);
  });
  it('re-validates cached rows, so a review that ages out is dropped', async () => {
    // Evidence that is 30s short of the 14-day horizon is valid now, and expired 59s later (still cached).
    const edge = new Date(now - 14 * 86400000 + 30_000).toISOString();
    calls.result = { data: [{ ...row, left_captured_at: edge, right_captured_at: edge, reviewed_at: edge }], error: null };
    expect(await getCurrentPairReviews(now)).toHaveLength(1);
    expect(await getCurrentPairReviews(now + 59_000)).toHaveLength(0);
    expect(calls.since).toHaveLength(1);
  });
  it('fails closed with no reviews when the ledger is unavailable', async () => {
    calls.result = { data: null, error: new Error('relation does not exist') };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getCurrentPairReviews(now)).toEqual([]);
    expect(await getCurrentPairReviews(now + 61_000)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('durable approvals: only ACTIVE pairs are used, monitored, and may be older than 14 days', async () => {
    const old = '2026-08-01T10:00:00Z';
    const base = { left_offer_id: 'a', right_offer_id: 'b', classification: 'exact_product', left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
      left_evidence_at: at, right_evidence_at: at, reviewed_at: old, rationale: 'r', reviewer: 'owner' };
    calls.rpc = { data: [{ ...base, status: 'active' }, { ...base, left_offer_id: 'c', status: 'suspended_identity_changed' }], error: null };
    const reviews = await getCurrentPairReviews(now);
    expect(reviews).toEqual([expect.objectContaining({ left_offer_id: 'a', monitored: true, left_captured_at: at, reviewed_at: old })]);
    expect(calls.since).toHaveLength(0); // no fallback ledger read
  });
  it('durable read errors other than a missing function fail closed', async () => {
    calls.rpc = { data: null, error: { code: '57014', message: 'statement timeout' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getCurrentPairReviews(now)).toEqual([]);
    warn.mockRestore();
  });
});

