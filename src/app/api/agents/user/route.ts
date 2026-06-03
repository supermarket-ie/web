import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET required');

function getSubscriberId(token: string): string | null {
  try {
    const p = jwt.verify(token, SECRET!) as { subscriberId: string };
    return p.subscriberId ?? null;
  } catch { return null; }
}

// GET /api/agents/user?token=xxx — list user's custom agents
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('user_agents')
    .select('agent_type, enabled, last_run, last_output, config')
    .eq('subscriber_id', subscriberId)
    .order('last_run', { ascending: false });

  if (error) {
    // Table might not exist yet — return empty gracefully
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return NextResponse.json({ agents: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agents: data ?? [] });
}
