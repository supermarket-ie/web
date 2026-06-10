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

  // Group by canonical_name and take the most recent entry for each
  const itemMap = new Map<string, { store: string; last_date: string }>();

  for (const item of data) {
    if (!itemMap.has(item.canonical_name)) {
      itemMap.set(item.canonical_name, {
        store: item.store,
        last_date: item.observed_at,
      });
    }
  }

  // Return top 5 most recent unique items
  return Array.from(itemMap.entries())
    .map(([canonical_name, { store, last_date }]) => ({
      name: canonical_name,
      store,
      last_date,
    }))
    .slice(0, 5);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response(JSON.stringify({ error: 'Token required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify JWT and extract subscriber ID
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
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
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}