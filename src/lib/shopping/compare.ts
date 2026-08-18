import type { StoreBasketComparison } from './contracts';

export type ComparableBasketItem = {
  canonical_name: string;
  quantity?: number;
  current_price?: number | null;
};

export type ComparablePrice = {
  canonical_name: string;
  store: string;
  price: number;
};

export function compareBasketStores(
  items: ComparableBasketItem[],
  prices: ComparablePrice[],
  onlyStore?: string,
) {
  const names = [...new Set(items.map(item => item.canonical_name).filter(Boolean))];
  const quantities = new Map(items.map(item => [item.canonical_name, item.quantity ?? 1]));
  const currentTotal = items.reduce(
    (sum, item) => sum + (Number(item.current_price) || 0) * (item.quantity ?? 1),
    0,
  );
  const totalUnits = items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);

  const byStore = new Map<string, Map<string, ComparablePrice>>();
  for (const row of prices) {
    const storeRows = byStore.get(row.store) ?? new Map<string, ComparablePrice>();
    const existing = storeRows.get(row.canonical_name);
    if (!existing || row.price < existing.price) storeRows.set(row.canonical_name, row);
    byStore.set(row.store, storeRows);
  }

  const comparisons: Array<StoreBasketComparison & { difference_vs_current: number | null }> = [
    ...byStore.entries(),
  ]
    .map(([store, rows]) => {
      let total = 0;
      let coveredUnits = 0;
      const missing: string[] = [];
      for (const name of names) {
        const quantity = quantities.get(name) ?? 1;
        const price = rows.get(name);
        if (!price) {
          missing.push(name);
          continue;
        }
        total += price.price * quantity;
        coveredUnits += quantity;
      }

      const complete = missing.length === 0;
      return {
        store,
        total: Number(total.toFixed(2)),
        complete,
        covered_products: names.length - missing.length,
        total_products: names.length,
        covered_units: coveredUnits,
        total_units: totalUnits,
        missing_products: missing.slice(0, 12),
        difference_vs_current: complete
          ? Number((total - currentTotal).toFixed(2))
          : null,
        utility_score: null,
      };
    })
    .filter(row => !onlyStore || row.store.toLowerCase() === onlyStore.toLowerCase())
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.complete && b.complete) return a.total - b.total;
      return b.covered_products - a.covered_products || a.total - b.total;
    });

  return {
    current_total: Number(currentTotal.toFixed(2)),
    comparisons,
  };
}
