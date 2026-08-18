import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

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

export default defineTool({
  description: 'Find catalogue-grounded substitute candidates for an exact canonical product using Supermarket.ie flavour/co-occurrence intelligence, then attach each candidate’s current best price. Use before replacing an item when the user asks for something cheaper, similar, or an alternative.',
  inputSchema: z.object({
    canonical_name: z.string().min(2).describe('Exact canonical product name to find alternatives for.'),
    limit: z.number().int().min(1).max(8).default(5),
  }),
  async execute(input, ctx) {
    requireSubscriber(ctx);

    const { data: targetRows, error: targetError } = await agentSupabase
      .from('product_pairings')
      .select('canonical_name, epicure_key, bridges')
      .eq('canonical_name', input.canonical_name)
      .eq('found', true)
      .limit(1);

    if (targetError) throw new Error(`Unable to load substitution intelligence: ${targetError.message}`);
    const target = (targetRows?.[0] ?? null) as PairingRow | null;
    if (!target || !target.bridges?.length) {
      return { ok: false, reason: 'no_substitution_model', message: 'I do not have reliable substitution data for that exact product yet.' };
    }

    const targetBridges = new Set(target.bridges);
    const { data: candidates, error: candidateError } = await agentSupabase
      .from('product_pairings')
      .select('canonical_name, epicure_key, bridges')
      .eq('found', true)
      .neq('canonical_name', input.canonical_name)
      .limit(250);

    if (candidateError) throw new Error(`Unable to find substitute candidates: ${candidateError.message}`);

    const scored = ((candidates ?? []) as PairingRow[])
      .map(candidate => {
        const overlap = (candidate.bridges ?? []).filter(bridge => targetBridges.has(bridge)).length;
        return { candidate, overlap };
      })
      .filter(row => row.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 20);

    if (scored.length === 0) {
      return { ok: false, reason: 'no_substitutes', message: 'I could not find a strong catalogue substitute for that product.' };
    }

    const names = scored.map(row => row.candidate.canonical_name);
    const { data: priceRows, error: pricesError } = await agentSupabase
      .from('latest_prices')
      .select('canonical_name, store, price, on_promotion')
      .in('canonical_name', names);

    if (pricesError) throw new Error(`Unable to price substitute candidates: ${pricesError.message}`);

    const bestPrice = new Map<string, PriceRow>();
    for (const row of (priceRows ?? []) as PriceRow[]) {
      const existing = bestPrice.get(row.canonical_name);
      if (!existing || Number(row.price) < Number(existing.price)) bestPrice.set(row.canonical_name, row);
    }

    const substitutes = scored
      .map(({ candidate, overlap }) => {
        const best = bestPrice.get(candidate.canonical_name);
        if (!best) return null;
        return {
          canonical_name: candidate.canonical_name,
          similarity_signals: overlap,
          store: best.store,
          price: Number(best.price),
          on_promotion: Boolean(best.on_promotion),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .slice(0, input.limit);

    return {
      ok: substitutes.length > 0,
      source_product: input.canonical_name,
      substitutes,
    };
  },
});
