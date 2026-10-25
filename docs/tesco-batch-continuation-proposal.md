# Proposal: hold-and-continue on ordinary identity mismatches (review only)

Status: PROPOSAL for review. No production behaviour is changed by this document.
Objective: let one ordinary, well-classified product-level identity mismatch be
checkpointed, held and SKIPPED so the supervised collector continues to the next
independently eligible product — without ever accepting a price that fails exact
identity, and without weakening any validation, hold, pacing, stop or
idempotency guarantee.

## 1. Current behaviour (why one mismatch ends the batch)

In `src/lib/tesco-supervised-collection.ts`, the per-product loop computes:

```
identityStop = outcome === 'ok' && reasons.some(r => r !== 'unavailable_or_no_regular_price')
pageStop     = transportStop ? outcome : identityStop ? 'identity_validation_anomaly' : null
...
if (pageStop) { stopReason = pageStop; break; }   // <-- terminates the WHOLE batch
```

So ANY identity rejection (any reason except the benign "no regular price") breaks
the loop. The recent 1kg-vs-700g case (`measureExactnessFailed`/`measureConflict`)
is an ordinary, well-understood, single-product mismatch, yet it stopped the batch.

KEY SAFETY FACT: the per-product rejection is ALREADY durably checkpointed before
the break. The atomic checkpoint DO block updates the product's
`tesco_direct_collection_pages` row (outcome, body hash, full `identity_results`
reasons, detail) regardless of accept/reject, and it does NOT finalise a price
when `accepted=false`. The hold is therefore already written per product; only the
control-flow decision (break vs continue) is at issue. This keeps the change
surface very small.

## 2. Proposed classification policy

Each `ok`-page rejection reason is classified CONTINUE (ordinary product-level
mismatch — hold this product, skip to next) or STOP (systemic/ambiguous — halt the
batch, as today). Default is STOP (fail-closed): any reason not explicitly on the
CONTINUE allow-list stops the batch.

CONTINUE — ordinary, deterministic, single-product attribute mismatch on a clean
HTTP 200 where the requested SKU WAS found in the page:
- `measureExactnessFailed`, `measureConflict`      (size/measure, e.g. 1kg vs 700g)
- `packExactnessFailed`, `packCountConflict`        (pack count)
- `brandExactnessFailed`, `brandConflict`           (brand)
- `variantConflict`, `formulationConflict`          (variant/formulation)
- `freshFrozenConflict`, `productTypeConflict`      (product form/type)
- `ownLabelConflict`                                (own-label vs branded)
- `raw_ingredient_prepared_meal_conflict`           (raw-vs-prepared guard)
- `candidate does not establish full exact canonical identity` (ambiguous/generic
  single-product identity — conservatively a HOLD, not a batch-wide signal)

STOP — systemic, mapping-integrity, or response-integrity signals (unchanged hard
stops):
- `different_sku_requires_mapping_review`, `urlSkuConflict`  (SKU/URL do not
  corroborate — a mapping-integrity problem, not a product attribute)
- `missing_exact_product`  (requested SKU not present in the parsed page — could be
  a soft block / listing or parse-scope anomaly; stop conservatively)
- `duplicate SKU group requires identity review` / duplicate-canonical guard
  (structural mapping ambiguity that can affect peers)
- `acquisition_live_identity_not_exact`  (expansion acquisition-handoff snapshot
  disagreement — handoff integrity)
- ANY reason not on the CONTINUE list (fail-closed default)

Also unchanged HARD STOPS (independent of identity — never reclassified):
- Transport: `access_block` (401/403/challenge), `rate_limited` (429),
  `http_error`, `network_error`, `unsafe_redirect`, `parse_error`.
- Lease/ownership loss, lost acknowledgement / interrupted, pacing failure,
  mapping/acquisition snapshot change under lock, `observation_changed`.

SYSTEMIC-ANOMALY CIRCUIT BREAKER (implemented, protective): even for CONTINUE
reasons, stop the batch if EITHER (a) **3 consecutive** product-level holds occur
(`identity_hold_consecutive_exceeded`), or (b) the batch-wide hold RATE **exceeds
40% after at least 10 attempts** (`identity_hold_rate_exceeded`). A run of
rejections is itself a signal (changed site structure, a bad mapping cohort, or a
soft block manifesting as "wrong product"), so hold-and-continue is bounded.
An acceptance resets the consecutive counter; totalHolds and attempts are
cumulative. All three counters are PERSISTED in `scrape_runs.error_summary` and
re-seeded on resume, so interruption/resume cannot reset or bypass the breaker.

REVIEW REFINEMENTS APPLIED: (1) `accept` iff productFound && reasons.length===0;
`unavailable_or_no_regular_price` is a non-accepting, non-terminal `skip_no_price`.
(2) `candidate does not establish full exact canonical identity` (ambiguous) is
STOP, not hold, pending stronger evidence. (3) breaker 3-consecutive + 40%-after-10.

NEVER-ACCEPT invariant (unchanged): `accepted = outcome==='ok' && reasons.length
=== 0 && product != null`. A CONTINUE classification only changes whether we move
to the next product; it NEVER makes a rejected product acceptable. Exact SKU,
brand, variant, pack, quantity, formulation and duplicate-canonical validation are
untouched.

## 3. Minimal implementation sketch (NOT applied)

Introduce a pure, unit-testable classifier and use it only to choose break vs
continue AFTER the existing durable rejection checkpoint has committed:

```ts
// pure function; no I/O
type IdentityDisposition = 'accept' | 'hold_continue' | 'stop';
function classifyIdentityOutcome(reasons: string[], productFound: boolean): IdentityDisposition {
  const effective = reasons.filter(r => r !== 'unavailable_or_no_regular_price');
  if (effective.length === 0 && productFound) return 'accept';
  if (!productFound) return 'stop';                       // missing_exact_product
  return effective.every(r => CONTINUE_REASONS.has(r)) ? 'hold_continue' : 'stop';
}
```

Loop change (conceptual) — the rejection checkpoint is the SAME atomic DO block as
today; only the post-checkpoint decision changes:

```
// after the durable checkpoint (page row updated to the rejected outcome +
// identity_results + detail, committed and acknowledged):
if (disposition === 'stop') { stopReason = pageStop; break; }
if (disposition === 'hold_continue') {
  consecutiveHolds += 1;
  if (consecutiveHolds >= MAX_CONSECUTIVE_HOLDS) { stopReason = 'identity_hold_rate_exceeded'; break; }
  continue;                 // move to the next independently eligible product
}
// accept path unchanged (finalise), and resets consecutiveHolds = 0
```

Durability ordering (critical, unchanged semantics):
- CONTINUE only happens AFTER the rejection checkpoint DO block has returned
  successfully (durably acknowledged). If that acknowledgement is uncertain/lost,
  the existing path treats it as `interrupted` and STOPS — we do NOT continue on an
  unacknowledged checkpoint.
- The product's page row remains the authoritative hold. On resume, the existing
  `held` predicate + `completedUrls` replay prevent re-requesting a held product;
  a reserved-but-unresolved (`pending`) row still blocks resume with
  `unresolved_attempts`. So restarts cannot duplicate requests or bypass holds.
- Pacing (10s), lease (10m), owner guard, and finalisation idempotency are all
  unchanged and still enforced per product on each iteration.

New stop reasons added to the vocabulary: `identity_hold_rate_exceeded` (circuit
breaker). Per-product holds continue to carry their specific identity reasons in
`identity_results`.

## 4. Regression test plan (to be ADDED with the implementation)

Harness: the existing PGlite in-memory Postgres in
`src/lib/tesco-supervised-collection.test.ts` (runs the real finaliser + schema +
cooldown migration). New cases:

A. Interspersed holds + successes (the headline case):
   batch [accept, measureConflict-hold, accept, packConflict-hold, accept] →
   result complete; 3 accepted observations; 2 held page rows with correct
   reasons; prior rows for held products unchanged; lease released; gate healthy.

B. Hold then continue durability: assert the held page row is committed
   (outcome<>'ok', identity_results populated) BEFORE the next product's reserve
   happens (order-of-operations), and that NO price is finalised for a held product.

C. STOP reasons still stop: `different_sku_requires_mapping_review`,
   `missing_exact_product`, duplicate-canonical, `acquisition_live_identity_not_exact`
   each terminate the batch with the correct stopReason and leave later products
   un-requested.

D. Circuit breaker: N consecutive holds → stop with `identity_hold_rate_exceeded`;
   and a success before N resets the counter (N-1 holds, accept, N-1 holds → no trip).

E. Transport/access still stop mid-batch: an `access_block` / `429` on product 2
   stops the batch, persists cooldown before checkpoint, and does NOT request
   product 3 — unchanged.

F. Interruption / lost acknowledgement during a hold: if the rejection checkpoint
   acknowledgement is lost, the run is `interrupted` and STOPS; on resume the held
   product is not re-requested and no duplicate row is created.

G. Restart cannot bypass a hold: after a hold-and-continue batch, a fresh
   selection excludes the held products (via the `held` predicate) and a resume of
   the interrupted run replays only non-completed URLs.

H. Never-accept: a held product with a borderline reason is never finalised; only
   reasons.length===0 products produce observations (reuse existing identity tests).

Also add pure unit tests for `classifyIdentityOutcome` over every CONTINUE and STOP
reason token and the fail-closed default.

## 5. Rollout boundary

Review this policy + test evidence FIRST. On approval, implement behind the same
collector (no schedule change), run the full suite (incl. the new cases) and the
behavioural gate, and land via PR. Production collection behaviour is unchanged
until that reviewed PR is merged and a supervised operator opts into it. No AWS
Tesco schedule is enabled by this work.
