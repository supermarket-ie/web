import type { HouseholdShopContract } from '../../src/lib/shopping/household-shop-contract';

// The durable result still contains the full card. Avoid sending its repeated
// offers, provenance and per-store missing-line arrays back into model history.
export function householdShopModelSummary(shop: HouseholdShopContract) {
  return {
    kind: 'household_shop',
    state: 'proposed',
    display: 'The full household shop is displayed in the native shopping card.',
    total_lines: shop.totals.total_lines,
    priced_lines: shop.totals.priced_lines,
    priced_subtotal: shop.totals.selected_total,
    currency: shop.totals.currency,
    budget: shop.household.budget ?? null,
    budget_assessment: shop.totals.priced_lines < shop.totals.total_lines
      ? 'Unconfirmed: the complete cost is unknown because some lines are unpriced.'
      : shop.household.budget == null ? 'No budget supplied.'
        : shop.totals.selected_total <= shop.household.budget ? 'Fully priced within budget.' : 'Fully priced over budget.',
    unpriced_items: shop.items.filter(item => !item.selected_offer).map(item => ({
      name: item.display_label,
      status: item.coverage_status,
      reason: item.coverage_note,
    })),
    store_coverage: shop.store_coverage.map(store => ({
      retailer: store.retailer,
      priced_lines: store.covered_lines,
      complete: store.complete,
      basket_total: store.basket_total,
    })),
    retailer_strategy: shop.recommended_retailer_strategy.kind,
  };
}
