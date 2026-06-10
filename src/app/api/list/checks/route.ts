import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

// GET /api/list/checks?token=&list_id= — fetch checked items for a list
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const listId = req.nextUrl.searchParams.get('list_id');
  if (!token || !listId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('list_item_checks')
    .select('canonical_name, checked')
    .eq('subscriber_id', subscriberId)
    .eq('list_id', listId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return as a map: { canonical_name: checked }
  const checks: Record<string, boolean> = {};
  for (const row of data ?? []) {
    checks[row.canonical_name] = row.checked;
  }
  return NextResponse.json({ checks });
}

// POST /api/list/checks — toggle a single item
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    token: string;
    list_id: string;
    canonical_name: string;
    checked: boolean;
  };

  const { token, list_id, canonical_name, checked } = body;
  if (!token || !list_id || !canonical_name) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('list_item_checks')
    .upsert(
      { subscriber_id: subscriberId, list_id, canonical_name, checked, checked_at: new Date().toISOString() },
      { onConflict: 'subscriber_id,list_id,canonical_name' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/list/checks?token=&list_id= — clear all checks for a list (reset)
export async function DELETE(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const listId = req.nextUrl.searchParams.get('list_id');
  if (!token || !listId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('list_item_checks')
    .delete()
    .eq('subscriber_id', subscriberId)
    .eq('list_id', listId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
