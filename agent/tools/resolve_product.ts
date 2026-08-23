import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { resolveCatalogueProduct } from '../lib/catalogue';

export default defineTool({
  description: 'Resolve natural supermarket product wording to current canonical Supermarket.ie catalogue products. Use before making product-specific decisions when the exact catalogue item is unclear. For a short generic staple query, request 8-10 candidates so ordinary household variants are present; rank ordinary variants ahead of specialist or incidental matches unless the user supplied that qualifier.',
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async execute({ query, limit }) {
    return resolveCatalogueProduct(query, limit);
  },
});
