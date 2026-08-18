import { getPairings, toEpicureName } from '../../src/lib/epicure-client';
import { findDietaryViolations } from '../../src/lib/list-validation';
import { resolveCatalogueProduct, type CatalogueCandidate } from './catalogue';
import { agentSupabase } from './supabase';

export type HouseholdIngredientContext = {
  dietary?: string[] | null;
  dislikes?: string | null;
  preferred_stores?: string[] | null;
};

export type GroundedIngredient = {
  ingredient: string;
  canonical_name: string;
  category: string | null;
  store: string | null;
  price: number | null;
  on_promotion: boolean;
  source: 'product_pairings' | 'catalogue_search';
  confidence: 'high' | 'medium';
};

type PairingRow = {
  canonical_name: string;
  epicure_key: string | null;
  bridges: string[] | null;
  primaries: string[] | null;
};

type PriceRow = {
  canonical_name: string;
  category: string | null;
  store: string;
  price: number;
  on_promotion: boolean | null;
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function disliked(name: string, dislikes?: string | null): boolean {
  if (!dislikes?.trim()) return false;
  const haystack = normalise(name);
  return dislikes
    .split(/[,;\n]/)
    .map(value => normalise(value))
    .filter(value => value.length >= 2)
    .some(value => haystack.includes(value) || value.includes(haystack));
}

function allowedByDiet(canonicalName: string, dietary?: string[] | null): boolean {
  return findDietaryViolations([{ canonical_name: canonicalName }], dietary ?? []).length === 0;
}

function choosePrice(rows: PriceRow[], preferredStores?: string[] | null): PriceRow | null {
  if (rows.length === 0) return null;
  const preferred = new Set((preferredStores ?? []).map(store => normalise(store)).filter(store => store !== 'all'));
  const eligible = preferred.size > 0
    ? rows.filter(row => preferred.has(normalise(row.store)))
    : rows;
  const pool = eligible.length > 0 ? eligible : rows;
  return [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0] ?? null;
}

async function pairingMappedProducts(ingredient: string): Promise<PairingRow[]> {
  const epicureKey = toEpicureName(ingredient);
  if (!epicureKey) return [];

  const { data, error } = await agentSupabase
    .from('product_pairings')
    .select('canonical_name, epicure_key, bridges, primaries')
    .eq('found', true)
    .ilike('epicure_key', epicureKey)
    .limit(12);

  if (error) throw new Error(`Ingredient mapping lookup failed: ${error.message}`);
  return (data ?? []) as PairingRow[];
}

async function priceMappedProducts(rows: PairingRow[], context: HouseholdIngredientContext): Promise<GroundedIngredient[]> {
  const canonicalNames = [...new Set(rows.map(row => row.canonical_name))];
  if (canonicalNames.length === 0) return [];

  const { data, error } = await agentSupabase
    .from('latest_prices')
    .select('canonical_name, category, store, price, on_promotion')
    .in('canonical_name', canonicalNames);

  if (error) throw new Error(`Ingredient price grounding failed: ${error.message}`);
  const prices = (data ?? []) as PriceRow[];

  const grounded: GroundedIngredient[] = [];
  for (const row of rows) {
    if (!allowedByDiet(row.canonical_name, context.dietary) || disliked(row.canonical_name, context.dislikes)) continue;
    const best = choosePrice(prices.filter(price => price.canonical_name === row.canonical_name), context.preferred_stores);
    if (!best) continue;
    grounded.push({
      ingredient: row.epicure_key ?? row.canonical_name,
      canonical_name: row.canonical_name,
      category: best.category,
      store: best.store,
      price: Number(best.price),
      on_promotion: Boolean(best.on_promotion),
      source: 'product_pairings',
      confidence: 'high',
    });
  }
  return grounded;
}

function candidateToGrounded(ingredient: string, candidate: CatalogueCandidate): GroundedIngredient {
  return {
    ingredient,
    canonical_name: candidate.canonical_name,
    category: candidate.category,
    store: candidate.best_store,
    price: candidate.best_price,
    on_promotion: candidate.on_promotion,
    source: 'catalogue_search',
    confidence: candidate.score >= 8 ? 'high' : 'medium',
  };
}

export async function groundIngredient(
  ingredient: string,
  context: HouseholdIngredientContext = {},
  limit = 3,
): Promise<GroundedIngredient[]> {
  const mapped = await pairingMappedProducts(ingredient);
  const mappedGrounded = await priceMappedProducts(mapped, context);
  if (mappedGrounded.length > 0) return mappedGrounded.slice(0, limit);

  const catalogue = await resolveCatalogueProduct(ingredient, Math.max(limit * 2, 5));
  return catalogue
    .filter(candidate => allowedByDiet(candidate.canonical_name, context.dietary))
    .filter(candidate => !disliked(candidate.canonical_name, context.dislikes))
    .map(candidate => candidateToGrounded(ingredient, candidate))
    .slice(0, limit);
}

export type IngredientSuggestion = {
  ingredient: string;
  signal_count: number;
  products: GroundedIngredient[];
  explanation: string;
};

export type IngredientIntelligenceResult = {
  source: 'precomputed' | 'live_epicure' | 'unavailable';
  input_ingredients: string[];
  suggestions: IngredientSuggestion[];
  unresolved: string[];
};

export type IngredientIntelligenceOptions = {
  allow_live_epicure?: boolean;
};

export async function getIngredientIntelligence(
  ingredients: string[],
  context: HouseholdIngredientContext = {},
  limit = 8,
  options: IngredientIntelligenceOptions = {},
): Promise<IngredientIntelligenceResult> {
  const cleanIngredients = [...new Set(ingredients.map(toEpicureName).filter(Boolean))].slice(0, 6);
  if (cleanIngredients.length === 0) {
    return { source: 'unavailable', input_ingredients: [], suggestions: [], unresolved: ingredients };
  }

  const { data, error } = await agentSupabase
    .from('product_pairings')
    .select('canonical_name, epicure_key, bridges, primaries')
    .eq('found', true)
    .in('epicure_key', cleanIngredients)
    .limit(60);

  if (error) throw new Error(`Pairing intelligence lookup failed: ${error.message}`);
  const rows = (data ?? []) as PairingRow[];

  const signalCounts = new Map<string, number>();
  for (const row of rows) {
    for (const bridge of row.bridges ?? []) {
      const key = toEpicureName(bridge);
      if (!key || cleanIngredients.includes(key)) continue;
      signalCounts.set(key, (signalCounts.get(key) ?? 0) + 1);
    }
  }

  let source: IngredientIntelligenceResult['source'] = rows.length > 0 ? 'precomputed' : 'unavailable';
  const allowLiveEpicure = options.allow_live_epicure ?? true;
  if (signalCounts.size === 0 && allowLiveEpicure) {
    const live = await getPairings(cleanIngredients);
    if (live?.bridges?.length) {
      source = 'live_epicure';
      for (const bridge of live.bridges) {
        const key = toEpicureName(bridge);
        if (!key || cleanIngredients.includes(key)) continue;
        signalCounts.set(key, (signalCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const ranked = [...signalCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(limit * 2, 12));

  const suggestions: IngredientSuggestion[] = [];
  const unresolved: string[] = [];
  for (const [ingredient, signalCount] of ranked) {
    const products = await groundIngredient(ingredient, context, 2);
    if (products.length === 0) {
      unresolved.push(ingredient);
      continue;
    }
    suggestions.push({
      ingredient,
      signal_count: signalCount,
      products,
      explanation: signalCount > 1
        ? `${ingredient} connects with more than one ingredient already in the meal context, so it may be useful across multiple dishes.`
        : `${ingredient} is a complementary ingredient supported by recipe co-occurrence data.`,
    });
    if (suggestions.length >= limit) break;
  }

  return {
    source: suggestions.length > 0 ? source : 'unavailable',
    input_ingredients: cleanIngredients,
    suggestions,
    unresolved,
  };
}
