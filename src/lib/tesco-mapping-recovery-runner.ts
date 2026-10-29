/**
 * Bounded, supervised discovery RUNNER for the Tesco mapping-recovery pilot
 * (review point 3). Dependency-injected so the orchestration is unit-testable and
 * the live wiring (Pepesto search, optional fresh Tesco page, evidence persist) is
 * explicit.
 *
 * DISCOVERY-ONLY. It persists candidate evidence + classification and tracks cost,
 * and produces a per-product report. It NEVER:
 *  - calls finalize_tesco_candidate_discovery (no mapping SKU/URL change),
 *  - writes a trusted price_observations row,
 *  - changes a master canonical, clears a hold, or touches a pending request.
 *
 * Two-tier verification: tier 1 is the Pepesto search match; tier 2 (optional) is
 * a fresh Tesco product-page corroboration. exact_verified requires tier 2.
 */
import {
  classifySearchCandidates,
  verifyAgainstLivePage,
  type PilotCandidate,
  type PilotClassification,
  type DiscoveredCandidate,
} from '@/lib/tesco-mapping-recovery-pilot';
import type { TescoCollectedProduct } from '@/lib/tesco-direct-collection-core';

export type RunnerDeps = {
  /** Pepesto single-query search → discovered candidates for one product. */
  searchCandidates: (product: PilotCandidate) => Promise<DiscoveredCandidate[]>;
  /** Persist the per-candidate evidence rows (tesco_candidate_discovery_evidence). */
  persistEvidence: (input: {
    product: PilotCandidate;
    evidence: Array<{ candidate: DiscoveredCandidate; classification: string; reasons: string[] }>;
  }) => Promise<void>;
  /** Pepesto credit balance in cents, for cost tracking (before/after). */
  creditsCents: () => Promise<number>;
  /**
   * OPTIONAL tier-2 live verification: fetch the candidate SKU's fresh Tesco
   * product page. Omit to run tier-1-only (e.g. when a permitted live egress is
   * not available — never assume AWS direct Tesco). Returns ok=false on any
   * access/execution failure.
   */
  fetchLiveProduct?: (sku: string, url: string) => Promise<{ ok: boolean; product: TescoCollectedProduct | null }>;
  /** Pacing between products (ms). */
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
};

export type PilotProductResult = {
  storeProductId: string;
  canonicalName: string;
  storeSku: string | null;
  defect: PilotCandidate['defect'];
  recoverability: PilotCandidate['recoverability'];
  bothPeers: boolean;
  outcome: PilotClassification;
  proposedSku: string | null;      // a PROPOSAL for operator review; never applied
  proposedName: string | null;
  candidateCount: number;
  tier2Checked: boolean;
  reasons: string[];
};

export type PilotRunReport = {
  target: number;
  discoveryRequests: number;
  candidateYield: number;
  outcomes: Record<PilotClassification, number>;
  expectedNewThreeRetailerComparisons: number; // exact_verified AND both peers
  costCents: number;
  creditsBefore: number;
  creditsAfter: number;
  stoppedEarly: boolean;
  stopReason: string | null;
  results: PilotProductResult[];
};

const EMPTY_OUTCOMES: Record<PilotClassification, number> = {
  exact_verified: 0,
  search_matched_unverified: 0,
  plausible_more_evidence: 0,
  wrong_product_variant_pack: 0,
  no_reliable_candidate: 0,
  access_or_execution_failure: 0,
};

/**
 * Run the bounded discovery pilot over a pre-selected, pre-sampled cohort
 * (≤50). Orchestration only — all collection semantics live in the injected
 * deps + the pure classifiers. Stops early on an access/execution failure
 * (does not relax matching to raise the acceptance rate).
 */
export async function runDiscoveryPilot(cohort: PilotCandidate[], deps: RunnerDeps): Promise<PilotRunReport> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const spacing = deps.spacingMs ?? 1500;
  const creditsBefore = await deps.creditsCents();
  const outcomes: Record<PilotClassification, number> = { ...EMPTY_OUTCOMES };
  const results: PilotProductResult[] = [];
  let discoveryRequests = 0;
  let candidateYield = 0;
  let stoppedEarly = false;
  let stopReason: string | null = null;

  for (const product of cohort) {
    let candidates: DiscoveredCandidate[] = [];
    let accessFailure = false;
    try {
      candidates = await deps.searchCandidates(product);
      discoveryRequests += 1;
    } catch (error) {
      accessFailure = true;
      stopReason = `discovery request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    candidateYield += candidates.length;

    // Tier 1: classify the search candidates (never a trusted price).
    const tier1 = classifySearchCandidates(product, candidates, { accessOrExecutionFailure: accessFailure });

    // Persist evidence regardless of outcome (evidence-first; no mutation of mappings).
    if (tier1.evidence.length) {
      try { await deps.persistEvidence({ product, evidence: tier1.evidence }); }
      catch (error) { stopReason = `evidence persist failed: ${error instanceof Error ? error.message : String(error)}`; accessFailure = true; }
    }

    let outcome: PilotClassification = tier1.outcome;
    let reasons: string[] = [];
    let tier2Checked = false;

    // Tier 2: ONLY when a live fetcher is provided AND tier 1 found a single
    // search match. A fresh product-page corroboration is required for
    // exact_verified; otherwise the result stays search_matched_unverified.
    if (deps.fetchLiveProduct && tier1.outcome === 'search_matched_unverified' && tier1.searchCandidate?.sku) {
      tier2Checked = true;
      try {
        const live = await deps.fetchLiveProduct(tier1.searchCandidate.sku, tier1.searchCandidate.url);
        const v = verifyAgainstLivePage(product, tier1.searchCandidate, live);
        outcome = v.outcome;
        reasons = v.reasons;
        if (v.outcome === 'access_or_execution_failure') { accessFailure = true; stopReason = stopReason ?? 'live verification fetch failed'; }
      } catch (error) {
        outcome = 'access_or_execution_failure';
        accessFailure = true;
        stopReason = stopReason ?? `live verification failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    outcomes[outcome] += 1;
    results.push({
      storeProductId: product.storeProductId,
      canonicalName: product.canonicalName,
      storeSku: product.storeSku,
      defect: product.defect,
      recoverability: product.recoverability,
      bothPeers: product.bothPeers,
      outcome,
      proposedSku: tier1.searchCandidate?.sku ?? null,
      proposedName: tier1.searchCandidate?.name ?? null,
      candidateCount: candidates.length,
      tier2Checked,
      reasons,
    });

    // Stop on an access/execution failure — never relax matching to continue.
    if (accessFailure) { stoppedEarly = true; break; }
    if (spacing > 0) await sleep(spacing);
  }

  const creditsAfter = await deps.creditsCents();
  const expectedNewThreeRetailerComparisons = results.filter((r) => r.outcome === 'exact_verified' && r.bothPeers).length;

  return {
    target: cohort.length,
    discoveryRequests,
    candidateYield,
    outcomes,
    expectedNewThreeRetailerComparisons,
    costCents: Math.max(0, creditsBefore - creditsAfter),
    creditsBefore,
    creditsAfter,
    stoppedEarly,
    stopReason,
    results,
  };
}
