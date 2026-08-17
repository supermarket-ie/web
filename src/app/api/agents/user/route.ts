import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const explicit = req.nextUrl.searchParams.get('token');
  const token = req.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('user_agents')
    .select('agent_type, enabled, last_run, last_output, config')
    .eq('subscriber_id', subscriberId)
    .order('last_run', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return NextResponse.json({ agents: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agents: data ?? [] });
}
