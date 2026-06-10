/**
 * POST /api/plan/reprice
 *
 * Given a list_id (or subscriber's latest list), fetches the items and
 * reprices the full basket at each store individually to compute:
 *   - bestSplitTotal: sum of cheapest-store prices per item (what the agent already did)
 *   - singleStoreTotals: what the basket costs buying everything at one store
 *   - bestSingleStore: the cheapest single-store option
 *   - savings: bestSingleStore.total - bestSplitTotal
 *
 * This powers the store comparison card without relying on LLM markers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

export interface StoreTotal {
  store: string;
  total: number;
  itemsCovered: number;
  itemsMissing: number;
}

export interface RepriceResult {
  bestSplitTotal: number;
  splitBreakdown: Array<{ store: string; total: number; items: number }>;
  singleStoreTotals: StoreTotal[];
  bestSingleStore: StoreTotal | null;
  savings: number; // bestSingleStore.total - bestSplitTotal
  itemCount: number;
}

const MAIN_STORES = ['tesco', 'dunnes', 'supervalu', 'aldi'];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, list_id } = body;

  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Get the list items
  let items: Array<{ canonical_name: string; store: string; price_paid: number; quantity: number }> = [];

  if (list_id) {
    const { data } = await supabaseAdmin
      .from('list_items')
      .select('canonical_name, store, price_paid, quantity')
      .eq('list_id', list_id)
      .eq('subscriber_id', subscriberId);
    items = data ?? [];
  } else {
    // Fall back to latest list
    const { data: list } = await supabaseAdmin
      .from('saved_lists')
      .select('id')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (list) {
      const { data } = await supabaseAdmin
        .from('list_items')
        .select('canonical_name, store, price_paid, quantity')
        .eq('list_id', list.id)
        .eq('subscriber_id', subscriberId);
      items = data ?? [];
    }
  }

  if (items.length === 0) {
    return NextResponse.json({ error: 'No items found' }, { status: 404 });
  }

  const canonicalNames = [...new Set(items.map(i => i.canonical_name))];

  // Fetch all prices for these products across all stores
  const { data: prices } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, store, price')
    .in('canonical_name', canonicalNames)
    .in('store', MAIN_STORES);

  // Build price map: canonical_name → store → price
  const priceMap = new Map<string, Map<string, number>>();
  for (const p of prices ?? []) {
    if (!priceMap.has(p.canonical_name)) priceMap.set(p.canonical_name, new Map());
    priceMap.get(p.canonical_name)!.set(p.store, p.price);
  }

  // Best split total (what agent already computed — cheapest store per item)
  const bestSplitTotal = items.reduce((sum, item) => sum + item.price_paid * (item.quantity ?? 1), 0);

  // Split breakdown by store
  const splitByStore = new Map<string, { total: number; items: number }>();
  for (const item of items) {
    if (!splitByStore.has(item.store)) splitByStore.set(item.store, { total: 0, items: 0 });
    const s = splitByStore.get(item.store)!;
    s.total += item.price_paid * (item.quantity ?? 1);
    s.items += 1;
  }
  const splitBreakdown = [...splitByStore.entries()]
    .map(([store, { total, items }]) => ({ store, total: Math.round(total * 100) / 100, items }))
    .sort((a, b) => b.items - a.items);

  // Single-store totals: what would it cost to buy everything at one store?
  const singleStoreTotals: StoreTotal[] = [];
  for (const store of MAIN_STORES) {
    let total = 0;
    let covered = 0;
    let missing = 0;
    for (const item of items) {
      const storeMap = priceMap.get(item.canonical_name);
      const price = storeMap?.get(store);
      if (price !== undefined) {
        total += price * (item.quantity ?? 1);
        covered++;
      } else {
        // Item not available at this store — use the agent's price as fallback
        total += item.price_paid * (item.quantity ?? 1);
        missing++;
      }
    }
    singleStoreTotals.push({
      store,
      total: Math.round(total * 100) / 100,
      itemsCovered: covered,
      itemsMissing: missing,
    });
  }

  // Best single store = lowest total (only consider stores that cover most items)
  const threshold = Math.floor(items.length * 0.6); // must cover at least 60% of items
  const viable = singleStoreTotals
    .filter(s => s.itemsCovered >= threshold)
    .sort((a, b) => a.total - b.total);

  const bestSingleStore = viable[0] ?? singleStoreTotals.sort((a, b) => a.total - b.total)[0];
  const savings = Math.round((bestSingleStore.total - bestSplitTotal) * 100) / 100;

  return NextResponse.json({
    bestSplitTotal: Math.round(bestSplitTotal * 100) / 100,
    splitBreakdown,
    singleStoreTotals: singleStoreTotals.sort((a, b) => a.total - b.total),
    bestSingleStore,
    savings,
    itemCount: items.length,
  } satisfies RepriceResult);
}
