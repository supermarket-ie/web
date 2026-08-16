import { supabaseAdmin } from '@/lib/supabase';

export type StoreKey = 'tesco' | 'dunnes' | 'supervalu' | 'aldi';

export const STORE_INFO: Record<StoreKey, { name: string; color: string; light: string }> = {
  tesco:     { name: 'Tesco',         color: '#003A8C', light: '#EEF3FB' },
  dunnes:    { name: 'Dunnes Stores', color: '#7B0017', light: '#FAEAEC' },
  supervalu: { name: 'SuperValu',     color: '#D4400F', light: '#FEF0E8' },
  aldi:      { name: 'Aldi',          color: '#00447C', light: '#EDF3FA' },
};

export const ALL_STORES: StoreKey[] = ['tesco', 'dunnes', 'supervalu', 'aldi'];
export const MAIN_STORES: StoreKey[] = ['tesco', 'dunnes', 'supervalu'];

export function fmt(n: number) { return `€${n.toFixed(2)}`; }
export function pct(was: number, now: number) { return Math.round(((was - now) / was) * 100); }

export type ProductPrice = {
  canonical_name: string;
  category: string;
  store: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  store_product_name: string;
};

// ── Module-level cache (survives across requests in the same warm Lambda) ─────
let _priceCache: ProductPrice[] | null = null;
let _priceCacheAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch the validated current-price set across active stores.
 *
 * `latest_prices` is the production boundary for price quality. Its database
 * definition is responsible for selecting the latest observation and excluding
 * mappings/stores that are not safe to present as live.
 *
 * IMPORTANT: fail closed if the view is unavailable. Falling back to raw
 * `price_observations` would bypass mapping/freshness guards and can publish
 * known-contaminated data. supermarket.ie deliberately prefers a missing price
 * to a false price.
 */
export async function getAllLatestPrices(): Promise<ProductPrice[]> {
  if (_priceCache && Date.now() - _priceCacheAt < CACHE_TTL_MS) {
    return _priceCache;
  }

  const { data: viewRows, error: viewError } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, category, store, price, was_price, on_promotion, store_product_name');

  if (viewError) {
    console.error('[price-data] latest_prices unavailable; refusing raw-price fallback:', viewError.message);
    return [];
  }

  if (!viewRows || viewRows.length === 0) {
    console.warn('[price-data] latest_prices returned no rows');
    return [];
  }

  // Deduplicate by canonical_name + store. The validated view may contain more
  // than one store_product mapping for a canonical product, but consumers need
  // at most one current store price for that canonical item.
  const seen = new Set<string>();
  const results: ProductPrice[] = [];
  for (const r of viewRows as unknown as ProductPrice[]) {
    const key = `${r.canonical_name}::${r.store}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }

  _priceCache = results;
  _priceCacheAt = Date.now();
  return results;
}

/**
 * Group prices by product, returning a map of canonical_name → store prices.
 */
export function groupByProduct(prices: ProductPrice[]) {
  const map = new Map<string, { category: string; stores: Map<string, { price: number; on_promotion: boolean; was_price: number | null }> }>();
  for (const p of prices) {
    if (!map.has(p.canonical_name)) {
      map.set(p.canonical_name, { category: p.category, stores: new Map() });
    }
    map.get(p.canonical_name)!.stores.set(p.store, { price: p.price, on_promotion: p.on_promotion, was_price: p.was_price });
  }
  return map;
}

/**
 * Filter grouped products to only those available in ALL 3 main stores (Tesco, Dunnes, SuperValu).
 */
export function filterToMain3(grouped: ReturnType<typeof groupByProduct>) {
  const filtered = new Map<string, { category: string; stores: Map<string, { price: number; on_promotion: boolean; was_price: number | null }> }>();
  for (const [name, data] of grouped) {
    const hasAll3 = MAIN_STORES.every(s => data.stores.has(s));
    if (hasAll3) filtered.set(name, data);
  }
  return filtered;
}
