import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { toEpicureName } from '../../src/lib/epicure-client';

type MealContext = {
  relevance: 'planned_ingredient' | 'complements_planned_meal';
  meals: string[];
  explanation: string;
};

type BriefingInsight =
  | {
      kind: 'promotion' | 'price_drop';
      canonical_name: string;
      store: string;
      price: number;
      saving: number;
      priority: number;
      meal_context?: MealContext;
    }
  | {
      kind: 'price_rise';
      canonical_name: string;
      store: string;
      price: number;
      increase: number;
      priority: number;
      meal_context?: MealContext;
    };

type PlannedIngredient = { name?: string };
type PlannedMeal = { day?: string; name?: string; ingredients?: PlannedIngredient[] };
type WeeklyMeals = { dinners?: PlannedMeal[]; lunches?: PlannedMeal[] };
type PairingRow = { canonical_name: string; epicure_key: string | null; bridges: string[] | null };

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function mealLabel(meal: PlannedMeal): string {
  return [meal.day, meal.name].filter(Boolean).join(' · ');
}

export default defineTool({
  description: 'Get the signed-in household’s most useful current shopping signals: meaningful price changes and promotions on products they actually buy, enriched with this week’s meal relevance when available. Use when the user asks what is worth knowing, what changed, or what they should buy this week.',
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const weekStart = currentWeekStart();

    const [{ data: history }, { data: weeklyPlan }] = await Promise.all([
      agentSupabase
        .from('list_items')
        .select('canonical_name, store, price_paid, observed_at')
        .eq('subscriber_id', subscriberId)
        .order('observed_at', { ascending: false })
        .limit(200),
      agentSupabase
        .from('weekly_plans')
        .select('meals')
        .eq('subscriber_id', subscriberId)
        .eq('week_start', weekStart)
        .maybeSingle(),
    ]);

    if (!history?.length) {
      return { quiet: true, summary: 'I need a little shopping history before I can give you a useful household briefing.', insights: [] };
    }

    const counts = new Map<string, number>();
    const last = new Map<string, { store: string; price: number }>();
    for (const row of history) {
      counts.set(row.canonical_name, (counts.get(row.canonical_name) ?? 0) + 1);
      if (!last.has(row.canonical_name)) {
        last.set(row.canonical_name, { store: row.store, price: Number(row.price_paid) });
      }
    }

    const names = [...last.keys()].slice(0, 40);
    const [{ data: prices }, { data: pairingRows }] = await Promise.all([
      agentSupabase
        .from('latest_prices')
        .select('canonical_name, store, price, was_price, on_promotion')
        .in('canonical_name', names),
      agentSupabase
        .from('product_pairings')
        .select('canonical_name, epicure_key, bridges')
        .eq('found', true)
        .in('canonical_name', names),
    ]);

    const best = new Map<string, { store: string; price: number; was_price: number | null; on_promotion: boolean }>();
    for (const row of prices ?? []) {
      const existing = best.get(row.canonical_name);
      if (!existing || Number(row.price) < existing.price) {
        best.set(row.canonical_name, {
          store: row.store,
          price: Number(row.price),
          was_price: row.was_price ? Number(row.was_price) : null,
          on_promotion: Boolean(row.on_promotion),
        });
      }
    }

    const mealIngredientMeals = new Map<string, string[]>();
    const meals = (weeklyPlan?.meals ?? {}) as WeeklyMeals;
    for (const meal of [...(meals.dinners ?? []), ...(meals.lunches ?? [])]) {
      const label = mealLabel(meal);
      for (const ingredient of meal.ingredients ?? []) {
        if (!ingredient.name) continue;
        const key = toEpicureName(ingredient.name);
        if (!key) continue;
        const labels = mealIngredientMeals.get(key) ?? [];
        if (label && !labels.includes(label)) labels.push(label);
        mealIngredientMeals.set(key, labels);
      }
    }

    const pairingsByName = new Map<string, PairingRow>();
    for (const row of (pairingRows ?? []) as PairingRow[]) {
      if (!pairingsByName.has(row.canonical_name)) pairingsByName.set(row.canonical_name, row);
    }

    function getMealContext(canonicalName: string): { context?: MealContext; bonus: number } {
      const pairing = pairingsByName.get(canonicalName);
      if (!pairing) return { bonus: 0 };
      const epicureKey = pairing.epicure_key ? toEpicureName(pairing.epicure_key) : '';
      if (epicureKey && mealIngredientMeals.has(epicureKey)) {
        const relevantMeals = mealIngredientMeals.get(epicureKey) ?? [];
        return {
          bonus: Math.min(18, 10 + relevantMeals.length * 2),
          context: {
            relevance: 'planned_ingredient',
            meals: relevantMeals.slice(0, 4),
            explanation: `${pairing.epicure_key} is already part of this week's saved meal plan.`,
          },
        };
      }

      const relatedMeals = new Set<string>();
      for (const bridge of pairing.bridges ?? []) {
        const labels = mealIngredientMeals.get(toEpicureName(bridge)) ?? [];
        for (const label of labels) relatedMeals.add(label);
      }
      if (relatedMeals.size > 0) {
        return {
          bonus: Math.min(10, 3 + relatedMeals.size * 2),
          context: {
            relevance: 'complements_planned_meal',
            meals: [...relatedMeals].slice(0, 4),
            explanation: `${pairing.epicure_key ?? canonicalName} has ingredient-pairing signals relevant to ${relatedMeals.size} planned meal${relatedMeals.size === 1 ? '' : 's'}.`,
          },
        };
      }
      return { bonus: 0 };
    }

    const insights: BriefingInsight[] = [];
    for (const name of names) {
      const previous = last.get(name);
      const current = best.get(name);
      if (!previous || !current) continue;

      const change = Number((current.price - previous.price).toFixed(2));
      const frequent = (counts.get(name) ?? 0) >= 2;
      const promoSaving = current.on_promotion && current.was_price
        ? Number((current.was_price - current.price).toFixed(2))
        : 0;
      const mealRelevance = getMealContext(name);

      if (frequent && promoSaving >= 0.75) {
        insights.push({
          kind: 'promotion',
          canonical_name: name,
          store: current.store,
          price: current.price,
          saving: promoSaving,
          priority: 80 + promoSaving + mealRelevance.bonus,
          ...(mealRelevance.context ? { meal_context: mealRelevance.context } : {}),
        });
        continue;
      }

      if (change <= -0.5) {
        insights.push({
          kind: 'price_drop',
          canonical_name: name,
          store: current.store,
          price: current.price,
          saving: Math.abs(change),
          priority: (frequent ? 60 : 40) + Math.abs(change) + mealRelevance.bonus,
          ...(mealRelevance.context ? { meal_context: mealRelevance.context } : {}),
        });
        continue;
      }

      if (frequent && change >= 1) {
        insights.push({
          kind: 'price_rise',
          canonical_name: name,
          store: current.store,
          price: current.price,
          increase: change,
          priority: 35 + change,
          ...(mealRelevance.context ? { meal_context: mealRelevance.context } : {}),
        });
      }
    }

    insights.sort((a, b) => b.priority - a.priority);
    const topInsights = insights.slice(0, 3);

    return {
      quiet: topInsights.length === 0,
      summary: topInsights.length
        ? `${topInsights.length} things are worth knowing about this household’s shop.`
        : 'Nothing important has changed in the household’s usual shop.',
      insights: topInsights,
      guidance: 'When meal_context is present, explain why the price or promotion matters to this household rather than presenting it as a generic deal.',
    };
  },
});
