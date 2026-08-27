import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getCurrentProductSnapshot, resolveCatalogueProduct } from '../lib/catalogue';

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export default defineTool({
  description: 'Resolve a natural-language product request against the current Supermarket.ie catalogue. Returns several strong candidate products with current retailer prices so the agent can infer ordinary shopper intent instead of blindly treating the first catalogue match as the requested SKU. For broad brand, product-family or staple requests, reason across the returned matches and answer with the most useful ordinary options; only treat one SKU as definitive when resolution is clear.',
  inputSchema: z.object({
    productQuery: z.string().min(2),
  }),
  async execute({ productQuery }) {
    // Keep enough plausible products for the language model to distinguish
    // ordinary variants, pack sizes and specialist products. Catalogue ranking
    // is evidence for inference, not permission to silently collapse a broad
    // shopper request onto candidate #1.
    const candidates = await resolveCatalogueProduct(productQuery, 8);
    if (candidates.length === 0) {
      return {
        found: false,
        query: productQuery,
        resolution: 'none' as const,
        matches: [],
      };
    }

    const snapshots = await Promise.all(
      candidates.map(candidate => getCurrentProductSnapshot(candidate.canonical_name)),
    );

    const matches = candidates.map((candidate, index) => ({
      rank: index + 1,
      canonical_name: candidate.canonical_name,
      category: candidate.category,
      relevance_score: candidate.score,
      best_price: candidate.best_price,
      best_store: candidate.best_store,
      on_promotion: candidate.on_promotion,
      snapshot: snapshots[index],
    }));

    const queryNorm = normalise(productQuery);
    const top = candidates[0];
    const second = candidates[1];
    const exactCanonicalMatch = normalise(top.canonical_name) === queryNorm;
    const scoreGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;

    // A clear exact match or a materially separated top candidate can safely be
    // treated as one product. Otherwise expose the request as a product-family
    // resolution and let the agent use Sonnet's judgement over the alternatives.
    const clearSingleMatch = exactCanonicalMatch || !second || scoreGap >= 8;

    return {
      found: true,
      query: productQuery,
      resolution: clearSingleMatch ? 'single' as const : 'product_family' as const,
      exact_canonical_match: exactCanonicalMatch,
      top_score_gap: Number.isFinite(scoreGap) ? scoreGap : null,
      guidance: clearSingleMatch
        ? 'The leading catalogue product is sufficiently distinct to answer as a single product.'
        : 'The wording plausibly refers to a product family or several variants. Do not silently equate the request with rank 1. Use the matches to infer the ordinary shopper intent, compare useful mainstream variants, and ask one concise clarification only if a materially different choice cannot be inferred.',
      matches,
      // Preserve the legacy single-product fields only when resolution is clear.
      // This prevents downstream prompting from receiving a false sense of
      // certainty while remaining compatible with exact product requests.
      canonical_name: clearSingleMatch ? top.canonical_name : null,
      snapshot: clearSingleMatch ? snapshots[0] : null,
    };
  },
});
