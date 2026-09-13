import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { resolveCatalogueProduct } from '../lib/catalogue';
import { consumeExpensiveTool } from '../lib/turn-budget';

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export default defineTool({
  description: 'Resolve a natural-language product request against the current Supermarket.ie catalogue. Returns several strong candidate products with current retailer prices so the agent can infer ordinary shopper intent instead of blindly treating the first catalogue match as the requested SKU. Do not repeat this lookup for the same product wording in one turn; use the returned alternatives.',
  inputSchema: z.object({
    productQuery: z.string().min(2),
  }),
  async execute({ productQuery }) {
    const budget = consumeExpensiveTool('get_current_price');
    if (!budget.allowed) return { found: false, query: productQuery, resolution: 'budget_exhausted' as const, matches: [], guidance: budget.message };

    // The catalogue resolver already returns current retailer offers for every
    // candidate. The previous implementation issued another latest_prices query
    // per candidate (up to 8 extra queries) and duplicated those offers in the
    // model context. Keep one bounded catalogue query per product request.
    const candidates = await resolveCatalogueProduct(productQuery, 6);
    if (candidates.length === 0) {
      return {
        found: false,
        query: productQuery,
        resolution: 'none' as const,
        matches: [],
      };
    }

    const matches = candidates.map((candidate, index) => ({
      rank: index + 1,
      canonical_product_id: candidate.canonical_product_id,
      canonical_name: candidate.canonical_name,
      category: candidate.category,
      relevance_score: candidate.score,
      best_price: candidate.best_price,
      best_store: candidate.best_store,
      on_promotion: candidate.on_promotion,
      stores: candidate.stores,
    }));

    const queryNorm = normalise(productQuery);
    const top = candidates[0];
    const second = candidates[1];
    const exactCanonicalMatch = normalise(top.canonical_name) === queryNorm;
    const scoreGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;
    const clearSingleMatch = exactCanonicalMatch || !second || scoreGap >= 8;

    return {
      found: true,
      query: productQuery,
      resolution: clearSingleMatch ? 'single' as const : 'product_family' as const,
      exact_canonical_match: exactCanonicalMatch,
      top_score_gap: Number.isFinite(scoreGap) ? scoreGap : null,
      guidance: clearSingleMatch
        ? 'The leading catalogue product is sufficiently distinct to answer as a single product.'
        : 'The wording plausibly refers to several variants. Use these matches; do not repeat the lookup unless the shopper materially changes the request.',
      matches,
      canonical_product_id: clearSingleMatch ? top.canonical_product_id : null,
      canonical_name: clearSingleMatch ? top.canonical_name : null,
    };
  },
  toModelOutput(output) {
    if (!output.found) return { type: 'json', value: output };
    return {
      type: 'json',
      value: {
        found: true,
        query: output.query,
        resolution: output.resolution,
        exact_canonical_match: output.exact_canonical_match,
        guidance: output.guidance,
        canonical_product_id: output.canonical_product_id,
        canonical_name: output.canonical_name,
        matches: output.matches.slice(0, 5).map(match => ({
          rank: match.rank,
          canonical_product_id: match.canonical_product_id,
          canonical_name: match.canonical_name,
          category: match.category,
          best_price: match.best_price,
          best_store: match.best_store,
          on_promotion: match.on_promotion,
          stores: match.stores.slice(0, 3).map(store => ({ store: store.store, price: store.price, on_promotion: store.on_promotion })),
        })),
      },
    };
  },
});
