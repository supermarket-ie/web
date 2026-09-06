import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { loadCurrentShop, persistCurrentShop, resolveCanonicalProduct } from '../lib/shop';

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Set the quantity of an exact canonical product already in the signed-in household’s current shop. Use for requests like make that two, change the milk to three, or reduce this to one.',
            inputSchema: z.object({
              canonical_name: z.string().min(2).describe('Exact canonical product name currently in the shop.'),
              canonical_product_id: z.string().min(1).describe('Exact canonical product ID returned by catalogue resolution.'),
              quantity: z.number().int().min(1).max(20).describe('New total quantity for the item.'),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const shop = await loadCurrentShop(subscriberId);
              if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to edit.' };
              const product = await resolveCanonicalProduct(input.canonical_product_id);
              if (!product) return { ok: false, reason: 'unknown_product', message: 'That product is no longer in the canonical catalogue.' };
              const item = shop.items.find(row => row.canonical_product_id === product.canonical_product_id || (!row.canonical_product_id && row.canonical_name === product.canonical_name));
              if (!item) return { ok: false, reason: 'item_not_in_shop', message: 'That exact product is not in the current shop.' };
              item.canonical_product_id = product.canonical_product_id;
              const previousQuantity = item.quantity ?? 1;
              item.quantity = input.quantity;
              const storeTotals = await persistCurrentShop(subscriberId, shop.id, shop.items, shop.generated_at);
              return { ok: true, list_id: shop.id, canonical_name: item.canonical_name, previous_quantity: previousQuantity, quantity: input.quantity, store_totals: storeTotals };
            },
          })
        : null,
  },
});
