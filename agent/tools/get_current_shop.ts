import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { loadCurrentShop } from '../lib/shop';

export default defineTool({
  description: 'Return the signed-in household’s current/latest saved shop as structured items, quantities, stores, prices and totals. Use before editing the shop or answering questions about what is currently in it.',
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const shop = await loadCurrentShop(subscriberId);
    if (!shop) {
      return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop yet.' };
    }

    return {
      ok: true,
      list_id: shop.id,
      name: shop.name,
      generated_at: shop.generated_at,
      items: shop.items,
      store_totals: shop.store_totals ?? [],
      recommended_store: shop.recommended_store ?? null,
    };
  },
});
