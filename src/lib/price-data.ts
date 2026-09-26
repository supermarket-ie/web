import { supabaseAdmin } from '@/lib/supabase';
import { DependencyUnavailableError, withSupabaseRetry } from '@/lib/supabase-resilience';

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
  canonical_product_id: string;
  canonical_name: string;
  category: string;
  store: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  store_product_name: string;
  store_sku: string;
  store_url: string | null;
  observed_at: string;
  source: string;
  relationship_type: 'exact';
  freshness_state: 'fresh';
};

let _priceCache: ProductPrice[] | null = null;
let _priceCacheAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;
const LAST_KNOWN_GOOD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function isKnownCiSupabasePlaceholder(): boolean {
  return process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://example.supabase.co';
}

function getLastKnownGoodPrices(): ProductPrice[] | null {
  if (!_priceCache || _priceCacheAt <= 0) return null;
  const ageMs = Date.now() - _priceCacheAt;
  if (ageMs > LAST_KNOWN_GOOD_MAX_AGE_MS) return null;
  console.warn('[price-data] serving bounded last-known-good trusted-price cache', {
    age_ms: ageMs,
    max_age_ms: LAST_KNOWN_GOOD_MAX_AGE_MS,
    rows: _priceCache.length,
  });
  return _priceCache;
}

/**
 * Fetch the validated current-price set across active stores.
 *
 * `latest_prices` is the production boundary for price quality. Fail closed if
 * it is unavailable unless this process has a recent, previously validated
 * last-known-good snapshot. Raw price observations remain forbidden as a
 * fallback and stale trusted data is bounded to two hours.
 *
 * GitHub CI intentionally builds with example.supabase.co. That single known
 * placeholder remains allowed to yield no rows so static route compilation can
 * complete; the exception cannot activate in preview or production.
 */
export async function getAllLatestPrices(options: { bypassCache?: boolean } = {}): Promise<ProductPrice[]> {
  if (!options.bypassCache && _priceCache && Date.now() - _priceCacheAt < CACHE_TTL_MS) {
    return _priceCache;
  }

  const viewRows: ProductPrice[] = [];
  try {
    // PostgREST caps each response. Read every page in a deterministic order;
    // never publish/cache a partially loaded catalogue if a later page fails.
    let from = 0;
    while (true) {
      const { data, error } = await withSupabaseRetry(
        'latest_prices.all_current_prices',
        () => supabaseAdmin
          .from('latest_prices')
          .select('canonical_product_id, canonical_name, category, store, price, was_price, on_promotion, store_product_name, store_sku, store_url, observed_at, source, relationship_type, freshness_state')
          .order('canonical_product_id')
          .order('store')
          .range(from, from + 999),
      );
      if (error) throw new Error(`latest_prices query failed: ${error.message ?? 'unknown database error'}`);
      if (!data?.length) break;
      viewRows.push(...data as ProductPrice[]);
      // Advance by the returned count, even if the API cap is below 1,000.
      from += data.length;
    }
  } catch (error) {
    if (isKnownCiSupabasePlaceholder()) {
      console.warn('[price-data] CI Supabase placeholder unavailable; allowing empty static-build data');
      return [];
    }
    if (error instanceof DependencyUnavailableError) {
      const fallback = getLastKnownGoodPrices();
      if (fallback) return fallback;
    }
    throw error;
  }

  if (!viewRows || viewRows.length === 0) {
    console.warn('[price-data] latest_prices returned zero rows');
    return [];
  }

  const seen = new Set<string>();
  const results: ProductPrice[] = [];
  for (const r of viewRows as unknown as ProductPrice[]) {
    const key = `${r.canonical_product_id}::${r.store}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(r);
  }

  // A successful trusted-price read becomes the process-local last-known-good
  // snapshot even when the caller requested a fresh read. `bypassCache` skips
  // a cache read; it must not prevent successful data becoming a safe fallback.
  _priceCache = results;
  _priceCacheAt = Date.now();
  return results;
}

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

export function filterToMain3(grouped: ReturnType<typeof groupByProduct>) {
  const filtered = new Map<string, { category: string; stores: Map<string, { price: number; on_promotion: boolean; was_price: number | null }> }>();
  for (const [name, data] of grouped) {
    const hasAll3 = MAIN_STORES.every(s => data.stores.has(s));
    if (hasAll3) filtered.set(name, data);
  }
  return filtered;
}
