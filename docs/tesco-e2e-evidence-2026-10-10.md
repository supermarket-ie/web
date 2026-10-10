# Bounded Tesco evidence test — 10 October 2026

This supplements the earlier interrupted listing attempt; it does not replace or
resolve that unknown request. No collector/discovery implementation, mapping,
canonical record, price timestamp, scheduling or egress configuration changed.

## Actual result

Three targets were selected from the existing queue after live production checks.
Only two product-page requests were attempted. Both returned HTTP 200 (8,005ms and
7,624ms), were durably checkpointed, and passed the unchanged collector identity
validator. Acquisition stopped on disagreement with the stricter discovery checks.
Batchelors Marrowfat Peas 420g was not requested. No access challenge, transport
failure or lost supervisor occurred. No unknown request or price receipt was added.

| Canonical product | Existing Tesco SKU | New live evidence | Discovery outcome |
| --- | --- | --- | --- |
| Avonmore Protein Milk Vanilla 1L | 308465836 | 21:46:42.365Z; exact product URL; title “Avonmore Protein Milk Vanilla 1 Litre”; GTIN 05011056024129; 1,000ml | needs_evidence: unexplained identity terms and peer review |
| Birds Eye Petits Pois 450g | 294076621 | 21:50:17.861Z; exact product URL; title “Birds Eye Petit Pois Peas”; GTIN 05000116103317; 450g | needs_evidence: missing title quantity, explicit measure difference and unexplained terms |

These are two newly obtained live response records for previously known SKUs, not
two newly discovered SKUs. Neither is an approved new collection-ready mapping.
Both direct URLs equal `https://www.tesco.ie/shop/en-IE/products/` plus the SKU.
The machine-readable private evidence bundle retains canonical IDs, mapping IDs,
page IDs, response hashes, timestamps, peer evidence and unmodified decisions.
The offline pipeline correctly does not claim it fetched a URL; live-response
provenance is recorded separately, without relabelling old listing evidence.

## Reproducible limitations

1. `measure()` normalizes “litre” to “l”, while `tokens()` strips only abbreviated
   units. Thus “1 Litre” versus “1L” fails the bidirectional word check, including
   the Dunnes peer. A synthetic same-spelling positive control passes. This is a
   unit-word normalization inconsistency, not authorization to relax variant checks.
2. The Birds Eye response supplies 450g structurally but omits quantity in its
   title. Discovery intentionally requires explicit title measures and rejects
   “Petit”/“Petits” and added “Peas” wording. Do not call this a proven pack mismatch
   or automatically rewrite either title; its evidence policy needs separate review.
3. Completed acquisition pages count as `previously_attempted` in discovery.
   Even after a separately reviewed identity correction, these requests must not be
   silently replayed. A safe purpose-specific acquisition-to-price handoff has not
   been demonstrated. Prior-success gating also prevents onboarding an entirely
   new mapping via the current expansion selector.

The minimum next step is a narrowly reviewed unit-normalization regression fix,
followed by an explicit handoff design/test preserving unknown holds and idempotent
receipts. Do not delete attempts, clear holds, append prices from cached pages with
new timestamps, or broaden quantity/variant acceptance to achieve a target count.
No runtime fix is included in this documentation-only update.

## Verification and protection

- Final production query at 21:51:44 UTC: 341 fresh Tesco, 171 three-retailer,
  337 fresh SuperValu/Dunnes gaps, zero renewals currently due.
- No active leases or current cooldowns; workspace gate remains disabled for
  automatic selection. All five previous unknown requests remain unchanged.
- First renewal 12 October 11:28:30 Irish time; 285 due that day, 56 on 13 October.
  Earliest expiry 15 October 11:28:30 Irish time. No renewal was run early.
- 38 discovery tests and 25 supervised-collection tests passed; discovery TypeScript
  check passed. Fifteen focused live-evidence/synthetic controls passed, including
  wrong sizes, variants, formulations, brand, URL, duplicate ownership, peer packs,
  unavailable products, provenance, unresolved/completed attempts and prior-success
  holds. Synthetic controls are not counted as product evidence.
- PR #256 remains unapproved/unexecuted. Application code and production deployment
  remain at merged main 5e0d88a. No new deployment was requested.

## Scaling decision

This run demonstrates two successful supervised acquisitions and durable response
checkpointing, not reliable 50–100-product identity discovery or end-to-end price
acceptance. One request yielded one new response in each case; requests per new
accepted mapping cannot be estimated because accepted yield is zero. No listing
search or previously unknown SKU was discovered in this run. Work credit usage is
not exposed. Do not start a larger run until the fail-closed integration issues are
reviewed. Then repeat a small fresh-target test before proposing 50–100 acquisitions.
The gap to 500 fresh Tesco prices remains 159; renewal takes priority from 12 October.
