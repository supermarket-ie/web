export type SavedListMoneyItem = {
  canonical_name: string;
  store: string;
  price: unknown;
  quantity?: number;
  category?: string;
  store_product_name?: string;
  on_promotion?: boolean;
};

export type SavedListStoreTotal = {
  store: string;
  total: unknown;
  item_count?: number;
  /** Only 'verified_exact' totals (complete baskets of independently verified exact matches) are displayable. */
  basis?: unknown;
};

function finiteMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sanitizeStructuredItems(items: unknown): Array<{
  canonical_name: string;
  store: string;
  price: number;
  quantity?: number;
  category?: string;
  store_product_name?: string;
  on_promotion?: boolean;
}> | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const safe = items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Partial<SavedListMoneyItem>;
    const price = finiteMoney(item.price);
    if (typeof item.canonical_name !== 'string' || typeof item.store !== 'string' || price === null) return [];
    return [{
      canonical_name: item.canonical_name,
      store: item.store,
      price,
      quantity: item.quantity,
      category: item.category,
      store_product_name: item.store_product_name,
      on_promotion: item.on_promotion,
    }];
  });

  return safe.length > 0 ? safe : null;
}

/**
 * The single read gate for persisted store totals, which several screens show as "best price" / cheapest.
 * Only totals recorded as complete baskets of independently verified exact matches are returned, and only
 * when at least two stores have one (a lone total is not a comparison). Legacy totals (no basis) were
 * computed from unverified canonical associations and are not displayed. Totals older than 14 days
 * (the pair-review evidence horizon) are also hidden.
 */
const VERIFIED_HORIZON_MS = 14 * 86400000;
export function sanitizeStoreTotals(totals: unknown, computedAt: unknown, now = Date.now()): Array<{ store: string; total: number; item_count?: number; basis: 'verified_exact' }> {
  if (!Array.isArray(totals)) return [];
  // A verified total rests on pair reviews that expire after 14 days, so the saved claim expires with them.
  // An unknown computation time fails closed.
  const at = typeof computedAt === 'string' || computedAt instanceof Date ? new Date(computedAt).getTime() : NaN;
  if (!Number.isFinite(at) || at > now + 60_000 || at < now - VERIFIED_HORIZON_MS) return [];

  const safe = totals.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const total = raw as Partial<SavedListStoreTotal>;
    const amount = finiteMoney(total.total);
    if (typeof total.store !== 'string' || amount === null || total.basis !== 'verified_exact') return [];
    return [{ store: total.store, total: amount, item_count: total.item_count, basis: 'verified_exact' as const }];
  });
  return safe.length >= 2 ? safe.sort((a, b) => a.total - b.total || a.store.localeCompare(b.store)) : [];
}
