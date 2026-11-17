/**
 * POST /api/plan/reprice
 *
 * Given a list_id (or subscriber's latest list), reprices the list with CURRENT retailer prices only
 * (src/lib/shopping/reprice.ts):
 *   - bestSplitTotal: the same items at the stores the shopper chose, at today's prices
 *   - singleStoreTotals: each store's current prices for the items it sells (never filled with past prices)
 *   - bestSingleStore / savings: only for complete baskets of independently verified exact matches
 *
 * This powers the store comparison card without relying on LLM markers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';
import { getCurrentPairReviews } from '@/lib/comparison-reviews';
import { repriceBasket, type RepriceItem, type RepricePrice } from '@/lib/shopping/reprice';

export type { RepriceResult, StoreTotal } from '@/lib/shopping/reprice';

const MAIN_STORES = ['tesco', 'dunnes', 'supervalu', 'aldi'];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, list_id } = body;

  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Get the list items
  let items: RepriceItem[] = [];

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
  const [{ data: prices }, reviews] = await Promise.all([
    supabaseAdmin
      .from('latest_prices')
      .select('canonical_name, store, price, store_product_id, store_product_name, relationship_type, freshness_state')
      .in('canonical_name', canonicalNames)
      .in('store', MAIN_STORES),
    getCurrentPairReviews(),
  ]);
  const current = ((prices ?? []) as Array<RepricePrice & { relationship_type?: string | null; freshness_state?: string | null }>)
    .filter(p => p.relationship_type === 'exact' && p.freshness_state === 'fresh')
    .map(p => ({ ...p, price: Number(p.price) }));

  return NextResponse.json(repriceBasket(items, current, MAIN_STORES, reviews));
}
