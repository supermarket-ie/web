import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { loadCurrentShop } from '../lib/shop';

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

    const quantities = new Map(shop.items.map(item => [item.canonical_name, item.quantity ?? 1]));
    const byStore = new Map<string, Map<string, PriceRow>>();

    for (const row of (data ?? []) as PriceRow[]) {
      const store = row.store;
      const storeRows = byStore.get(store) ?? new Map<string, PriceRow>();
      const existing = storeRows.get(row.canonical_name);
      if (!existing || Number(row.price) < Number(existing.price)) storeRows.set(row.canonical_name, row);
      byStore.set(store, storeRows);
    }

    const currentTotal = shop.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.quantity ?? 1), 0);
    const itemCount = shop.items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);

    const comparisons = [...byStore.entries()].map(([store, rows]) => {
      let total = 0;
      let coveredUnits = 0;
      const missing: string[] = [];
      for (const name of names) {
        const quantity = quantities.get(name) ?? 1;
        const price = rows.get(name);
        if (!price) {
          missing.push(name);
          continue;
        }
        total += Number(price.price) * quantity;
        coveredUnits += quantity;
      }
      const complete = missing.length === 0;
      return {
        store,
        total: Number(total.toFixed(2)),
        complete,
        covered_products: names.length - missing.length,
        total_products: names.length,
        covered_units: coveredUnits,
        total_units: itemCount,
        missing_products: missing.slice(0, 12),
        difference_vs_current: complete ? Number((total - currentTotal).toFixed(2)) : null,
      };
    })
      .filter(row => !input.store || row.store.toLowerCase() === input.store.toLowerCase())
      .sort((a, b) => {
        if (a.complete !== b.complete) return a.complete ? -1 : 1;
        if (a.complete && b.complete) return a.total - b.total;
        return b.covered_products - a.covered_products || a.total - b.total;
      });

    return {
      ok: true,
      list_id: shop.id,
      current_mixed_total: Number(currentTotal.toFixed(2)),
      comparisons,
      note: 'Only exact catalogue products are compared. A store with missing products is not presented as a complete basket total.',
    };
  },
});
