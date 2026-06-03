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
 * Fetch all latest prices across all stores.
 *
 * Fast path: uses the `latest_prices` DB view (single query, no pagination).
 * The view is:
 *   CREATE OR REPLACE VIEW latest_prices AS
 *   SELECT DISTINCT ON (po.store_product_id)
 *     po.store_product_id, po.price, po.was_price, po.on_promotion,
 *     sp.store, sp.store_product_name,
 *     p.canonical_name, p.category
 *   FROM price_observations po
 *   JOIN store_products sp ON sp.id = po.store_product_id AND sp.url_status = 'resolved'
 *   JOIN products p ON p.id = sp.product_id
 *   ORDER BY po.store_product_id, po.observed_at DESC;
 *
 * Slow path (fallback): paginated price_observations scan — used if view not yet created.
 */
export async function getAllLatestPrices(): Promise<ProductPrice[]> {
  // Return cached data if fresh
  if (_priceCache && Date.now() - _priceCacheAt < CACHE_TTL_MS) {
    return _priceCache;
  }

  // Fast path — try the view first (single DB round-trip, ~200ms)
  const { data: viewRows, error: viewError } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, category, store, price, was_price, on_promotion, store_product_name');

  if (!viewError && viewRows && viewRows.length > 0) {
    // Dedup by canonical_name + store
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

  // Slow path fallback — paginated scan (used before view is created)
  const { data: spRows } = await supabaseAdmin
    .from('store_products')
    .select('id, store, store_product_name, products(canonical_name, category)')
    .eq('url_status', 'resolved');

  if (!spRows) return [];

  let priceRows: { store_product_id: string; price: number; on_promotion: boolean; was_price: number | null }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabaseAdmin
      .from('price_observations')
      .select('store_product_id, price, on_promotion, was_price')
      .order('observed_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    priceRows = priceRows.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const latestBySpId = new Map<string, { price: number; on_promotion: boolean; was_price: number | null }>();
  for (const row of priceRows) {
    if (!latestBySpId.has(row.store_product_id)) {
      latestBySpId.set(row.store_product_id, { price: row.price, on_promotion: row.on_promotion ?? false, was_price: row.was_price });
    }
  }

  const seen = new Set<string>();
  const results: ProductPrice[] = [];
  for (const sp of spRows) {
    const p = sp.products as unknown as { canonical_name: string; category: string } | null;
    if (!p) continue;
    const obs = latestBySpId.get(sp.id);
    if (!obs) continue;
    const key = `${p.canonical_name}::${sp.store}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      canonical_name: p.canonical_name,
      category: p.category,
      store: sp.store,
      price: obs.price,
      was_price: obs.was_price,
      on_promotion: obs.on_promotion,
      store_product_name: sp.store_product_name,
    });
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
