import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { forgetMemoryKey, normaliseHouseholdMemory, productMemoryKey, setExplicitMemoryFact } from '../../src/lib/household-memory';

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
              stopped_products: z.array(z.string().min(1).max(200)).optional(),
              forget_products: z.array(z.string().min(1).max(200)).optional(),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const { stopped_products, forget_products, ...profileInput } = input;
              const fields = Object.fromEntries(Object.entries(profileInput).filter(([, value]) => value !== undefined));
              if (Object.keys(fields).length === 0 && !stopped_products && !forget_products?.length) return { ok: false, reason: 'no_changes', message: 'No household preference changes were provided.' };
              const now = new Date().toISOString();
              const { data: existing } = await agentSupabase.from('households').select('memory').eq('subscriber_id', subscriberId).maybeSingle();
              let memory = normaliseHouseholdMemory(existing?.memory, now);
              const explicitMap: Record<string, unknown> = {
                household_composition: input.adults === undefined && input.children === undefined ? undefined : { adults: input.adults, children: input.children },
                weekly_budget: input.weekly_budget,
                preferred_stores: input.preferred_stores,
                dietary: input.dietary,
                dislikes: input.dislikes,
                stopped_products,
              };
              for (const [key, value] of Object.entries(explicitMap)) {
                if (value !== undefined) memory = setExplicitMemoryFact(memory, key, value, now);
              }
              for (const product of forget_products ?? []) memory = forgetMemoryKey(memory, `product:${productMemoryKey(product)}`, now);
              const { error } = await agentSupabase.from('households').upsert({ subscriber_id: subscriberId, ...fields, memory }, { onConflict: 'subscriber_id' });
              if (error) throw new Error(`Unable to update household preferences: ${error.message}`);
              return { ok: true, updated: [...Object.keys(fields), ...(stopped_products ? ['stopped_products'] : []), ...(forget_products ? ['forgotten_products'] : [])], values: fields };
            },
          })
        : null,
  },
});
