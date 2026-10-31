# Tesco held-mapping audited re-entry — review-only proposal

**Status:** code and migration proposed for review. **Not deployed.** No held
SKU may be collected or finalised under this mechanism until a separate
deployment, evidence-review and collection authorisation.

## Scope and priority

The existing supervised SQL bridge, Irish Tesco page fetcher, page parser,
identity validator and `finalize_store_scrape_product` remain unchanged.
The normal expansion selector still refuses held mappings. The exceptional
path is explicit `--reviewed-candidates`, which accepts 1–100 **review
UUIDs**, never unchecked Tesco SKUs. No automatic approval of a mapping.

Start with the **183 held, unique-SKU mappings with two fresh retailer
peers**, not random Tesco product IDs. A 31 October read-only assessment
found 143 with a historical success receipt, 180 with a parsed retained
Tesco source page, and 142 with both (and no fresh 24-hour attempt or
pending request). These are technical preflight signals, **not** exact
identity verdicts or approvals. The one pending request among the 183,
and all six historically unresolved Tesco requests, remain untouched.
The actual read-only ranking output was 23 `likely_exact` hypotheses,
109 `conflict` and 51 `needs_evidence`; the 23 are **not** approvals
or promised future three-retailer comparisons.

## Read-only ranking and AI review

From the reviewed branch and authenticated Work SQL bridge:

```sh
node --import tsx scripts/tesco-hold-reentry-assess.ts
```

Returns all current held/unique/peer-overlap candidates, ordered by
historical success, prior Tesco identity, brand, size, pack and Dunnes /
SuperValu names. Each recommendation is explicitly
`independent_review_required`. An LLM-assisted operator should consider
synonyms, canonical-name omissions and independent retail-equivalence;
the heuristic may **over-rank** false matches such as 4-roll versus
24-roll Andrex, spring water versus brine, or a citrus formulation.
It never approves or edits mappings.

For one candidate, fetch its immutable database-derived snapshot:

```sh
node --import tsx scripts/tesco-hold-reentry-assess.ts --evidence STORE_PRODUCT_UUID SOURCE_PAGE_UUID
```

Both commands use the same JSONL SQL bridge: for each emitted
`{type:'sql',id,query}`, execute the entire read-only query once through
the authenticated connector, then reply `{id,rows}`. The evidence includes
the retained Tesco page ID, SHA-256, parsed title/brand/barcode/quantity,
the current canonical Tesco mapping and one-to-one SKU count, two fresh
retailer peer identities and observation times, historical success,
fresh-Tesco status, and unresolved/24-hour attempt state.

A human assessor and an **independent human approver** must independently
establish that this is the **same exact** canonical product, including brand,
pack count, quantity, flavour/formulation, product form, and barcode when
available. A model verdict or the old deterministic validator alone is
insufficient. Mark wrong SKUs for a separate mapping-correction process;
do not use hold re-entry to fix them.

## Approval ledger (post-deployment and separate authorisation)

Migration `20261101000000_tesco_hold_reentry_reviews.sql` introduces
three restricted, append-only tables:

- `tesco_hold_reentry_reviews`: a bounded (maximum 14 days) review
  containing the **exact** read-only evidence snapshot, source page,
  rationale, and distinct assessor/approver identities.
- `tesco_hold_reentry_revocations`: one-way audit of cancelled approvals.
- `tesco_hold_reentry_uses`: one use per review, claimed **atomically**
  with the collector's pending request reservation.

No browser/anonymous/authenticated role may write these ledgers. There
is no UI or scheduler for approvals. Privileged operator approval is a
deliberate, separately controlled database action, **not** something the
collector or ranking script performs.

An approved reviewer would insert a row with the exact JSON returned by
`--evidence`, a specific identity rationale (including both independently
inspected peer products), their identity and a *different* approver identity.
The database requires both identities and an expiry no more than 14 days
away. Every subsequent change or revocation is an additional ledger row;
the initial approval cannot be edited or deleted.

## Guarded use (not authorised by this PR)

```sh
node --import tsx scripts/tesco-supervised-collect.ts --mode expansion --limit 100 --reviewed-candidates REVIEW_UUID_1,REVIEW_UUID_2 --dry-run
```

Later, only with separate deployment and live collection authorisation,
replace `--dry-run` with `--confirm-run`, maintaining bounded sequential
batches and the existing operator SQL bridge.

Before selection, the approval and source must match *exactly*: unique SKU,
historical success, retained hashed page, complete source run, two fresh
retailer peers, no fresh trusted Tesco observation, no pending/24h attempt,
no material category/variant/quantity conflict, no revocation or prior use.
The existing hold is **not** cleared.

Under the existing leased gate, the runner rechecks the complete
approval/evidence snapshot, canonical mapping and peer observations
**before** reserving a request. It consumes that approval in the same
transaction as pending-page insertion. The normal Irish Tesco fetcher
must then retrieve a **new** live page. The old deterministic validator
must pass **and** an independent, strict live comparison to the reviewed
source's exact SKU, name, brand, pack, barcode (when available) and
canonical formulation must pass. A variant change is held without a price.
Before the *existing* guarded finaliser runs, the review, revocation,
one-time use, source hash, canonical mapping and peers are rechecked in
the **same** checkpoint/finalisation transaction.

The runner inherits the existing 10-second pacing, 10-minute ownership
lease, cooldown and Retry-After quarantine, 24-hour attempt exclusion,
six unknown requests, existing holds, same-SKU hard stop, hold/quarantine
circuit breakers, run reconciliation, and receipt-based idempotent price
finalisation. On uncertain acknowledgement, reconcile; never retry a
pending request or use cached prices. A consumed review cannot be
reused, even after an unsuccessful or interrupted request.

## Explicit remaining limitations

- **Zero approval rows** are created by this PR. Independent signed-off
  product evidence and a second reviewer are still required; the ranking
  output is not a trusted-price whitelist.
- Non-proven held mappings (at least 40 of the 183) cannot use this
  path without an independently approved *different* policy; this PR
  intentionally preserves the existing historical-success requirement.
- At least three of the 183 lack a retained parsed source page; missing
  source evidence cannot be fabricated.
- Fresh Dunnes and SuperValu observations are *commercial overlap*, not
  sufficient exact product identity; brand/size/pack/variant mismatches
  still require canonical correction or a new Tesco SKU.
- Source metadata edits, new peer observations, expiry, revocation,
  new holds or a concurrent run invalidate existing approvals rather
  than silently relaxing them.

## Review verification

Run `npx tsc --noEmit --incremental false` and
`npx vitest run src/lib/tesco-supervised-collection.test.ts src/lib/tesco-hold-reentry-ranking.test.ts`.
Tests use isolated PGlite and the *actual* page/gate and finalisation SQL.
The five diagnostic validator concerns (juice/drink, citrus, and three
shared-SKU scenarios) are explicit regressions, in addition to stale
approval/source, live changes, 24-hour holds, one-use and idempotency.
