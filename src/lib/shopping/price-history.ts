import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchCurrentExactOffers } from './current-offers';

export async function queryUserHistory(subscriberId: string) {
  const { data } = await supabaseAdmin
    .from('list_items')
    .select('canonical_name, category, store, price_paid, quantity, observed_at')
    .eq('subscriber_id', subscriberId)
    .order('observed_at', { ascending: false })
    .limit(200);
  const map = new Map<string, { store: string; price_paid: number; quantity: number; times_bought: number; last_bought: string }>();
  for (const row of (data ?? []) as Array<{ canonical_name: string; store: string; price_paid: number; quantity: number; observed_at: string }>) {
    const existing = map.get(row.canonical_name);
    if (existing) existing.times_bought += 1;
    else map.set(row.canonical_name, { store: row.store, price_paid: row.price_paid, quantity: row.quantity, times_bought: 1, last_bought: row.observed_at });
  }
  return [...map.entries()].map(([canonical_name, value]) => ({ canonical_name, ...value }));
}

/** Same-store price changes; throws if current prices cannot be read (use when a result will be cached). */
export async function queryPriceChangesStrict(subscriberId: string) {
  const history = await queryUserHistory(subscriberId);
  if (!history.length) return [];
  const names = history.slice(0, 30).map(item => item.canonical_name);
  const data = await fetchCurrentExactOffers<{ canonical_name: string; store: string; price: number }>(names, 'canonical_name, store, price, was_price, on_promotion');
  return priceChangesAtSameStore(history.slice(0, 30), data);
}

/** Lenient variant for notices: a read failure yields no notice (never one built on partial prices), logged. */
export async function queryPriceChanges(subscriberId: string) {
  try {
    return await queryPriceChangesStrict(subscriberId);
  } catch (error) {
    console.warn('[price-history] current prices unavailable; no price-change notice', { message: error instanceof Error ? error.message : 'unknown' });
    return [];
  }
}

/**
 * A price change is only reported for the SAME retailer the shopper bought from: another store's offer on
 * the same canonical record is not verified to be the same product, so it can never be presented as
 * "cheaper now at X". best_store_now is therefore always the store last bought from.
 */
export function priceChangesAtSameStore(
  history: Array<{ canonical_name: string; store: string; price_paid: number }>,
  current: Array<{ canonical_name: string; store: string; price: number }>,
) {
  const now = new Map<string, number>();
  for (const row of current) {
    const key = `${row.canonical_name}\u0000${String(row.store).toLowerCase()}`;
    const price = Number(row.price);
    if (Number.isFinite(price) && price > 0 && (!now.has(key) || price < now.get(key)!)) now.set(key, price);
  }
  return history.flatMap(item => {
    const price = now.get(`${item.canonical_name}\u0000${String(item.store).toLowerCase()}`);
    if (price === undefined) return [];
    const change = Number((price - Number(item.price_paid)).toFixed(2));
    if (Math.abs(change) < 0.05) return [];
    return [{ canonical_name: item.canonical_name, last_store: item.store, last_price: item.price_paid, best_store_now: item.store, best_price_now: price, change, direction: change < 0 ? 'cheaper' as const : 'dearer' as const }];
  });
}
