import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token: explicitToken, items } = body as {
    token?: string;
    items?: { canonical_name: string; category: string; store: string; price_paid: number; quantity: number }[];
  };

  if (!items?.length) return NextResponse.json({ ok: false }, { status: 400 });

  const token = req.cookies.get('sm_session')?.value ??
    (explicitToken && explicitToken !== '__cookie__' ? explicitToken : null);
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const { error } = await supabaseAdmin.from('list_items').insert(
    items.map(i => ({ ...i, subscriber_id: subscriberId }))
  );

  if (error) return NextResponse.json({ error: 'Failed to save list items' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
