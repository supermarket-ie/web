import type { ProductPrice } from './price-data';
import { buildShopCatalogue } from './shop-builder-catalogue';
import { shopBuilderPrompt } from './shop-builder';
import { WEEKLY_STORES, weeklyShopTotals, type WeeklyItem } from './weekly-shop';

// A starting basket, not a claim about a complete week's food needs.
// Stable identities and quantities; prices always come from the trusted reader.
export const HOMEPAGE_EXAMPLE_ITEMS = [
  { id: 'fbf1ad4d-fecd-4303-9d12-0add3b6f6e6c', name: 'Fresh Whole Milk 2L', quantity: 2 },
  { id: 'b31f7611-3d30-4945-ae00-c3ba4011b2e5', name: 'Carrots 1kg', quantity: 1 },
  { id: '8c4c0e88-8c10-42ad-a858-6f7a96af7646', name: 'Basmati Rice 1kg', quantity: 1 },
  { id: '153316b3-ddda-4af4-90cb-4de2ebca26f9', name: 'Fairy Max Power Lemon Washing Up Liquid 660ml', quantity: 1 },
  { id: 'deb948db-7413-4a8b-bc46-2f6220f1bc70', name: 'Colgate Cavity Protection Toothpaste 75ml', quantity: 1 },
  { id: 'de5f4721-eefe-4c5c-bcc6-20ea63f22972', name: 'Andrex Complete Clean Toilet Tissue (4 Roll)', quantity: 1 },
  { id: 'b1ead794-7439-41c3-af84-38dbdb5c1b91', name: 'Kerrygold Irish Creamery Salted Butter 400g', quantity: 1 },
  { id: '5eeaa467-d7ca-45b1-993c-f50da50fa615', name: 'Kilmeaden Fully Mature White Cheddar 200g', quantity: 1 },
  { id: 'a9c3e972-f9bb-4752-9ff9-aeb27b4c170c', name: 'Weetabix 24 Pack', quantity: 1 },
  { id: 'd29cb96a-a7a9-4804-b898-4d03428a6cfe', name: 'Onions 1kg', quantity: 1 },
  { id: '0d9e4009-150e-48eb-aa6d-e1f800692b4f', name: 'Broccoli', quantity: 1 },
  { id: '92a236f1-40b9-4f42-8718-a003556df16a', name: 'Chopped Tomatoes 400g', quantity: 2 },
];

export function buildHomepageExample(prices: ProductPrice[], now = Date.now()) {
  const catalogue = new Map(buildShopCatalogue(prices, now).map(item => [item.id, item]));
  const items: WeeklyItem[] = HOMEPAGE_EXAMPLE_ITEMS.map(item => ({
    ...item, name: catalogue.get(item.id)?.name ?? item.name, offers: catalogue.get(item.id)?.offers ?? {},
  }));
  const quantities = Object.fromEntries(items.map(item => [item.id, item.quantity]));
  // Most complete single retailer, then subtotal, then a stable tie-break.
  // Never mix retailers into an apparently purchasable one-store total.
  const best = weeklyShopTotals(items, quantities).sort((a, b) =>
    b.pricedCount - a.pricedCount || (a.subtotal ?? Infinity) - (b.subtotal ?? Infinity) ||
    WEEKLY_STORES.indexOf(a.store) - WEEKLY_STORES.indexOf(b.store))[0];
  const store = best.pricedCount ? best.store : null;
  const lines = items.map(item => {
    const offer = store ? item.offers[store] : undefined;
    return { id: item.id, name: item.name, quantity: item.quantity, offer: offer ?? null,
      lineTotal: offer ? Math.round(offer.price * 100) * item.quantity / 100 : null };
  });
  const dates = lines.flatMap(line => line.offer ? [line.offer.observedAt] : []).sort();
  return {
    lines, store, subtotal: best.subtotal, total: best.total, missingCount: best.missingCount,
    oldestCheck: dates[0] ?? null,
    prompt: shopBuilderPrompt({ items, adults: '2', children: '1', budget: '100', needs: '', completeWeek: false }),
  };
}

export type HomepageShopExample = ReturnType<typeof buildHomepageExample>;
