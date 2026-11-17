import { COMPARISON_EXPLANATIONS, compareBasket, type PairReview } from '../comparison-policy';

export interface StoreTotal {
  store: string;
  /** Current prices only, for the items this store sells. Complete only when itemsMissing is 0. */
  total: number;
  itemsCovered: number;
  itemsMissing: number;
  complete: boolean;
  /** True only for a complete basket of independently verified exact matches. */
  verified: boolean;
}

export interface RepriceResult {
  /** Today's prices for the same items at the stores the shopper chose (null if any is no longer priced there). */
  bestSplitTotal: number | null;
  splitBreakdown: Array<{ store: string; total: number; items: number }>;
  singleStoreTotals: StoreTotal[];
  /** Cheapest complete basket of verified exact matches; null when no such claim is supported. */
  bestSingleStore: StoreTotal | null;
  /** bestSingleStore.total - bestSplitTotal, only for verified like-for-like comparisons; else null. */
  savings: number | null;
  itemCount: number;
  basis: 'verified_exact' | 'indicative' | 'incomplete';
  explanation: string;
}

export type RepriceItem = { canonical_name: string; store: string; price_paid: number; quantity: number | null };
export type RepricePrice = { canonical_name: string; store: string; price: number; store_product_id?: string | null; store_product_name?: string | null };

/**
 * Reprices a saved list using CURRENT retailer prices only. Historical paid prices are never mixed into a
 * store total, missing items are never filled in, and a cheapest single store or a split saving is stated
 * only when the shared comparison rule verifies every item as the same product at the stores compared.
 */
export function repriceBasket(items: RepriceItem[], prices: RepricePrice[], stores: string[], reviews: PairReview[] = [], now = Date.now()): RepriceResult {
  const qty = (i: RepriceItem) => i.quantity ?? 1;
  const offer = new Map<string, RepricePrice>();
  for (const p of prices) {
    const key = `${p.canonical_name}\u0000${p.store}`;
    if (Number.isFinite(p.price) && p.price > 0 && (!offer.has(key) || p.price < offer.get(key)!.price)) offer.set(key, p);
  }
  const names = [...new Set(items.map(i => i.canonical_name))];
  const quantity = new Map<string, number>();
  for (const i of items) quantity.set(i.canonical_name, (quantity.get(i.canonical_name) ?? 0) + qty(i));
  const comparison = compareBasket(names.map(name => ({ id: name, quantity: quantity.get(name) ?? 1,
    offers: stores.flatMap(store => { const o = offer.get(`${name}\u0000${store}`); return o ? [{ store, storeProductId: o.store_product_id ?? undefined, name: o.store_product_name ?? name, price: o.price }] : []; }) })),
  stores, reviews, now);

  const singleStoreTotals: StoreTotal[] = comparison.stores.map(s => ({ store: s.store, total: Math.round((s.subtotal ?? 0) * 100) / 100,
    itemsCovered: s.comparableLines, itemsMissing: s.totalLines - s.comparableLines, complete: s.completeTotal !== null, verified: s.verifiedExactTotal !== null }));
  const cheapest = comparison.cheapestVerified;
  const bestSingleStore = cheapest ? singleStoreTotals.find(s => s.store === cheapest.store) ?? null : null;

  // The shopper's chosen stores at TODAY's prices for the same items (same store, same canonical mapping).
  const split = new Map<string, { total: number; items: number }>();
  let unpriced = 0, splitTotal = 0;
  for (const item of items) {
    const o = offer.get(`${item.canonical_name}\u0000${item.store}`);
    if (!o) { unpriced++; continue; }
    const row = split.get(item.store) ?? { total: 0, items: 0 };
    row.total += o.price * qty(item); row.items += 1; split.set(item.store, row);
    splitTotal += o.price * qty(item);
  }
  const bestSplitTotal = unpriced === 0 && items.length ? Math.round(splitTotal * 100) / 100 : null;
  const verifiedStores = new Set(comparison.stores.filter(s => s.verifiedExactTotal !== null).map(s => s.store));
  const splitIsVerified = [...split.keys()].every(store => verifiedStores.has(store));
  const savings = bestSingleStore && bestSplitTotal !== null && splitIsVerified
    ? Math.round((bestSingleStore.total - bestSplitTotal) * 100) / 100 : null;

  return {
    bestSplitTotal,
    splitBreakdown: [...split.entries()].map(([store, v]) => ({ store, total: Math.round(v.total * 100) / 100, items: v.items })).sort((a, b) => b.items - a.items),
    singleStoreTotals,
    bestSingleStore,
    savings,
    itemCount: items.length,
    basis: comparison.basis,
    explanation: COMPARISON_EXPLANATIONS[comparison.basis === 'verified_exact' ? 'verified' : comparison.basis],
  };
}
