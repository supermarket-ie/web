import { defineTool } from 'eve/tools';
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

export default defineTool({
  description: 'Compare the household’s current exact shop across supermarkets using current catalogue prices. Returns coverage and comparable basket totals by store. Use for questions like “would it be worth doing this all in Dunnes?” or “which one store best fits this shop?”.',
  inputSchema: z.object({
    store: z.string().min(2).max(60).optional().describe('Optional specific supermarket to compare against the current mixed-store shop.'),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const shop = await loadCurrentShop(subscriberId);
    if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to compare.' };

    const names = [...new Set(shop.items.map(item => item.canonical_name).filter(Boolean))];
    const { data, error } = await agentSupabase
      .from('latest_prices')
      .select('canonical_name, store, price, on_promotion')
      .in('canonical_name', names);

    if (error) throw new Error(`Unable to compare current supermarket prices: ${error.message}`);

    const comparison = compareBasketStores(
      shop.items.map(item => ({
        canonical_name: item.canonical_name,
        quantity: item.quantity ?? 1,
        current_price: item.price ?? null,
      })),
      ((data ?? []) as PriceRow[]).map(row => ({
        canonical_name: row.canonical_name,
        store: row.store,
        price: Number(row.price),
      })),
      input.store,
    );

    return {
      ok: true,
      list_id: shop.id,
      current_mixed_total: comparison.current_total,
      comparisons: comparison.comparisons,
      note: 'Only exact catalogue products are compared. A store with missing products is not presented as a complete basket total.',
    };
  },
});
