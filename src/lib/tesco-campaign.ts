/**
 * Supervised Tesco recovery CAMPAIGN orchestrator.
 *
 * Drives the EXISTING supervised collector (collectTescoSupervised) through a
 * sequence of bounded runs so a single authorised campaign can process the full
 * eligible cohort (potentially hundreds of products) without stopping for known
 * catalogue conflicts or asking for approval after each batch.
 *
 * It changes NO collection semantics. Every run still enforces exact identity,
 * durable holds, no-price rejection, pacing, circuit breakers, Akamai/429 stops,
 * leases, cooldowns and idempotent finalisation. The orchestrator only decides
 * whether to START the NEXT bounded run, and aggregates a consolidated report.
 *
 * Safety rules encoded here:
 *  - Each run is bounded to <= maxPerRun (<=100). The campaign is bounded to a
 *    total request budget (default/authorised 1000).
 *  - Shared-SKU canonical groups are excluded from selection (excludeSharedSku);
 *    their deferral is reported, not collected.
 *  - It CONTINUES only after a run result of 'complete'. Any other result
 *    (access_block / rate_limited / identity_validation_anomaly / parse_error /
 *    network_error / unsafe_redirect / identity_hold_* / interrupted /
 *    unresolved_attempts / terminal_run / no_due_products) STOPS the campaign.
 *  - It NEVER resumes/retries a terminal or interrupted run and NEVER retries an
 *    unknown-outcome request. On any stop it reports and returns.
 *  - Between runs it reconciles the completed run and re-selects fresh eligibility
 *    (so holds/receipts from the prior run are respected). The next claim re-checks
 *    the lease/cooldown/ownership inside collectTescoSupervised; a lost gate
 *    surfaces as a non-'complete' result and stops the campaign.
 */
import {
  collectTescoSupervised, reconcileSupervisedRun, selectSupervisedCandidates,
  listExcludedSharedSkuGroups, countEligibleCandidates, type CollectionMode, type Dependencies,
  type DeferredSharedSkuGroup,
} from './tesco-supervised-collection';

export type CampaignOptions = {
  mode: CollectionMode;
  /** Total request budget for the whole campaign (authorised). Default 1000. */
  requestBudget?: number;
  /** Max requests per bounded run. Default/cap 100. */
  maxPerRun?: number;
};

export type CampaignRunRecord = {
  runId: string | null;
  result: string;
  target: number;
  inserted: number;        // accepted trusted observations this run
  held: number;            // ordinary product-level holds this run
  quarantined: number;     // quarantined ambiguous products this run
  completed: number;
  reserved: number;
  unresolved: string[];
};

// Terminal/systemic results that stop the campaign AND indicate a non-ordinary
// condition the operator should review (as opposed to the clean exhaustion of
// eligible work or the request budget).
const SYSTEMIC_STOP_RESULTS = new Set([
  'access_block', 'rate_limited', 'http_error', 'network_error', 'unsafe_redirect',
  'parse_error', 'identity_validation_anomaly',
  'identity_hold_consecutive_exceeded', 'identity_hold_rate_exceeded',
  'identity_quarantine_consecutive_exceeded', 'identity_quarantine_rate_exceeded',
  'interrupted', 'unresolved_attempts', 'terminal_run', 'gate_unavailable',
]);

export type CampaignReport = {
  mode: CollectionMode;
  stoppedReason: string;            // why the campaign stopped iterating
  stoppedSystemic: boolean;         // true when the stop was a systemic/terminal condition
  runs: CampaignRunRecord[];
  requestsIssued: number;           // sum of reserved pages across runs
  acceptedPrices: number;           // sum of successful receipts across runs
  ordinaryHolds: number;            // sum of ordinary product-level holds across runs
  quarantinedProducts: number;      // sum of quarantined ambiguous products across runs
  // Snapshot taken at campaign end (read-only):
  excludedSharedSkuGroups: DeferredSharedSkuGroup[];
  excludedSharedSkuMappings: number; // total mappings deferred via shared-SKU groups
  remainingEligible: number;        // ACTUAL non-shared eligible count (not capped at 100)
  unresolvedRequests: string[];     // any pending/unknown-outcome URLs seen
};

// Results that mean "stop the campaign" (anything other than a clean complete).
const CONTINUE_RESULT = 'complete';

export async function runTescoRecoveryCampaign(options: CampaignOptions, deps: Dependencies): Promise<CampaignReport> {
  const mode = options.mode;
  if (mode !== 'renewal' && mode !== 'expansion') throw new Error('Campaign requires mode renewal|expansion');
  const requestBudget = options.requestBudget ?? 1000;
  const maxPerRun = Math.min(options.maxPerRun ?? 100, 100);
  if (!Number.isInteger(requestBudget) || requestBudget < 1) throw new Error('requestBudget must be a positive integer');
  if (!Number.isInteger(maxPerRun) || maxPerRun < 1) throw new Error('maxPerRun must be 1-100');

  const { execute } = deps;
  const runs: CampaignRunRecord[] = [];
  let requestsIssued = 0;
  let acceptedPrices = 0;
  let ordinaryHolds = 0;
  let quarantinedProducts = 0;
  const unresolvedRequests: string[] = [];
  let stoppedReason = 'budget_exhausted';

  while (requestsIssued < requestBudget) {
    const remainingBudget = requestBudget - requestsIssued;
    const limit = Math.min(maxPerRun, remainingBudget);

    // Re-select fresh eligibility each iteration (respects new holds/receipts and
    // excludes shared-SKU groups). If nothing is eligible, the campaign is done.
    const next = await selectSupervisedCandidates(execute, mode, limit, { excludeSharedSku: true });
    if (next.length === 0) { stoppedReason = 'no_more_eligible'; break; }

    // Run ONE bounded batch through the unchanged collector.
    const result = await collectTescoSupervised({ mode, limit, excludeSharedSku: true }, deps) as Record<string, unknown>;
    const runId = typeof result.id === 'string' ? result.id : null;
    const reconciled = runId ? await reconcileSupervisedRun(execute, runId) as Record<string, unknown> : null;
    const reserved = Number(reconciled?.reserved ?? 0);
    const inserted = Number(reconciled?.inserted ?? 0);
    const held = Number(reconciled?.held ?? 0);
    const quarantined = Number(reconciled?.quarantined ?? 0);
    const completed = Number(reconciled?.completed ?? 0);
    const unresolved = Array.isArray(reconciled?.unresolved) ? reconciled!.unresolved as string[] : [];

    runs.push({ runId, result: String(result.result), target: next.length, inserted, held, quarantined, completed, reserved, unresolved });
    requestsIssued += reserved;
    acceptedPrices += inserted;
    ordinaryHolds += held;
    quarantinedProducts += quarantined;
    for (const u of unresolved) if (!unresolvedRequests.includes(u)) unresolvedRequests.push(u);

    // Continue ONLY on a clean complete. Any other result stops the campaign:
    // we never resume a terminal/interrupted run or retry an unknown request.
    if (String(result.result) !== CONTINUE_RESULT) { stoppedReason = String(result.result); break; }
  }

  // Final read-only snapshot for the consolidated report.
  const excludedSharedSkuGroups = await listExcludedSharedSkuGroups(execute, mode);
  const excludedSharedSkuMappings = excludedSharedSkuGroups.reduce((n, g) => n + g.member_count, 0);
  const remainingEligible = await countEligibleCandidates(execute, mode, { excludeSharedSku: true });

  return {
    mode,
    stoppedReason,
    stoppedSystemic: SYSTEMIC_STOP_RESULTS.has(stoppedReason),
    runs,
    requestsIssued,
    acceptedPrices,
    ordinaryHolds,
    quarantinedProducts,
    excludedSharedSkuGroups,
    excludedSharedSkuMappings,
    remainingEligible,
    unresolvedRequests,
  };
}
