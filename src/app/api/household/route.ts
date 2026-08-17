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
    .from('households')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ household: data ?? null });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { token: explicitToken, ...profile } = body;

  const subscriberId = getSubscriberId(sessionToken(req, explicitToken));
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const row = {
    subscriber_id: subscriberId,
    adults: profile.adults ?? 2,
    children: profile.children ?? 0,
    child_ages: profile.childAges ?? [],
    weekly_budget: profile.weeklyBudget ?? null,
    preferred_stores: profile.preferredStores ?? ['all'],
    dietary: profile.dietary ?? [],
    dislikes: profile.dislikes ?? null,
    meals: profile.meals ?? { breakfast: true, lunch: true, dinner: true, snacks: true },
    batch_cooking: profile.batchCooking ?? false,
    skip_days: profile.skipDays ?? null,
    extra_context: profile.extraContext ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('households')
    .upsert({ ...row }, { onConflict: 'subscriber_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ household: data });
}
