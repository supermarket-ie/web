import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

// GET /api/lists?token=xxx — fetch all saved lists for subscriber
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Deliberately exclude `items` (large JSONB) — dashboard only needs metadata
  const { data, error } = await supabaseAdmin
    .from('saved_lists')
    .select('id, name, meals_prompt, family_size, store_totals, is_default, created_at, generated_at, conversation_id')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lists: data ?? [] });
}

// POST /api/lists — save a new list
export async function POST(req: Request) {
  const body = await req.json();
  const { token, name, meals_prompt, family_size, items, store_totals, is_default } = body;

  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // If setting as default, clear existing defaults
  if (is_default) {
    await supabaseAdmin
      .from('saved_lists')
      .update({ is_default: false })
      .eq('subscriber_id', subscriberId);
  }

  // Cap at 10 lists per subscriber — delete oldest if over limit
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

// DELETE /api/lists?id=xxx&token=xxx
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const id = searchParams.get('id');
  if (!token || !id) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('saved_lists')
    .delete()
    .eq('id', id)
    .eq('subscriber_id', subscriberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
