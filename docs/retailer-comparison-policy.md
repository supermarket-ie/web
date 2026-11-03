# Retailer offer comparison policy — 3 November 2026

This policy separates **trusted exact retailer prices** from **evidence-backed
relationships between two retailer offers**. The canonical catalogue product
is a search/display anchor; it is not proof that Tesco, Dunnes and SuperValu
sell the same commercial identity or pack.

## Four mutually exclusive pairwise outcomes

| Type | Meaning | Consumer treatment |
| --- | --- | --- |
| `exact_product` — **Exact product** | Same manufacturer/brand, identity, variant, formulation, measure, retail pack and multipack count, with independent retailer evidence | May support exact comparisons only when every relevant pair is reviewed |
| `comparable_alternative` — **Comparable alternative** | Different product/brand or retail pack, but an independently reviewed functional substitute with compatible category, intended use and dietary properties | Label immediately beside its price and show retailer name, pack and normalized unit price; different/unknown packs are excluded from equal-pack basket totals |
| `not_comparable` — **Not comparable** | Material brand, species, formulation, dietary, variant, pack or identity contradiction | Exclude from equivalent-basket comparisons, retain reviewed rationale |
| `unverified` — **Unverified comparison** | Missing, ambiguous, expired or insufficient direct source evidence | Never count as verified exact/alternative; display uncertainty and retain review queue |

Source checks include SKU-to-direct-page binding, manufacturer/brand, GTIN
(where available), title, flavour, formulation/ingredients, quantity,
multipack count, unit of measure and material exclusions. Barcodes and title
similarity cannot override a genuine contradiction. A missing peer price
does not invalidate an independently verified Tesco price.

For three offers A, B and C, **three exact** means A↔B, A↔C and B↔C all
have current, independently supported `exact_product` decisions. A reviewed
substitute may instead produce A↔B exact, A↔C alternative, B↔C alternative.
No inferred candidate or canonical association automatically becomes an
approved edge. If any pair is missing, the group remains unverified; a material
conflict excludes the group from equivalent comparison.

## Evidence storage and verification

`latest_prices` continues to be the exclusive source of trusted current
exact retailer prices (seven-day freshness, existing promotion and
finalisation checks). The separate append-only
`retailer_offer_pair_reviews` table records an individual pair, decision,
reviewer, rationale, AI assessment/checked attributes, source kinds, source
IDs, immutable body hashes and capture/review timestamps. A protected
postgres-only insert must reference independently retrieved source records
bound to the two exact store-product IDs: the existing supervised Tesco page
ledger or original Dunnes/SuperValu direct-product capture ledger.
Evidence older than 14 days cannot support a currently verified UI claim.

The table is RLS-enabled; browser roles have no access, the service role
has SELECT only, and the trigger rejects unbound/invalid positive evidence
and UPDATE/DELETE. No public RPC, privileged Auth account, broad INSERT grant
or automatic approval endpoint is created. Missing ledger/migration data
fails closed to `unverified`. The storefront reads this ledger as comparison
evidence only; it never writes mappings or price observations.

The operator process must independently perform deterministic identity,
pack, barcode, variant and dietary checks and AI inference on the original
source evidence. An AI confidence score, reconstructed metadata hash or
catalogue title is not approval. A reviewed record must specify reasons,
contradictions, missing evidence and corroboration. The existing
`branded-inference` outputs are candidate assessments, not approvals for the
new ledger. Inference and source capture are budgeted, supervised and
separate from the guarded Tesco price collector.

## Frontend and basket semantics

- Every displayed retailer offer shows its actual retailer title (including
  its pack text), price and observation date; supported formats also show
  unit price by kg, litre or item.
- `Comparable alternative` appears beside the relevant retailer offer, not
  as a property of the canonical product. A complete basket containing it
  discloses the alternative count.
- Different/unknown alternative packs are displayed for inspection, but
  omitted from equal-pack basket totals. Unit price is shown where measurable.
- An individually trusted price with unverified cross-retailer equivalence
  can still appear as an *indicative* subtotal. It is never described as a
  verified cheapest identical basket. Non-comparable relationships are
  excluded from equal-basket claims.
- An exact three-retailer badge/metric requires all three independent
  approved pair relationships. Raw overlap and reviewed alternatives are
  counted separately from verified exact triples.

## Current audit and release gate

The 3 November read-only review had **183 raw three-retailer price overlaps**:
130 titles appeared compatible, 22 had clear pack/variant/formulation
contradictions, 15 involved different brands/private labels needing
substitution review, and 16 had insufficient title information. These are
preliminary inferences. No group has independently captured direct-product
proof from all three retailers, so **verified exact triples are currently
zero established by this audit**; do not equate 183 with exact coverage.

The implementation is feature-branch work until GitHub `validate` passes,
the PR is merged, the table migration is applied through protected Supabase
workflow and the AWS ECR SHA-tagged image + Terraform rollout is confirmed
on `smie-prod-cluster` (eu-west-1). No merge automatically deploys. Do not
backfill/approve the 55 staged Dunnes different-pack candidates as exact
offers. Each requires fresh direct evidence and separately reviewed,
source-bound classification.

### Tesco renewal independence

Maintain existing SQL-bridge operational identity, leases, pacing,
guarded finaliser, exact Tesco identity checks, seven unresolved pages,
shared-SKU exclusions and 403/429/transport circuit breakers. Follow
`docs/tesco-operational-recovery-release-20261101.md`. Until the SQL-bridge
payload problem is fixed, use batches of **at most 10**. Existing due
renewals precede expansion. Peer relationship verification is asynchronous:
a verified Tesco price must not be rejected solely because Dunnes or
SuperValu currently lacks a price.

## Release checkpoint — 3 November 2026

PR #304 is merged into `main` at `fc7d2cc3d76f5ce57e8b86b9bbf454c11cf1a41a`
with GitHub Actions `validate` green. The protected Supabase migration is
installed as `20261103142905_offer_comparison_review_ledger`: verified RLS,
service-role SELECT-only, no anonymous/authenticated write access and a
SECURITY INVOKER validation trigger without public/API EXECUTE. A forged
capture reference was rejected in a rollback-only test. The ledger holds
zero approved decisions; 183 raw triple overlaps remain distinct from
zero independently corroborated exact triples under this review policy.

**AWS image build, ECR push and Terraform ECS rollout remain outstanding.**
Until live deployment, customer-facing UI has not changed; until independent
peer source captures and approved pair decisions exist, no alternative count
can truthfully increase. The supervised Tesco collector did not run in this
session, and its original safeguards remain unchanged.
