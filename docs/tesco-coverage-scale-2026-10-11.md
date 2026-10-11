# Tesco coverage: measured constraints and batch acquisition

Production snapshot: 2026-10-11 07:15 UTC. All analysis is read-only. No Tesco
requests, mapping repairs, observations or operational state changes were made.

## Release and measured impact

PR #258 merged as `1979aaa694231a9d9402446ec853a8b993b40598` after CI #914
(485 tests), repository protections and review threads were checked. Post-merge
CI #915 passed; production deployment `dpl_2ffhRwKgFZZV4Z3MeFwbhoXscrHR` was
READY on that exact commit. PR #256 remains unapproved and unexecuted.

Same production snapshot, same 3,968 structured Tesco SKUs, all 2,121 products
missing fresh Tesco prices; compare discovery v2 with corrected v3:

| Classification | Before | After |
| --- | ---: | ---: |
| Ready | 0 | 0 |
| Repair required | 0 | 0 |
| Exact but held | 5 | 9 |
| Ambiguous | 6 | 7 |
| Needs evidence | 1,302 | 1,297 |
| Mismatch | 808 | 808 |

Four additional exact identities pass: Birds Eye Petits Pois 450g (294076621),
Avonmore Protein Milk Vanilla 1L (308465836), Avonmore Whole Super Milk 1L
(265021425), Avonmore Low Fat Super Milk 1L (250000750). Three have fresh peer
prices. The first two separately pass the released guarded acquisition handoff
using current production source snapshots. Raw discovery export does not include
that exception. Thus two are usable through the handoff, not nine newly ready
products. The other two new exact results retain rejection-history holds.
There are no newly discovered unknown SKUs and no price-coverage gain.

## Scaling constraints

The planner assigns one primary root cause per missing product, in the stated
precedence order (metadata, peer identity, exact/hold, ambiguity, mapping/evidence).
This is triage, not a replacement for exact identity acceptance.

| Primary category | Products | Fresh peer comparisons |
| --- | ---: | ---: |
| Canonical metadata incomplete | 1,201 | 181 |
| Peer identity needs review | 455 | 136 |
| Current mapping conflict | 194 | 6 |
| Fresh evidence needed | 256 | 7 |
| Ambiguous SKU | 7 | 3 |
| Exact identity, operational hold | 6 | 2 |
| Guarded acquisition handoff | 2 | 2 |
| Total | 2,121 | 337 |

Overlapping diagnostics: 1,109 missing canonical brands, 753 missing quantities,
808 material current-mapping conflicts, 101 current SKUs without structured
evidence. Missing evidence is not proof a SKU is obsolete. None of the 4,920
exported peer mappings has a GTIN. Of 3,968 latest Tesco evidence rows, 2,611 are
listing rows without structured quantity, 1,204 direct-product rows have quantity,
and 153 direct-product rows lack it. Product quantity normalization therefore
cannot resolve most listing evidence gaps.

26 products have a candidate blocked only by unexplained title terms and/or peer
review. They remain review opportunities, not proven repairs. Strict two-peer
metadata-consensus experimentation yielded two proposals and zero additional
exact Tesco identities. Bulk metadata autofill is not justified by this evidence.

## Reusable implementation

`npm run tesco:coverage-plan -- --input snapshot.json --operations operations.json --out output`

Obtain the snapshot using `scripts/tesco-discovery-export.sql`, and complete
request history using `scripts/tesco-coverage-operations-export.sql`. Optional
acquisition snapshots use the existing `acquisitionSnapshotSql` helper. They must
be current; the planner cross-checks canonical and peer identities with the input.
An empty acquisition array cannot bypass holds. Planning is offline, not a live
collector authorization; all operational gates must be rechecked before execution.

The planner reuses unchanged identity profiles, requires known matching brands and
complete equivalent canonical/peer quantities, groups targets by brand and product
terms, and ranks bounded listing queries by current comparison value and demand.
It excludes previously requested query scopes and pending product/brand scopes;
it never retries unknown outcomes. It outputs canonical IDs, exact or candidate
SKUs/URLs, source page IDs, hashes, timestamps, rejection reasons and fingerprints.
Outputs are content-addressed and fsynced. URLs remain stored-evidence-only;
nothing is labelled live-verified by this offline run. No network/DB write is used.

465 products pass the complete canonical plus exact-peer-brand screen (20 fresh
comparison gaps); after exclusions, 422 are acquisition targets. The initial ten
proposed queries cover 72 distinct targets including 12 comparison targets.
These counts are retrieval scope, not predicted exact matches. The earlier coarse
screen of 476 omitted an explicit peer-brand requirement; 11 fail that final gate.

## Practical next acquisition step

Historical durable logs show 99 successful listing requests produced 2,958 product
rows, versus one row per successful direct-product request. That demonstrates
retrieval efficiency, not current accessibility or new-match yield. Use an approved
supervised ten-query listing pilot, page 1/count 24, with the existing leases,
pacing, checkpoints, cooldowns and stop rules. Do not execute this manifest as a
generic scraper. The pilot is a recommendation, not performed in this change.

Ingest each actual response into existing evidence storage, rerun discovery only
for changed evidence fingerprints, validate exact brand/formulation/variant/pack,
unique SKU ownership and URL correspondence, then review necessary mapping repairs
separately. Only approved exact mappings reach trusted live price finalisation.
Measure requests, novel SKUs, exact identities, repairs and final trusted prices
separately. Stop for access blocks or unknown outcomes; do not change egress.

Manufacturer/authorised GTIN data could improve canonical identity, but does not
establish a Tesco SKU, current availability or price. Confirm licensing and useful
Tesco SKU linkage before purchasing or integrating third-party sources.

## Milestones and renewal

Fresh coverage remains 341 Tesco / 171 three-retailer. Reaching 500 needs 159 fresh
prices; the two guarded handoffs can contribute only after successful collection.
The 422-target cohort is the next measurable acquisition pool, with unknown yield.
Reaching 1,000 needs 659 additional fresh prices, exceeding that cohort even at
100% yield. Reaching 2,000 needs 1,659. Both require materially better catalogue
and peer identity evidence, reviewed mapping work and renewed existing prices;
neither is currently an evidence-supported forecast.

Zero renewals were due at preflight. 285 become due on 12 October and 56 on
13 October; first due is 12 October 11:28:30 Irish, earliest expiry 15 October
11:28:30. All five unresolved requests remain held; no active lease or cooldown.
Renewals take precedence from their due time. This planner does not change any
collector, renewal, price, lease, checkpoint or scheduling behaviour.
