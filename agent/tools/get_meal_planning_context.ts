import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

type PriceRow = {
  canonical_name: string;
  category: string | null;
  store: string;
  price: number;
  on_promotion: boolean | null;
};

export default defineTool({
  description: 'Load the signed-in household preferences plus a compact set of current promoted and low-price supermarket products for meal planning. Use before creating dinners or lunches so plans are grounded in the household and current catalogue.',
  inputSchema: z.object({
    kind: z.enum(['dinners', 'lunches']).default('dinners'),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const [{ data: household, error: householdError }, { data: rows, error: pricesError }] = await Promise.all([
      agentSupabase
        .from('households')
        .select('adults, children, child_ages, weekly_budget, preferred_stores, dietary, dislikes, meals, batch_cooking, skip_days, extra_context')
        .eq('subscriber_id', subscriberId)
        .maybeSingle(),
      agentSupabase
        .from('latest_prices')
        .select('canonical_name, category, store, price, on_promotion')
        .order('price', { ascending: true })
        .limit(500),
    ]);

    if (householdError) throw new Error(`Unable to load household preferences: ${householdError.message}`);
    if (pricesError) throw new Error(`Unable to load current catalogue prices: ${pricesError.message}`);

    const best = new Map<string, PriceRow>();
    for (const row of (rows ?? []) as PriceRow[]) {
      const existing = best.get(row.canonical_name);
      if (!existing || Number(row.price) < Number(existing.price)) best.set(row.canonical_name, row);
    }

    const bestRows = [...best.values()];
    const promotions = bestRows
      .filter(row => Boolean(row.on_promotion))
      .slice(0, 30)
      .map(row => ({
        canonical_name: row.canonical_name,
        category: row.category,
        store: row.store,
        price: Number(row.price),
      }));

    const usefulCategories = input.kind === 'dinners'
      ? ['meat', 'fish', 'vegetable', 'fruit', 'pasta', 'rice', 'sauce', 'dairy', 'bread', 'frozen']
      : ['bread', 'wrap', 'meat', 'fish', 'cheese', 'dairy', 'fruit', 'vegetable', 'salad', 'snack'];

    const lowPrice = bestRows
      .filter(row => {
        const category = (row.category ?? '').toLowerCase();
        return usefulCategories.some(term => category.includes(term) || row.canonical_name.toLowerCase().includes(term));
      })
      .slice(0, 60)
      .map(row => ({
        canonical_name: row.canonical_name,
        category: row.category,
        store: row.store,
        price: Number(row.price),
        on_promotion: Boolean(row.on_promotion),
      }));

    return {
      ok: true,
      kind: input.kind,
      household: household ?? {
        adults: 2,
        children: 0,
        weekly_budget: null,
        preferred_stores: ['all'],
        dietary: [],
        dislikes: null,
        batch_cooking: false,
        skip_days: null,
        extra_context: null,
      },
      promotions,
      low_price_products: lowPrice,
      guidance: [
        'Respect dietary requirements and dislikes as hard constraints.',
        'Reuse ingredients where sensible to reduce waste.',
        'Use catalogue product names when recommending ingredients that should be added to the shop.',
        'Price is useful intelligence, not the only criterion: keep meals coherent and practical.',
      ],
    };
  },
});
