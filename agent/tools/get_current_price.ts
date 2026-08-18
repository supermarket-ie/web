import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getCurrentProductSnapshot, resolveCatalogueProduct } from '../lib/catalogue';

export default defineTool({
  description: 'Get the current Supermarket.ie price snapshot for a product, including the best store and promotion state. Accepts natural product wording.',
  inputSchema: z.object({
    productQuery: z.string().min(2),
  }),
  async execute({ productQuery }) {
    const candidates = await resolveCatalogueProduct(productQuery, 3);
    if (candidates.length === 0) return { found: false, candidates: [] };

    const best = candidates[0];
    const snapshot = await getCurrentProductSnapshot(best.canonical_name);
    return {
      found: Boolean(snapshot),
      canonical_name: best.canonical_name,
      snapshot,
      alternatives: candidates.slice(1).map(candidate => ({
        canonical_name: candidate.canonical_name,
        best_price: candidate.best_price,
        best_store: candidate.best_store,
      })),
    };
  },
});
