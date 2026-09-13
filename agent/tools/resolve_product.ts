import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { resolveCatalogueProduct } from '../lib/catalogue';
import { consumeExpensiveTool } from '../lib/turn-budget';

export default defineTool({
  description: 'Resolve natural supermarket product wording to current canonical Supermarket.ie catalogue products. Use before making product-specific decisions when the exact catalogue item is unclear. Reuse results within the same turn rather than repeating equivalent searches.',
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(8).default(5),
  }),
  async execute({ query, limit }) {
    const budget = consumeExpensiveTool('resolve_product');
    if (!budget.allowed) return { budget_exhausted: true, query, message: budget.message, matches: [] };
    return { budget_exhausted: false, query, matches: await resolveCatalogueProduct(query, limit) };
  },
  toModelOutput(output) {
    if (output.budget_exhausted) return { type: 'json', value: output };
    return {
      type: 'json',
      value: {
        query: output.query,
        matches: output.matches.map(candidate => ({
          canonical_product_id: candidate.canonical_product_id,
          canonical_name: candidate.canonical_name,
          category: candidate.category,
          score: candidate.score,
          best_price: candidate.best_price,
          best_store: candidate.best_store,
          on_promotion: candidate.on_promotion,
          stores: candidate.stores.slice(0, 3).map(store => ({ store: store.store, price: store.price, on_promotion: store.on_promotion })),
        })),
      },
    };
  },
});
