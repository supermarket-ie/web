import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { loadCurrentShop } from '../lib/shop';

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Assess the signed-in household’s current shop against either an explicit requested budget or their stored weekly budget. Returns the current total, amount over/under target, and the highest-spend items to consider when the user asks to keep or bring the shop under a budget.',
            inputSchema: z.object({
              target: z.number().positive().max(2000).optional().describe('Explicit budget target from the user. If omitted, use the stored household weekly budget.'),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const shop = await loadCurrentShop(subscriberId);
              if (!shop) return { ok: false, reason: 'no_current_shop', message: 'There is no current saved shop to assess.' };

              const { data: household, error } = await agentSupabase
                .from('households')
                .select('weekly_budget')
                .eq('subscriber_id', subscriberId)
                .maybeSingle();
              if (error) throw new Error(`Unable to load household budget: ${error.message}`);

              const target = input.target ?? (household?.weekly_budget == null ? null : Number(household.weekly_budget));
              const total = shop.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.quantity ?? 1), 0);
              const currentTotal = Number(total.toFixed(2));
              const highestSpend = shop.items
                .map(item => ({
                  canonical_name: item.canonical_name,
                  store: item.store ?? null,
                  unit_price: typeof item.price === 'number' ? item.price : null,
                  quantity: item.quantity ?? 1,
                  line_total: Number(((Number(item.price) || 0) * (item.quantity ?? 1)).toFixed(2)),
                }))
                .sort((a, b) => b.line_total - a.line_total)
                .slice(0, 10);

              if (target == null) {
                return { ok: true, list_id: shop.id, current_total: currentTotal, target: null, highest_spend_items: highestSpend, message: 'No weekly budget is stored for this household. Ask for a target or offer to remember one.' };
              }

              const difference = Number((currentTotal - target).toFixed(2));
              return { ok: true, list_id: shop.id, current_total: currentTotal, target: Number(target.toFixed(2)), on_track: difference <= 0, over_by: difference > 0 ? difference : 0, under_by: difference < 0 ? Math.abs(difference) : 0, highest_spend_items: highestSpend };
            },
          })
        : null,
  },
});
