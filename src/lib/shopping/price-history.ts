import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

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

export async function queryPriceChanges(subscriberId: string) {
  const history = await queryUserHistory(subscriberId);
  if (!history.length) return [];
  const names = history.slice(0, 30).map(item => item.canonical_name);
  const { data } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, store, price, was_price, on_promotion')
    .in('canonical_name', names);
  if (!data) return [];

  const bestByName = new Map<string, { store: string; price: number }>();
  for (const row of data as Array<{ canonical_name: string; store: string; price: number }>) {
    const existing = bestByName.get(row.canonical_name);
    if (!existing || Number(row.price) < existing.price) bestByName.set(row.canonical_name, { store: row.store, price: Number(row.price) });
  }
  return history.slice(0, 30).flatMap(item => {
    const best = bestByName.get(item.canonical_name);
    if (!best) return [];
    const change = Number((best.price - Number(item.price_paid)).toFixed(2));
    if (Math.abs(change) < 0.05) return [];
    return [{ canonical_name: item.canonical_name, last_store: item.store, last_price: item.price_paid, best_store_now: best.store, best_price_now: best.price, change, direction: change < 0 ? 'cheaper' as const : 'dearer' as const }];
  });
}
