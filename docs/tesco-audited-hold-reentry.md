# Tesco held-mapping audited re-entry — review-only proposal

**Status:** code and migration proposed for review. **Not deployed.** No held
SKU may be collected or finalised under this mechanism until a separate
deployment, evidence-review and collection authorisation.

## Complete held inventory reconciliation — 31 October 2026

Fresh read-only queries reconciled **1,163** held unique-SKU Tesco mappings:
183 with two fresh Dunnes/SuperValu peers, 521 with one and 459 with none.
This is **34 more** than the earlier 1,129 held figure; that figure should
not be used as a current execution total without matching the collector's
hold predicate and query timestamp.

The additional **980** have a preserved product-level, read-only audit:
**78 independently evidence-supported Tesco identities**, **107 explicit
retained-page barcode/pack-count mismatches**, and **795 uncertain**.
The 78 comprise **69 with one fresh retailer peer** and **nine with neither**;
their reviewed SKU/mapping/page-hash evidence is in
`docs/tesco-hold-reentry-additional-verified-20261031.jsonl`.
The complete audit and 73 original wrong-mapping correction proposals are
separate owner-visible reports. The previous provisional **76** candidates
were reclassified from recovered records; the lost transient list of 76
identifiers cannot truthfully be diffed row-for-row.

**None of the 78 is selectable through this PR.** The unchanged
`independentExactIdentity` gate requires both fresh retailer peers.
They are a **deferred recovery queue**, not an excuse to weaken this gate.
Before adding a one/no-peer path, a separately reviewed, policy-explicit
identity rule must require stronger canonical/retained source evidence
(including barcode or independent corroboration), and exact live checking
before finalisation. Do not treat price recency or brand alone as identity.
Those 78 could add at most 78 fresh Tesco prices after a future approved
path; with fewer than two fresh peers, they add **zero immediate genuine
three-retailer comparisons**.

The parser's decimal and counted-pack correction now identifies one
additional exact-source/peer identity, Dr Oetker Gelatine 3x12g,
Tesco SKU `280932920`, among the original 61 verified. However its
unchanged lexical validator reports `brandConflict` and `measureConflict`;
the reviewed-only exception **must not** waive those reasons. The safe
initial cohort remains **33**, not 34.

## Security-review finding: two reviewer names are not two authenticated people

Migration `20261101000000_tesco_hold_reentry_reviews.sql` stores
`assessed_by` and `approved_by` as freely supplied `text`. Its CHECK
constraint and collector require different strings but do **not**
authenticate two distinct privileged humans. A single operator with the
existing privileged SQL connection could supply both. This is a
**release-blocking authentication gap**, not evidence of two-person control.

**Smallest robust two-person implementation, if that requirement is retained:**

1. Reuse existing Supabase Auth operator identities. Grant a narrowly scoped
   `tesco_reentry_reviewer` permission in server-controlled membership or
   `app_metadata`; never trust user-editable metadata or a submitted name.
2. Expose an explicitly restricted, evidence-bound approval RPC to authenticated
   reviewers. The database derives `assessor_user_id` and
   `approver_user_id` from separate verified `auth.uid()` sessions,
   checks the permission and distinct IDs, and stores the exact product,
   mapping/source/peer snapshot hash and expiry. Do not accept client-supplied
   reviewer IDs. Restrict direct ledger INSERT to a dedicated controlled role;
   do not let the collector create approvals.
3. Support signing a **bounded manifest batch** (up to 100 individual immutable
   evidence hashes) in one reviewed operation per person. Each candidate
   retains an independently justified exact-product decision, revocation,
   one-use claim and live-check semantics. A second review is one batch action,
   not 33 manual database operations.
4. Add SQL/RLS/permission and PGlite regressions for a forged reviewer,
   same identity using two labels, non-reviewer JWT, stale evidence, batch
   changes, and collector privilege separation.

A **single authenticated, accountable evidence-bound reviewer** together
with the existing exact live/source verification may be a defensible simpler
policy. It is **not the currently proposed two-person policy** and has
**not been implemented or authorised**. A conscious security-policy decision
is required before replacing the two-person condition.

## Exact release sequence (not yet authorised)

1. Complete GitHub code/security review of PR #286 and required CI.
   The identity-parser fix is narrow and keeps all real conflicts blocked;
   the authenticated-approval concern above must be resolved before
   describing the approval process as two-person enforced.
2. Separately authorise and apply the Supabase migration, with verified
   table/RLS/grants and the authenticated reviewer entrypoint. The three new
   ledger tables are **not deployed** at this review checkpoint.
3. Merge/pin the reviewed collector revision in the existing ChatGPT Work
   supervised Node 24 + `npm ci` environment, retaining its authenticated
   SQL bridge, Irish Tesco fetcher, leases, 10-second pacing, cooldowns,
   circuit breakers, six unresolved historical requests and guarded
   finaliser. Reviewers then sign the 33 exact evidence snapshots.
4. After **separate collection authorisation**, refresh production preflight,
   select up to 33 *approved review UUIDs*, check non-stale peers/hold
   conditions and run a supervised batch with fresh live identity evidence.
   Reconcile 33 requests versus **actual** finalised prices and triples.
5. The existing GitHub AWS ECR image workflow may ship any website-side
   code, followed by the normal separately controlled ECS rollout. **It does
   not run this Work-supervised CLI or apply Supabase migrations.** An AWS
   ECS website deployment is not inherently required merely to use the
   Work collector's reviewed code. Vercel is not a production release gate.

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

### Completed independent AI-assisted identity review, 31 October

The **183 product-level reviews** are recorded in the separate
`tesco-183-identity-review-2026-10-31-v2.jsonl` audit deliverable; the
assessment made **no** production database writes. Each record binds the
mapping UUID and Tesco SKU to retained source-page UUID, body SHA-256,
source-run status, exact parsed identity, prior validator output, historical
price observations and the two current retailer peers. The assessment
records positive/negative reasons and distinguishes Tesco identity from
genuine same-product three-retailer comparability.

- **61 evidence-supported Tesco identities**, **73 demonstrated mapping/product
  mismatches**, **49 unresolved**. Among the original 23 high-ranked:
  **20 verified, 1 rejected, 2 uncertain**.
- Of the 61 Tesco identities, **51** have genuine Dunnes and SuperValu
  equivalents; five have a demonstrated peer mismatch, and five have
  insufficient peer-equivalence evidence.
- Under the source-page/receipt/pack/variant requirements already in this PR,
  **35 of the 61** pass the strict independent evidence gate, including
  **33 genuine three-retailer comparables**. The other two have unresolved
  cross-retailer identity evidence and are **excluded** from the proposed
  collection cohort. Thus **33**, not 35, is the largest fully peer-supported
  cohort for privileged human approval, before fresh Tesco fetch.
- The branch ships `docs/tesco-hold-reentry-reviewed-cohort-20261031.jsonl`
  with the **33 proposed** mapping IDs, source-page IDs/hashes, two peer
  identifiers, and independent reasoning. It contains **no** review UUIDs,
  signatures or approved ledger entries and does not authorize collection.
- The unchanged lexical validator accepts just **nine** of those 33
  three-retailer source identities; the remainder fail generic canonical
  identity or lexical measurement exactness, while still satisfying the
  stricter positive evidence gate. This is a false-negative in the
  historically held cohort, not grounds to relax real product conflicts.

**No ledger approval is issued by the AI assessment.** Two distinct
privileged reviewers are required after deployment and separate collection
authorisation. New peer observations or mapping/source changes invalidate
the evidence snapshot and require re-review.

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
runs unchanged. A separately approved, reviewed candidate may resolve
**only** its legacy `candidate does not establish full exact canonical
identity` and `measureExactnessFailed` rejections, and only when **all**
legacy reasons are in that set **and** the retained source and freshly
fetched live identity pass the strict positive identity gate. The new
page audit retains the original validator reasons and exception decision.
Actual brand/formulation/type/variant/pack/measure conflicts, missing
prices and every other failure stay fail-closed; ordinary renewal/expansion
cannot use this exception. Independent live comparison to the reviewed
source's exact SKU, name, brand, pack, barcode (when available) and
canonical formulation must pass. The independent check also compares
canonical and peer-declared units/pack counts and material variant qualifiers
against the retained source,
rejecting e.g. 4 versus 24 rolls and a single 110g pack versus 3x110g.
Source GTIN must agree with any canonical mapping GTIN. A variant change
is held without a price.
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
