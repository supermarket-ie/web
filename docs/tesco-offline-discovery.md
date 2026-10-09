# Read-only Tesco identity discovery

The supervised collector requires an exact mapping before requesting a product.
Historical URLs and successful receipts alone do not establish current identity.
This offline pipeline indexes the whole stored structured catalogue, searches
across SKUs, and reports evidence without changing a mapping or collecting a price.
There is no database client, fetch implementation, cron, new service or migration.

## Repeatable operation

1. Use the existing authorised SQL bridge to run
   `scripts/tesco-discovery-export.sql`. It is one SELECT snapshot. Save its
   `snapshot` column as a private JSON file; do not commit production exports.
2. Run `npm run tesco:discover -- --input SNAPSHOT.json --out PRIVATE_DIRECTORY`.
3. For incremental discovery add `--previous PREVIOUS_REPORT.json`. Changed
   identity evidence, mappings, peer freshness, holds, rejection dates, demand
   and the evidence-age boundary invalidate the relevant decision fingerprints.
   Unchanged decisions are reused; previously rejected data is not reclassified
   as a new opportunity without an input change. `newlyReady` compares states.
4. Retain the input and content-addressed report in durable private storage.
   Writes use a temporary file, fsync and rename. Interrupted writes do not become
   reports. The report includes the input digest, candidate reasons and evidence
   page IDs/body hashes. Output filenames are immutable, not a mutable latest file.

## Discovery versus acceptance

Retrieval uses SKU, independently corroborated checksum-valid GTIN and an inverted
title-token index. Deterministic scores rank evidence; scores never grant trust.
Tesco metadata agreeing with Tesco evidence is explicitly not independent GTIN
corroboration. Legacy discovery records are retained as hints without copying
session tokens or accepting their old classifications.

Acceptance requires explicit brand, quantity/pack and bidirectional identity terms,
compatible peer identities, no conflicting SKU assignment, recent structured
evidence with provenance, and the unchanged Tesco identity validator. Numeric
formulations are preserved. Added variants, blends and formulations fail closed.
The additional discovery checks do not modify any production validator. Conservative
word equality can reject harmless synonyms; those remain review work, not near
equivalents promoted by score. Fourteen days is an offline evidence-age ceiling,
not a trusted-price TTL and not a claim of current availability.

Candidate pools over 200 cannot be accepted. Equal-time conflicting snapshots cannot
be accepted. The export retains those conflicts. Duplicate SKU ownership includes
fresh products as well as the missing-price population. Missing brand or quantity
is insufficient evidence, not evidence that Tesco has no matching product.

| Status | Meaning |
| --- | --- |
| `ready` | Exact, unchanged mapping passes offline checks and recorded operational exclusions; live price verification still required |
| `repair_required` | Exact evidence exists but approved mapping work is needed |
| `held` | Exact evidence exists but prior attempt, unresolved outcome, rejection or the current runner's prior-success requirement prevents collection |
| `ambiguous` | Multiple exact SKUs or otherwise exact conflicting SKU ownership |
| `mismatch` | Stored current mapping has a material identity conflict; an undiscovered replacement may still exist |
| `needs_evidence` | No acceptable candidate yet, incomplete identity or missing/currently unusable evidence |

## SKU and URL handoff

Every candidate retains `canonicalProductId`, `sku`, exact stored `url`, title,
brand, quantity, GTIN, stored availability, source URL/mode, evidence date, page ID,
body hash, signals and rejection reasons. `existingMapping` and `historicalHints`
retain original URLs even when no acceptable structured candidate exists.

`urlVerification: "stored_evidence_only"` and `liveVerifiedThisRun: false` are
unconditional. Structured listing parsers may construct a product URL from the
observed SKU; a listing response is not a fetch of that product URL. This pipeline
does not claim any URL is live-verified. Accepted URL shape must be exactly
`https://www.tesco.ie/shop/en-IE/products/<sku>` without credentials or query data.

A single exact identity supplies `exactSku`/`exactUrl`. `collectorTarget` appears
only for `ready` or `repair_required`, tying canonical ID and store-product ID to
the exact SKU/URL, with `requiresRepair`. Held/ambiguous cases have no handoff.
Use approved unchanged targets with the existing supervised runner's product-ID
selection and fresh preflight. Do not feed repair-dependent entries to collection.
The runner independently rechecks mappings, leases, cooldowns, request history and
live identity. This offline queue cannot authorise a retry, reserve a request,
finalise an observation, or waive a stop condition. Approved new mappings without
prior successful receipts still require a separately reviewed onboarding path;
discovery does not bypass the runner's proven-product gate.

## Scaling evidence supply

The full-catalogue evaluation, rather than the old rejection shortlist, exposes
separate constraints: underspecified canonical identities, shared/wrong SKUs,
missing independent identifiers, and absent structured evidence. A high historical
URL count is not a count of verified mappings. Private reports contain actual
counts and ranked comparison/demand opportunities; no target yield is guaranteed.

Next evidence acquisition should target products with both peers fresh, complete
brand/variant/size and unresolved evidence gaps. Obtain independently sourced GTIN
and peer identity metadata where available, then bounded approved structured
listing evidence through the existing lease/checkpoint process. Re-export and
rerun incrementally. Do not bulk-scrape to meet a target or relax matching.
Keep the separately reviewed spelling repairs separate from generic aliases.

No collector or renewal code is changed. Due renewals take priority from the
approved renewal window; offline discovery does not acquire collection leases.
