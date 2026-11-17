import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { queryPriceChanges } from '@/lib/shopping/price-history';
import { getSubscriberId } from '@/lib/auth';

const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const explicit = req.nextUrl.searchParams.get('token');
  const token = req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: subscriber } = await supabaseAdmin
    .from('subscribers')
    .select('refresh_cache, refresh_cache_at')
    .eq('id', subscriberId)
    .single();

  if (subscriber?.refresh_cache && subscriber?.refresh_cache_at) {
    const age = Date.now() - new Date(subscriber.refresh_cache_at).getTime();
    const cached = subscriber.refresh_cache as { hasRecentList?: boolean; basis?: string };
    // Reuse only results computed on the like-for-like basis (older cached results mixed stores).
    if (age < CACHE_TTL_MS && (cached.hasRecentList === false || cached.basis === 'same_store_same_items')) return NextResponse.json(subscriber.refresh_cache);
  }

  const { data: lastList } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, created_at, store_totals')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastList) {
    const empty = { hasRecentList: false };
    await supabaseAdmin
      .from('subscribers')
      .update({ refresh_cache: empty, refresh_cache_at: new Date().toISOString() })
      .eq('id', subscriberId);
    return NextResponse.json(empty);
  }

  const listAge = Date.now() - new Date(lastList.created_at).getTime();
  const daysSince = Math.floor(listAge / (1000 * 60 * 60 * 24));
  // Like-for-like only: what was paid for the last list's items versus the SAME stores' current prices for
  // those items. Other stores' offers on a canonical record are not verified to be the same product, and
  // summing several stores' totals is not a basket at all.
  const { data: lastItems } = await supabaseAdmin
    .from('list_items')
    .select('canonical_name, store, price_paid, quantity')
    .eq('list_id', lastList.id)
    .eq('subscriber_id', subscriberId);
  const paid = (lastItems ?? []) as Array<{ canonical_name: string; store: string; price_paid: number; quantity: number | null }>;
  const lastTotal = paid.reduce((sum, item) => sum + Number(item.price_paid) * (item.quantity ?? 1), 0);
  // Only fresh, exact store offers count as a current price; page past the 1,000-row default.
  const current: Array<{ canonical_name: string; store: string; price: number }> = [];
  const names = [...new Set(paid.map(i => i.canonical_name))];
  for (let from = 0; names.length; from += 1000) {
    const { data: page, error } = await supabaseAdmin.from('latest_prices')
      .select('canonical_name, store, price')
      .in('canonical_name', names)
      .eq('relationship_type', 'exact')
      .eq('freshness_state', 'fresh')
      .order('store_product_id')
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: 'Price lookup failed' }, { status: 500 });
    current.push(...((page ?? []) as typeof current));
    if (!page || page.length < 1000) break;
  }
  const sameStorePrice = (item: (typeof paid)[number]) => current
    .filter(r => r.canonical_name === item.canonical_name && String(r.store).toLowerCase() === String(item.store).toLowerCase())
    .reduce<number | null>((min, r) => (min === null || Number(r.price) < min ? Number(r.price) : min), null);
  const repriced = paid.map(item => ({ item, now: sameStorePrice(item) }));
  const unpriced = repriced.filter(r => r.now === null).length;
  // A current total exists only when every item still has a current price at the store it was bought from.
  const thisWeekTotal = paid.length && unpriced === 0
    ? repriced.reduce((sum, r) => sum + r.now! * (r.item.quantity ?? 1), 0)
    : null;
  const priceChanges = await queryPriceChanges(subscriberId);

  const cheaper = priceChanges.filter(c => c.direction === 'cheaper');
  const dearer = priceChanges.filter(c => c.direction === 'dearer');
  const cheaperAmount = cheaper.reduce((sum, c) => sum + Math.abs(c.change), 0);
  const dearerAmount = dearer.reduce((sum, c) => sum + c.change, 0);
  const netChange = thisWeekTotal === null ? cheaperAmount - dearerAmount : lastTotal - thisWeekTotal;

  const result = {
    hasRecentList: true,
    daysSince,
    lastList: {
      id: lastList.id,
      name: lastList.name,
      created_at: lastList.created_at,
      total: Math.round(lastTotal * 100) / 100,
    },
    priceDiff: {
      cheaper: cheaper.length,
      dearer: dearer.length,
      // Cross-store "promotion elsewhere" counts are not produced: other stores' products are unverified.
      promoSwaps: 0,
      cheaperAmount: Math.round(cheaperAmount * 100) / 100,
      dearerAmount: Math.round(dearerAmount * 100) / 100,
      netChange: Math.round(netChange * 100) / 100,
    },
    /** Same items at the same stores at today's prices; null when any item has no current price there. */
    thisWeekTotal: thisWeekTotal === null ? null : Math.round(thisWeekTotal * 100) / 100,
    unpricedItems: unpriced,
    basis: 'same_store_same_items' as const,
  };

  supabaseAdmin
    .from('subscribers')
    .update({ refresh_cache: result, refresh_cache_at: new Date().toISOString() })
    .eq('id', subscriberId)
    .then(() => {});

  return NextResponse.json(result);
}
