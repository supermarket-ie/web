# Tesco mapping-recovery plan (revised) — recover trusted prices by repairing/discovering mappings

Written 30 October 2026; revised after review of PR #284. A quantified,
evidence-grounded plan to grow Tesco trusted coverage beyond 323 by REPAIRING and
DISCOVERING correct Tesco mappings. Read-only investigation; nothing in production
was changed. All figures from uncapped prod reads.

Hard invariants (enforced by existing code; unchanged): never auto-overwrite a
master canonical identity, never clear historical holds, never retry
unknown-outcome (pending) requests, never accept a price without exact identity
verification. The existing 323 stay protected by the separate supervised renewal
process. Tesco renewals are out of scope here.

## 0. What changed from the first draft (review responses)

- REMOVED the "45–50 of the last 57 eligible mappings" projection. Recent
  expansion results (run 5 of the 421-request campaign: 14% accept; run 6:
  identity_hold_rate_exceeded at ~0 new prices) do NOT support it. The 57
  eligible-never-attempted are listed as a cohort to try, with NO numeric yield
  claim.
- Canonical-name enrichment is NO LONGER the default route (see §3): the live
  evidence shows most held cases are NOT "master name too generic" but wrong-size
  / wrong-variant retailer mappings that must be re-discovered, or cases solvable
  with retailer-level evidence without touching the master canonical.
- Corrected the pending count: the backlog said "4 pending" — the authoritative
  figure is **6 pending**, equal to the 6 historical unresolved requests (§6).

## 1. Backlog (unchanged from PR #284, still accurate)

2,461 Tesco mappings (1 canonical each; 685 duplicate shared-SKU): 323 fresh
trusted · 870 unproven-never-succeeded · 813 held on an identity reason · 313
shared-SKU deferred · 81 url-failed (80 audit-invalidated) · 57 eligible-never-
attempted · 6 pending/unknown (preserve — see §6).

## 2. Top-50 pilot cohort — held canonicals with FRESH Dunnes AND SuperValu prices

There are **143 held, unique-SKU Tesco canonicals that already have a fresh price
at BOTH Dunnes and SuperValu** (502 have ≥1 peer). Each recovered Tesco price here
creates a genuine THREE-retailer comparison immediately. Ranked by recovery
difficulty (easiest first), with the live evidence captured on the last fetch.

Defect/difficulty distribution across the 143 both-peer cohort (by dominant
identity reason): measureExactnessFailed 52 · "candidate does not establish full
exact canonical identity" 37 · measureConflict 14 · brandConflict 13 ·
unavailable_or_no_regular_price 10 (not recoverable now) · formulationConflict 7 ·
packExactnessFailed 5 · missing_exact_product 4 · transport 9 · ownLabelConflict 2
· variantConflict 1.

Top 50 (rank | defect | class | difficulty | Tesco SKU | canonical → LIVE Tesco
title | SV/DN €). "class" per §4.

| # | defect | class | diff | SKU | canonical → live | SV/DN |
|--|--|--|--|--|--|--|
| 1 | canonical_ambiguous | confirmed_equivalent (name generic) | easy | 293687406 | Broccoli → Tesco Family Pack Broccoli | 1.75/1.59 |
| 2 | canonical_ambiguous | confirmed_equivalent | easy | 253558972 | Cucumber → Tesco Whole Cucumber Each | 0.95/0.95 |
| 3 | canonical_ambiguous | confirmed_equivalent | easy | 254878499 | Fusilli 1kg → Tesco Fusilli Pasta Twists 1Kg | 1.35/3.49 |
| 4 | canonical_ambiguous | confirmed_equivalent | easy | 306954071 | Mushrooms → Tesco Irish Chestnut Mushrooms 250G | 0.95/1.15 |
| 5 | canonical_ambiguous | confirmed_equivalent | easy | 300823276 | Sultanas → Growers Harvest Sultanas 375G | 1.89/3.29 |
| 6 | canonical_ambiguous | plausible (spacing) | medium | 295496617 | Airwick Pure Soft Cotton Aerosol 250ml → Air Wick Pure Aerosol Soft Cotton Air Freshener 250ml | 3.5/3.5 |
| 7 | wrong_pack/qty | plausible_wrong_size | medium | 316313515 | Andrex Complete Clean (4 Roll) → …24 Standard Rolls | 3/3.65 |
| 8 | wrong_pack/qty | plausible_wrong_size | medium | 322046385 | Andrex Ultimate Fresh …36 Pack → …Single Pack | 1.5/2.33 |
| 9 | canonical_ambiguous | plausible | medium | 317739427 | Avonmore Chunky Chicken & Veg High Protein Soup 400g → Avonmore High Protein Chicken & Veg Soup 400g | 3.25/3.25 |
| 10 | wrong_pack/qty | plausible_wrong_size | medium | 285049178 | Avonmore Farmers Choice Mixed Veg Soup 1kg → …700G | 4.99/4.99 |
| 11 | transport | review | medium | 250005727 | Avonmore Light Cream 250ml → Avonmore Fresh Light Cream 250Ml | 2.39/1.5 |
| 12 | wrong_pack/qty | plausible_wrong_size | medium | 292621319 | Bacon Rashers Smoked → Tesco Smoked Irish Bacon Rashers 225G | 1.69/3.89 |
| 13 | wrong_pack/qty | plausible_wrong_size | medium | 262229847 | Baked Beans → Heinz Baked Beans In Tomato Sauce 3×200g | 1.5/1.9 |
| 14 | wrong_pack/qty | plausible_wrong_size | medium | 316431717 | Ballymaloe Italian Tomato Pasta Sauce 180g → …360g | 2.39/2 |
| 15 | wrong_pack/qty | plausible_wrong_size | medium | 254296718 | Balsamic Vinegar → Tesco Balsamic Vinegar Of Modena 250Ml | 1.6/4.29 |
| 16 | wrong_pack/qty | plausible_wrong_size | medium | 305829740 | Birds Eye Ultimate Chicken Fillet Burger 2 Pack → …227g | 4/4.5 |
| 17 | wrong_pack/qty | plausible_wrong_size | medium | 314596390 | Biscuits Digestive → Jacobs Digestive Creams Biscuits 200G | 0.79/0.79 |
| 18 | canonical_ambiguous | plausible | medium | 312227635 | Brady Family Hand Crumbed Thin Sliced Irish Ham 120g → …Thinly Sliced…120G | 4/4 |
| 19 | wrong_pack/qty | plausible_wrong_size | medium | 260178456 | Carrots & Parsnips 500g → Mash Direct Carrot & Parsnip Mash 400G | 1.39/1.39 |
| 20 | canonical_ambiguous | genuine_mismatch | hard | 264014086 | Cheddar Cheese Block → Applewood Smoked Cheddar Cheese 185g | 2.4/3.6 |
| 21 | wrong_pack/qty | plausible_wrong_size | medium | 272781516 | Chef Sweet & Sticky BBQ Sauce 400g → Heinz Sweet BBQ Sauce 500g | 3.49/3.5 |
| 22 | wrong_pack/qty | genuine_mismatch | hard | 298011813 | Chef Tomato Ketchup …470g → Heinz 50% Less Salt & Sugar Ketchup 880g | 4.5/3.37 |
| 23 | wrong_pack/qty | plausible_wrong_size | medium | 314095625 | Chicken Breast Fillets → Tesco Irish Chicken Breast Fillets 291G | 8.29/5.99 |
| 24 | wrong_pack/qty | plausible_wrong_size | medium | 295871818 | Chilli and Garlic Stir Fry Sauce → Blue Dragon Sweet Chilli & Garlic Stir Fry Sauce 120G | 1.05/0.85 |
| 25 | canonical_ambiguous | plausible | medium | 284777930 | Classic Pizza Sauce → Pizza Sauce 250G | 2.95/15 |
| 26 | canonical_ambiguous | plausible | medium | 262258403 | Clonakilty Black & White Mini Puddings 260g → Clonakilty Mini Puddings 260G | 3.2/3.2 |
| 27 | canonical_ambiguous | plausible | medium | 322135325 | Cooked Ham Sliced → Tesco Big Value Traditional Cooked Ham 320g | 2.19/2.79 |
| 28 | canonical_ambiguous | confirmed_equivalent | easy | 312833862 | Courgette → Tesco Loose Courgettes | 1.75/0.69 |
| 29 | wrong_pack/qty | plausible_wrong_size | medium | 308109009 | Dark Sea Salt Chocolate → KIND Dark Chocolate Nuts & Sea Salt Cereal Bars 3×30g | 4/4.85 |
| 30 | canonical_ambiguous | plausible | medium | 316802294 | Dolmio Spicy Chilli Bolognese Sauce 450g → Dolmio Bolognese Spicy Chili Red Pasta Sauce 450g | 3.5/3.5 |
| 31 | transport | review | medium | 251698077 | Dolmio Stir In Sweet Pepper Pasta Sauce 150g → …150G | 3/3 |
| 32 | canonical_ambiguous | plausible | medium | 313941162 | Domestos Fresh Floral Power Fresh Toilet Cleaner 750ml → Domestos Power Fresh Toilet Gel Floral Fresh 750ml | 2.5/4.5 |
| 33 | wrong_pack/qty | plausible_wrong_size | medium | 280932920 | Dr. Oetker Gelatine 3 Sachets 12g → Dr.Oetker Gelatine Sachet 3×12g | 2.29/2.3 |
| 34 | wrong_pack/qty | plausible_wrong_size | medium | 303759559 | Easy Peelers → Tesco Easy Peeler Pack 750G | 0.45/2.99 |
| 35 | wrong_pack/qty | plausible_wrong_size | medium | 299155664 | Ecover Camomile & Clementine Washing Up Liquid 450ml → …950ml | 2.5/2.99 |
| 36 | wrong_pack/qty | plausible_wrong_size | medium | 272640603 | Egg Noodles → Tesco Medium Egg Noodles 250G | 0.95/1.5 |
| 37 | wrong_pack/qty | plausible_wrong_size | medium | 254887027 | English Mustard → Colman's Original English Mustard Jar 100G | 2.75/2.75 |
| 38 | wrong_pack/qty | plausible_wrong_size | medium | 308863336 | Felix Soup Tender Strips Selection 6 Pack → …6×48g | 3/2 |
| 39 | wrong_pack/qty | plausible_wrong_size | medium | 307314499 | Flaked Almonds → Tesco Flaked Almonds 200G | 3.69/3.69 |
| 40 | canonical_ambiguous | genuine_mismatch | hard | 312581491 | Flash Bleach Spray 800ml → Flash Bathroom Cleaning Spray 800Ml | 3.4/3.5 |
| 41 | wrong_pack/qty | plausible_wrong_size | medium | 252807478 | Free Range Eggs 6 → Tesco Free Range Eggs Large 6 Pack | 2.25/2.55 |
| 42 | canonical_ambiguous | genuine_mismatch | hard | 322334723 | Frozen Chips → Strong Roots Proper Chips 750g | 2.39/4.99 |
| 43 | wrong_pack/qty | plausible_wrong_size | medium | 300794983 | Fruit & Nut Chocolate → Tesco Fruit & Nut Milk Chocolate 200G | 2/3.15 |
| 44 | canonical_ambiguous | plausible | medium | 314588808 | Fruit Chews → Starburst Chewy Sweets Fruit Flavoured Pouch Bag 138g | 3.5/3.5 |
| 45 | canonical_ambiguous | confirmed_equivalent | easy | 254878614 | Fusilli Wholewheat 500g → Tesco Whole Wheat Fusilli Pasta 500G | 1.05/1.05 |
| 46 | wrong_pack/qty | plausible_wrong_size | medium | 254385356 | Galia Melon 1 Pack → Tesco Galia Melon Each | 2.49/2.49 |
| 47 | wrong_pack/qty | plausible_wrong_size | medium | 303316048 | Garlic & Coriander Naan Breads → Tesco Garlic & Coriander Naan Bread 2 Pack | 0.85/2.99 |
| 48 | wrong_pack/qty | plausible_wrong_size | medium | 330742553 | Glenisk High Protein Strawberry Strained Irish Yogurt 4 Pack → …4×105g | 2.99/2.5 |
| 49 | canonical_ambiguous | plausible | medium | 312108788 | Glenisk Organic Kids Apricot Yogurt 4 Pack → …4×90g | 2.49/2.49 |
| 50 | canonical_ambiguous | plausible | medium | 311428779 | Glenisk Organic Kids Banana Yogurt 4 Pack → …4×90g | 2.49/2.49 |

(Alphabetical tail of the 143 continues past #50; the full list is reproducible
from the read-only query. SV/DN are current fresh peer prices in €.)

## 3. Is canonical-name enrichment the right fix? Mostly NO — assess retailer evidence first

The live evidence contradicts a "rename the master canonical" default:

- Many "canonical_ambiguous" cases are the stored RETAILER descriptor
  (`store_products.store_product_name`) being stale/short vs the live Tesco title
  (e.g. #39 stored "Tesco Flaked Almonds" vs live "Tesco Flaked Almonds 200G").
  The master canonical is fine; the fix is to let identity verification use the
  LIVE title + structured quantity (which the collector already fetches) rather
  than a reviewed master-canonical change. An "accepted retailer descriptor"
  (store-level) is the right lever, NOT a master-canonical edit.
- Most "wrong_pack/qty" and "measureExactnessFailed" cases are genuine: the Tesco
  SKU is a DIFFERENT pack size than the canonical describes (#14 180g→360g, #22
  470g→880g, #10 1kg→700G). Renaming the canonical to match would CORRUPT the
  master product and mis-compare against Dunnes/SuperValu. These need REDISCOVERY
  of the correct-size Tesco SKU, never a canonical rename.
- A minority ("confirmed_equivalent", #1–5/#28/#45) are truly the master name
  being under-specified while the mapping is correct AND the size agrees. Only
  here is a reviewed canonical/alias change defensible — and even then an
  accepted-descriptor/alias is preferable to editing the shared master canonical,
  because the master is used for cross-retailer joining.

Order of preference for establishing identity WITHOUT changing the master
canonical: (1) validate against live Tesco title + structured quantity already on
the page; (2) a retailer-scoped accepted descriptor/alias on the Tesco
store_products row; (3) rediscover the correct SKU when the live product is
genuinely a different size/variant/brand; (4) only as a last resort, a reviewed
master-canonical enrichment for genuinely-generic names with an agreeing mapping.

## 4. Separate confirmed-equivalent / plausible / genuine-mismatch (independent corroboration)

Classification is from LIVE evidence, and every accept still requires independent
corroboration of exact SKU, brand, quantity, variant and formulation (the existing
`classifyTescoReplacement` gate — no change):

- **confirmed_equivalent** (~13 of 143): live title ⊇ all canonical terms AND
  measure/pack agree; the mapping is correct and only a descriptor/alias gap
  blocks it. Lowest risk.
- **plausible_match / plausible_wrong_size** (~357 across the broader peer set;
  ~120 of 143): the live product looks related but a material attribute
  (measure/pack/variant/brand) differs — treat as UNVERIFIED; requires rediscovery
  and full corroboration before any correction.
- **genuine_mismatch** (~79 of the ≥1-peer set): live product is a different
  product (Cheddar Block→Applewood Smoked, Frozen Chips→Strong Roots). Rediscover;
  never coerce.
- **not_recoverable_now**: unavailable_or_no_regular_price (10/143) — out of stock;
  renewal retries when back.

No candidate is accepted on name similarity; the deterministic SKU+brand+
quantity+variant+formulation checks in `classifyTescoReplacement` remain the gate.

## 5. Safety audit of the discovery + guarded-finalisation RPCs (requirement 5)

Reviewed `finalize_tesco_candidate_discovery` and `selectAuditedTescoDiscoveryProducts`:

What the RPC DOES guarantee (safe to reuse): it corrects `store_products`
SKU/URL/name ONLY for a row whose `url_status='failed'` AND
`url_last_error like 'tesco_mapping_audit:%'` (raises "Audited Tesco mapping guard
did not match" otherwise), requires `classification='exact_replacement_candidate'`
AND exactly ONE distinct exact candidate SKU, a positive price, a running
discovery run, and an idempotent `scrape_product_receipts` insert; it writes a
`retailer_mapping_audit_decisions` trail. It CANNOT touch a `resolved`/accepted
mapping (the `url_status='failed'` guard), CANNOT overwrite the master canonical
(`products` is untouched; it only reads `p.brand`), and is single-candidate so it
cannot pick among ambiguous matches.

Gaps that MUST be closed before generalising scope (else the stated risks are
real):
1. **Trusted price without fresh live re-verification.** The RPC writes a trusted
   `price_observations` row (source `pepesto_search`) from the DISCOVERY
   candidate's price — there is no fresh live re-fetch of the corrected SKU before
   the price is trusted. Generalising cohort scope would therefore produce trusted
   prices from search evidence alone. REQUIRED CHANGE: for the recovery pipeline,
   the RPC must apply the SKU/URL correction but NOT finalise a price; the
   corrected mapping re-enters the supervised collector / acquisition handoff,
   which re-verifies identity on a fresh live fetch before any trusted price.
2. **Hold bypass.** The `held` predicate parks a product whenever its page carries
   identity_results reasons. A correction changes `store_sku`/`store_url`, so the
   NEW url has no prior rejection — correct (the hold was against the OLD wrong
   mapping). But the pipeline must NOT delete/alter the old pending/holds rows
   (they stay as evidence); it only adds a new resolved mapping + fresh attempt.
   Confirmed the RPC does not touch collection-page rows → no hold bypass, provided
   the generalised cohort selection still EXCLUDES the 6 pending unknowns (§6).
3. **Cohort generalisation guard.** `selectAuditedTescoDiscoveryProducts` is keyed
   to one audit batch. Generalising must keep the SAME invalidation-marker guard:
   a mapping enters discovery only after it is explicitly invalidated
   (`url_status='failed'`, `url_last_error='tesco_mapping_audit:…'`) by a reviewed
   decision — never directly from `resolved`. This preserves "no accepted mapping
   overwritten" and keeps the RPC guard meaningful.

Conclusion: generalising scope is safe ONLY with changes (1)+(3); without them it
could trust search-only prices. The pilot (§7) adopts both.

## 6. Pending vs historical-unresolved reconciliation (requirement 6)

Authoritative live count: there are **6** `tesco_direct_collection_pages` with
`outcome='pending'`, exactly matching the 6 historical unresolved requests in
`docs/tesco-recovery-plan.md` §2:
- products 285859740 (run 8b22ab1e), 308853589 (f4bb77d4), 314109029 (21443f41),
  317854748 (a502af52, the orphaned run), 311944507 (0d7fca1f); and the Glenisk
  search page (0e60076d).
The PR #284 "4 pending" was a reporting artifact of the eligibility-gated count
(it excluded pending rows on shared-SKU / non-proven mappings). The correct figure
is 6 = the runbook's 6. Three of the product SKUs (285859740, 308853589,
311944507) ALSO have later `ok` rows from separate attempts, but the original
pending rows remain unknown-outcome and MUST stay preserved. The orphaned
`a502af52` run and 4 ancient Aug `pepesto_tesco_eval` runs stay as-is. The
recovery pipeline's cohort selection explicitly EXCLUDES all 6 pending URLs and
never retries or closes them.

## 7. Proposed first pilot — 50 high-value canonicals, discovery + verification only

Scope: the top 50 from §2 (held, unique-SKU, BOTH fresh peers). NO automatic
production mapping updates; NO trusted-price writes in the pilot; NO holds
cleared; the 6 pending excluded.

Pilot stages (all reuse existing capabilities):
1. Select the 50 (read-only), each tagged with defect + class + difficulty.
2. For each, one Pepesto single-query discovery keyed on the canonical name
   (existing `pepesto-tesco-candidate-discovery` canary). Persist every candidate
   to `tesco_candidate_discovery_evidence` with its deterministic
   `classifyTescoReplacement` classification. No fetch of the known mapping URL.
3. Classify: confirmed_equivalent / plausible / genuine_mismatch / no-candidate.
   Report ONLY; apply nothing.
4. Operator reviews the evidence; approves corrections case-by-case.
5. (Separate, post-approval, NOT in the pilot run) approved corrections are
   applied via the guarded RPC in CORRECTION-ONLY mode (SKU/URL, no price), then
   the corrected mappings re-enter the normal supervised collector which
   re-verifies identity on a fresh live fetch before any trusted price.

The pilot stops at step 3/4 (discovery + verified classification + a review
report). It is a measurement of how many of the 50 yield an exact,
independently-corroborated candidate — with NO production mutation.

## 8. Success metrics (per pilot run)

- candidates_discovered: total Pepesto candidates returned across the 50.
- exact_verified: products with exactly one distinct `exact_replacement_candidate`
  passing all deterministic checks.
- corrections_approved: operator-approved (manual; expected ≤ exact_verified).
- trusted_prices_recovered: NEW `price_observations` written AFTER fresh live
  re-verification (0 during the discovery-only pilot; counted in the follow-on).
- new_three_retailer_comparisons: recovered canonicals that become tesco+SV+DN.
- errors: Pepesto failures, zero-candidate, multi-candidate-conflict,
  guard-mismatch.
- cost_per_accepted_price: Pepesto credits spent ÷ trusted_prices_recovered.
- Baseline from the existing audited-discovery history: 36 attempted → 26
  material_mismatch → 10 exact_replacement_candidate (~28% exact rate). The pilot
  tests whether the peer-prioritised cohort beats that.

## 9. Engineering changes required for the pilot (exact)

Minimal, reuse-first:
1. **Generalise the discovery cohort (read-only selection).** Add a cohort
   selector (e.g. `selectHeldTescoRecoveryCandidates(limit, {bothPeersFirst})`)
   alongside `selectAuditedTescoDiscoveryProducts` that returns held, unique-SKU,
   proven, peer-ranked products — WITHOUT requiring the one hard-coded audit
   batch. Pure selection; no mapping change. Excludes the 6 pending URLs.
2. **Correction-only mode in the finalisation path.** Split
   `finalize_tesco_candidate_discovery` so the SKU/URL correction and the
   price-write are separable: a `p_apply_price=false` path (or a sibling RPC)
   corrects the mapping and writes the audit trail but does NOT insert a
   `price_observations` row. The corrected mapping then flows through the existing
   supervised collector for fresh live price verification. Keeps the
   `url_status='failed' + tesco_mapping_audit:` guard.
3. **Reviewed invalidation entry.** A guarded-SQL migration (same pattern as the
   26-row 2026-09-20 audit) that records the pilot's 50 as a new decision batch
   and sets them `url_status='failed'`, `url_last_error='tesco_mapping_audit:…'`
   ONLY after the live evidence confirms the current mapping is wrong — so the
   discovery RPC guard applies. (confirmed_equivalent cases are handled by a
   retailer-descriptor/alias change instead, not invalidation.)
4. **Tests.** Unit tests for the new cohort selector (peer ranking, pending
   exclusion, shared-SKU exclusion) and for the correction-only RPC path (writes
   mapping + audit, writes NO price; still blocked on non-invalidated rows).
5. NO change to: the master `products` table, the `held` predicate, the renewal
   path, the circuit breakers, or the supervised collector's live-verification
   gate.

## 10. Recommended sequence

1. Build §9.1 (cohort selector) + §9.2 (correction-only RPC) + tests behind a PR;
   run the discovery-only pilot over the 50 on the permitted Work egress; produce
   the §8 metrics report. No production mapping/price change.
2. Operator reviews; approves the subset with exact corroborated candidates.
3. Apply approved corrections (correction-only) → re-collect via the supervised
   collector (fresh live verification) → trusted prices + new triples.
4. Iterate over the remaining both-peer cohort, then ≥1-peer, by difficulty.
5. Renewal keeps everything fresh; Tesco renewals remain separate and protected.
