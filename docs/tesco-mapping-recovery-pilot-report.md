# Tesco mapping-recovery pilot — 50-product deliverable

Approved bounded, supervised discovery + identity-verification pilot. Prepared
from CURRENT evidence (read-only). It does NOT apply any mapping correction, write
any trusted price, clear any hold, or launch a collection campaign. Proposed Tesco
SKUs are produced by the live discovery run (a separate supervised step).

## Review-round improvements (this revision)

1. REPRESENTATIVE sampling (not alphabetical): `selectRepresentativeSample`
   round-robins across every identity-failure category present and, within each,
   prioritises the likeliest recoveries (recoverability high>medium>low, then
   both-peers). So the 50 cover wrong_pack/qty, canonical_ambiguous, brand/
   ownlabel, variant/formulation, missing_on_page, etc. — not 50 of the biggest
   bucket. The cohort SQL now returns the FULL both-peer held set for sampling.
2. TWO-TIER verification: a Pepesto SEARCH match is `search_matched_unverified`
   (a proposal). `exact_verified` requires an ADDITIONAL fresh Tesco product-page
   corroboration (`validateTescoCollectedIdentity`: live SKU, brand, structured
   quantity, pack, variant, formulation). Only tier 2 is "fully verified".
3. COMPLETE runner: `runDiscoveryPilot` (dependency-injected, unit-tested) does
   per-product search → classify → persist evidence → optional tier-2 live check →
   cost tracking → per-product report, stopping on access/execution failure and
   NEVER calling the finalise RPC / writing a trusted price.

## Scope + safety posture (as approved)

- Cohort: the revised high-value held-mapping set — held on an identity reason,
  unique-SKU, proven, canonical-URL Tesco mappings with NO fresh trusted price AND
  a fresh price at BOTH Dunnes and SuperValu, so each recovery is a three-retailer
  comparison. 476 qualify (139 both-peers, 337 one-peer); the pilot takes the top
  50, all both-peers.
- Excludes: the 6 historical unresolved (pending) requests, shared-SKU groups,
  recent-24h attempts, and anything not safely independently discoverable.
  Verified: 0 pending URLs leak into the cohort.
- Mechanism: REUSES the existing Pepesto single-query discovery + the deterministic
  `classifyTescoReplacement` validator. No new scraper. No matching-rule changes.
- Engineering boundary honoured: the pilot path NEVER calls
  `finalize_tesco_candidate_discovery` (no SKU/URL change, no price). A
  correction-only pathway + fresh live re-verification is a separate later step.

## How to run the live discovery (separate supervised step)

1. Select the 50 via the read-only `pilotCohortSql(50)` (in
   `src/lib/tesco-mapping-recovery-pilot.ts`).
2. One Pepesto `/search` per product (existing supported discovery path; bounded;
   ~12c/product historically → ≈€6 for 50; NOT AWS direct Tesco).
3. Persist every candidate to `tesco_candidate_discovery_evidence` and classify
   with `classifyPilotDiscovery` (reuses `classifyTescoReplacement`).
4. Produce the per-product verdict (five outcomes below). Apply nothing.

## Classification outcomes (requirement 8)

- `exact_verified` — exactly one distinct candidate SKU passes the strict
  deterministic validator (brand, measure, pack, variant, formulation all agree,
  URL↔SKU corroborate). A PROPOSED correction for operator review — not applied.
- `plausible_more_evidence` — related but a material attribute is unverified, or
  more than one exact candidate (ambiguous). Needs more evidence.
- `wrong_product_variant_pack` — every candidate is a material mismatch.
- `no_reliable_candidate` — discovery returned nothing usable.
- `access_or_execution_failure` — Pepesto/egress failure; STOP and report (do not
  relax rules to force a result).

## Reconciled 50-product cohort (current evidence; proposed SKU pending discovery)

All 50 have fresh Dunnes AND SuperValu prices → up to 50 potential NEW
three-retailer comparisons if recovered. "Live" is the Tesco title the current SKU
last resolved to (evidence of the defect). Est. recoverability: high = mapping
likely already correct (live ⊇ canonical terms, name just generic); medium = needs
discovery/rediscovery of correct size; low = live product looks like a different
product/variant/brand; n/a = out of stock (not mapping-recoverable now).

Top-50 defect mix: 22 wrong_pack_or_quantity · 13 canonical_ambiguous ·
6 wrong_variant_or_formulation · 5 brand_or_ownlabel · 2 missing_on_page ·
2 out_of_stock. Recoverability estimate: 2 high · 33 medium · 13 low · 2 n/a.

| # | defect | est | Tesco SKU | canonical → LIVE Tesco title | SV/DN € |
|--|--|--|--|--|--|
| 1 | canonical_ambiguous | medium | 295496617 | Airwick Pure Soft Cotton Aerosol 250ml → Air Wick Pure Aerosol Soft Cotton Air Freshener 250ml | 3.5/3.5 |
| 2 | wrong_pack/qty | medium | 316313515 | Andrex Complete Clean (4 Roll) → …24 Standard Rolls | 3/3.65 |
| 3 | wrong_pack/qty | medium | 322046385 | Andrex Ultimate Fresh …36 Pack → …Single Pack | 1.5/2.33 |
| 4 | canonical_ambiguous | medium | 317739427 | Avonmore Chunky Chicken & Veg High Protein Soup 400g → Avonmore High Protein Chicken & Veg Soup 400g | 3.25/3.25 |
| 5 | wrong_pack/qty | medium | 285049178 | Avonmore Farmers Choice Mixed Veg Soup 1kg → …700G | 4.99/4.99 |
| 6 | wrong_pack/qty | medium | 292621319 | Bacon Rashers Smoked → Tesco Smoked Irish Bacon Rashers 225G | 1.69/3.89 |
| 7 | wrong_pack/qty | medium | 262229847 | Baked Beans → Heinz Baked Beans In Tomato Sauce 3×200g | 1.5/1.9 |
| 8 | wrong_variant/form | low | 316055434 | Ballygowan Hint of Fruit Strawberry 750ml → …Sugar Free Flavoured Still Water 750ml | 1.85/1.85 |
| 9 | wrong_variant/form | low | 316198725 | Ballygowan Hint of Fruit Watermelon 1.5L → …Sugar Free Flavoured Still Water 1.5 Litre | 1.85/1.85 |
| 10 | wrong_variant/form | low | 320795139 | Ballygowan Hint of Fruits Summer Fruits Sparkling 1.5L → …Sugar Free Flavoured Sparkling Water 1.5 Litre | 1.85/1.85 |
| 11 | wrong_pack/qty | medium | 316431717 | Ballymaloe Italian Tomato Pasta Sauce 180g → …360g | 2.39/2 |
| 12 | brand_or_ownlabel | low | 316789547 | Ballymaloe Pizza Sauce 170g → Ballymaloe Pizza Sauce 170g | 2.89/2.59 |
| 13 | wrong_pack/qty | medium | 254296718 | Balsamic Vinegar → Tesco Balsamic Vinegar Of Modena 250Ml | 1.6/4.29 |
| 14 | wrong_pack/qty | medium | 305829740 | Birds Eye Ultimate Chicken Fillet Burger 2 Pack → …227g | 4/4.5 |
| 15 | wrong_pack/qty | medium | 314596390 | Biscuits Digestive → Jacobs Digestive Creams Biscuits 200G | 0.79/0.79 |
| 16 | canonical_ambiguous | medium | 312227635 | Brady Family Hand Crumbed Thin Sliced Irish Ham 120g → …Thinly Sliced 14 Irish Ham 120G | 4/4 |
| 17 | canonical_ambiguous | **high** | 293687406 | Broccoli → Tesco Family Pack Broccoli | 1.75/1.59 |
| 18 | missing_on_page | low | 316809160 | Cadbury Starbar Duo Chocolate Bar 74g → Cadbury Starbar Duo Milk Chocolate Bar 74g | 2.4/2.25 |
| 19 | wrong_pack/qty | medium | 260178456 | Carrots & Parsnips 500g → Mash Direct Carrot & Parsnip Mash 400G | 1.39/1.39 |
| 20 | brand_or_ownlabel | low | 303260549 | Cauliflower → Strong Roots Cauliflower Hash Brown 375g | 1.95/1.89 |
| 21 | canonical_ambiguous | medium | 264014086 | Cheddar Cheese Block → Applewood Smoked Cheddar Cheese 185g | 2.4/3.6 |
| 22 | wrong_pack/qty | medium | 272781516 | Chef Sweet & Sticky BBQ Sauce 400g → Heinz Sweet BBQ Sauce 500g | 3.49/3.5 |
| 23 | wrong_pack/qty | medium | 298011813 | Chef Tomato Ketchup …470g → Heinz 50% Less Salt & Sugar Ketchup 880g | 4.5/3.37 |
| 24 | wrong_pack/qty | medium | 314095625 | Chicken Breast Fillets → Tesco Irish Chicken Breast Fillets 291G | 8.29/5.99 |
| 25 | wrong_pack/qty | medium | 295871818 | Chilli and Garlic Stir Fry Sauce → Blue Dragon Sweet Chilli & Garlic Stir Fry Sauce 120G | 1.05/0.85 |
| 26 | canonical_ambiguous | medium | 284777930 | Classic Pizza Sauce → Pizza Sauce 250G | 2.95/15 |
| 27 | canonical_ambiguous | medium | 262258403 | Clonakilty Black & White Mini Puddings 260g → Clonakilty Mini Puddings 260G | 3.2/3.2 |
| 28 | missing_on_page | low | 316060911 | Club Rock Shandy 500ml → Club Rock Shandy Bottle 500ml | 2.25/2 |
| 29 | wrong_variant/form | low | 318072329 | Colgate Total Active Fresh Toothpaste 125ml → Colgate Total Active Prevention Fresh Mint Toothpaste 125ml | 4.65/4.5 |
| 30 | out_of_stock | n/a | 311688401 | Cooked Beetroot 500g → Tesco Cooked Beetroot 500g | 0.69/0.69 |
| 31 | canonical_ambiguous | medium | 322135325 | Cooked Ham Sliced → Tesco Big Value Traditional Cooked Ham 320g | 2.19/2.79 |
| 32 | canonical_ambiguous | medium | 312833862 | Courgette → Tesco Loose Courgettes | 1.75/0.69 |
| 33 | wrong_variant/form | low | 311436216 | Cream Cheese → Philadelphia Light Low Fat Soft Cream Cheese 280G | 2/2 |
| 34 | canonical_ambiguous | **high** | 253558972 | Cucumber → Tesco Whole Cucumber Each | 0.95/0.95 |
| 35 | out_of_stock | n/a | 278236013 | Dark Chocolate 100g → Tesco Dark Chocolate Chips 100G | 1.25/2.99 |
| 36 | wrong_pack/qty | medium | 308109009 | Dark Sea Salt Chocolate → KIND Dark Chocolate Nuts & Sea Salt Cereal Bars 3×30g | 4/4.85 |
| 37 | brand_or_ownlabel | low | 260691710 | Dijon Mustard → Tesco Dijon Mustard 185G | 4.69/2.6 |
| 38 | canonical_ambiguous | medium | 316802294 | Dolmio Spicy Chilli Bolognese Sauce 450g → Dolmio Bolognese Spicy Chili Red Pasta Sauce 450g | 3.5/3.5 |
| 39 | canonical_ambiguous | medium | 313941162 | Domestos Fresh Floral Power Fresh Toilet Cleaner 750ml → Domestos Power Fresh Toilet Gel Floral Fresh 750ml | 2.5/4.5 |
| 40 | brand_or_ownlabel | low | 304724639 | Dr. Oetker Baking Cases 100 Pack → Dr Oetker Baking Cases 100Pc | 1.6/3 |
| 41 | brand_or_ownlabel | low | 260285673 | Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g → Dr Oetker Bistro Baguette Pepperoni 2×125g | 2.99/2.99 |
| 42 | wrong_pack/qty | medium | 280932920 | Dr. Oetker Gelatine 3 Sachets 12g → Dr.Oetker Gelatine Sachet 3×12g | 2.29/2.3 |
| 43 | wrong_pack/qty | medium | 303759559 | Easy Peelers → Tesco Easy Peeler Pack 750G | 0.45/2.99 |
| 44 | wrong_pack/qty | medium | 299155664 | Ecover Camomile & Clementine Washing Up Liquid 450ml → …950ml | 2.5/2.99 |
| 45 | wrong_pack/qty | medium | 272640603 | Egg Noodles → Tesco Medium Egg Noodles 250G | 0.95/1.5 |
| 46 | wrong_variant/form | low | 286348001 | Ella's Kitchen Strawberry & Banana Melty Puffs 6+ Months 20g → …Organic Strawberry + Banana Melty Puffs Baby Snack 6m+ 20g | 1.05/0.95 |
| 47 | wrong_pack/qty | medium | 254887027 | English Mustard → Colman's Original English Mustard Jar 100G | 2.75/2.75 |
| 48 | wrong_pack/qty | medium | 308863336 | Felix Soup Tender Strips Selection 6 Pack → …6×48g | 3/2 |
| 49 | wrong_pack/qty | medium | 307314499 | Flaked Almonds → Tesco Flaked Almonds 200G | 3.69/3.69 |
| 50 | canonical_ambiguous | medium | 312581491 | Flash Bleach Spray 800ml → Flash Bathroom Cleaning Spray 800Ml | 3.4/3.5 |

## Interpretation (evidence, not a yield promise)

The live title shows the dominant pattern is the Tesco SKU resolving to a product
whose SIZE/VARIANT genuinely differs from the canonical (e.g. #11 180g→360g, #23
470g→880g, #8–10 flavoured-water size/format): these need rediscovery of the
correct-size SKU, NOT a canonical rename. A smaller set (#17 Broccoli, #34
Cucumber) are the mapping already being correct with a generic master name. Two
(#30, #35) are out of stock — not mapping-recoverable now. The 50-product live
discovery run measures how many yield a single `exact_verified` candidate; the
historical exact rate on a less-prioritised cohort was ~28% (10/36).

## Metrics the live run will report (requirement 9)

discovery_requests · candidate_yield (total candidates) · exact_verified ·
plausible · wrong_product · no_candidate · access_failures ·
expected_new_three_retailer_comparisons (= exact_verified here, since all 50 have
both peers) · pepesto_cost_cents · cost_per_exact. Stop immediately on
access_or_execution_failure; do not relax matching to raise the rate.

## Next steps (gated on this report + the live run)

1. Operator reviews this cohort; approves the live discovery run (≈€6 Pepesto).
2. Run discovery-only via `runDiscoveryPilot` (no corrections/prices); produce the
   metrics + per-product verdict with proposed SKUs for `search_matched`/
   `exact_verified` rows.
3. SEPARATELY (own PR/release): build the correction-only pathway (apply approved
   SKU/URL with a full audit trail, NO price), then re-collect via the supervised
   collector which re-verifies identity on a fresh live fetch before any trusted
   price. Only then do recovered prices + new triples materialise.

## Separate + urgent: Tesco RENEWALS (not part of discovery)

The 323 trusted prices renew on their own window and are handled ONLY through the
proven ChatGPT Work supervised renewal path (`tesco:supervised --mode renewal`),
never through this discovery work. Current status (read-only, 29 Oct ~21:46 UTC):
323 fresh; **7 now due (≥4 days old)**; 0 expiring within 24h; soonest expiry
2026-11-01 ~20:00 UTC, latest 2026-11-04 ~09:40 UTC. ACTION: run a supervised
renewal session as the window opens (first expiries ~2 days out) to protect the
323; keep it fully separate from the discovery pilot.
