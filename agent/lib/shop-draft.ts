import { agentSupabase } from './supabase';
import { computeStoreTotals, type AgentListItem } from './shop';
import { getIngredientIntelligence } from './ingredient-intelligence';
import { loadHouseholdContext } from './household-context';
import { toEpicureName } from '../../src/lib/epicure-client';
import { findDietaryViolations } from '../../src/lib/list-validation';
import {
  appendShopSuggestions,
  prepareHouseholdShop,
  type CurrentCataloguePrice,
  type ShopDecision,
  type ShoppingHistoryItem,
} from '../../src/lib/shopping/prepare';

export type DraftConfidence = 'include' | 'suggest' | 'suppress';
export type DraftSource = 'history' | 'replenishment' | 'meal_plan' | 'ingredient_intelligence' | 'preference' | 'catalogue';
export type DraftDecision = ShopDecision;

type Meal = { day?: string; name?: string; ingredients?: Array<{ name: string; quantity?: string | null }> };
type Meals = { dinners?: Meal[]; lunches?: Meal[] };

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

export async function buildShopDraft(subscriberId: string) {
  const weekStart = currentWeekStart();
  const [{ data: historyData }, { data: planData }, { data: currentList }] = await Promise.all([
    agentSupabase
      .from('list_items')
      .select('canonical_name, category, store, price_paid, quantity, observed_at')
      .eq('subscriber_id', subscriberId)
      .order('observed_at', { ascending: false })
      .limit(500),
    agentSupabase
      .from('weekly_plans')
      .select('meals')
      .eq('subscriber_id', subscriberId)
      .eq('week_start', weekStart)
      .maybeSingle(),
    agentSupabase
      .from('saved_lists')
      .select('id, family_size, items')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const history = (historyData ?? []) as ShoppingHistoryItem[];
  const currentItems = ((currentList?.items ?? []) as AgentListItem[]).map(item => ({ ...item }));
  if (!history.length && !currentItems.length) return { ok: false as const, reason: 'no_history' };

  const household = await loadHouseholdContext(subscriberId, currentList?.family_size ?? '2');
  const candidateNames = [...new Set([
    ...history.map(row => row.canonical_name),
    ...currentItems.map(item => item.canonical_name),
  ])];

  const { data: priceData, error: priceError } = candidateNames.length
    ? await agentSupabase
        .from('latest_prices')
        .select('canonical_name, category, store, price, on_promotion, store_product_name')
        .in('canonical_name', candidateNames)
    : { data: [], error: null };

  if (priceError) throw new Error(`Unable to load current catalogue prices: ${priceError.message}`);

  let prepared = prepareHouseholdShop(
    {
      household,
      history,
      current_items: currentItems,
      catalogue_prices: (priceData ?? []) as CurrentCataloguePrice[],
    },
    {
      violatesDietary: (canonicalName, dietary) =>
        findDietaryViolations([{ canonical_name: canonicalName }], dietary).length > 0,
    },
  );

  const items: AgentListItem[] = prepared.basket.items
    .filter(item => item.selected_offer)
    .map(item => ({
      canonical_name: item.canonical_name,
      category: item.category ?? undefined,
      store: item.selected_offer!.retailer,
      price: item.selected_offer!.price,
      quantity: item.quantity,
      on_promotion: item.selected_offer!.on_promotion,
      store_product_name: item.selected_offer!.retailer_product_name,
    }));

  const meals = (planData?.meals ?? {}) as Meals;
  const plannedMeals = [...(meals.dinners ?? []), ...(meals.lunches ?? [])];
  const itemKeys = new Set(items.map(item => toEpicureName(item.canonical_name)));
  const completion = new Map<string, ShopDecision>();

  for (const meal of plannedMeals.slice(0, 6)) {
    const hero = [...new Set((meal.ingredients ?? []).map(item => toEpicureName(item.name)).filter(Boolean))].slice(0, 5);
    if (!hero.length) continue;

    const intel = await getIngredientIntelligence(
      hero,
      {
        dietary: household.dietary,
        dislikes: household.dislikes,
        preferred_stores: household.preferred_stores,
      },
      4,
      { allow_live_epicure: false },
    );

    for (const suggestion of intel.suggestions) {
      const product = suggestion.products[0];
      if (!product || itemKeys.has(toEpicureName(product.canonical_name))) continue;
      const existing = completion.get(product.canonical_name);
      const mealLabel = [meal.day, meal.name].filter(Boolean).join(' · ');
      if (existing) {
        existing.meal_count = (existing.meal_count ?? 1) + 1;
        existing.signals.push(`useful for ${mealLabel}`);
        continue;
      }
      completion.set(product.canonical_name, {
        canonical_name: product.canonical_name,
        action: 'suggested',
        confidence: 'suggest',
        reason: `${suggestion.ingredient} complements this week's planned meals but needs approval before being added.`,
        signals: ['meal completion', `useful for ${mealLabel}`, suggestion.signal_count > 1 ? 'ingredient reuse' : 'Epicure pairing'],
        sources: ['meal_plan', 'ingredient_intelligence', 'catalogue'],
        meal_count: 1,
        price: product.price,
        store: product.store,
        on_promotion: product.on_promotion,
      });
    }
  }

  prepared = appendShopSuggestions(
    prepared,
    [...completion.values()].sort((a, b) => (b.meal_count ?? 0) - (a.meal_count ?? 0)).slice(0, 6),
  );

  return {
    ok: true as const,
    family_size: currentList?.family_size ?? '2',
    items,
    store_totals: computeStoreTotals(items),
    decisions: prepared.decisions,
    suggestions: prepared.suggestions,
    suppressed: prepared.suppressed,
    week_start: weekStart,
  };
}
