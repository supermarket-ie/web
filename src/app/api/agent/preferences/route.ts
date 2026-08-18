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
    .from('subscribers')
    .select('agent_proactivity, weekly_digest_enabled, watchdog_enabled')
    .eq('id', subscriberId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    proactivity: data?.agent_proactivity ?? 'important_only',
    weeklyDigestEnabled: data?.weekly_digest_enabled ?? true,
    watchdogEnabled: data?.watchdog_enabled ?? true,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const subscriberId = getSubscriberId(sessionToken(req, body.token));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const update: Record<string, string | boolean> = {};
  if (['important_only', 'useful_updates', 'quiet'].includes(body.proactivity)) update.agent_proactivity = body.proactivity;
  if (typeof body.weeklyDigestEnabled === 'boolean') update.weekly_digest_enabled = body.weeklyDigestEnabled;
  if (typeof body.watchdogEnabled === 'boolean') update.watchdog_enabled = body.watchdogEnabled;
  if (!Object.keys(update).length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  update.updated_at = new Date().toISOString();
  const { error } = await supabaseAdmin.from('subscribers').update(update).eq('id', subscriberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
