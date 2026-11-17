# Cross-retailer comparison surfaces that treat a shared canonical record as the same product (17 Nov 2026)

This is a read-only code review. Nothing was changed. Policy
(`docs/retailer-comparison-policy.md`) says an exact comparison, an equal-pack
basket total or a "cheapest" claim needs approved `retailer_offer_pair_reviews`
edges. Unverified pairs can only be indicative, and a "Similar product" label
needs an approved `comparable_alternative`. The ledger has 0 rows, so no pair is
currently verified.

## Already ledger-aware (compliant)

These surfaces label totals correctly: `weeklyShopTotals` / `buildShopCatalogue`
(`classifyOfferGroup`), shown in the weekly-shop calculator, the shop builder and
the compare page. "Verified comparable total" appears only when nothing is
unverified; otherwise the total is labelled "Indicative subtotal" with a count of
unverified items.

One caveat: `differentPack` is set only for `comparable_alternative`, so an
unverified different-pack offer still enters `subtotal` and `total`. It is only
captioned as indicative.

## Gaps: shared canonical record treated as the same product, no ledger check

| Surface | File | What it claims |
|---|---|---|
| Agent `compare_shop_stores` | `src/lib/agent/tools.ts` → `src/lib/shopping/compare.ts` | Complete basket totals and a ranking by `canonical_name`. Note says "Only exact catalogue products are compared". No ledger, pack or relationship filter. |
| Agent `present_household_shop` | `src/lib/shopping/household-shop.ts` | Cheapest offer per line, per-store `basket_total`, and "single_retailer … has trusted current offers for every shop line". Only title-regex pack checks, which are skipped when the expected pack is unstated (e.g. a generic "Muesli"). |
| `generateList` (`/api/list`, `/api/products`) | `src/lib/list-generator.ts` | `best_store`, `store_totals` and `recommended_store` by canonical record. No pack check, and coverage is unequal across stores. |
| `/api/plan/reprice` | `src/app/api/plan/reprice/route.ts` | `bestSingleStore` and `savings` by `canonical_name`. Missing items are filled with the user's earlier price. |
| Product JSON-LD | `src/lib/product-catalogue.ts` | `AggregateOffer` low/high across stores, with no comparison-type filter. |
| Household briefing | `src/lib/household-briefing.ts` | `best_store_now` per canonical record (not fully traced). |

Example: Dunnes Flahavan's 1kg (€5.50) and SuperValu Lifeforce 750g (€5.19) sit
on the same "Muesli" record. They can appear as the same line in an agent
"complete basket" and be ranked as cheapest, with no indicative label.

## Proposed fix (separate PR, needs owner decision before work)

Route every cross-store total and "cheapest" claim through
`classifyOfferGroup(offers, getCurrentPairReviews())`:

- `exact_product` pairs only can enter a complete or equal basket total and a
  "cheapest" ranking.
- `unverified` offers are shown individually with retailer title, pack, price
  and check date, and an indicative subtotal clearly labelled.
- `comparable_alternative` becomes "Similar product", excluded from equal-pack
  totals.
- `not_comparable` is excluded.

Consequence to accept: with 0 approved edges, every cross-store total becomes
indicative until verified pairs exist (see the capture pilot). This changes the
shopping agent's answers, so it needs your decision and its own tests and
release.
