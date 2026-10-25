/**
 * PROPOSAL (review only) — pure classifier for the hold-and-continue policy.
 *
 * This module is NOT yet wired into the supervised collector. It exists so the
 * classification policy in docs/tesco-batch-continuation-proposal.md can be
 * reviewed with executable test evidence. It makes NO decision about acceptance:
 * a price is accepted elsewhere ONLY when reasons.length === 0 (exact identity).
 * This function only decides, for a REJECTED product, whether the batch may hold
 * that product and continue, or must stop.
 */

export type IdentityDisposition = 'accept' | 'hold_continue' | 'stop';

// Benign: "no regular price" is not an identity anomaly (existing behaviour).
export const BENIGN_REASON = 'unavailable_or_no_regular_price';

/**
 * Ordinary, deterministic, single-product attribute mismatches on a clean 200
 * where the requested SKU was found. Safe to hold-and-continue. Fail-closed:
 * anything not in this set STOPS the batch.
 */
export const CONTINUE_REASONS: ReadonlySet<string> = new Set([
  // measure / quantity (e.g. 1kg vs 700g)
  'measureExactnessFailed',
  'measureConflict',
  // pack count
  'packExactnessFailed',
  'packCountConflict',
  // brand
  'brandExactnessFailed',
  'brandConflict',
  // variant / formulation / form / type / own-label
  'variantConflict',
  'formulationConflict',
  'freshFrozenConflict',
  'productTypeConflict',
  'ownLabelConflict',
  // raw-ingredient vs prepared-meal guard
  'raw_ingredient_prepared_meal_conflict',
  // ambiguous/generic single-product identity — conservatively a hold
  'candidate does not establish full exact canonical identity',
]);

/**
 * Systemic / mapping-integrity / response-integrity signals that must STOP the
 * whole batch even though they appear as "identity" reasons. Listed for clarity;
 * the fail-closed default already stops anything not in CONTINUE_REASONS.
 */
export const STOP_REASONS: ReadonlySet<string> = new Set([
  'different_sku_requires_mapping_review',
  'urlSkuConflict',
  'missing_exact_product',
  'duplicate SKU group requires identity review',
  'acquisition_live_identity_not_exact',
]);

/**
 * Decide disposition for a product after a clean (ok) fetch + identity check.
 * @param reasons     identity reasons from validateTescoCollectedIdentity (+ handoff)
 * @param productFound whether the requested SKU was present in the parsed page
 */
export function classifyIdentityOutcome(reasons: readonly string[], productFound: boolean): IdentityDisposition {
  const effective = reasons.filter((r) => r !== BENIGN_REASON);
  if (effective.length === 0 && productFound) return 'accept';
  // Requested SKU absent from the page → treat as systemic (soft block / parse
  // / listing anomaly), never an ordinary attribute mismatch.
  if (!productFound) return 'stop';
  // Hold-and-continue only when EVERY effective reason is an ordinary
  // product-level mismatch; otherwise fail-closed stop.
  return effective.every((r) => CONTINUE_REASONS.has(r)) ? 'hold_continue' : 'stop';
}

/** Default consecutive-hold circuit-breaker threshold (proposal). */
export const MAX_CONSECUTIVE_HOLDS = 5;
