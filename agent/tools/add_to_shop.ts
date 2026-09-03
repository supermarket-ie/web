import { defineDynamic, defineTool } from 'eve/tools';
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

function storeTotals(items: ListItem[]) {
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

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Add an exact canonical catalogue product to the signed-in household’s latest draft shop using its current best available price. Resolve ambiguous product wording first. If no saved shop exists, create a new agent draft.',
            inputSchema: z.object({
              canonical_name: z.string().min(2).describe('Exact canonical product name from the Supermarket.ie catalogue.'),
              quantity: z.number().int().min(1).max(20).default(1),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const { data: prices, error: pricesError } = await agentSupabase
                .from('latest_prices')
                .select('canonical_name, category, store, price, on_promotion')
                .eq('canonical_name', input.canonical_name)
                .order('price', { ascending: true })
                .limit(1);
              if (pricesError) throw new Error(`Unable to fetch current product price: ${pricesError.message}`);
              const current = prices?.[0];
              if (!current) return { ok: false, reason: 'product_unavailable', message: 'I could not find a current available price for that exact product.' };

              const { data: latest, error: latestError } = await agentSupabase
                .from('saved_lists')
                .select('id, name, family_size, items')
                .eq('subscriber_id', subscriberId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (latestError) throw new Error(`Unable to load the current shop: ${latestError.message}`);

              const items = ((latest?.items ?? []) as ListItem[]).map(item => ({ ...item }));
              const existing = items.find(item => item.canonical_name === input.canonical_name);
              if (existing) {
                existing.quantity = (existing.quantity ?? 1) + input.quantity;
                existing.store = current.store;
                existing.price = Number(current.price);
                existing.on_promotion = Boolean(current.on_promotion);
                existing.category = current.category ?? existing.category;
              } else {
                items.push({ canonical_name: input.canonical_name, category: current.category ?? 'Other', store: current.store, price: Number(current.price), quantity: input.quantity, on_promotion: Boolean(current.on_promotion) });
              }

              const totals = storeTotals(items);
              if (latest) {
                const { error: updateError } = await agentSupabase
                  .from('saved_lists')
                  .update({ items, store_totals: totals, generated_at: new Date().toISOString() })
                  .eq('id', latest.id)
                  .eq('subscriber_id', subscriberId);
                if (updateError) throw new Error(`Unable to update the current shop: ${updateError.message}`);
                return { ok: true, list_id: latest.id, list_name: latest.name, canonical_name: input.canonical_name, quantity: existing?.quantity ?? input.quantity, store: current.store, price: Number(current.price), on_promotion: Boolean(current.on_promotion) };
              }

              const { data: created, error: createError } = await agentSupabase
                .from('saved_lists')
                .insert({ subscriber_id: subscriberId, name: 'My agent shop', family_size: '2', meals_prompt: 'Created by the Supermarket.ie shopping agent', items, store_totals: totals, is_default: false, generated_at: new Date().toISOString() })
                .select('id, name')
                .single();
              if (createError) throw new Error(`Unable to create a shopping draft: ${createError.message}`);
              return { ok: true, list_id: created.id, list_name: created.name, canonical_name: input.canonical_name, quantity: input.quantity, store: current.store, price: Number(current.price), on_promotion: Boolean(current.on_promotion) };
            },
          })
        : null,
  },
});
