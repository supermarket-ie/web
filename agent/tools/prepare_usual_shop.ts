import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { buildShopDraft } from '../lib/shop-draft';

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: `Prepare the most likely shop this signed-in household needs now. This is not a clone of the previous shop. It combines purchase frequency and recency, replenishment timing, explicit household preferences, current catalogue prices/promotions and this week's meal plan. Strong usual/replenishment needs are included automatically; meal-completion and weaker inferred needs are returned as approval-gated suggestions. Every meaningful decision includes structured provenance explaining why it was included, suggested or not added.`,
            inputSchema: z.object({
              name: z.string().min(1).max(80).optional().describe('Optional name for the prepared draft list.'),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const draft = await buildShopDraft(subscriberId);
              if (!draft.ok) {
                return { ok: false, reason: draft.reason, message: 'There is not enough household shopping history to prepare a reliable shop yet.' };
              }

              const date = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
              const decisionTrace = {
                version: 1,
                prepared_at: new Date().toISOString(),
                week_start: draft.week_start,
                decisions: draft.decisions,
              };

              const { data: created, error } = await agentSupabase
                .from('saved_lists')
                .insert({
                  subscriber_id: subscriberId,
                  name: input.name ?? `Prepared shop · ${date}`,
                  family_size: draft.family_size,
                  meals_prompt: 'Prepared from household shopping patterns, replenishment signals and this week’s meal intent by Supermarket.ie',
                  items: draft.items,
                  store_totals: draft.store_totals,
                  is_default: false,
                  generated_at: new Date().toISOString(),
                  agent_decision_trace: decisionTrace,
                })
                .select('id, name')
                .single();

              if (error) throw new Error(`Unable to save the prepared shop: ${error.message}`);

              return {
                ok: true,
                list_id: created.id,
                list_name: created.name,
                item_count: draft.items.length,
                store_totals: draft.store_totals,
                included: draft.decisions.filter(decision => decision.action === 'included'),
                suggestions: draft.suggestions,
                not_added: draft.suppressed,
                decision_trace_version: 1,
                message: draft.suggestions.length
                  ? `Your shop is prepared from what the household is most likely to need now. I also found ${draft.suggestions.length} meal-related ${draft.suggestions.length === 1 ? 'suggestion' : 'suggestions'} that need your approval before I add them.`
                  : 'Your shop is prepared from what the household is most likely to need now.',
              };
            },
          })
        : null,
  },
});
