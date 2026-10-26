/**
 * Pure classifier for the hold-and-continue batch policy.
 *
 * It makes NO acceptance decision beyond the strict invariant below: a price is
 * finalised by the collector ONLY when the product was found AND reasons.length
 * === 0 (exact identity). This function decides, for each fetched product,
 * whether the batch may: accept it, skip it as a benign no-price (non-accepting,
 * non-terminal), hold it and continue (ordinary product-level mismatch), or stop
 * the batch (systemic / ambiguous / unknown — fail-closed).
 */

export type IdentityDisposition = 'accept' | 'skip_no_price' | 'hold_continue' | 'quarantine_continue' | 'stop';

// Benign: "no regular price" is not an identity anomaly and must NOT terminate
// the batch, but it is also NOT an acceptance.
export const BENIGN_REASON = 'unavailable_or_no_regular_price';

/**
 * Ordinary, deterministic, single-product attribute mismatches on a clean 200
 * where the requested SKU was found. Safe to hold-and-continue. Fail-closed:
 * anything not in this set STOPS the batch.
 *
 * NOTE: 'candidate does not establish full exact canonical identity' (ambiguous
 * / generic) is deliberately NOT here — it remains a STOP until we have stronger
 * evidence for safely classifying it (per review refinement 2).
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
]);

/**
 * NARROW quarantine set: ambiguous CANONICAL-identity rejections that are
 * confined to a single product's identity (the live Tesco product is a genuinely
 * different product than the stored canonical — e.g. "Heinz By Nature Chicken
 * Dinner" mapped to live "Heinz Sunday Chicken Dinner"). These may be
 * QUARANTINED-and-skipped — the product is durably rejected/held and the campaign
 * continues — but ONLY under the strict positive-evidence gate in
 * classifyIdentityOutcome (clean ok page, requested SKU found + corroborated, no
 * material duplicate-canonical conflict). This is NOT a blanket allow-list: it is
 * a single, well-understood canonical-identity reason, disjoint from the ordinary
 * attribute CONTINUE set and from the systemic STOP set, and the fail-closed
 * default still STOPS anything not explicitly classified.
 */
export const QUARANTINE_REASONS: ReadonlySet<string> = new Set([
  'candidate does not establish full exact canonical identity',
]);

/**
 * Systemic / mapping-integrity / response-integrity signals that must STOP the
 * whole batch. Listed for clarity and documentation; the fail-closed default
 * already stops anything not in CONTINUE_REASONS or QUARANTINE_REASONS.
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
 * @param reasons      identity reasons from validateTescoCollectedIdentity (+ handoff)
 * @param productFound whether the requested SKU was present in the parsed page
 * @param materialDuplicateConflict true when the product's same-SKU canonical
 *   mapping GROUP has a MATERIAL duplicate-canonical conflict (distinct canonical
 *   identities sharing one SKU), independently inspected by the caller. This must
 *   force a hard STOP even when the ordinary validator returned an attribute
 *   conflict (measure/brand/variant/pack/etc) FIRST and masked it. Genuine
 *   canonical synonyms (equivalent term-sets) are NOT a material conflict and do
 *   not set this flag.
 */
export function classifyIdentityOutcome(
  reasons: readonly string[],
  productFound: boolean,
  materialDuplicateConflict = false,
): IdentityDisposition {
  // Requested SKU absent from the page → systemic (soft block / parse / listing
  // anomaly), never an ordinary attribute mismatch.
  if (!productFound) return 'stop';
  // A material duplicate-canonical conflict is a hard stop regardless of any
  // ordinary attribute reason that may have been returned first (the masking bug
  // this guards against). Checked before accept/skip/hold so it cannot be
  // bypassed — though in practice a material duplicate group also yields reasons.
  if (materialDuplicateConflict) return 'stop';
  // Strict accept invariant: product found AND no reasons at all.
  if (reasons.length === 0) return 'accept';
  // Benign no-price only (product found): non-accepting, non-terminal skip.
  const effective = reasons.filter((r) => r !== BENIGN_REASON);
  if (effective.length === 0) return 'skip_no_price';
  // Hold-and-continue when EVERY effective reason is an ordinary product-level
  // attribute mismatch (measure/brand/variant/pack/etc).
  if (effective.every((r) => CONTINUE_REASONS.has(r))) return 'hold_continue';
  // Quarantine-and-continue ONLY when the (product-found, non-duplicate) gates
  // above hold AND every effective reason is in the narrow canonical-identity
  // quarantine set — i.e. this one product's live identity is a different product
  // than the stored canonical, confined to it. Mixed with any non-quarantine
  // reason, or any systemic/unknown reason, falls through to the fail-closed stop.
  if (effective.every((r) => QUARANTINE_REASONS.has(r))) return 'quarantine_continue';
  // Fail-closed: systemic (STOP_REASONS), unknown, or mixed reasons stop the batch.
  return 'stop';
}

/**
 * Circuit-breaker bounds (review refinement 3):
 *  - stop after this many CONSECUTIVE product-level identity holds, and
 *  - stop once the batch-wide hold RATE exceeds the threshold after a minimum
 *    number of attempts.
 * An acceptance resets the consecutive counter; the rate is cumulative over the
 * run and (together with the consecutive counter) is persisted in run state so
 * interruption/resume cannot reset or bypass it.
 */
export const MAX_CONSECUTIVE_HOLDS = 3;
export const HOLD_RATE_MIN_ATTEMPTS = 10;
export const HOLD_RATE_THRESHOLD = 0.4;

/**
 * Whether the circuit breaker trips given cumulative counters.
 * @param consecutiveHolds holds since the last acceptance
 * @param totalHolds       cumulative product-level holds in the run
 * @param attempts         cumulative identity-evaluated attempts in the run
 *                         (accepts + holds + no-price skips; NOT transport stops)
 */
export function holdCircuitTripped(consecutiveHolds: number, totalHolds: number, attempts: number): false | 'consecutive' | 'rate' {
  if (consecutiveHolds >= MAX_CONSECUTIVE_HOLDS) return 'consecutive';
  if (attempts >= HOLD_RATE_MIN_ATTEMPTS && totalHolds / attempts > HOLD_RATE_THRESHOLD) return 'rate';
  return false;
}

/**
 * SEPARATE quarantine circuit breaker (review requirement 5). A proven isolated
 * product-level quarantine (clean page, SKU corroborated, confined canonical-
 * identity mismatch) is NOT a systemic-anomaly signal, so it is counted on its
 * own axis with its own protective thresholds — independent of the ordinary-hold
 * breaker. Quarantines can legitimately be more frequent than attribute holds
 * (mismappings exist across the catalogue), so the thresholds are more tolerant
 * than the hold breaker but still bounded: a LONG run of consecutive quarantines,
 * or a very high quarantine rate, still indicates a bad selection cohort or a
 * subtle systemic problem and stops the campaign for review.
 */
export const MAX_CONSECUTIVE_QUARANTINES = 8;
export const QUARANTINE_RATE_MIN_ATTEMPTS = 20;
export const QUARANTINE_RATE_THRESHOLD = 0.6;

export function quarantineCircuitTripped(consecutiveQuarantines: number, totalQuarantines: number, attempts: number): false | 'consecutive' | 'rate' {
  if (consecutiveQuarantines >= MAX_CONSECUTIVE_QUARANTINES) return 'consecutive';
  if (attempts >= QUARANTINE_RATE_MIN_ATTEMPTS && totalQuarantines / attempts > QUARANTINE_RATE_THRESHOLD) return 'rate';
  return false;
}
