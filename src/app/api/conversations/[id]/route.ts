import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

function sessionToken(req: NextRequest, explicit?: string | null) {
  return req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, messages, profile, list_id, created_at, updated_at')
    .eq('id', id)
    .eq('subscriber_id', subscriberId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ conversation: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { token: explicitToken, messages, title, list_id } = body;

  const subscriberId = getSubscriberId(sessionToken(req, explicitToken));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('id', id)
    .eq('subscriber_id', subscriberId)
    .single();

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (messages !== undefined) updates.messages = messages;
  if (title !== undefined) updates.title = title;
  if (list_id !== undefined) updates.list_id = list_id;

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .update(updates)
    .eq('id', id)
    .select('id, title, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('conversations')
    .delete()
    .eq('id', id)
    .eq('subscriber_id', subscriberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
