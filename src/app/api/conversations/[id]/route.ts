import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

// GET /api/conversations/[id]?token=xxx — get single conversation with messages
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, messages, profile, list_id, created_at, updated_at')
    .eq('id', id)
    .eq('subscriber_id', subscriberId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ conversation: data });
}

// PATCH /api/conversations/[id] — update conversation (messages, title)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { token, messages, title, list_id } = body;

  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Verify ownership
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

// DELETE /api/conversations/[id]?token=xxx — delete conversation
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('conversations')
    .delete()
    .eq('id', id)
    .eq('subscriber_id', subscriberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
