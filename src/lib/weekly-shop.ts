import type { ProductPrice } from '@/lib/price-data';

export const WEEKLY_SHOP_PATH = '/cost-of-weekly-shop-ireland';
export const WEEKLY_STORES = ['tesco', 'dunnes', 'supervalu'] as const;
export type WeeklyStore = typeof WEEKLY_STORES[number];
export const WEEKLY_STORE_NAMES: Record<WeeklyStore, string> = {
  tesco: 'Tesco', dunnes: 'Dunnes Stores', supervalu: 'SuperValu',
};

// A transparent example, not an average household or a full week's meal plan.
// Stable catalogue IDs prevent fuzzy substitutions and survive catalogue renames.
export const EXAMPLE_WEEKLY_ITEMS = [
  { id: 'fbf1ad4d-fecd-4303-9d12-0add3b6f6e6c', name: 'Fresh Whole Milk 2L', quantity: 2 },
  { id: 'b1ead794-7439-41c3-af84-38dbdb5c1b91', name: 'Kerrygold Irish Creamery Salted Butter 400g', quantity: 1 },
  { id: '5eeaa467-d7ca-45b1-993c-f50da50fa615', name: 'Kilmeaden Fully Mature White Cheddar 200g', quantity: 1 },
  { id: '7aaa3e1d-82fc-40cb-823f-5c7eee37aa99', name: 'Brennans Sliced White Pan 800g', quantity: 1 },
  { id: '8071e3b7-c80e-4ffe-9371-bee76ce65375', name: 'White Pitta Bread 6 Pack', quantity: 1 },
  { id: 'a9c3e972-f9bb-4752-9ff9-aeb27b4c170c', name: 'Weetabix 24 Pack', quantity: 1 },
  { id: 'b31f7611-3d30-4945-ae00-c3ba4011b2e5', name: 'Carrots 1kg', quantity: 1 },
  { id: 'd29cb96a-a7a9-4804-b898-4d03428a6cfe', name: 'Onions 1kg', quantity: 1 },
  { id: 'd63fc419-84f3-4527-8d3e-2b5a79171246', name: 'Closed Cup Mushrooms 250g', quantity: 1 },
  { id: '0d9e4009-150e-48eb-aa6d-e1f800692b4f', name: 'Broccoli', quantity: 1 },
  { id: '8c4c0e88-8c10-42ad-a858-6f7a96af7646', name: 'Basmati Rice 1kg', quantity: 1 },
  { id: '465bce85-e489-4a4c-89c3-082f15beff5a', name: 'Penne Pasta 500g', quantity: 1 },
  { id: '92a236f1-40b9-4f42-8718-a003556df16a', name: 'Chopped Tomatoes 400g', quantity: 2 },
  { id: 'd180a368-0625-49e6-b35e-c8a406c48ed1', name: 'Heinz Beans No Sugar Added 200g', quantity: 2 },
  { id: 'a5287cc1-bccc-46d6-b191-c87e5e6477c1', name: 'Fish Fingers 10 Pack', quantity: 1 },
  { id: '90739707-ad96-4623-b2bc-d8bcde032a11', name: 'Green Isle Mushy Peas 750g', quantity: 1 },
  { id: '153316b3-ddda-4af4-90cb-4de2ebca26f9', name: 'Fairy Max Power Lemon Washing Up Liquid 660ml', quantity: 1 },
];

export type WeeklyOffer = { price: number; name: string; observedAt: string };
export type WeeklyItem = {
  id: string;
  name: string;
  quantity: number;
  offers: Partial<Record<WeeklyStore, WeeklyOffer>>;
};

export function buildWeeklyExample(prices: ProductPrice[], now = Date.now()): WeeklyItem[] {
  const items: WeeklyItem[] = EXAMPLE_WEEKLY_ITEMS.map(item => ({ ...item, offers: {} }));
  const byId = new Map(items.map(item => [item.id, item]));
  for (const price of prices) {
    const item = byId.get(price.canonical_product_id);
    const observed = Date.parse(price.observed_at);
    if (!item || !WEEKLY_STORES.includes(price.store as WeeklyStore) ||
        price.relationship_type !== 'exact' || price.freshness_state !== 'fresh' ||
        !Number.isFinite(price.price) || price.price <= 0 || !Number.isFinite(observed) ||
        observed > now || observed < now - 7 * 24 * 60 * 60 * 1000) continue;
    const store = price.store as WeeklyStore;
    if (item.offers[store] && Date.parse(item.offers[store]!.observedAt) >= observed) continue;
    item.name = price.canonical_name;
    item.offers[store] = { price: price.price, name: price.store_product_name, observedAt: price.observed_at };
  }
  return items;
}

export function weeklyShopTotals(items: WeeklyItem[], quantities: Record<string, number>) {
  const selected = items.filter(item => Number.isInteger(quantities[item.id]) && quantities[item.id] > 0 && quantities[item.id] <= 20);
  return WEEKLY_STORES.map(store => {
    const priced = selected.filter(item => item.offers[store]);
    const subtotalCents = priced.reduce((sum, item) => sum + Math.round(item.offers[store]!.price * 100) * quantities[item.id], 0);
    return {
      store,
      selectedCount: selected.length,
      pricedCount: priced.length,
      missingCount: selected.length - priced.length,
      subtotal: priced.length ? subtotalCents / 100 : null,
      total: selected.length > 0 && priced.length === selected.length ? subtotalCents / 100 : null,
    };
  });
}

export function weeklyShopPrompt(input: {
  adults: number; children: number; budget: string; needs: string;
  useExample: boolean; items: WeeklyItem[]; quantities: Record<string, number>;
}): string {
  const lines = [
    `Prepare a weekly household shop for ${input.adults} adult${input.adults === 1 ? '' : 's'} and ${input.children} child${input.children === 1 ? '' : 'ren'}.`,
    input.budget ? `My weekly budget is €${input.budget}.` : 'I have not set a budget.',
  ];
  if (input.useExample) {
    const selected = input.items.filter(item => input.quantities[item.id] > 0);
    lines.push('Start with these products (quantities are packs or individual items as named):');
    lines.push(...selected.map(item => `${input.quantities[item.id]} × ${item.name}`));
  }
  if (input.needs.trim()) lines.push(`Other details: ${input.needs.trim()}`);
  lines.push('Fill out the rest of the week around my needs. Prepare a first draft with quantities and current prices where available, flag anything you cannot price, and state any assumptions.');
  return lines.join('\n');
}
