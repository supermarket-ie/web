import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { getTrustedCurrentOffer, loadCurrentShop, persistCurrentShop, resolveCanonicalProduct } from '../lib/shop';

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Replace one exact canonical product in the current shop with another exact canonical catalogue product, preserving quantity and using the replacement’s current best available price. Use after resolving the requested replacement or substitute.',
            inputSchema: z.object({
              old_canonical_name: z.string().min(2).describe('Exact canonical product currently in the shop.'),
              old_canonical_product_id: z.string().min(1).describe('Exact canonical product ID of the item currently in the shop.'),
              new_canonical_name: z.string().min(2).describe('Exact canonical replacement product from the catalogue.'),
              new_canonical_product_id: z.string().min(1).describe('Exact canonical product ID returned by catalogue resolution.'),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const shop = await loadCurrentShop(subscriberId);
              if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to edit.' };
              const oldProduct = await resolveCanonicalProduct(input.old_canonical_product_id);
              if (!oldProduct) return { ok: false, reason: 'unknown_product', message: 'The item to replace is no longer in the canonical catalogue.' };
              const index = shop.items.findIndex(item => item.canonical_product_id === oldProduct.canonical_product_id || (!item.canonical_product_id && item.canonical_name === oldProduct.canonical_name));
              if (index < 0) return { ok: false, reason: 'item_not_in_shop', message: 'The item to replace is not in the current shop.' };
              const replacement = await getTrustedCurrentOffer(input.new_canonical_product_id);
              if (!replacement) return { ok: false, reason: 'replacement_unavailable', message: 'I could not find a current available price for that replacement.' };
              const previous = shop.items[index];
              const quantity = previous.quantity ?? 1;
              const previousLineTotal = typeof previous.price === 'number' ? previous.price * quantity : null;
              const replacementLineTotal = replacement.price * quantity;
              shop.items[index] = {
                ...previous,
                canonical_name: replacement.canonical_name,
                canonical_product_id: replacement.canonical_product_id,
                category: replacement.category ?? previous.category,
                store: replacement.store,
                price: replacement.price,
                quantity,
                on_promotion: Boolean(replacement.on_promotion),
                store_product_name: replacement.store_product_name ?? undefined,
              };
              const storeTotals = await persistCurrentShop(subscriberId, shop.id, shop.items, shop.generated_at);
              return {
                ok: true,
                list_id: shop.id,
                replaced: input.old_canonical_name,
                replacement: replacement.canonical_name,
                quantity,
                store: replacement.store,
                price: replacement.price,
                on_promotion: Boolean(replacement.on_promotion),
                line_difference: previousLineTotal == null ? null : Number((replacementLineTotal - previousLineTotal).toFixed(2)),
                store_totals: storeTotals,
              };
            },
          })
        : null,
  },
});
