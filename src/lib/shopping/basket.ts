import type { BasketItem, RetailerOffer, ShoppingBasket } from './contracts';

export type StoreTotal = {
  store: string;
  total: number;
  item_count: number;
};

export function computeBasketStoreTotals(items: BasketItem[]): StoreTotal[] {
  const grouped = new Map<string, StoreTotal>();

  for (const item of items) {
    const offer = item.selected_offer;
    if (!offer) continue;
    const quantity = item.quantity ?? 1;
    const row = grouped.get(offer.retailer) ?? {
      store: offer.retailer,
      total: 0,
      item_count: 0,
    };
    row.total += offer.price * quantity;
    row.item_count += quantity;
    grouped.set(offer.retailer, row);
  }

  return [...grouped.values()].map(row => ({
    ...row,
    total: Number(row.total.toFixed(2)),
  }));
}

export function selectOffer(
  offers: RetailerOffer[],
  preferredStores: string[] = [],
): RetailerOffer | null {
  if (!offers.length) return null;
  const wanted = new Set(preferredStores.map(store => store.toLowerCase()).filter(store => store !== 'all'));
  const preferred = wanted.size
    ? offers.filter(offer => wanted.has(offer.retailer.toLowerCase()))
    : [];
  const pool = preferred.length ? preferred : offers;
  return [...pool].sort((a, b) => a.price - b.price)[0] ?? null;
}

export function createBasket(
  items: BasketItem[],
  input: Pick<ShoppingBasket, 'id' | 'household_id' | 'name'> = {},
): ShoppingBasket {
  return {
    ...input,
    items,
    generated_at: new Date().toISOString(),
  };
}
