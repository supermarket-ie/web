import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

function sessionToken(req: NextRequest, explicit?: string | null) {
  return req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

export async function GET(req: NextRequest) {
  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: sub } = await supabaseAdmin
    .from('subscribers')
    .select('weekly_digest_enabled, watchdog_enabled, last_watchdog_sent, created_at')
    .eq('id', subscriberId)
    .single();

  const { data: alerts } = await supabaseAdmin
    .from('price_alerts')
    .select('id, product_id, target_price, created_at, products!inner(canonical_name)')
    .eq('subscriber_id', subscriberId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  return NextResponse.json({
    weeklyDigest: {
      enabled: sub?.weekly_digest_enabled ?? true,
      schedule: 'Sunday mornings',
    },
    watchdog: {
      enabled: sub?.watchdog_enabled ?? true,
      lastSent: sub?.last_watchdog_sent ?? null,
      schedule: 'Daily at 08:30',
    },
    priceAlerts: (alerts ?? []).map(a => ({
      id: a.id,
      product_id: a.product_id,
      product_name: (a.products as unknown as { canonical_name: string }).canonical_name,
      target_price: a.target_price,
      created_at: a.created_at,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { token: explicitToken, weeklyDigestEnabled, watchdogEnabled } = body;
  const subscriberId = getSubscriberId(sessionToken(req, explicitToken));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const update: Record<string, boolean> = {};
  if (typeof weeklyDigestEnabled === 'boolean') update.weekly_digest_enabled = weeklyDigestEnabled;
  if (typeof watchdogEnabled === 'boolean') update.watchdog_enabled = watchdogEnabled;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('subscribers')
    .update(update)
    .eq('id', subscriberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
