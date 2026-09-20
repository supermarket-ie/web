# Tesco mapping integrity audit — 20 September 2026

This is the first read-only baseline for Tesco recovery. It records production
evidence before any mapping or price mutation. Counts are conservative:
`ambiguous` means a mapping has not earned either exact or invalid status yet.

## Production baseline

| Measure | Result |
|---|---:|
| Canonical catalogue | 2,462 |
| Tesco mapping rows | 2,461 |
| Resolved Tesco mappings | 2,460 |
| Fresh trusted canonical rows | 118 |
| Unique fresh Tesco SKUs | 114 |
| Catalogue coverage | 4.79% |
| Demand-weighted coverage | 50.93% |
| Products live at two or more main retailers | 803 (32.62%) |
| Products live at all three main retailers | 78 (3.17%) |

The latest untouched `/products` run remains
`97f092ea-8cd6-49ed-bd04-a3ce7545c751`. Its persisted batch returned 22
shopping-list items, accepted no exact requested SKU, cost 32 cents and is the
evidence source used for replacement inspection. No paid request was made for
this audit.

## Risk-classifier result

| Classification / risk | Result |
|---|---:|
| Fresh rows with a deterministic material conflict | 12 |
| Fresh rows on a duplicated Tesco SKU | 29 |
| Fresh rows with a unique SKU and full canonical-term coverage | 66 |
| Fresh unique-SKU rows whose titles still require review | 23 |
| Duplicate Tesco SKU groups | 325 |
| Rows in duplicate-SKU groups | 742 |
| Duplicate groups with identical canonical term sets | 1 |
| Exact replacement candidates in persisted Pepesto evidence | 0 |

The single same-term duplicate group is not yet a valid synonym decision: the
two olive-oil canonical rows have conflicting brand metadata (one is Monini;
the current Tesco item is Tesco own-label). It remains ambiguous/material until
canonical identity is corrected.

The 66 full-term rows are a high-confidence review cohort, not a final count of
`exact_unique`: brand, measure, pack, formulation and duplicate-group checks
still take precedence. A duplicate SKU is never accepted as a synonym merely
because its names look similar.

## Deterministic fresh conflicts

These 12 current rows are candidates for removal from trusted Tesco coverage
after a reviewed mutation plan; this audit did not change them.

| Canonical identity | Stored Tesco identity | Conflict |
|---|---|---|
| Bananas Loose (Fyffes) | Tesco Loose Bananas | brand / own-label |
| Chilli Peppers Red | Tesco Red Bell Pepper Each | product type |
| Closed Cup Mushrooms 250g | Tesco Closed Cup Mushrooms 300g | size |
| Curry Sauce Mild (Daily Basics) | McDonnells Mild Curry Sauce 200g | brand |
| Dr. Oetker Bistro Pepperoni Pizza 2 Pack | Dr Oetker Bistro Pepperoni Baguette 250g | product type |
| Granny Smith Apples 6 Pack | Tesco Granny Smith Apples 5 Pack | pack count |
| Loose Pink Lady Apples 1 Pack | Tesco Pink Lady Apples 5 Pack | pack count |
| Loose Royal Gala Apples 1 Pack | Tesco Gala Apples 7 Pack | pack count |
| Muller Rice Original Low Fat Dessert 180g | Muller Rice Original Low Fat Rice Pudding Dessert 170g | size |
| Olive Oil Extra Virgin 500ml (Monini) | Tesco Extra Virgin Olive Oil 500ml | brand / own-label |
| Semolina Conchiglie 500g | Shamrock Semolina Flour 500g | product type |
| Strawberry Yogurt | Tesco Strawberry Yogurt Drink 6 x 100g | product type |

## Duplicate-SKU audit

All 325 groups were enumerated programmatically. Only one group has the same
normalised canonical term set, and it fails the separate brand check described
above. The remaining 324 groups are not synonyms by construction and stay in
the risk queue. The fresh-intersecting sample shows wholemeal pitta shared by
generic pitta records, red chilli shared with red pepper, conflicting apple
pack sizes, and materially different bacon, yogurt, chicken and fruit variants.

No canonical records were merged and no duplicate group was automatically
accepted.

## Persisted candidate evidence

The 50 requested mappings and all candidates in the persisted batch were
compared without another Pepesto call. Eligibility required URL/SKU
corroboration and full agreement on brand, type, variant, formulation, size and
pack. No new SKU passed the strict exact-replacement test. Broad alternatives
such as flour for pancake mix remain evidence only.

## Next safe step

The second read-only pass completed the row-level audit of all 29 fresh rows
whose SKU is duplicated elsewhere and all 23 fresh unique-SKU rows whose title
did not contain every canonical term. The combined deterministic repair set
contains 26 fresh mappings. Fourteen title-review rows are corroborated exact
identities, two remain ambiguous (`Chia Loaf` and `Frozen Mixed Veg 1kg`), and
seven are material mismatches; two of those seven were already in the first
12-row set. The duplicate-SKU pass added nine further deterministic mismatches.

Additional conflicts include:

- chilli-infused olive oil mapped to plain olive oil;
- onions mapped to breaded onion rings;
- onion powder mapped to onion granules;
- generic pitta, chicken and salmon mapped to wholemeal, free-range or organic
  variants;
- branded wraps mapped to a different brand and formulation;
- natural yogurt mapped to peach yogurt with a different pack/size;
- oyster chicken thighs mapped to boneless thighs;
- generic kiwi and Tesco grapes mapped to gold kiwi and Keelings black grapes.

The repair migration records a complete pre-change JSON snapshot and reason in
the private, RLS-protected `retailer_mapping_audit_decisions` table before it
changes a mapping. It preserves the old Tesco SKU, URL, title and observations,
and marks only the mapping status as failed so it exits `latest_prices` and all
trusted consumer coverage. The update is guarded by the snapshotted identity;
it will not overwrite a mapping that changed after the audit.

The migration was first executed inside a production transaction and rolled
back to verify its SQL and guards. It was then applied after PR #171 passed CI,
the preview reached `READY` and production deployment
`dpl_5vZFcKCa6jUpxfcWL3po34RVZKZ7` reached `READY` at commit
`b7507cb90931143cd1e1d919fdea17c368aa33d2`.

## Corrected baseline if the repair set is applied

| Measure | Current | After 26 deterministic invalidations |
|---|---:|---:|
| Fresh trusted canonical rows | 118 | 92 |
| Unique fresh Tesco SKUs | 114 | 91 |
| Catalogue coverage | 4.79% | 3.74% |
| Demand-weighted coverage | 50.86% | 38.13% |
| Products live at two or more main retailers | 803 | 794 |
| Products live at all three main retailers | 78 | 67 |

The demand denominator had increased from 1,659 to 1,681 units by the time of
the second pass; current and corrected demand percentages therefore use the
same live denominator of 1,681. Correctness takes precedence over retaining the
118-row headline.

Production verification confirmed all predicted results: 26/26 decisions have
an applied audit action, 26 mappings carry the audit failure marker and none of
those mappings remains in `latest_prices`. Tesco now has 92 trusted canonical
products, 91 unique trusted SKUs, 3.74% catalogue coverage, 641/1,681 demanded
units (38.13%), 794 products live at two or more main retailers and 67 live at
all three. No recent Vercel runtime errors were present after release.
