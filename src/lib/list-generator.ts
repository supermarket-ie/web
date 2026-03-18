import { supabaseAdmin } from './supabase';
import { NUTRITION, type NutritionData } from './nutrition-data';

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
  nutrition: NutritionData | null;
  store_overridden?: boolean; // true if user picked a non-cheapest store
}

export interface SmartList {
  family_size: FamilySize;
  recommended_store: string;
  store_totals: { store: string; total: number }[];
  items: ListItem[];
  generated_at: string;
}

// User customisations applied on top of the generated list
export interface ListCustomisations {
  removedItems?: string[];        // product_ids to hide
  addedItems?: string[];          // product_ids to include (even if single-store)
  storeOverrides?: Record<string, string>; // product_id → store
}

function getMultiplier(familySize: FamilySize): number {
  switch (familySize) {
    case '1':   return 1;
    case '2':   return 1;
    case '3-4': return 1.5;
    case '5+':  return 2;
  }
}

export async function generateList(
  familySize: FamilySize,
  customisations?: ListCustomisations
): Promise<SmartList> {
  const multiplier = getMultiplier(familySize);
  const quantity = Math.ceil(multiplier);

  const removedSet  = new Set(customisations?.removedItems ?? []);
  const addedSet    = new Set(customisations?.addedItems ?? []);
  const overrides   = customisations?.storeOverrides ?? {};

  const { data: storeProducts, error: spError } = await supabaseAdmin
    .from('store_products')
    .select('id, product_id, store, store_product_name, store_url, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (spError) throw spError;

  const { data: priceRows, error: poError } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, price, observed_at')
    .order('observed_at', { ascending: false });

  if (poError) throw poError;

  const latestPrice = new Map<string, number>();
  for (const row of priceRows ?? []) {
    if (!latestPrice.has(row.store_product_id) && row.price !== null) {
      latestPrice.set(row.store_product_id, row.price as number);
    }
  }

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

  const items: ListItem[] = [];
  const storeTotals = new Map<string, number>();

  for (const [productId, { canonical_name, category, stores }] of byProduct) {
    // Include if: has ≥2 stores OR is explicitly added by user
    if (stores.size < 2 && !addedSet.has(productId)) continue;
    // Skip if removed
    if (removedSet.has(productId)) continue;

    // Determine best store: user override → cheapest
    const overrideStore = overrides[productId];
    let bestStore = '';
    let bestPrice = Infinity;

    if (overrideStore && stores.has(overrideStore)) {
      bestStore = overrideStore;
      bestPrice = stores.get(overrideStore)!.price;
    } else {
      for (const [store, { price }] of stores) {
        if (price < bestPrice) {
          bestPrice = price;
          bestStore = store;
        }
      }
    }

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
    const cheapestPrice = allPrices[0]?.price ?? bestPrice;

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
      all_prices: allPrices,
      nutrition: NUTRITION[canonical_name] ?? null,
      store_overridden: !!overrideStore && bestPrice > cheapestPrice,
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

// Return all products (for the add-items picker)
export async function getAllProducts(): Promise<{ product_id: string; canonical_name: string; category: string | null }[]> {
  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('product_id, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (error || !data) return [];

  const seen = new Set<string>();
  const result: { product_id: string; canonical_name: string; category: string | null }[] = [];
  for (const row of data) {
    const p = (Array.isArray(row.products) ? row.products[0] : row.products) as { id: string; canonical_name: string; category: string | null } | null;
    if (!p || seen.has(row.product_id)) continue;
    seen.add(row.product_id);
    result.push({ product_id: row.product_id, canonical_name: p.canonical_name, category: p.category });
  }
  return result.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}


