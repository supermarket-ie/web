import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { getSubstitutes as getEpicureSubstitutes } from '../../src/lib/epicure-client';
import { findDietaryViolations } from '../../src/lib/list-validation';
import { getCurrentProductSnapshot } from '../lib/catalogue';
import { groundIngredient } from '../lib/ingredient-intelligence';

type PairingRow = {
  canonical_name: string;
  epicure_key: string | null;
  bridges: string[] | null;
};

type PriceRow = {
  canonical_name: string;
  store: string;
  price: number;
  on_promotion: boolean | null;
};

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isDisliked(name: string, dislikes?: string | null): boolean {
  if (!dislikes?.trim()) return false;
  const haystack = normalise(name);
  return dislikes
    .split(/[,;\n]/)
    .map(value => normalise(value))
    .filter(value => value.length >= 2)
    .some(value => haystack.includes(value) || value.includes(haystack));
}

function chooseBestPrice(rows: PriceRow[], preferredStores: string[]): PriceRow | null {
  if (rows.length === 0) return null;
  const preferred = new Set(preferredStores.map(normalise).filter(store => store !== 'all'));
  const preferredRows = preferred.size > 0 ? rows.filter(row => preferred.has(normalise(row.store))) : [];
  const pool = preferredRows.length > 0 ? preferredRows : rows;
  return [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0] ?? null;
}

export default defineTool({
  description: 'Find catalogue-grounded functional substitute candidates for an exact product. Combines recipe/ingredient similarity, household dietary requirements and dislikes, current prices, promotions and preferred-store context. Use before replacing an item when the user asks for something cheaper, similar or a better alternative.',
  inputSchema: z.object({
    canonical_name: z.string().min(2).describe('Exact canonical product name to find alternatives for.'),
    limit: z.number().int().min(1).max(8).default(5),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const [{ data: household, error: householdError }, sourceSnapshot] = await Promise.all([
      agentSupabase
        .from('households')
        .select('dietary, dislikes, preferred_stores')
        .eq('subscriber_id', subscriberId)
        .maybeSingle(),
      getCurrentProductSnapshot(input.canonical_name),
    ]);

    if (householdError) throw new Error(`Unable to load household substitution context: ${householdError.message}`);

    const dietary = (household?.dietary as string[] | null) ?? [];
    const dislikes = (household?.dislikes as string | null) ?? null;
    const preferredStores = (household?.preferred_stores as string[] | null) ?? [];

    const { data: targetRows, error: targetError } = await agentSupabase
      .from('product_pairings')
      .select('canonical_name, epicure_key, bridges')
      .eq('canonical_name', input.canonical_name)
      .eq('found', true)
      .limit(1);

    if (targetError) throw new Error(`Unable to load substitution intelligence: ${targetError.message}`);
    const target = (targetRows?.[0] ?? null) as PairingRow | null;

    const candidatesByName = new Map<string, {
      canonical_name: string;
      ingredient: string | null;
      similarity_signals: number;
      source: 'precomputed' | 'live_epicure';
    }>();

    if (target?.bridges?.length) {
      const targetBridges = new Set(target.bridges);
      const { data: candidates, error: candidateError } = await agentSupabase
        .from('product_pairings')
        .select('canonical_name, epicure_key, bridges')
        .eq('found', true)
        .neq('canonical_name', input.canonical_name)
        .limit(300);

      if (candidateError) throw new Error(`Unable to find substitute candidates: ${candidateError.message}`);

      for (const candidate of (candidates ?? []) as PairingRow[]) {
        if (findDietaryViolations([{ canonical_name: candidate.canonical_name }], dietary).length > 0) continue;
        if (isDisliked(candidate.canonical_name, dislikes)) continue;
        const overlap = (candidate.bridges ?? []).filter(bridge => targetBridges.has(bridge)).length;
        if (overlap <= 0) continue;
        const existing = candidatesByName.get(candidate.canonical_name);
        if (!existing || overlap > existing.similarity_signals) {
          candidatesByName.set(candidate.canonical_name, {
            canonical_name: candidate.canonical_name,
            ingredient: candidate.epicure_key,
            similarity_signals: overlap,
            source: 'precomputed',
          });
        }
      }
    }

    // Live Epicure is a bounded fallback/enrichment path, not a hard dependency.
    if (candidatesByName.size < input.limit) {
      const live = await getEpicureSubstitutes(target?.epicure_key ?? input.canonical_name, 8);
      for (const substitute of live?.substitutes ?? []) {
        const grounded = await groundIngredient(substitute.name, {
          dietary,
          dislikes,
          preferred_stores: preferredStores,
        }, 2);
        for (const product of grounded) {
          if (product.canonical_name === input.canonical_name || candidatesByName.has(product.canonical_name)) continue;
          candidatesByName.set(product.canonical_name, {
            canonical_name: product.canonical_name,
            ingredient: substitute.name,
            similarity_signals: Math.max(1, Math.round(substitute.similarity * 10)),
            source: 'live_epicure',
          });
        }
        if (candidatesByName.size >= Math.max(input.limit * 2, 10)) break;
      }
    }

    const ranked = [...candidatesByName.values()]
      .sort((a, b) => b.similarity_signals - a.similarity_signals)
      .slice(0, 30);

    if (ranked.length === 0) {
      return {
        ok: false,
        reason: 'no_substitutes',
        message: 'I could not find a sufficiently grounded substitute that fits this household.',
      };
    }

    const names = ranked.map(row => row.canonical_name);
    const { data: priceRows, error: pricesError } = await agentSupabase
      .from('latest_prices')
      .select('canonical_name, store, price, on_promotion')
      .in('canonical_name', names);

    if (pricesError) throw new Error(`Unable to price substitute candidates: ${pricesError.message}`);
    const prices = (priceRows ?? []) as PriceRow[];

    const sourcePrice = sourceSnapshot?.best_price ?? null;
    const substitutes = ranked
      .map(candidate => {
        const best = chooseBestPrice(
          prices.filter(row => row.canonical_name === candidate.canonical_name),
          preferredStores,
        );
        if (!best) return null;
        const price = Number(best.price);
        return {
          canonical_name: candidate.canonical_name,
          ingredient_role: candidate.ingredient,
          similarity_signals: candidate.similarity_signals,
          intelligence_source: candidate.source,
          store: best.store,
          price,
          on_promotion: Boolean(best.on_promotion),
          saving_vs_source_best: sourcePrice == null ? null : Number((sourcePrice - price).toFixed(2)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => {
        if (a.similarity_signals !== b.similarity_signals) return b.similarity_signals - a.similarity_signals;
        return a.price - b.price;
      })
      .slice(0, input.limit);

    return {
      ok: substitutes.length > 0,
      source_product: input.canonical_name,
      source_best_price: sourcePrice,
      household_constraints_applied: {
        dietary,
        dislikes: dislikes ?? null,
        preferred_stores: preferredStores,
      },
      substitutes,
      guidance: 'Similarity is one signal only. Prefer a substitute that serves the same meal function, fits the household and offers a useful price or promotion advantage; do not replace automatically when function is ambiguous.',
    };
  },
});
