import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { queryPriceChanges } from '@/lib/planner-agent';
import { getSubscriberId } from '@/lib/auth';

export const maxDuration = 30;

export interface MealSlot {
  day: string;
  name: string | null;
  description?: string;
  ingredients: { name: string; quantity?: string }[];
  estimatedCost: number | null;
  status: 'planned' | 'skipped' | 'empty';
}

export interface ShoppingItem {
  canonicalName: string;
  category: string;
  store: string;
  price: number;
  quantity: number;
  usedIn: string[];
  onPromotion: boolean;
}

export interface AgentNotice {
  type: 'price_drop' | 'promotion' | 'suggestion' | 'warning';
  message: string;
  actionable?: boolean;
  action?: string;
}

export interface WeeklyPlanState {
  weekStart: string;
  meals: {
    dinners: MealSlot[];
    lunches: MealSlot[];
  };
  shoppingList: ShoppingItem[];
  storeAssignment: {
    recommendation: string;
    primary: { store: string; total: number; itemCount: number };
    secondary?: { store: string; total: number; itemCount: number; savings: number };
  } | null;
  budget: { target: number | null; current: number; onTrack: boolean };
  agentNotices: AgentNotice[];
  status: 'empty' | 'partial' | 'complete';
}

function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

function computeStatus(meals: { dinners: MealSlot[]; lunches: MealSlot[] }): 'empty' | 'partial' | 'complete' {
  const all = [...(meals.dinners ?? []), ...(meals.lunches ?? [])];
  const planned = all.filter(m => m.status === 'planned').length;
  if (planned === 0) return 'empty';
  const dinnersFull = (meals.dinners ?? []).filter(m => m.status === 'planned').length >= 7;
  const lunchesFull = (meals.lunches ?? []).filter(m => m.status === 'planned').length >= 5;
  return dinnersFull && lunchesFull ? 'complete' : 'partial';
}

function subscriberFromRequest(req: NextRequest): string | null {
  const explicit = req.nextUrl.searchParams.get('token');
  const token = req.cookies.get('sm_session')?.value ??
    (explicit && explicit !== '__cookie__' ? explicit : null);
  return getSubscriberId(token);
}

export async function GET(req: NextRequest) {
  const subscriberId = subscriberFromRequest(req);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const weekStart = getCurrentWeekStart();

  const { data: selectedPlan, error: selectErr } = await supabaseAdmin
    .from('weekly_plans')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .eq('week_start', weekStart)
    .single();
  let plan = selectedPlan;

  if (selectErr && (selectErr.code === '42P01' || selectErr.message?.includes('does not exist'))) {
    return NextResponse.json({
      weekStart,
      meals: { dinners: [], lunches: [] },
      shoppingList: [],
      storeAssignment: null,
      budget: { target: null, current: 0, onTrack: true },
      agentNotices: [{
        type: 'suggestion',
        message: 'Ask Supermarket.ie to plan dinners for this week based on your household and current supermarket options',
        actionable: true,
        action: 'plan_dinners',
      }],
      status: 'empty',
    } satisfies WeeklyPlanState);
  }

  if (!plan) {
    const { data: newPlan, error: insertErr } = await supabaseAdmin
      .from('weekly_plans')
      .insert({
        subscriber_id: subscriberId,
        week_start: weekStart,
        meals: { dinners: [], lunches: [] },
        shopping_list: [],
        store_assignment: null,
        status: 'empty',
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({
        weekStart,
        meals: { dinners: [], lunches: [] },
        shoppingList: [],
        storeAssignment: null,
        budget: { target: null, current: 0, onTrack: true },
        agentNotices: [{
          type: 'suggestion',
          message: 'Ask Supermarket.ie to plan dinners for this week based on your household and current supermarket options',
          actionable: true,
          action: 'plan_dinners',
        }],
        status: 'empty',
      } satisfies WeeklyPlanState);
    }
    plan = newPlan;
  }

  const { data: household } = await supabaseAdmin
    .from('households')
    .select('weekly_budget')
    .eq('subscriber_id', subscriberId)
    .single();

  const agentNotices: AgentNotice[] = [];

  try {
    const priceChanges = await queryPriceChanges(subscriberId);
    const cheaper = priceChanges.filter((c: { direction: string; change: number }) => c.direction === 'cheaper');
    if (cheaper.length > 0) {
      const amount = cheaper.reduce((sum: number, c: { change: number }) => sum + Math.abs(c.change), 0);
      agentNotices.push({
        type: 'price_drop',
        message: `${cheaper.length} item${cheaper.length > 1 ? 's' : ''} from your last shop ${cheaper.length > 1 ? 'are' : 'is'} cheaper this week — save up to €${amount.toFixed(2)}`,
        actionable: false,
      });
    }
  } catch {
    // Price-change intelligence is helpful but should never block the weekly view.
  }

  const meals = (plan?.meals ?? { dinners: [], lunches: [] }) as { dinners: MealSlot[]; lunches: MealSlot[] };
  const plannedDinners = (meals.dinners ?? []).filter(d => d.status === 'planned').length;
  const plannedLunches = (meals.lunches ?? []).filter(l => l.status === 'planned').length;

  if (plannedDinners === 0 && plannedLunches === 0) {
    agentNotices.push({
      type: 'suggestion',
      message: 'Ask Supermarket.ie to plan the meals you need this week',
      actionable: true,
      action: 'plan_dinners',
    });
  } else if (plannedDinners > 0 && plannedLunches === 0) {
    agentNotices.push({
      type: 'suggestion',
      message: 'Dinners are planned. Supermarket.ie can add lunches too if you need them.',
      actionable: true,
      action: 'plan_lunches',
    });
  }

  const shoppingList = (plan?.shopping_list ?? []) as ShoppingItem[];
  const shoppingTotal = shoppingList.reduce((sum, item) => sum + (item.price * (item.quantity ?? 1)), 0);
  const weeklyBudget = household?.weekly_budget ?? null;

  const response: WeeklyPlanState = {
    weekStart,
    meals,
    shoppingList,
    storeAssignment: plan?.store_assignment ?? null,
    budget: {
      target: weeklyBudget,
      current: Math.round(shoppingTotal * 100) / 100,
      onTrack: weeklyBudget ? shoppingTotal <= weeklyBudget : true,
    },
    agentNotices,
    status: plan?.status ?? 'empty',
  };

  return NextResponse.json(response);
}

export async function PATCH(req: NextRequest) {
  const subscriberId = subscriberFromRequest(req);
  if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const weekStart = getCurrentWeekStart();
  const body = await req.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.meals !== undefined) {
    updates.meals = body.meals;
    updates.status = computeStatus(body.meals);
  }
  if (body.shopping_list !== undefined) updates.shopping_list = body.shopping_list;
  if (body.store_assignment !== undefined) updates.store_assignment = body.store_assignment;
  if (body.status !== undefined) updates.status = body.status;

  const { data, error } = await supabaseAdmin
    .from('weekly_plans')
    .upsert(
      { subscriber_id: subscriberId, week_start: weekStart, ...updates },
      { onConflict: 'subscriber_id,week_start' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, plan: data });
}
