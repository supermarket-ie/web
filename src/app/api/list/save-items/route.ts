import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, items } = body as {
    token: string;
    items: { canonical_name: string; category: string; store: string; price_paid: number; quantity: number }[]
  };

  if (!token || !items?.length) return NextResponse.json({ ok: false }, { status: 400 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  await supabaseAdmin.from('list_items').insert(
    items.map(i => ({ ...i, subscriber_id: subscriberId }))
  );

  return NextResponse.json({ ok: true });
}
