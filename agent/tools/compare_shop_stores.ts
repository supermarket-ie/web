import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { loadCurrentShop } from '../lib/shop';
import { compareBasketStores } from '../../src/lib/shopping/compare';

type PriceRow = {
  canonical_name: string;
  store: string;
  price: number;
  on_promotion: boolean | null;
};

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Compare the household’s current shop across supermarkets using current catalogue prices. Returns coverage and INDICATIVE basket totals by store: the stores’ products are not verified as the same items, so never call a store cheapest or say the products are identical. Use for questions like “would it be worth doing this all in Dunnes?”.',
            inputSchema: z.object({
              store: z.string().min(2).max(60).optional().describe('Optional specific supermarket to compare against the current mixed-store shop.'),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const shop = await loadCurrentShop(subscriberId);
              if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to compare.' };
              const names = [...new Set(shop.items.map(item => item.canonical_name).filter(Boolean))];
              const { data, error } = await agentSupabase.from('latest_prices').select('canonical_name, store, price, on_promotion').in('canonical_name', names);
              if (error) throw new Error(`Unable to compare current supermarket prices: ${error.message}`);
              const comparison = compareBasketStores(
                shop.items.map(item => ({ canonical_name: item.canonical_name, quantity: item.quantity ?? 1, current_price: item.price ?? null })),
                ((data ?? []) as PriceRow[]).map(row => ({ canonical_name: row.canonical_name, store: row.store, price: Number(row.price) })),
                input.store,
              );
              // No retailer offer identities or pair reviews here, so totals are always indicative: never name a
              // cheapest store or say the stores' products are the same.
              return { ok: true, list_id: shop.id, current_mixed_total: comparison.current_total, comparison_basis: comparison.comparison_basis,
                cheapest_verified_store: comparison.cheapest_verified_store, comparisons: comparison.comparisons, note: comparison.explanation };
            },
          })
        : null,
  },
});
