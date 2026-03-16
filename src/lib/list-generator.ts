import { supabaseAdmin } from './supabase';

export type FamilySize = '1' | '2' | '3-4' | '5+';

export interface StorePrice {
  store: string;
  price: number;
  store_product_name: string;
  store_url: string | null;
}

export interface ListItem {
  product_id: string;
  canonical_name: string;
  category: string | null;
  quantity: number;
  best_store: string;
  best_price: number;
  best_price_total: number;
  best_store_product_name: string;
  best_store_url: string | null;
  all_prices: StorePrice[];
}

export interface SmartList {
  family_size: FamilySize;
  recommended_store: string;
  store_totals: { store: string; total: number }[];
  items: ListItem[];
  generated_at: string;
}

function getMultiplier(familySize: FamilySize): number {
  switch (familySize) {
    case '1':   return 1;
    case '2':   return 1;
    case '3-4': return 1.5;
    case '5+':  return 2;
  }
}

export async function generateList(familySize: FamilySize): Promise<SmartList> {
  const multiplier = getMultiplier(familySize);
  const quantity = Math.ceil(multiplier); // 1→1, 2→1, 3-4→2, 5+→2

  // Fetch store_products with their parent product info (resolved URLs only)
  const { data: storeProducts, error: spError } = await supabaseAdmin
    .from('store_products')
    .select('id, product_id, store, store_product_name, store_url, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (spError) throw spError;

  // Fetch all price observations, newest first — we pick the first seen per store_product
  const { data: priceRows, error: poError } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, price, observed_at')
    .order('observed_at', { ascending: false });

  if (poError) throw poError;

  // Latest price per store_product_id
  const latestPrice = new Map<string, number>();
  for (const row of priceRows ?? []) {
    if (!latestPrice.has(row.store_product_id) && row.price !== null) {
      latestPrice.set(row.store_product_id, row.price as number);
    }
  }

  // Build per-product map: product_id → { meta, stores: Map<store, priceInfo> }
  type PriceInfo = { price: number; store_product_name: string; store_url: string | null };
  type ProductEntry = { canonical_name: string; category: string | null; stores: Map<string, PriceInfo> };

  const byProduct = new Map<string, ProductEntry>();

  for (const sp of storeProducts ?? []) {
    const price = latestPrice.get(sp.id);
    if (price === undefined) continue;

    const product = sp.products as unknown as { id: string; canonical_name: string; category: string | null };

    if (!byProduct.has(sp.product_id)) {
      byProduct.set(sp.product_id, {
        canonical_name: product.canonical_name,
        category: product.category,
        stores: new Map()
      });
    }

    byProduct.get(sp.product_id)!.stores.set(sp.store, {
      price,
      store_product_name: sp.store_product_name,
      store_url: sp.store_url
    });
  }

  // Build list items (products with ≥2 store prices) and accumulate store totals
  const items: ListItem[] = [];
  const storeTotals = new Map<string, number>();

  for (const [productId, { canonical_name, category, stores }] of byProduct) {
    if (stores.size < 2) continue;

    // Best (cheapest) store for this product
    let bestStore = '';
    let bestPrice = Infinity;
    for (const [store, { price }] of stores) {
      if (price < bestPrice) {
        bestPrice = price;
        bestStore = store;
      }
    }

    // Accumulate each store's cost for this product (for basket comparison)
    for (const [store, { price }] of stores) {
      storeTotals.set(store, (storeTotals.get(store) ?? 0) + price * quantity);
    }

    const allPrices: StorePrice[] = Array.from(stores.entries())
      .map(([store, info]) => ({
        store,
        price: info.price,
        store_product_name: info.store_product_name,
        store_url: info.store_url
      }))
      .sort((a, b) => a.price - b.price);

    const best = stores.get(bestStore)!;
    items.push({
      product_id: productId,
      canonical_name,
      category,
      quantity,
      best_store: bestStore,
      best_price: bestPrice,
      best_price_total: Math.round(bestPrice * quantity * 100) / 100,
      best_store_product_name: best.store_product_name,
      best_store_url: best.store_url,
      all_prices: allPrices
    });
  }

  items.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

  const sortedStoreTotals = Array.from(storeTotals.entries())
    .map(([store, total]) => ({ store, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.total - b.total);

  return {
    family_size: familySize,
    recommended_store: sortedStoreTotals[0]?.store ?? '',
    store_totals: sortedStoreTotals,
    items,
    generated_at: new Date().toISOString()
  };
}
