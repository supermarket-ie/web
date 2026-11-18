import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake query builder: records the reviewed_at lower bound and returns the queued result.
const calls = vi.hoisted(() => ({ since: [] as string[], result: { data: [] as unknown[] | null, error: null as unknown },
  // Default: the durable-approval migration is not applied yet (PostgREST: function not found).
  rpc: { data: null as unknown[] | null, error: { code: 'PGRST202', message: 'Could not find the function public.current_pair_review_status' } as unknown },
  cap: 1000 /* server max-rows */ }));
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    gte: (_col: string, value: string) => { calls.since.push(value); return builder; },
    order: () => builder,
    range: async (from: number, to: number) => calls.result.error ? calls.result
      : { data: (calls.result.data ?? []).slice(from, Math.min(to + 1, from + calls.cap)), error: null },
  };
  return { supabaseAdmin: { from: () => builder, rpc: () => ({ range: async (from: number, to: number) => calls.rpc.error ? calls.rpc
    : { data: (calls.rpc.data ?? []).slice(from, Math.min(to + 1, from + calls.cap)), error: null } }) } };
});
import { getCurrentPairReviews, resetPairReviewCache } from './comparison-reviews';

const now = Date.parse('2026-11-17T12:00:00Z');
const at = '2026-11-17T10:00:00Z';
const row = { left_offer_id: 'a', right_offer_id: 'b', classification: 'exact_product', left_source_hash: 'a'.repeat(64),
  right_source_hash: 'b'.repeat(64), left_captured_at: at, right_captured_at: at, reviewed_at: at, rationale: 'r', reviewer: 'owner' };

describe('getCurrentPairReviews', () => {
  beforeEach(() => { resetPairReviewCache(); calls.since.length = 0; calls.result = { data: [row], error: null };
    calls.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.current_pair_review_status' } }; calls.cap = 1000; });
  it('limits the read to the 14-day horizon in SQL', async () => {
    expect(await getCurrentPairReviews(now)).toHaveLength(1);
    expect([...new Set(calls.since)]).toEqual(['2026-11-03T12:00:00.000Z']);
  });
  it('serves repeat reads within 60s from cache and refetches after', async () => {
    await getCurrentPairReviews(now);
    await getCurrentPairReviews(now + 30_000);
    expect(new Set(calls.since).size).toBe(1);
    await getCurrentPairReviews(now + 61_000);
    expect(new Set(calls.since).size).toBe(2);
  });
  it('re-validates cached rows, so a review that ages out is dropped', async () => {
    // Evidence that is 30s short of the 14-day horizon is valid now, and expired 59s later (still cached).
    const edge = new Date(now - 14 * 86400000 + 30_000).toISOString();
    calls.result = { data: [{ ...row, left_captured_at: edge, right_captured_at: edge, reviewed_at: edge }], error: null };
    expect(await getCurrentPairReviews(now)).toHaveLength(1);
    expect(await getCurrentPairReviews(now + 59_000)).toHaveLength(0);
    expect(new Set(calls.since).size).toBe(1);
  });
  it('fails closed with no reviews when the ledger is unavailable', async () => {
    calls.result = { data: null, error: new Error('relation does not exist') };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getCurrentPairReviews(now)).toEqual([]);
    expect(await getCurrentPairReviews(now + 61_000)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    // The failure itself is cached for 60s: no new read within the window.
    const before = calls.since.length;
    await getCurrentPairReviews(now + 62_000);
    expect(calls.since.length).toBe(before);
    warn.mockRestore();
  });
  it('durable approvals: only ACTIVE pairs are used, monitored, and may be older than 14 days', async () => {
    const old = '2026-08-01T10:00:00Z';
    const base = { left_offer_id: 'a', right_offer_id: 'b', classification: 'exact_product', left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
      left_evidence_at: at, right_evidence_at: at, reviewed_at: old, rationale: 'r', reviewer: 'owner' };
    // The function is called with p_active_only, but a suspended row is still never trusted if returned.
    calls.rpc = { data: [{ ...base, status: 'active' }, { ...base, left_offer_id: 'c', status: 'suspended_identity_changed' }], error: null };
    const reviews = await getCurrentPairReviews(now);
    // The ledger row in this fixture is positive: only NEGATIVE ledger decisions are added beside durable approvals.
    expect(reviews).toEqual([expect.objectContaining({ left_offer_id: 'a', monitored: true, left_captured_at: at, reviewed_at: old })]);
  });
  it('durable read errors other than a missing function fail closed', async () => {
    calls.rpc = { data: null, error: { code: '57014', message: 'statement timeout in current_pair_review_status' } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getCurrentPairReviews(now)).toEqual([]);
    warn.mockRestore();
  });
  it('recent negative decisions still reach the policy alongside durable approvals', async () => {
    calls.rpc = { data: [], error: null };
    calls.result = { data: [{ ...row, classification: 'not_comparable' }, row], error: null };
    const reviews = await getCurrentPairReviews(now);
    expect(reviews.map(r => r.classification)).toEqual(['not_comparable']);
  });
  it('pages past a server row cap smaller than the page size', async () => {
    calls.cap = 2;
    const base = { left_offer_id: 'a', right_offer_id: 'b', classification: 'exact_product', left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
      left_evidence_at: at, right_evidence_at: at, reviewed_at: at, rationale: 'r', reviewer: 'owner', status: 'active' };
    calls.rpc = { data: [1, 2, 3, 4, 5].map(i => ({ ...base, left_offer_id: `a${i}` })), error: null };
    calls.result = { data: [], error: null };
    expect(await getCurrentPairReviews(now)).toHaveLength(5);
  });
  it('a negative superseded by a newer (e.g. suspended) positive review does not resurface', async () => {
    calls.rpc = { data: [], error: null };
    const later = '2026-11-17T11:00:00Z';
    calls.result = { data: [{ ...row, classification: 'not_comparable' }, { ...row, reviewed_at: later, left_captured_at: later, right_captured_at: later }], error: null };
    expect(await getCurrentPairReviews(now)).toEqual([]);
  });
});

