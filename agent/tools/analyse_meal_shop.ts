import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { loadCurrentShop } from '../lib/shop';
import { getIngredientIntelligence } from '../lib/ingredient-intelligence';
import { toEpicureName } from '../../src/lib/epicure-client';

type PlannedIngredient = {
  name: string;
  quantity?: string | null;
};

type PlannedMeal = {
  day?: string;
  name?: string;
  ingredients?: PlannedIngredient[];
};

type WeeklyMeals = {
  dinners?: PlannedMeal[];
  lunches?: PlannedMeal[];
};

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function compactIngredients(meal: PlannedMeal): string[] {
  return [...new Set((meal.ingredients ?? [])
    .map(item => toEpicureName(item.name))
    .filter(Boolean))]
    .slice(0, 5);
}

export default defineTool({
  description: `Analyse the current household shop against this week's saved meal plan. Identifies planned ingredients already covered by the shop, likely missing catalogue-grounded complementary components, and ingredients that could be useful across more than one meal. Use when the user asks whether the shop covers the meal plan, what is missing, how to reduce meal-shopping waste, or whether the planned shop can be improved. This tool never edits the shop. Missing items are suggestions only and uncertain additions require user approval.`,
  inputSchema: z.object({
    kind: z.enum(['dinners', 'lunches', 'all']).default('all'),
    max_suggestions: z.number().int().min(1).max(10).default(6),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const weekStart = currentWeekStart();

    const [{ data: weeklyPlan, error: planError }, { data: household, error: householdError }, shop] = await Promise.all([
      agentSupabase
        .from('weekly_plans')
        .select('meals')
        .eq('subscriber_id', subscriberId)
        .eq('week_start', weekStart)
        .maybeSingle(),
      agentSupabase
        .from('households')
        .select('dietary, dislikes, preferred_stores')
        .eq('subscriber_id', subscriberId)
        .maybeSingle(),
      loadCurrentShop(subscriberId),
    ]);

    if (planError) throw new Error(`Unable to load this week's meal plan: ${planError.message}`);
    if (householdError) throw new Error(`Unable to load household context: ${householdError.message}`);
    if (!weeklyPlan?.meals) {
      return { ok: false, reason: 'no_meal_plan', message: 'There is no saved meal plan for this week yet.' };
    }
    if (!shop) {
      return { ok: false, reason: 'no_current_shop', message: 'There is no current shop to compare with the meal plan yet.' };
    }

    const meals = weeklyPlan.meals as WeeklyMeals;
    const selectedMeals: PlannedMeal[] = input.kind === 'dinners'
      ? (meals.dinners ?? [])
      : input.kind === 'lunches'
        ? (meals.lunches ?? [])
        : [...(meals.dinners ?? []), ...(meals.lunches ?? [])];

    if (selectedMeals.length === 0) {
      return { ok: false, reason: 'no_meals_for_kind', message: `There are no saved ${input.kind === 'all' ? 'meals' : input.kind} to analyse.` };
    }

    const shopKeys = new Set(shop.items.map(item => toEpicureName(item.canonical_name)).filter(Boolean));
    const plannedUsage = new Map<string, { count: number; meals: string[] }>();

    for (const meal of selectedMeals) {
      for (const ingredient of compactIngredients(meal)) {
        const current = plannedUsage.get(ingredient) ?? { count: 0, meals: [] };
        current.count += 1;
        const label = [meal.day, meal.name].filter(Boolean).join(' · ');
        if (label && !current.meals.includes(label)) current.meals.push(label);
        plannedUsage.set(ingredient, current);
      }
    }

    const covered = [...plannedUsage.entries()]
      .filter(([ingredient]) => shopKeys.has(ingredient))
      .map(([ingredient, usage]) => ({ ingredient, meal_count: usage.count, meals: usage.meals }));

    const plannedButNotExact = [...plannedUsage.entries()]
      .filter(([ingredient]) => !shopKeys.has(ingredient))
      .map(([ingredient, usage]) => ({ ingredient, meal_count: usage.count, meals: usage.meals }))
      .sort((a, b) => b.meal_count - a.meal_count || a.ingredient.localeCompare(b.ingredient));

    const context = {
      dietary: (household?.dietary as string[] | null) ?? [],
      dislikes: (household?.dislikes as string | null) ?? null,
      preferred_stores: (household?.preferred_stores as string[] | null) ?? [],
    };

    const completionSignals = new Map<string, {
      canonical_name: string;
      ingredient: string;
      store: string | null;
      price: number | null;
      on_promotion: boolean;
      signal_count: number;
      meals: string[];
    }>();

    // Analyse meal-by-meal so a component repeatedly useful across different meals
    // gains confidence. Keep calls bounded to the first 6 planned meals.
    for (const meal of selectedMeals.slice(0, 6)) {
      const heroIngredients = compactIngredients(meal);
      if (heroIngredients.length < 1) continue;

      const intelligence = await getIngredientIntelligence(heroIngredients, context, 4);
      for (const suggestion of intelligence.suggestions) {
        const product = suggestion.products[0];
        if (!product) continue;
        const productKey = toEpicureName(product.canonical_name);
        if (shopKeys.has(productKey)) continue;

        const existing = completionSignals.get(product.canonical_name) ?? {
          canonical_name: product.canonical_name,
          ingredient: suggestion.ingredient,
          store: product.store,
          price: product.price,
          on_promotion: product.on_promotion,
          signal_count: 0,
          meals: [],
        };
        existing.signal_count += Math.max(1, suggestion.signal_count);
        const mealLabel = [meal.day, meal.name].filter(Boolean).join(' · ');
        if (mealLabel && !existing.meals.includes(mealLabel)) existing.meals.push(mealLabel);
        completionSignals.set(product.canonical_name, existing);
      }
    }

    const missing_candidates = [...completionSignals.values()]
      .sort((a, b) => b.meals.length - a.meals.length || b.signal_count - a.signal_count || Number(a.price ?? Infinity) - Number(b.price ?? Infinity))
      .slice(0, input.max_suggestions)
      .map(item => ({
        ...item,
        confidence: item.meals.length >= 2 || item.signal_count >= 2 ? 'higher' : 'candidate',
        reason: item.meals.length >= 2
          ? `${item.ingredient} is useful across ${item.meals.length} planned meals and is not currently represented in the shop.`
          : `${item.ingredient} complements a planned meal and is not currently represented in the shop.`,
      }));

    const reuse_opportunities = [...plannedUsage.entries()]
      .filter(([, usage]) => usage.count > 1)
      .map(([ingredient, usage]) => ({
        ingredient,
        meal_count: usage.count,
        meals: usage.meals,
        in_current_shop: shopKeys.has(ingredient),
      }))
      .sort((a, b) => b.meal_count - a.meal_count || a.ingredient.localeCompare(b.ingredient));

    return {
      ok: true,
      week_start: weekStart,
      meal_count: selectedMeals.length,
      shop_item_count: shop.items.length,
      covered_planned_ingredients: covered,
      planned_ingredients_without_exact_shop_match: plannedButNotExact,
      reuse_opportunities,
      missing_candidates,
      guidance: [
        'Do not describe planned_ingredients_without_exact_shop_match as definitely missing: the shop may contain a differently named product serving the same role.',
        'Prefer missing_candidates supported by more than one meal or more than one pairing signal.',
        'Ask before adding uncertain missing components to the shop.',
        'Explain cross-meal reuse when recommending an addition.',
      ],
    };
  },
});
