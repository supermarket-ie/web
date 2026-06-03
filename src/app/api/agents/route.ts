import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

function getSubscriberId(token: string): string | null {
  try {
    const p = jwt.verify(token, SECRET!) as { subscriberId: string };
    return p.subscriberId ?? null;
  } catch { return null; }
}

// GET /api/agents?token=xxx — fetch agent settings + last run info
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

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

// PATCH /api/agents — update agent toggles
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { token, weeklyDigestEnabled, watchdogEnabled } = body;
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

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
