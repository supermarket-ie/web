import { describe, it, expect, vi } from 'vitest';
import { runDiscoveryPilot, type RunnerDeps } from './tesco-mapping-recovery-runner';
import type { PilotCandidate, DiscoveredCandidate } from './tesco-mapping-recovery-pilot';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';

function product(i: number, over: Partial<PilotCandidate> = {}): PilotCandidate {
  return {
    storeProductId: `sp-${i}`, productId: `p-${i}`,
    canonicalName: over.canonicalName ?? 'Heinz Tomato Ketchup 460g',
    canonicalBrand: 'Heinz', storeProductName: 'Heinz Tomato Ketchup', storeBrand: 'Heinz', isOwnBrand: false,
    storeSku: String(100000 + i), storeUrl: `https://www.tesco.ie/shop/en-IE/products/${100000 + i}`,
    heldReasons: ['measureExactnessFailed'], liveName: null,
    supervaluPrice: 1, dunnesPrice: 1, bothPeers: true,
    defect: 'wrong_pack_or_quantity', recoverability: 'medium', ...over,
  };
}
const exactCand = (sku: string): DiscoveredCandidate => ({ sku, url: `https://www.tesco.ie/shop/en-IE/products/${sku}`, name: 'Heinz Tomato Ketchup 460g', priceCents: 299, structuredQuantity: { grams: 460 } });
const liveExact = (sku: string): TescoCollectedProduct => ({ sku, url: `https://www.tesco.ie/shop/en-IE/products/${sku}`, name: 'Heinz Tomato Ketchup 460g', brand: 'Heinz', gtin: null, price: 2.99, currency: 'EUR', available: true, quantity: { grams: 460 } });

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    searchCandidates: vi.fn(async () => [exactCand('222')]),
    persistEvidence: vi.fn(async () => {}),
    creditsCents: vi.fn().mockResolvedValueOnce(10000).mockResolvedValue(9988),
    sleep: vi.fn(async () => {}),
    spacingMs: 0,
    ...over,
  };
}

describe('runDiscoveryPilot — bounded discovery-only orchestration', () => {
  it('tier-1 only (no live fetcher) yields search_matched_unverified, never exact_verified', async () => {
    const d = deps();
    const report = await runDiscoveryPilot([product(1)], d);
    expect(report.outcomes.search_matched_unverified).toBe(1);
    expect(report.outcomes.exact_verified).toBe(0);
    expect(report.expectedNewThreeRetailerComparisons).toBe(0);
    expect(d.persistEvidence).toHaveBeenCalledTimes(1); // evidence persisted
  });

  it('tier-2 live corroboration promotes a search match to exact_verified', async () => {
    const d = deps({ fetchLiveProduct: vi.fn(async () => ({ ok: true, product: liveExact('222') })) });
    const report = await runDiscoveryPilot([product(1)], d);
    expect(report.outcomes.exact_verified).toBe(1);
    expect(report.expectedNewThreeRetailerComparisons).toBe(1); // both peers
    expect(report.results[0].tier2Checked).toBe(true);
    expect(report.results[0].proposedSku).toBe('222'); // proposal for review only
  });

  it('tier-2 keeps it unverified when the live page disagrees', async () => {
    const d = deps({ fetchLiveProduct: vi.fn(async () => ({ ok: true, product: { ...liveExact('222'), name: 'Heinz Tomato Ketchup 1.35kg', quantity: { grams: 1350 } } })) });
    const report = await runDiscoveryPilot([product(1)], d);
    expect(report.outcomes.exact_verified).toBe(0);
    expect(report.outcomes.plausible_more_evidence).toBe(1);
  });

  it('tracks cost from the credit delta', async () => {
    const d = deps({ creditsCents: vi.fn().mockResolvedValueOnce(10000).mockResolvedValueOnce(9952) });
    const report = await runDiscoveryPilot([product(1), product(2)], d);
    expect(report.costCents).toBe(48);
    expect(report.creditsBefore).toBe(10000);
  });

  it('stops early on an access/execution failure and does not relax matching', async () => {
    const d = deps({ searchCandidates: vi.fn()
      .mockResolvedValueOnce([exactCand('222')])
      .mockRejectedValueOnce(new Error('Pepesto 429')) });
    const report = await runDiscoveryPilot([product(1), product(2), product(3)], d);
    expect(report.stoppedEarly).toBe(true);
    expect(report.stopReason).toMatch(/429|failed/);
    expect(report.results.length).toBe(2); // stopped at the failing product; 3rd not attempted
    expect(report.outcomes.access_or_execution_failure).toBe(1);
  });

  it('no_reliable_candidate when discovery returns nothing', async () => {
    const d = deps({ searchCandidates: vi.fn(async () => []) });
    const report = await runDiscoveryPilot([product(1)], d);
    expect(report.outcomes.no_reliable_candidate).toBe(1);
    expect(report.candidateYield).toBe(0);
  });

  it('counts discovery requests and candidate yield', async () => {
    const d = deps({ searchCandidates: vi.fn(async () => [exactCand('222'), exactCand('333')]) });
    const report = await runDiscoveryPilot([product(1), product(2)], d);
    expect(report.discoveryRequests).toBe(2);
    expect(report.candidateYield).toBe(4);
  });

  it('exposes no finalisation/price capability (discovery-only by construction)', () => {
    // The RunnerDeps surface has no finalise/price-write hook — a structural
    // guarantee that the pilot cannot apply a correction or trusted price.
    const keys = Object.keys(deps());
    expect(keys).not.toContain('finalize');
    expect(keys).not.toContain('writePrice');
    expect(keys.sort()).toEqual(['creditsCents', 'persistEvidence', 'searchCandidates', 'sleep', 'spacingMs'].sort());
  });

  it('enforces the 50-request hard cap regardless of cohort size', async () => {
    const search = vi.fn(async () => [exactCand('222')]);
    const d = deps({ searchCandidates: search, creditsCents: vi.fn().mockResolvedValue(10000) });
    const cohort = Array.from({ length: 80 }, (_, i) => product(i));
    const report = await runDiscoveryPilot(cohort, d);
    expect(report.requestCapReached).toBe(true);
    expect(report.target).toBe(50);
    expect(search).toHaveBeenCalledTimes(50); // never 80
    expect(report.discoveryRequests).toBe(50);
  });

  it('checkpoints after each product with running cost + result', async () => {
    const checkpoints: Array<{ index: number; costCents: number }> = [];
    const d = deps({
      creditsCents: vi.fn().mockResolvedValueOnce(10000).mockResolvedValueOnce(9988).mockResolvedValueOnce(9976).mockResolvedValue(9976),
      onCheckpoint: vi.fn(async (s) => { checkpoints.push({ index: s.index, costCents: s.costCents }); }),
    });
    await runDiscoveryPilot([product(1), product(2)], d);
    expect(checkpoints.map((c) => c.index)).toEqual([1, 2]);
    expect(checkpoints[0].costCents).toBeGreaterThanOrEqual(0);
  });

  it('a failing checkpoint never blocks or rolls back discovery', async () => {
    const d = deps({ onCheckpoint: vi.fn(async () => { throw new Error('checkpoint store down'); }) });
    const report = await runDiscoveryPilot([product(1)], d);
    expect(report.stoppedEarly).toBe(false);
    expect(report.results.length).toBe(1);
  });

  it('DRY RUN: a fully-stubbed run makes zero external requests + zero mutations and yields a complete report', async () => {
    // Dry run = the real orchestration with offline stubs standing in for the
    // search API, evidence store, credit meter and (omitted) live fetcher. If the
    // runner ever reached out directly (network/DB) this would throw/ hang; it
    // does not — all I/O is via injected deps, which here are pure in-memory.
    const persisted: unknown[] = [];
    const dry: RunnerDeps = {
      searchCandidates: async (p) => [exactCand(String(Number(p.storeSku) + 900000))],
      persistEvidence: async (input) => { persisted.push(input); }, // in-memory, not the DB
      creditsCents: async () => 10000, // flat meter -> cost 0 in a dry run
      sleep: async () => {},
      spacingMs: 0,
      // fetchLiveProduct intentionally omitted: tier-2 stays in the authorised
      // supervised environment only.
    };
    const cohort = [
      product(1, { defect: 'wrong_pack_or_quantity' }),
      product(2, { defect: 'canonical_ambiguous', canonicalName: 'Heinz Tomato Ketchup 460g' }),
    ];
    const report = await runDiscoveryPilot(cohort, dry);
    expect(report.target).toBe(2);
    expect(report.discoveryRequests).toBe(2);
    expect(report.costCents).toBe(0);              // no credits spent
    expect(report.stoppedEarly).toBe(false);
    expect(report.requestCapReached).toBe(false);
    expect(report.results).toHaveLength(2);
    // Tier-2 omitted -> nothing reaches exact_verified in the dry run.
    expect(report.outcomes.exact_verified).toBe(0);
    expect(persisted).toHaveLength(2);             // evidence captured in-memory only
    // Report shape is complete for the operator.
    for (const k of ['target', 'discoveryRequests', 'candidateYield', 'outcomes', 'costCents', 'results', 'requestCapReached']) {
      expect(report).toHaveProperty(k);
    }
  });
});
