import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';
import { boundedConversationMessages, validAgentChatProfile } from '@/lib/conversation-persistence';

function sessionToken(req: NextRequest, explicit?: string | null) {
  return req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

export async function GET(req: NextRequest) {
  const subscriberId = getSubscriberId(sessionToken(req, req.nextUrl.searchParams.get('token')));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('id, title, list_id, created_at, updated_at, messages, profile')
    .eq('subscriber_id', subscriberId)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conversations = (data ?? []).map((c: { id: string; title: string | null; list_id: string | null; created_at: string; updated_at: string | null; messages: unknown; profile: unknown }) => ({
    id: c.id,
    title: c.title,
    list_id: c.list_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    message_count: Array.isArray(c.messages) ? c.messages.length : 0,
    agent_chat: Boolean(c.profile && typeof c.profile === 'object' && 'eve_state' in c.profile),
  }));

  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token: explicitToken, title, profile, messages, list_id } = body;

  const subscriberId = getSubscriberId(sessionToken(req, explicitToken));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (profile !== undefined && !validAgentChatProfile(profile)) return NextResponse.json({ error: 'Conversation state is too large or invalid' }, { status: 400 });

  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id, created_at')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: true });

  if (existing && existing.length >= 20) {
    const toDelete = existing.slice(0, existing.length - 19);
    await supabaseAdmin.from('conversations').delete().in('id', toDelete.map((r: { id: string }) => r.id));
  }

  const { data, error } = await supabaseAdmin
    .from('conversations')
    .insert({
      subscriber_id: subscriberId,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'New conversation',
      profile: profile ?? null,
      messages: boundedConversationMessages(messages),
      list_id: list_id ?? null,
    })
    .select('id, title, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
