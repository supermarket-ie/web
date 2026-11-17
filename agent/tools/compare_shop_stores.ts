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
  store_product_id: string;
  store_product_name: string | null;
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
              // Only fresh, exact store offers; page past the 1,000-row default.
              const data: PriceRow[] = [];
              for (let from = 0; names.length; from += 1000) {
                const { data: page, error } = await agentSupabase.from('latest_prices')
                  .select('canonical_name, store, price, store_product_id, store_product_name')
                  .in('canonical_name', names).eq('relationship_type', 'exact').eq('freshness_state', 'fresh')
                  .order('store_product_id').range(from, from + 999);
                if (error) throw new Error(`Unable to compare current supermarket prices: ${error.message}`);
                data.push(...((page ?? []) as PriceRow[]));
                if (!page || page.length < 1000) break;
              }
              const comparison = compareBasketStores(
                shop.items.map(item => ({ canonical_name: item.canonical_name, quantity: item.quantity ?? 1, current_price: item.price ?? null })),
                data.map(row => ({ canonical_name: row.canonical_name, store: row.store, price: Number(row.price),
                  store_product_id: String(row.store_product_id), store_product_name: row.store_product_name ?? undefined })),
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
