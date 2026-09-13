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

export function sanitizeStoreTotals(totals: unknown): Array<{ store: string; total: number; item_count?: number }> {
  if (!Array.isArray(totals)) return [];

  return totals.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const total = raw as Partial<SavedListStoreTotal>;
    const amount = finiteMoney(total.total);
    if (typeof total.store !== 'string' || amount === null) return [];
    return [{ store: total.store, total: amount, item_count: total.item_count }];
  });
}
