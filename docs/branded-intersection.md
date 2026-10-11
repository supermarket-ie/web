# Read-only branded intersection

This pipeline evaluates the known Tesco, SuperValu and Dunnes catalogue. It does
not estimate their complete assortments. Retailer SKU identities are the matching
unit; existing canonical associations are context, never evidence of equality.
No application route, collector, scheduled job or production write is added.

## Evidence and acceptance

`branded-product-identity.ts` validates direct SKU URLs, sourced brand ownership,
explicit pack sizes/counts, unit equivalents, formulation/flavour words, barcode
checksums, provenance age and duplicate ownership. Unknown brands remain unknown;
the legacy `is_own_brand` flag does not determine inclusion. Registry owners name
the cited brand operator, which is not necessarily its ultimate holding company.

Brand and shared identity-token blocking avoid an all-catalogue Cartesian join.
Every three-retailer result must satisfy all three pair comparisons. Multiple
equivalent SKUs within one retailer and duplicate mapping ownership are held.
The output retains cross-canonical proposals instead of assuming old associations
are correct. `1 Litre`, `1L` and `1000ml` normalize together; `2x500g` is distinct
from one `1kg` pack. An unspecified multipack measure basis is held. Containers
and material variant words cannot silently disappear during normalization.

Two evidence standards are deliberately separate:

* `recordedExactThree`: exact normalized identity/pack in recent retained retailer
  records. SuperValu/Dunnes refresh receipts attest to retailer retrieval, but do
  not bind an immutable original response body to the current mapping title.
* `independentlyVerifiedThree`: independently captured, timestamped and hashed
  source evidence at all three retailers. Only this tier enters category A.

The current export has raw Tesco captures but no equivalent retained peer
responses. A recorded match therefore remains category B, with explicit required
corroboration. Do not advertise these rows as independently verified comparisons.
No URL is fetched in the offline evaluation. `lastLiveVerifiedAt` describes an
earlier direct retrieval, not this run; Dunnes API refresh does not prove its web
product URL was visited. The default identity evidence horizon is 14 days; price
freshness remains seven days and uses the existing trusted `latest_prices` view.

## Run and inspect

Export `scripts/branded-intersection-export.sql` with an approved read-only SQL
client and save the `snapshot` JSON value privately. It is one statement to allow
a consistent MVCC snapshot. If a connector requires chunking, record the read
window and reconcile counts and an identity-field digest before evaluation; do
not claim that multiple requests were atomic. Product text and aggregate list
quantity are exported; no customer identifiers or credentials are needed.

```sh
npm run branded:intersection -- --input /private/snapshot.json --out /private/audit
npm run typecheck:branded
npx vitest run src/lib/branded-intersection.test.ts
```

Outputs use content-addressed immutable directories, private file permissions and
spreadsheet-safe CSV escaping. Keep all production data outputs outside git:

| File | Purpose |
| --- | --- |
| `summary.json` | Coverage, evidence tiers, price coverage, holds and reason counts |
| `intersection.json` / `.csv` | Exact recorded identity groups, category A/B, all SKUs/URLs, pack, provenance and prices |
| `catalogue-audit.json` | Every original canonical association with reasons and retailer evidence |
| `collection-opportunities.json` | Missing-price groups, ranked by coverage gain then aggregate demand |
| `inference-candidates.json` | Unresolved plausible pair proposals, not shared-product counts |
| `report.json` | Complete reproducible decisions, records, canonical context and input/registry digests |

Category A is independently captured identity. B includes recorded exact matches
awaiting peer capture and strong plausible candidates needing wording, pack or
provenance corroboration. C contains material contradictions. D contains missing
or invalid retailer identifiers/URLs; it does **not** claim all such products are
obsolete or unavailable. E is other insufficient evidence. Confirmed retailer
private labels are excluded before these association categories. These categories
partition canonical associations; cross-canonical groups are counted separately.
Reason counts overlap. Any-two groups include three-retailer groups.

The optional `retailerEvidence` snapshot array accepts independently acquired
normalized direct-product captures for all three stores. Each record needs
`store`, `sku`, direct `url`, `title`, nullable `brand`/`gtin`, and `source` with
`kind: captured_product`, `ref`, ISO `at`, exact product `url` and body SHA-256
`hash`. Optional description, ingredients, image URL, manufacturer, dimensions
and structured quantity remain available to inference. Preserve the original
response privately and verify its hash before constructing this input. Never
invent capture timestamps, hashes or peer barcodes. Newer evidence supersedes
older records; conflicting evidence at the same instant is held.

## Bounded inference

`branded-inference.ts` has a versioned untrusted-data prompt and validated output:
decision, supporting attributes with evidence IDs, contradictions, missing
evidence, rationale and confidence. Requests contain retailer evidence and
canonical metadata including descriptions/ingredients/images where available.
Image URLs are references; no claim is made that image pixels were inspected.
Canonical metadata cannot establish retailer identity.

`branded:infer` is a separate operator command using the existing server-side
Anthropic provider/model from `agent/agent.ts`. It never reads another deployment's
credentials or automatically falls back to a new provider. No credential means
no calls. A private budget JSON must explicitly set `model`, `maxCalls` (1–20),
`maxUsd` (positive, at most 1), positive `inputUsdPerMillion` and
`outputUsdPerMillion`, plus `rateSource` and `ratesCheckedAt`. Verify current
provider rates before supplying them; these are operator assertions, not an
automatically fetched price list. There are no preset monetary rates.

```sh
npm run branded:infer -- /private/audit/branded-DIGEST/report.json \
  /private/inference /private/budget.json --confirm-bounded-inference
npm run branded:intersection -- --input /private/snapshot.json --out /private/replay \
  --inference /private/inference/inference-replay.json
```

At most 20 eligible unresolved wording pairs are considered. Each request is
bounded to 12,000 UTF-8 input bytes and 1,400 output tokens. A conservative spend
reservation is fsynced before sending; retries are disabled, timeout is 60 seconds,
reservations are never refunded and uncertain outcomes stop further calls.
Concurrent access is locked. A crash lock or unresolved ledger must be reconciled
against provider usage before manual recovery; deleting it is not a retry policy.
All runs in an exercise must reuse the same ledger so the cap remains cumulative.
Actual token usage and its cost estimate are recorded separately from reservations;
neither is described as an invoice. The offline evaluator makes zero model calls,
even when replaying external proposals.

Confidence never promotes a candidate by itself. This first corroboration adapter
requires separately acquired, recent, hashed, SKU-bound, checksum-valid GTIN
evidence for both retailers. It re-runs the deterministic checks and will not
replace an inconsistent existing GTIN or override missing variants/hard conflicts.
This intentionally leaves synonym cases unresolved when no independent evidence
is available. Richer corroboration adapters can follow a separately tested change.
Replay is bound to the exact evidence digest and cannot mutate the source snapshot
or production. Inference output is not approval to repair a mapping.

## Price handoff and rollout

The commercial metric is independently verified identity **and** three current
trusted prices. Recorded-evidence price coverage is a separate diagnostic metric.
Zero demand means no exact canonical-name match in the exported aggregate, not
proof of no shopper demand. A cross-canonical proposal requires assignment/repair
even if its retailer rows already have prices. Source evidence or a stored URL
does not prove current availability.

Run read-only evaluation first; preserve peer response evidence through the
existing supervised collectors, review their exact matches, then propose any
mapping repairs separately. Enforce existing identity checks, cooldowns, leases,
unknown-request holds and supervised-runner preflight at collection time. Report
readiness is not execution authorization. Due Tesco renewal always precedes
discovery. No automatic scheduler or collector change is part of this proposal.

Regression controls cover units, multipacks, formulation/flavour negatives,
private labels, copied/conflicting GTINs, provenance, duplicates, cross-canonical
discovery, evidence tiers, inference replay and cost reservation failures. Fixture
accuracy and review of retained text are not a substitute for independently
labelled live-product precision/recall. Measure that separately as peer source
captures become available.
