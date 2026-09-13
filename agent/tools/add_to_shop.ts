import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { retryOptimisticMutation } from '../lib/optimistic-retry';
import { computeStoreTotals, getTrustedCurrentOffer, loadCurrentShop, persistCurrentShop, type AgentListItem, type CurrentPrice } from '../lib/shop';
import { requireLineCapacity } from '../../src/lib/shopping/action-gates';

function applyAdd(items: AgentListItem[], current: CurrentPrice, quantity: number) {
  const existing = items.find(item => item.canonical_product_id === current.canonical_product_id);
  if (existing) {
    existing.quantity = (existing.quantity ?? 1) + quantity;
    existing.store = current.store;
    existing.price = Number(current.price);
    existing.on_promotion = Boolean(current.on_promotion);
    existing.category = current.category ?? existing.category;
    existing.store_product_name = current.store_product_name ?? existing.store_product_name;
  } else {
    requireLineCapacity(items.length, 1);
    items.push({
      canonical_product_id: current.canonical_product_id,
      canonical_name: current.canonical_name,
      category: current.category ?? 'Other',
      store: current.store,
      price: current.price,
      quantity,
      on_promotion: Boolean(current.on_promotion),
      store_product_name: current.store_product_name ?? undefined,
    });
  }
  return existing?.quantity ?? quantity;
}

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

              const saved = await retryOptimisticMutation(async () => {
                const latest = await loadCurrentShop(subscriberId);
                if (!latest) return null;

                // Reload and reapply on each retry. Retrying a stale item array would
                // overwrite whichever concurrent mutation won the compare-and-swap.
                const items: AgentListItem[] = latest.items.map(item => ({ ...item }));
                const finalQuantity = applyAdd(items, current, input.quantity);
                await persistCurrentShop(subscriberId, latest.id, items, latest.generated_at);
                return { latest, finalQuantity };
              });

              if (saved) {
                return {
                  ok: true,
                  list_id: saved.latest.id,
                  list_name: saved.latest.name,
                  canonical_product_id: current.canonical_product_id,
                  canonical_name: current.canonical_name,
                  quantity: saved.finalQuantity,
                  store: current.store,
                  price: current.price,
                  on_promotion: Boolean(current.on_promotion),
                };
              }

              // No existing shop: create the first draft. Subsequent mutations in
              // the same turn will observe this draft and use optimistic retries.
              const items: AgentListItem[] = [];
              const finalQuantity = applyAdd(items, current, input.quantity);
              const totals = computeStoreTotals(items);
              const { data: created, error: createError } = await agentSupabase
                .from('saved_lists')
                .insert({ subscriber_id: subscriberId, name: 'My agent shop', family_size: '2', meals_prompt: 'Created by the Supermarket.ie shopping agent', items, store_totals: totals, is_default: false, generated_at: new Date().toISOString() })
                .select('id, name')
                .single();
              if (createError) throw new Error(`Unable to create a shopping draft: ${createError.message}`);
              return { ok: true, list_id: created.id, list_name: created.name, canonical_product_id: current.canonical_product_id, canonical_name: current.canonical_name, quantity: finalQuantity, store: current.store, price: current.price, on_promotion: Boolean(current.on_promotion) };
            },
          })
        : null,
  },
});
