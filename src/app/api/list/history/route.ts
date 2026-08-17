import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

interface HistoryItem {
  name: string;
  store: string;
  last_date: string;
}

async function getUserHistory(subscriberId: string): Promise<HistoryItem[]> {
  const { data } = await supabaseAdmin
    .from('list_items')
    .select('canonical_name, store, observed_at')
    .eq('subscriber_id', subscriberId)
    .order('observed_at', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) return [];

  const itemMap = new Map<string, { store: string; last_date: string }>();
  for (const item of data) {
    if (!itemMap.has(item.canonical_name)) {
      itemMap.set(item.canonical_name, { store: item.store, last_date: item.observed_at });
    }
  }

  return Array.from(itemMap.entries())
    .map(([canonical_name, { store, last_date }]) => ({ name: canonical_name, store, last_date }))
    .slice(0, 5);
}

export async function GET(request: NextRequest) {
  const explicit = request.nextUrl.searchParams.get('token');
  const token = request.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
  const subscriberId = getSubscriberId(token);

  if (!subscriberId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const items = await getUserHistory(subscriberId);
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[/api/list/history] Error:', error);
    return new Response(JSON.stringify({ error: 'Unable to load history' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
