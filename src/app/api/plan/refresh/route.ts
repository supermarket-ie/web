import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { queryPriceChanges } from '@/lib/planner-agent';
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
    if (age < CACHE_TTL_MS) return NextResponse.json(subscriber.refresh_cache);
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
  const storeTotals = (lastList.store_totals ?? []) as Array<{ store: string; total: number }>;
  const lastTotal = storeTotals.reduce((sum, t) => sum + t.total, 0);
  const priceChanges = await queryPriceChanges(subscriberId);

  const cheaper = priceChanges.filter(c => c.direction === 'cheaper');
  const dearer = priceChanges.filter(c => c.direction === 'dearer');
  const promoSwaps = priceChanges.filter(c => c.direction === 'cheaper' && c.best_store_now !== c.last_store);
  const cheaperAmount = cheaper.reduce((sum, c) => sum + Math.abs(c.change), 0);
  const dearerAmount = dearer.reduce((sum, c) => sum + c.change, 0);
  const netChange = cheaperAmount - dearerAmount;
  const thisWeekTotal = Math.max(0, lastTotal - netChange);

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
      promoSwaps: promoSwaps.length,
      cheaperAmount: Math.round(cheaperAmount * 100) / 100,
      dearerAmount: Math.round(dearerAmount * 100) / 100,
      netChange: Math.round(netChange * 100) / 100,
    },
    thisWeekTotal: Math.round(thisWeekTotal * 100) / 100,
  };

  supabaseAdmin
    .from('subscribers')
    .update({ refresh_cache: result, refresh_cache_at: new Date().toISOString() })
    .eq('id', subscriberId)
    .then(() => {});

  return NextResponse.json(result);
}
