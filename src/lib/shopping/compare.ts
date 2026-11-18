import { COMPARISON_EXPLANATIONS, comparisonLabel, compareBasket, type BasketLine, type PairReview } from '../comparison-policy';

export type ComparableBasketItem = {
  canonical_name: string;
  quantity?: number;
  current_price?: number | null;
};

export type ComparablePrice = {
  canonical_name: string;
  store: string;
  price: number;
  /** Retailer offer identity. Without it, a line can never be verified as the same product across stores. */
  store_product_id?: string | null;
  store_product_name?: string | null;
};

/**
 * Cross-store basket comparison for the shopping agent. Totals per store are always shown with the
 * retailer's own titles, prices and unit prices. A cheapest store is named ONLY when the shared
 * comparison rule (compareBasket) finds >= 2 complete baskets of independently verified exact matches.
 * Otherwise stores are listed in coverage order and every total is labelled indicative.
 */
export function compareBasketStores(
  items: ComparableBasketItem[],
  prices: ComparablePrice[],
  onlyStore?: string,
  reviews: PairReview[] = [],
  now = Date.now(),
) {
  const names = [...new Set(items.map(item => item.canonical_name).filter(Boolean))];
  const quantities = new Map(items.map(item => [item.canonical_name, item.quantity ?? 1]));
  const totalUnits = items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);

  // Lowest current offer per (store, canonical line), keeping the retailer's offer identity.
  const byLine = new Map<string, Map<string, ComparablePrice>>();
  for (const row of prices) {
    if (!names.includes(row.canonical_name) || !Number.isFinite(row.price) || row.price <= 0) continue;
    const line = byLine.get(row.canonical_name) ?? new Map<string, ComparablePrice>();
    const existing = line.get(row.store);
    if (!existing || row.price < existing.price) line.set(row.store, row);
    byLine.set(row.canonical_name, line);
  }
  const stores = [...new Set(prices.map(p => p.store))]
    .filter(store => !onlyStore || store.toLowerCase() === onlyStore.toLowerCase());
  const lines: BasketLine[] = names.map(name => ({ id: name, quantity: quantities.get(name) ?? 1,
    offers: [...(byLine.get(name)?.values() ?? [])].map(o => ({ store: o.store, storeProductId: o.store_product_id ?? undefined,
      name: o.store_product_name ?? o.canonical_name, price: o.price })) }));
  // Equivalence is judged across every store that sells the line, even when one store is requested.
  const allStores = [...new Set(prices.map(p => p.store))];
  const result = compareBasket(lines, allStores, reviews, now);

  // The shopper's own mixed basket can be set against a store only for a verified exact claim.
  const currentTotal = items.reduce((sum, item) => sum + (Number(item.current_price) || 0) * (item.quantity ?? 1), 0);
  const comparisons = result.stores.filter(s => stores.includes(s.store)).map(s => {
    const verified = s.verifiedExactTotal !== null;
    return {
      store: s.store,
      complete: s.missingLines === 0 && s.differentProductLines === 0,
      comparison_basis: verified ? 'verified_exact' as const : 'indicative' as const,
      /** Indicative total of this store's comparable offers; null unless every line is covered. */
      total: s.completeTotal,
      indicative_subtotal: s.subtotal,
      verified_exact_total: s.verifiedExactTotal,
      covered_products: s.comparableLines,
      total_products: s.totalLines,
      covered_units: s.lines.reduce((n, l, i) => n + (l.status !== 'missing' && l.status !== 'not_comparable' ? lines[i].quantity : 0), 0),
      total_units: totalUnits,
      missing_products: s.lines.filter(l => l.status === 'missing').map(l => l.id).slice(0, 12),
      different_products: s.lines.filter(l => l.status === 'not_comparable').map(l => l.id).slice(0, 12),
      unverified_products: s.unverifiedLines,
      similar_products: s.similarLines,
      difference_vs_current: verified && result.cheapestVerified ? Number((s.verifiedExactTotal! - currentTotal).toFixed(2)) : null,
      // The retailer's own title, or null when unknown (never the canonical name presented as a retailer title).
      lines: s.lines.map(l => ({ canonical_name: l.id, retailer_product_name: byLine.get(l.id)?.get(s.store)?.store_product_name ?? null,
        price: l.price, unit_price: byLine.get(l.id)?.get(s.store)?.store_product_name ? l.unitPrice : null,
        // A line only this store sells is not compared with anything: 'single_store', never "Exact match".
        comparison: l.status === 'missing' ? 'not_available' : comparisonLabel(l.status, byLine.get(l.id)?.size ?? 0) ?? 'single_store' })),
      utility_score: null,
    };
  });

  return {
    current_total: Number(currentTotal.toFixed(2)),
    comparison_basis: result.basis,
    cheapest_verified_store: result.cheapestVerified,
    explanation: COMPARISON_EXPLANATIONS[result.basis === 'verified_exact' ? 'verified' : result.basis],
    comparisons,
  };
}
