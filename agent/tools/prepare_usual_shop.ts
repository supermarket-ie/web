import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

type ListItem = {
  canonical_name: string;
  category?: string;
  store?: string;
  price?: number;
  quantity?: number;
  on_promotion?: boolean;
};

type PriceRow = {
  canonical_name: string;
  store: string;
  price: number;
  on_promotion: boolean | null;
};

function totals(items: ListItem[]) {
  const grouped = new Map<string, { store: string; total: number; item_count: number }>();
  for (const item of items) {
    if (!item.store || typeof item.price !== 'number') continue;
    const row = grouped.get(item.store) ?? { store: item.store, total: 0, item_count: 0 };
    row.total += item.price * (item.quantity ?? 1);
    row.item_count += 1;
    grouped.set(item.store, row);
  }
  return [...grouped.values()].map(row => ({ ...row, total: Number(row.total.toFixed(2)) }));
}

export default defineTool({
  description: 'Prepare a fresh draft of the signed-in household’s usual shop using their latest saved list, refreshed to current catalogue prices and the current cheapest available store for each exact product. Use when the user says prepare my usual shop, same again, or get my normal shop ready.',
  inputSchema: z.object({
    name: z.string().min(1).max(80).optional().describe('Optional name for the prepared draft list.'),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const { data: previous, error: previousError } = await agentSupabase
      .from('saved_lists')
      .select('id, name, family_size, items')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previousError) throw new Error(`Unable to load the household’s latest shop: ${previousError.message}`);
    const previousItems = (previous?.items ?? []) as ListItem[];
    if (!previous || previousItems.length === 0) {
      return { ok: false, reason: 'no_previous_shop', message: 'There is no previous saved shop to prepare yet.' };
    }

    const names = [...new Set(previousItems.map(item => item.canonical_name).filter(Boolean))];
    const { data: currentRows, error: pricesError } = await agentSupabase
      .from('latest_prices')
      .select('canonical_name, store, price, on_promotion')
      .in('canonical_name', names);

    if (pricesError) throw new Error(`Unable to refresh current prices: ${pricesError.message}`);

    const best = new Map<string, PriceRow>();
    for (const row of (currentRows ?? []) as PriceRow[]) {
      const existing = best.get(row.canonical_name);
      if (!existing || Number(row.price) < Number(existing.price)) best.set(row.canonical_name, row);
    }

    let refreshed = 0;
    const items = previousItems.map(item => {
      const current = best.get(item.canonical_name);
      if (!current) return item;
      if (item.price !== Number(current.price) || item.store !== current.store) refreshed += 1;
      return {
        ...item,
        store: current.store,
        price: Number(current.price),
        on_promotion: Boolean(current.on_promotion),
      };
    });

    const beforeTotal = previousItems.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.quantity ?? 1), 0);
    const currentTotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.quantity ?? 1), 0);
    const difference = Number((currentTotal - beforeTotal).toFixed(2));
    const storeTotals = totals(items);

    const date = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
    const { data: created, error: insertError } = await agentSupabase
      .from('saved_lists')
      .insert({
        subscriber_id: subscriberId,
        name: input.name ?? `Agent-prepared shop · ${date}`,
        family_size: previous.family_size ?? '2',
        meals_prompt: 'Prepared from the household’s usual shop by the Supermarket.ie shopping agent',
        items,
        store_totals: storeTotals,
        is_default: false,
        generated_at: new Date().toISOString(),
      })
      .select('id, name')
      .single();

    if (insertError) throw new Error(`Unable to save the prepared shop: ${insertError.message}`);

    return {
      ok: true,
      list_id: created.id,
      list_name: created.name,
      item_count: items.length,
      refreshed_items: refreshed,
      previous_total: Number(beforeTotal.toFixed(2)),
      current_total: Number(currentTotal.toFixed(2)),
      difference,
      message: difference < 0
        ? `Your usual shop is ready and is €${Math.abs(difference).toFixed(2)} cheaper at current best prices.`
        : difference > 0
          ? `Your usual shop is ready. At current best prices it is €${difference.toFixed(2)} dearer than the previous version.`
          : 'Your usual shop is ready at essentially the same total as before.',
    };
  },
});
