import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { supabaseAdmin } from '@/lib/supabase';
import { getAllLatestPrices } from '@/lib/price-data';
import { getSubscriberId } from '@/lib/auth';
import type { MealSlot } from '@/app/api/plan/weekly/route';

export const maxDuration = 60;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

function parseMealSlots(text: string, type: string): MealSlot[] {
  const slots: MealSlot[] = [];
  const lines = text.split('\n');
  let current: Partial<MealSlot> | null = null;

  function flush() {
    if (current?.day) {
      slots.push({
        day: current.day,
        name: current.name ?? null,
        description: current.description,
        ingredients: current.ingredients ?? [],
        estimatedCost: current.estimatedCost ?? null,
        status: 'planned',
      });
    }
    current = null;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('---') || line.toLowerCase().includes('shopping list')) {
      flush();
      break;
    }

    const dayMatch = line.match(/^\*\*(\w+):\*\*\s*(.+)$/);
    if (dayMatch && DAYS.includes(dayMatch[1])) {
      flush();
      current = { day: dayMatch[1], name: dayMatch[2].trim(), ingredients: [] };
      continue;
    }
    if (!current) continue;

    if (line.toLowerCase().startsWith('key ingredients:')) {
      current.ingredients = line.slice('key ingredients:'.length).split(',').map(p => ({
        name: p.trim().replace(/\s*\(.*?\)/g, '').replace(/\*+/g, '').trim(),
      })).filter(i => i.name.length > 0);
      continue;
    }

    const costMatch = line.match(/est\.?\s*cost:?\s*€?([\d.]+)/i);
    if (costMatch) {
      current.estimatedCost = parseFloat(costMatch[1]);
      continue;
    }

    if (line && !current.description && !line.startsWith('**') && !line.startsWith('*') && !line.startsWith('-')) {
      current.description = line;
    }
  }

  flush();
  return type === 'lunches' ? slots.slice(0, 5) : slots.slice(0, 7);
}

async function getWeeklyData() {
  const all = await getAllLatestPrices();
  const best = new Map<string, typeof all[number]>();
  for (const item of all) {
    const existing = best.get(item.canonical_name);
    if (!existing || item.price < existing.price) best.set(item.canonical_name, item);
  }

  const bestList = [...best.values()];
  const promotions = bestList
    .filter(p => p.on_promotion)
    .sort((a, b) => a.price - b.price)
    .slice(0, 30);
  const cheapest = bestList.sort((a, b) => a.price - b.price).slice(0, 90);
  return { cheapest, promotions };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { token?: unknown; config?: { type?: string; days?: number; preferences?: string } };
    const explicit = typeof body.token === 'string' && body.token !== '__cookie__' ? body.token : null;
    const token = req.cookies.get('sm_session')?.value ?? explicit;
    const subscriberId = getSubscriberId(token);
    if (!subscriberId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { data: household } = await supabaseAdmin
      .from('households')
      .select('*')
      .eq('subscriber_id', subscriberId)
      .single();

    const agentType = body.config?.type === 'lunches' ? 'lunches' : 'dinners';
    const days = Math.max(1, Math.min(Number(body.config?.days ?? (agentType === 'lunches' ? 5 : 7)), agentType === 'lunches' ? 5 : 7));
    const preferences = typeof body.config?.preferences === 'string' ? body.config.preferences.slice(0, 500) : '';

    const { cheapest, promotions } = await getWeeklyData();
    const promoSummary = promotions.map(p => `${p.canonical_name} — ${p.store} €${p.price.toFixed(2)}${p.was_price ? ` (was €${p.was_price.toFixed(2)})` : ''}`).join('\n');
    const cheapSummary = cheapest.map(p => `${p.canonical_name} (${p.category}) — ${p.store} €${p.price.toFixed(2)}`).join('\n');

    const adults = household?.adults ?? 2;
    const children = household?.children ?? 0;
    const dietary = Array.isArray(household?.dietary) ? household.dietary.join(', ') : 'none';
    const dislikes = household?.dislikes ?? 'none';
    const budget = household?.weekly_budget ? `€${household.weekly_budget}` : 'not specified';
    const householdDesc = `${adults} adult${adults === 1 ? '' : 's'}${children ? ` and ${children} child${children === 1 ? '' : 'ren'}` : ''}`;

    const mealLabel = agentType === 'lunches' ? 'lunch' : 'dinner';
    const prompt = `You are supermarket.ie, an Irish grocery planning agent. Create a practical ${days}-${mealLabel} weekly plan for a ${householdDesc}.

Household:
- Dietary requirements: ${dietary}
- Dislikes: ${dislikes}
- Weekly budget: ${budget}
${preferences ? `- Preferences: ${preferences}` : ''}

Current promotions:
${promoSummary || 'No promotions available'}

Current low-price ingredients:
${cheapSummary}

Rules:
- Use only products present in the supplied current-price data.
- Respect dietary requirements absolutely.
- Reuse ingredients across meals to reduce waste.
- Prefer promoted and lower-cost ingredients without sacrificing a coherent meal.
- Keep meals realistic for Irish households and normal home cooking.
- Show key ingredients with store and price and an estimated cost for each meal.

Format each meal exactly as:
**Monday:** Meal name
Short description
Key ingredients: Item (€X, store), Item (€X, store)
*Est. cost: €X.XX*

Then add a shopping list and estimated total.`;

    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt,
      maxOutputTokens: 2000,
    });

    const agentKey = agentType === 'lunches' ? 'lunch_planner' : 'meal_planner';
    await supabaseAdmin.from('user_agents').upsert({
      subscriber_id: subscriberId,
      agent_type: agentKey,
      config: body.config ?? {},
      enabled: true,
      last_run: new Date().toISOString(),
      last_output: text,
    }, { onConflict: 'subscriber_id,agent_type' });

    const parsedSlots = parseMealSlots(text, agentType);
    const weekStart = getCurrentWeekStart();
    const { data: existing } = await supabaseAdmin
      .from('weekly_plans')
      .select('meals')
      .eq('subscriber_id', subscriberId)
      .eq('week_start', weekStart)
      .maybeSingle();

    const existingMeals = (existing?.meals ?? { dinners: [], lunches: [] }) as { dinners: MealSlot[]; lunches: MealSlot[] };
    const updatedMeals = agentType === 'lunches'
      ? { dinners: existingMeals.dinners ?? [], lunches: parsedSlots }
      : { dinners: parsedSlots, lunches: existingMeals.lunches ?? [] };
    const planned = [...updatedMeals.dinners, ...updatedMeals.lunches].filter(m => m.status === 'planned').length;

    await supabaseAdmin.from('weekly_plans').upsert({
      subscriber_id: subscriberId,
      week_start: weekStart,
      meals: updatedMeals,
      status: planned === 0 ? 'empty' : 'partial',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'subscriber_id,week_start' });

    return NextResponse.json({ plan: text, meals: parsedSlots });
  } catch (error) {
    console.error('[meal-plan] error:', error);
    return NextResponse.json({ error: 'Unable to generate meal plan' }, { status: 500 });
  }
}
