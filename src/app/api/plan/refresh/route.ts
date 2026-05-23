import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { queryPriceChanges } from '@/lib/planner-agent';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token || !SECRET) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let subscriberId: string;
  try {
    const payload = jwt.verify(token, SECRET) as { subscriberId: string };
    subscriberId = payload.subscriberId;
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // Get last saved list
  const { data: lastList } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, created_at, store_totals')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastList) {
    return NextResponse.json({ hasRecentList: false });
  }

  const listAge = Date.now() - new Date(lastList.created_at).getTime();
  const daysSince = Math.floor(listAge / (1000 * 60 * 60 * 24));

  const storeTotals = (lastList.store_totals ?? []) as Array<{ store: string; total: number }>;
  const lastTotal = storeTotals.reduce((sum, t) => sum + t.total, 0);

  // Get price changes since last shop
  const priceChanges = await queryPriceChanges(subscriberId);

  const cheaper = priceChanges.filter(c => c.direction === 'cheaper');
  const dearer = priceChanges.filter(c => c.direction === 'dearer');
  const promoSwaps = priceChanges.filter(
    c => c.direction === 'cheaper' && c.best_store_now !== c.last_store,
  );

  const cheaperAmount = cheaper.reduce((sum, c) => sum + Math.abs(c.change), 0);
  const dearerAmount = dearer.reduce((sum, c) => sum + c.change, 0);
  const netChange = cheaperAmount - dearerAmount;
  const thisWeekTotal = Math.max(0, lastTotal - netChange);

  return NextResponse.json({
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
  });
}
