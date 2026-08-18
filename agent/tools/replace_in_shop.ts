import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { getBestCurrentPrice, loadCurrentShop, persistCurrentShop } from '../lib/shop';

export default defineTool({
  description: 'Replace one exact canonical product in the current shop with another exact canonical catalogue product, preserving quantity and using the replacement’s current best available price. Use after resolving the requested replacement or substitute.',
  inputSchema: z.object({
    old_canonical_name: z.string().min(2).describe('Exact canonical product currently in the shop.'),
    new_canonical_name: z.string().min(2).describe('Exact canonical replacement product from the catalogue.'),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const shop = await loadCurrentShop(subscriberId);
    if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to edit.' };

    const index = shop.items.findIndex(item => item.canonical_name === input.old_canonical_name);
    if (index < 0) {
      return { ok: false, reason: 'item_not_in_shop', message: 'The item to replace is not in the current shop.' };
    }

    const replacement = await getBestCurrentPrice(input.new_canonical_name);
    if (!replacement) {
      return { ok: false, reason: 'replacement_unavailable', message: 'I could not find a current available price for that replacement.' };
    }

    const previous = shop.items[index];
    const quantity = previous.quantity ?? 1;
    const previousLineTotal = typeof previous.price === 'number' ? previous.price * quantity : null;
    const replacementLineTotal = replacement.price * quantity;

    shop.items[index] = {
      ...previous,
      canonical_name: replacement.canonical_name,
      category: replacement.category ?? previous.category,
      store: replacement.store,
      price: replacement.price,
      quantity,
      on_promotion: Boolean(replacement.on_promotion),
      store_product_name: replacement.store_product_name ?? undefined,
    };

    const storeTotals = await persistCurrentShop(subscriberId, shop.id, shop.items);

    return {
      ok: true,
      list_id: shop.id,
      replaced: input.old_canonical_name,
      replacement: replacement.canonical_name,
      quantity,
      store: replacement.store,
      price: replacement.price,
      on_promotion: Boolean(replacement.on_promotion),
      line_difference: previousLineTotal == null
        ? null
        : Number((replacementLineTotal - previousLineTotal).toFixed(2)),
      store_totals: storeTotals,
    };
  },
});
