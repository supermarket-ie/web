import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

function sessionToken(req: NextRequest, explicit?: string | null) {
  return req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

export async function GET(req: NextRequest) {
  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, meals_prompt, family_size, store_totals, is_default, created_at, generated_at, conversation_id')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lists: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token: explicitToken, name, meals_prompt, family_size, items, store_totals, is_default } = body;

  const subscriberId = getSubscriberId(sessionToken(req, explicitToken));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (is_default) {
    await supabaseAdmin.from('saved_lists').update({ is_default: false }).eq('subscriber_id', subscriberId);
  }

  const { data: existing } = await supabaseAdmin
    .from('saved_lists')
    .select('id, created_at')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: true });

  if (existing && existing.length >= 10) {
    const toDelete = existing.slice(0, existing.length - 9);
    await supabaseAdmin.from('saved_lists').delete().in('id', toDelete.map(r => r.id));
  }

  const { data, error } = await supabaseAdmin
    .from('saved_lists')
    .insert({
      subscriber_id: subscriberId,
      name: name || meals_prompt?.slice(0, 60) || 'My list',
      meals_prompt: meals_prompt ?? null,
      family_size: family_size ?? '2',
      items: items ?? [],
      store_totals: store_totals ?? [],
      is_default: is_default ?? false,
      generated_at: new Date().toISOString(),
    })
    .select('id, name')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ list: data });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('saved_lists')
    .delete()
    .eq('id', id)
    .eq('subscriber_id', subscriberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
