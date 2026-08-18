import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

const mealSchema = z.object({
  day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  ingredients: z.array(z.object({
    name: z.string().min(1).max(160),
    quantity: z.string().max(80).optional(),
  })).max(20).default([]),
  estimated_cost: z.number().min(0).max(200).optional(),
});

function currentWeekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

export default defineTool({
  description: 'Persist a structured dinner or lunch plan for the signed-in household’s current week. Use after grounding the plan with get_meal_planning_context. This records the plan for the household UI but does not order food or automatically add ingredients to the shop.',
  inputSchema: z.object({
    kind: z.enum(['dinners', 'lunches']),
    meals: z.array(mealSchema).min(1).max(7),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const weekStart = currentWeekStart();

    const { data: existing, error: existingError } = await agentSupabase
      .from('weekly_plans')
      .select('meals')
      .eq('subscriber_id', subscriberId)
      .eq('week_start', weekStart)
      .maybeSingle();

    if (existingError) throw new Error(`Unable to load the current weekly plan: ${existingError.message}`);

    const current = (existing?.meals ?? { dinners: [], lunches: [] }) as {
      dinners?: unknown[];
      lunches?: unknown[];
    };

    const normalized = input.meals.map(meal => ({
      day: meal.day,
      name: meal.name,
      description: meal.description ?? null,
      ingredients: meal.ingredients,
      estimatedCost: meal.estimated_cost ?? null,
      status: 'planned',
    }));

    const meals = input.kind === 'dinners'
      ? { dinners: normalized, lunches: current.lunches ?? [] }
      : { dinners: current.dinners ?? [], lunches: normalized };

    const plannedCount = meals.dinners.length + meals.lunches.length;
    const status = plannedCount >= 12 ? 'complete' : 'partial';

    const { error } = await agentSupabase.from('weekly_plans').upsert({
      subscriber_id: subscriberId,
      week_start: weekStart,
      meals,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'subscriber_id,week_start' });

    if (error) throw new Error(`Unable to save the weekly meal plan: ${error.message}`);

    return {
      ok: true,
      week_start: weekStart,
      kind: input.kind,
      meal_count: normalized.length,
      meals: normalized,
      message: `Saved ${normalized.length} ${input.kind} for this week.`,
    };
  },
});
