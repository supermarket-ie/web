import { defineDynamic, defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';
import { getIngredientIntelligence } from '../lib/ingredient-intelligence';

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) =>
      ctx.session.auth.current?.principalType === 'user'
        ? defineTool({
            description: `Analyse ingredients already planned or on hand and return catalogue-grounded complementary ingredients that can improve meal coherence or reuse across meals. Use this for requests such as "use these ingredients across four dinners", "what am I missing?", "reuse ingredients", or when a meal plan needs evidence-based complementary components. Results are suggestions only: do not add speculative products without the user's request or clear approval.`,
            inputSchema: z.object({
              ingredients: z.array(z.string().min(2)).min(1).max(6).describe('Hero ingredients or meal components already planned, on hand, or intended for reuse.'),
              purpose: z.enum(['meal_planning', 'reuse', 'completion']).default('meal_planning'),
              limit: z.number().int().min(1).max(8).default(6),
            }),
            async execute(input, toolCtx) {
              const subscriberId = requireSubscriber(toolCtx);
              const { data: household, error } = await agentSupabase
                .from('households')
                .select('dietary, dislikes, preferred_stores')
                .eq('subscriber_id', subscriberId)
                .maybeSingle();
              if (error) throw new Error(`Unable to load household ingredient context: ${error.message}`);

              const intelligence = await getIngredientIntelligence(
                input.ingredients,
                {
                  dietary: (household?.dietary as string[] | null) ?? [],
                  dislikes: (household?.dislikes as string | null) ?? null,
                  preferred_stores: (household?.preferred_stores as string[] | null) ?? [],
                },
                input.limit,
              );

              return {
                ok: intelligence.suggestions.length > 0,
                purpose: input.purpose,
                ...intelligence,
                guidance: input.purpose === 'reuse'
                  ? 'Prefer suggestions with signal_count > 1 because they can bridge more than one planned ingredient or meal. Explain the reuse benefit to the household.'
                  : input.purpose === 'completion'
                    ? 'Treat these as candidate omissions, not automatic additions. Ask before adding when meal intent is uncertain.'
                    : 'Use these grounded ingredients to make the meal plan more coherent while keeping household preferences and budget in control.',
              };
            },
          })
        : null,
  },
});
