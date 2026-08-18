import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { resolveCatalogueProduct } from '../lib/catalogue';

export default defineTool({
  description: 'Resolve natural supermarket product wording to current canonical Supermarket.ie catalogue products. Use before making product-specific decisions when the exact catalogue item is unclear.',
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async execute({ query, limit }) {
    return resolveCatalogueProduct(query, limit);
  },
});
