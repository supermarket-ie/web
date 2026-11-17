import { describe, expect, it, vi } from 'vitest';
import { INFERENCE_HARD_CEILING, INFERENCE_VERSION, inferenceRequest, reconcileFailed, reservationFor, runBounded, validateBudget, type Budget, type Ledger } from './branded-inference';
import type { Evidence } from './branded-product-identity';

const rec = (title: string, store: Evidence['store']): Evidence => ({ id: `${store}:${title.length}${store.length}00000`, store, sku: '1000000', url: 'https://x/product/1000000',
  title, brand: 'Heinz', gtin: null, source: { kind: 'refresh_attested', ref: 'r', at: '2026-10-10T00:00:00.000Z', url: null }, mappingIds: [], canonicalIds: [], conflicts: [], lastLiveVerifiedAt: null });
const reqs = (n: number) => Array.from({ length: n }, (_, i) => inferenceRequest(rec(`Heinz Beans ${i + 1}00g`, 'dunnes'), rec(`Heinz Beans ${i + 1}00g`, 'supervalu'), {}));
const verdict = { decision: 'exact_match', supportingAttributes: [], contradictions: [], missingEvidence: [], rationale: 'x', confidence: 0.5 };
const ok = () => vi.fn(async () => ({ result: verdict, usage: { inputTokens: 900, outputTokens: 300 } }));
const base: Budget = { campaign: 'dunnes-supervalu-wording-20261117', authorisedBy: 'owner', authorisedAt: '2026-11-17', maxCalls: 100, maxUsd: 10,
  batchSize: 10, inputUsdPerMillion: 3.3, outputUsdPerMillion: 16.5, rateSource: 'AWS Price List API', ratesCheckedAt: '2026-11-17' };
const fresh = (): Ledger => ({ version: INFERENCE_VERSION, model: 'fixture', entries: [] });

describe('authorised inference campaigns', () => {
  it('requires a named, authorised campaign and enforces the code backstop', () => {
    expect(() => validateBudget({ ...base, campaign: '' })).toThrow(/authorised campaign/);
    expect(() => validateBudget({ ...base, authorisedBy: ' ' })).toThrow(/authorised campaign/);
    expect(() => validateBudget({ ...base, maxUsd: INFERENCE_HARD_CEILING.maxUsd + 1 })).toThrow(/Campaign limits/);
    expect(() => validateBudget({ ...base, maxCalls: INFERENCE_HARD_CEILING.maxCalls + 1 })).toThrow(/Campaign limits/);
    expect(() => validateBudget({ ...base, batchSize: 0 })).toThrow(/batchSize/);
    expect(() => validateBudget({ ...base, inputUsdPerMillion: 0 })).toThrow(/rates/);
    expect(() => validateBudget(base)).not.toThrow();
  });
  it('never sends a call whose worst-case reservation would cross the campaign cap', async () => {
    const r = reqs(5), one = reservationFor(r[0], base).reservedUsd, cap = one * 2.5;
    const provider = ok(), ledger = fresh();
    await runBounded(r, provider, { ...base, maxUsd: cap }, ledger, async () => {});
    expect(provider).toHaveBeenCalledTimes(2);
    expect(ledger.entries.reduce((n, e) => n + e.reservedUsd, 0)).toBeLessThanOrEqual(cap);
    // Actual (estimated) spend can never exceed what was reserved.
    for (const e of ledger.entries) expect(e.usageCostEstimateUsd!).toBeLessThanOrEqual(e.reservedUsd);
  });
  it('caps are cumulative per campaign across runs; cache spans campaigns', async () => {
    const r = reqs(4), ledger = fresh(), p1 = ok();
    await runBounded(r.slice(0, 2), p1, { ...base, campaign: 'earlier-campaign', maxCalls: 2 }, ledger, async () => {});
    const p2 = ok();
    await runBounded(r, p2, { ...base, maxCalls: 1 }, ledger, async () => {});
    expect(p2).toHaveBeenCalledTimes(1); // the 2 cached requests are skipped, then the new campaign's 1-call cap stops it
    await runBounded(r, p2, { ...base, maxCalls: 1 }, ledger, async () => {});
    expect(p2).toHaveBeenCalledTimes(1); // re-running the same campaign adds nothing once its cap is used
    expect(ledger.entries.filter(e => e.campaign === base.campaign)).toHaveLength(1);
  });
  it('reports progress per batch and still stops (no retry) on an uncertain call', async () => {
    const r = reqs(7), batches: number[] = [];
    let n = 0;
    const provider = vi.fn(async () => { if (++n === 5) throw Error('timeout'); return { result: verdict, usage: { inputTokens: 900, outputTokens: 300 } }; });
    const ledger = fresh();
    await runBounded(r, provider, { ...base, batchSize: 3 }, ledger, async () => {}, p => { batches.push(p.campaignCalls); });
    expect(provider).toHaveBeenCalledTimes(5);
    expect(ledger.entries.at(-1)!.status).toBe('failed_unknown_spend');
    expect(batches).toEqual([3, 5]);
    await runBounded(r, provider, base, ledger, async () => {});
    expect(provider).toHaveBeenCalledTimes(5); // unresolved spend blocks every later call
  });
  it('an operator-reconciled failure stays counted at full reservation and is never re-sent', async () => {
    const r = reqs(4); let n = 0;
    const provider = vi.fn(async () => { if (++n === 2) throw Error('ThrottlingException'); return { result: verdict, usage: { inputTokens: 900, outputTokens: 300 } }; });
    const ledger = fresh();
    await runBounded(r, provider, base, ledger, async () => {});
    expect(ledger.entries[1].error).toMatch(/ThrottlingException/);
    expect(reconcileFailed(ledger, '2026-11-17T00:00:00.000Z')).toBe(1);
    await runBounded(r, provider, base, ledger, async () => {});
    expect(provider).toHaveBeenCalledTimes(4); // 2 earlier + the 2 not yet sent; the failed one is not repeated
    const failed = ledger.entries.find(e => e.status === 'failed_reconciled')!;
    expect(failed.reservedUsd).toBeGreaterThan(0);
    expect(ledger.entries.filter(e => e.id === failed.id)).toHaveLength(1);
  });
  it('stops when a provider exceeds the reserved output cap', async () => {
    const provider = vi.fn(async () => ({ result: verdict, usage: { inputTokens: 900, outputTokens: 5000 } }));
    const ledger = fresh();
    await runBounded(reqs(3), provider, { ...base, maxOutputTokens: 1400 }, ledger, async () => {});
    expect(provider).toHaveBeenCalledTimes(1);
    expect(ledger.entries[0].status).toBe('failed_unknown_spend');
  });
});
