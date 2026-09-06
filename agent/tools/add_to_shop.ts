import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { computeStoreTotals, getTrustedCurrentOffer, loadCurrentShop, persistCurrentShop, type AgentListItem } from '../lib/shop';
import { requireLineCapacity } from '../../src/lib/shopping/action-gates';

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Add an exact canonical catalogue product to the signed-in household’s latest draft shop using its current best available price. Resolve ambiguous product wording first. If no saved shop exists, create a new agent draft.',
            inputSchema: z.object({
              canonical_name: z.string().min(2).describe('Exact canonical product name from the Supermarket.ie catalogue.'),
              canonical_product_id: z.string().min(1).describe('Exact canonical product ID returned by catalogue resolution.'),
              quantity: z.number().int().min(1).max(20).default(1),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const current = await getTrustedCurrentOffer(input.canonical_product_id);
              if (!current) return { ok: false, reason: 'product_unavailable', message: 'I could not find a current available price for that exact product.' };
              const latest = await loadCurrentShop(subscriberId);
              const items: AgentListItem[] = latest?.items ?? [];
              const existing = items.find(item => item.canonical_product_id === current.canonical_product_id);
              if (existing) {
                existing.quantity = (existing.quantity ?? 1) + input.quantity;
                existing.store = current.store;
                existing.price = Number(current.price);
                existing.on_promotion = Boolean(current.on_promotion);
                existing.category = current.category ?? existing.category;
              } else {
                requireLineCapacity(items.length, 1);
                items.push({ canonical_product_id: current.canonical_product_id, canonical_name: current.canonical_name, category: current.category ?? 'Other', store: current.store, price: current.price, quantity: input.quantity, on_promotion: Boolean(current.on_promotion), store_product_name: current.store_product_name ?? undefined });
              }
              if (latest) {
                await persistCurrentShop(subscriberId, latest.id, items, latest.generated_at);
                return { ok: true, list_id: latest.id, list_name: latest.name, canonical_product_id: current.canonical_product_id, canonical_name: current.canonical_name, quantity: existing?.quantity ?? input.quantity, store: current.store, price: current.price, on_promotion: Boolean(current.on_promotion) };
              }
              const totals = computeStoreTotals(items);
              const { data: created, error: createError } = await agentSupabase
                .from('saved_lists')
                .insert({ subscriber_id: subscriberId, name: 'My agent shop', family_size: '2', meals_prompt: 'Created by the Supermarket.ie shopping agent', items, store_totals: totals, is_default: false, generated_at: new Date().toISOString() })
                .select('id, name')
                .single();
              if (createError) throw new Error(`Unable to create a shopping draft: ${createError.message}`);
              return { ok: true, list_id: created.id, list_name: created.name, canonical_product_id: current.canonical_product_id, canonical_name: current.canonical_name, quantity: input.quantity, store: current.store, price: current.price, on_promotion: Boolean(current.on_promotion) };
            },
          })
        : null,
  },
});
