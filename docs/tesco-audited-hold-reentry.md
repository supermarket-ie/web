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

**1 November revised evidence-bound gate:** the owner authorised a
single **authenticated reviewer** and admission with fewer than two fresh
retailer peers **only when independent exact-product evidence is sufficient**.
The code now requires the same unique mapping, successful historical receipt,
hashed source page, exact Tesco brand/pack/variant and unaltered live identity.
Two peers retain the previous guard; one peer additionally needs positively
matching source/canonical/peer brand and source/peer name; zero peers needs
an exact canonical-to-Tesco barcode. A conflicting existing peer never
passes. The reviewer must still approve each exact immutable snapshot.

Read-only preflight against **current** production evidence for the 78:
**64** pass the strict independent source-identity gate; of those, **56**
have no material unchanged lexical-validator conflict, including **12 whose
old source page lacked an available regular price** and therefore depend
on a newly available live price. **22 remain excluded**. All 56 still need
authenticated human review, fresh production snapshot at approval,
new live Tesco price/identity and guarded finalisation. None has been
approved or collected. With one or zero fresh peers, these 56 create
**zero immediate three-retailer comparisons**, but could provide up to
56 additional Tesco prices if live availability and all guards permit.

The parser's decimal and counted-pack correction now identifies one
additional exact-source/peer identity, Dr Oetker Gelatine 3x12g,
Tesco SKU `280932920`, among the original 61 verified. However its
unchanged lexical validator reports `brandConflict` and `measureConflict`;
the reviewed-only exception **must not** waive those reasons. The safe
initial cohort remains **33**, not 34.

### Largest defensible prepared production review queue — 1 November

`docs/tesco-hold-reentry-production-queue-20261101.jsonl` contains
**89 unique, evidence-backed mapping candidates** with exact mapping UUID,
source-page UUID and SHA-256, retained Tesco identity and pack, canonical
identity and available barcode, independently assessed reasoning, and
current competitor evidence:

| Cohort | Candidate mappings | Potential fresh Tesco prices | Genuine new triples if exact live |
| --- | ---: | ---: | ---: |
| Original dual-peer, independently confirmed equivalence | 33 | Up to 33 | Up to 33 |
| Additional exact Tesco identity, one fresh peer | 51 | Up to 51 | 0 at current overlap |
| Additional exact Tesco identity, no fresh peer; canonical/Tesco barcode match | 5 | Up to 5 | 0 at current overlap |
| **Total** | **89** | **Up to 89** | **Up to 33** |

Seventeen of these have an old retained source page marked unavailable/
unpriced; they are **not evidence of currently buyable Tesco stock** and
will only receive a trusted price on an available and correctly priced
*new* live page. The initial 33 and 56 additional have **zero signed
approval records**, so **zero are selectable for collection today**.
Actual price/triple counts can only be stated after authorised execution.
The remaining 50 of the 139 evidence-supported identities have not
passed the entire reviewed positive gate and unchanged lexical conflicts
or have unresolved competitor equivalence; they remain excluded.
The independently reviewed 980-product audit, 73 original correction
proposals and all rejected/uncertain product evidence remain preserved.

### Separate non-held expansion and renewal lanes — 1 November

The **unchanged ordinary supervised expansion selector** currently reports
**57** non-held, one-to-one, historically successful, resolved-URL candidates
eligible after the shared-SKU and attempt exclusions: **23** have one
fresh retailer peer, **34** have none, and **zero** have both. They are
*not* part of the 89 held-review candidates and do not promise any immediate
new triples. The product-level read-only ordinary selector list is
`docs/tesco-nonheld-expansion-preflight-20261101.jsonl`.
An exact retained page could be located for **12**; **two** additionally
passed the strict independent source-identity test (SKU `282485161`
and `297708302`), while **55** lack that independent preflight. All 57
must pass normal live identity checks; do **not** present selector eligibility
as proof of independently verified exact identity or automatic trusted price.
Thus the wider *requestable* future expansion pool is **up to 146**
(89 reviewed-held candidates **only after Auth approval**, plus 57 ordinary),
but only **91** have independent source support so far (89+2). The
55 ordinary mappings need stronger exact identity evidence before being
counted in a trusted recovery forecast.

A fresh read-only renewal query confirms **323** trusted Tesco prices and
**303** already eligible under the collector's four-day proactive renewal
threshold, with earliest seven-day price expiry on **3 November**. The
expiry exposure by UTC date is **57 on 3 November, 246 on 4 November,
20 on 7 November**. The
existing approved renewal path needs operational priority ahead of expansion;
the current instruction prohibits initiating any production collection,
so none was run here. Recovered held products subsequently return to
**ordinary** supervised renewal after a newly trusted observation overtakes
the prior hold; a regression test verifies no repeat human hold re-entry
approval is required for a normal live-validated renewal.

## Authenticated single-reviewer security model

The original two-name-string check was **not** evidence of two independent
people. The owner has explicitly approved replacing that proposed control
with **one accountable, authenticated human reviewer**, while retaining
an independently supported exact-product gate and independent live checks.
This migration is not a change to an established deployed security rule:
the earlier two-string proposal was never deployed.

- Approval INSERT is available only over the **Supabase Auth-verified Data
  API** to an `authenticated` user whose server-owned JWT
  `app_metadata.tesco_reentry_reviewer` equals `true`.
- A BEFORE INSERT trigger **overwrites** any submitted `reviewer_id` with
  `auth.uid()` and stamps the approval time. Row-level security checks the
  same authenticated principal and privilege. Non-reviewers cannot approve;
  free-text aliases and caller-supplied reviewer IDs cannot forge a signature.
- The SQL bridge/collector `service_role` has **SELECT**, but not
  INSERT/UPDATE/DELETE, on approval rows. SQL database owner access is
  an administrative break-glass privilege, **not** an approval pathway:
  do not create approvals through an unrestricted SQL editor/bridge.
- A reviewed record binds the entire read-only source, mapping, peer,
  receipt, hold and cooldown snapshot, specific rationale and 14-day
  expiry. Every changed fact invalidates the approval; it is single-use,
  revocable, and separately rechecked under the collection lease and
  immediately before guarded finalisation.
- PGlite SQL/RLS regression coverage proves the reviewer UUID is sourced
  from the authenticated session, non-reviewer/anonymous/service-role writes
  fail, and changed peer/live identity, source or one-use state fail closed.

## Exact release sequence (not yet authorised)

1. Complete GitHub review/required CI of PR #286, including the authenticated
   single-reviewer policy and the positive one-/zero-peer evidence rule.
2. Separately authorise and apply the Supabase migration, with verified
   table/RLS/grants and the authenticated reviewer entrypoint. The three new
   ledger tables are **not deployed** at this review checkpoint.
3. Set `tesco_reentry_reviewer: true` in the selected human's **server-owned**
   Supabase Auth app metadata (admin-side), confirm a signed-in Auth session,
   and approve the exact currently queried candidate JSON snapshots through
   that Auth-verified API. Then pin the reviewed collector revision in the
   existing ChatGPT Work
   supervised Node 24 + `npm ci` environment, retaining its authenticated
   SQL bridge, Irish Tesco fetcher, leases, 10-second pacing, cooldowns,
   circuit breakers, six unresolved historical requests and guarded
   finaliser. This approval step is not available through an SQL-bridge
   service credential. Do not pre-sign a stale offline manifest.
4. After **separate collection authorisation**, refresh production preflight,
   select 1–100 *approved review UUIDs* per sequential batch, check non-stale peers/hold
   conditions and run a supervised batch with fresh live identity evidence.
   Reconcile requests versus **actual** finalised prices and genuine triples.
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

**No ledger approval is issued by the AI assessment.** A single
authenticated privileged human reviewer is required after approved
deployment; source/peer changes invalidate that signed snapshot.
The 31 October 33 retained candidates remain the highest-priority
defensible *three-retailer* cohort; the broader one-/zero-peer candidates
are separately accounted for and cannot claim a new triple.

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
the current canonical Tesco mapping and one-to-one SKU count, zero to two
fresh retailer peer identities and observation times, historical success,
fresh-Tesco status, and unresolved/24-hour attempt state.

A privileged human reviewer must separately evaluate the AI-assisted
assessment and positively establish the **same exact** canonical product:
brand, pack count, quantity, flavour/formulation, product form and barcode
when present. The code enforces independent source and newly fetched live
validation on top of that review. A model verdict or the old deterministic
validator alone is insufficient. Mark wrong SKUs for mapping correction;
do not use hold re-entry to fix them.

## Approval ledger (post-deployment and separate authorisation)

Migration `20261101000000_tesco_hold_reentry_reviews.sql` introduces
three restricted, append-only tables:

- `tesco_hold_reentry_reviews`: a bounded (maximum 14 days) review
  containing the **exact** read-only evidence snapshot, source page,
  rationale, and one JWT-verified privileged `reviewer_id`.
- `tesco_hold_reentry_revocations`: one-way audit of cancelled approvals.
- `tesco_hold_reentry_uses`: one use per review, claimed **atomically**
  with the collector's pending request reservation.

Only the specially authorised `authenticated` Supabase Auth role may
INSERT a review via the verified Data API; anonymous, non-reviewer and
collector service-role clients may not. The collector may read approvals.
No UI or scheduler performs approval automatically.

An authorised reviewer INSERTs the exact JSON returned by `--evidence`
(after fetching it **again immediately before signing**), the product and
source UUIDs, and a specific independent identity rationale. Their
`reviewer_id` and approval timestamp are **set by the database from the
verified Auth JWT**. Expiry must be within 14 days. Use an authenticated
Supabase client/Data API connection for this act, never the SQL editor or
unrestricted bridge. Changes/revocation are separate records; approval
cannot be edited or deleted.

## Guarded use (not authorised by this PR)

```sh
node --import tsx scripts/tesco-supervised-collect.ts --mode expansion --limit 100 --reviewed-candidates REVIEW_UUID_1,REVIEW_UUID_2 --dry-run
```

Later, only with separate deployment and live collection authorisation,
replace `--dry-run` with `--confirm-run`, maintaining bounded sequential
batches and the existing operator SQL bridge.

Before selection, the approval and source must match *exactly*: unique SKU,
historical success, retained hashed page, complete source run, plus
positive exact identity evidence suitable to the observed zero, one or two
fresh peer products; no fresh Tesco price, no pending/24h attempt,
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

- **Zero approval rows** are created by this PR. One authenticated
  privileged human review of each immutable evidence snapshot is still
  required; the AI ranking output is not a trusted-price whitelist.
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
- The 31 October review marked two additional Tesco identities (SKUs
  `254877356` and `257572562`) as **cross-retailer equivalence uncertain**
  despite otherwise strong Tesco-source evidence. They are *not* included
  in the 33 expected three-retailer comparisons. Do not equate the
  mechanical gate with an independently reviewed competitor-product match.

## Review verification

Run `npx tsc --noEmit --incremental false` and
`npx vitest run src/lib/tesco-supervised-collection.test.ts src/lib/tesco-hold-reentry-ranking.test.ts`.
Tests use isolated PGlite and the *actual* page/gate and finalisation SQL.
The five diagnostic validator concerns (juice/drink, citrus, and three
shared-SKU scenarios) are explicit regressions, in addition to stale
approval/source, live changes, 24-hour holds, one-use and idempotency.
