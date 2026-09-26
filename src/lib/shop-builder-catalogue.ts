import type { ProductPrice } from './price-data';
import type { ShopProduct } from './shop-builder';
import { hasProductIdentityConflict } from './shopping/product-identity';
import { dunnesPackSignature } from './dunnes-discovery';
import { WEEKLY_STORES, type WeeklyStore } from './weekly-shop';

export function buildShopCatalogue(prices: ProductPrice[], now = Date.now()): ShopProduct[] {
  const products = new Map<string, ShopProduct>();
  for (const row of prices) {
    const observed = Date.parse(row.observed_at);
    if (!WEEKLY_STORES.includes(row.store as WeeklyStore) || row.relationship_type !== 'exact' ||
        row.freshness_state !== 'fresh' || !Number.isFinite(row.price) || row.price <= 0 ||
        !Number.isFinite(observed) || observed > now || observed < now - 7 * 86400000 ||
        !row.store_product_name || hasProductIdentityConflict(row.canonical_name, row.store_product_name, row.category)) continue;
    // An unmarked canonical unit must not display the price of a retailer multipack.
    const expectedPack = dunnesPackSignature(row.canonical_name);
    const actualPack = dunnesPackSignature(row.store_product_name);
    if ((actualPack.count ?? 1) > 1 && (expectedPack.count ?? 1) === 1) continue;
    const item: ShopProduct = products.get(row.canonical_product_id) ?? {
      id: row.canonical_product_id, name: row.canonical_name, category: row.category ?? 'Other', quantity: 1, offers: {},
    };
    const store = row.store as WeeklyStore;
    if (!item.offers[store] || Date.parse(item.offers[store]!.observedAt) < observed) {
      item.offers[store] = { name: row.store_product_name, price: row.price, observedAt: row.observed_at };
    }
    products.set(item.id, item);
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function searchShopCatalogue(products: ShopProduct[], query: string): ShopProduct[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return products.filter(product => terms.every(term => product.name.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(query.toLowerCase())) - Number(a.name.toLowerCase().startsWith(query.toLowerCase())) || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, 8);
}
