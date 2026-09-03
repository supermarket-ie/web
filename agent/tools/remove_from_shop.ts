import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { loadCurrentShop, persistCurrentShop } from '../lib/shop';

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Remove an exact canonical product from the signed-in household’s current shop. Use when the user explicitly asks to remove, delete, drop or take an item out of the shop.',
            inputSchema: z.object({ canonical_name: z.string().min(2).describe('Exact canonical product name currently in the shop.') }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const shop = await loadCurrentShop(subscriberId);
              if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to edit.' };
              const index = shop.items.findIndex(item => item.canonical_name === input.canonical_name);
              if (index < 0) return { ok: false, reason: 'item_not_in_shop', message: 'That exact product is not in the current shop.' };
              const [removed] = shop.items.splice(index, 1);
              const storeTotals = await persistCurrentShop(subscriberId, shop.id, shop.items);
              return { ok: true, list_id: shop.id, removed: removed.canonical_name, remaining_items: shop.items.length, store_totals: storeTotals };
            },
          })
        : null,
  },
});
