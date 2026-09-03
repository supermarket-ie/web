import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

const allowedStores = ['all', 'tesco', 'dunnes', 'supervalu', 'aldi'] as const;

export default defineDynamic({
  events: {
    'turn.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: 'Update durable household shopping preferences when the signed-in user explicitly tells the agent something about their household, budget, stores, dietary needs, dislikes, meal coverage or shopping context. Only change fields the user actually specified.',
            inputSchema: z.object({
              adults: z.number().int().min(1).max(8).optional(),
              children: z.number().int().min(0).max(8).optional(),
              weekly_budget: z.number().positive().max(5000).nullable().optional(),
              preferred_stores: z.array(z.enum(allowedStores)).min(1).optional(),
              dietary: z.array(z.string().min(1)).optional(),
              dislikes: z.string().max(1000).nullable().optional(),
              batch_cooking: z.boolean().optional(),
              skip_days: z.string().max(500).nullable().optional(),
              extra_context: z.string().max(2000).nullable().optional(),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const fields = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
              if (Object.keys(fields).length === 0) return { ok: false, reason: 'no_changes', message: 'No household preference changes were provided.' };
              const { error } = await agentSupabase.from('households').upsert({ subscriber_id: subscriberId, ...fields }, { onConflict: 'subscriber_id' });
              if (error) throw new Error(`Unable to update household preferences: ${error.message}`);
              return { ok: true, updated: Object.keys(fields), values: fields };
            },
          })
        : null,
  },
});
