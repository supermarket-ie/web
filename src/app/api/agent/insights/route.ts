import { NextResponse } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function subscriberFromRequest(request: Request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearer ?? url.searchParams.get('token');
  return getSubscriberId(token ?? undefined);
}

export async function GET(request: Request) {
  const subscriberId = subscriberFromRequest(request);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('limit') ?? 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 10;

  const { data, error } = await supabaseAdmin
    .from('household_insights')
    .select('id, canonical_name, kind, priority, title, body, payload, status, emailed_at, created_at')
    .eq('subscriber_id', subscriberId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[agent-insights] Failed to load insights', error);
    return NextResponse.json({ error: 'Unable to load insights' }, { status: 500 });
  }

  return NextResponse.json({ insights: data ?? [] });
}

export async function PATCH(request: Request) {
  const subscriberId = subscriberFromRequest(request);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as { id?: string; status?: 'seen' | 'dismissed' } | null;
  if (!body?.id || !['seen', 'dismissed'].includes(body.status ?? '')) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('household_insights')
    .update({ status: body.status })
    .eq('id', body.id)
    .eq('subscriber_id', subscriberId)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[agent-insights] Failed to update insight', error);
    return NextResponse.json({ error: 'Unable to update insight' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Insight not found' }, { status: 404 });

  return NextResponse.json(data);
}
