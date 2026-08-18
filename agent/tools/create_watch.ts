import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { createAgentTask } from '../lib/tasks';
import { getCurrentProductSnapshot, resolveCatalogueProduct } from '../lib/catalogue';
import { agentSupabase } from '../lib/supabase';
import { requireSubscriber } from '../lib/subscriber';

const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('any_price_change') }),
  z.object({ kind: z.literal('price_below'), amount: z.number().positive(), currency: z.literal('EUR').default('EUR') }),
  z.object({ kind: z.literal('promotion_started') }),
  z.object({ kind: z.literal('available') }),
]);

export default defineTool({
  description: 'Create a persistent product watch for the signed-in household. Use this whenever the user asks to watch, track, monitor or notify them about a supermarket product.',
  inputSchema: z.object({
    productQuery: z.string().min(2).describe('Natural product wording from the user, e.g. "Hellmann\'s mayonnaise"'),
    sourceRequest: z.string().min(2).describe('The user\'s original request in their own words'),
    condition: conditionSchema,
    notificationChannel: z.enum(['email', 'in_app']).default('email'),
  }),
  async execute(input, ctx) {
    const subscriberId = requireSubscriber(ctx);
    const candidates = await resolveCatalogueProduct(input.productQuery, 5);

    if (candidates.length === 0) {
      return {
        created: false,
        reason: 'product_not_found',
        message: `I could not confidently match "${input.productQuery}" to a product in the current Supermarket.ie catalogue.`,
      };
    }

    const best = candidates[0];
    const second = candidates[1];
    if (second && second.score >= best.score - 1 && second.canonical_name !== best.canonical_name) {
      return {
        created: false,
        reason: 'ambiguous_product',
        candidates: candidates.slice(0, 3).map(candidate => ({
          canonical_name: candidate.canonical_name,
          best_price: candidate.best_price,
          best_store: candidate.best_store,
        })),
        message: 'The product wording matches more than one catalogue item. Ask the user which one they mean.',
      };
    }

    const snapshot = await getCurrentProductSnapshot(best.canonical_name);
    if (!snapshot && input.condition.kind !== 'available') {
      return {
        created: false,
        reason: 'no_current_price',
        canonical_name: best.canonical_name,
        message: 'The product exists in the catalogue but has no current price observation yet.',
      };
    }

    const baseline: Record<string, unknown> = snapshot ? { ...snapshot } : { available: false };

    // Compatibility bridge: existing price-below alerts already have proven
    // scheduled Resend delivery in production. Reuse that path while agent_tasks
    // becomes the general source of truth for all persistent intentions.
    let legacyAlertId: string | null = null;
    if (input.condition.kind === 'price_below') {
      const { data: product, error: productError } = await agentSupabase
        .from('products')
        .select('id')
        .eq('canonical_name', best.canonical_name)
        .single();

      if (productError) throw new Error(`Could not resolve alert product: ${productError.message}`);

      if (product?.id) {
        const { data: existing, error: existingError } = await agentSupabase
          .from('price_alerts')
          .select('id')
          .eq('subscriber_id', subscriberId)
          .eq('product_id', product.id)
          .eq('active', true)
          .maybeSingle();

        if (existingError) throw new Error(`Could not inspect existing price alert: ${existingError.message}`);

        if (existing?.id) {
          legacyAlertId = existing.id;
          const { error: updateError } = await agentSupabase
            .from('price_alerts')
            .update({ target_price: input.condition.amount })
            .eq('id', existing.id)
            .eq('subscriber_id', subscriberId);
          if (updateError) throw new Error(`Could not update price alert: ${updateError.message}`);
        } else {
          const { data: inserted, error: insertError } = await agentSupabase
            .from('price_alerts')
            .insert({
              subscriber_id: subscriberId,
              product_id: product.id,
              target_price: input.condition.amount,
            })
            .select('id')
            .single();
          if (insertError) throw new Error(`Could not create price alert: ${insertError.message}`);
          legacyAlertId = inserted?.id ?? null;
        }
      }
    }

    if (legacyAlertId) baseline.legacy_alert_id = legacyAlertId;

    const task = await createAgentTask({
      subscriberId,
      type: input.condition.kind === 'promotion_started'
        ? 'promotion_watch'
        : input.condition.kind === 'available'
          ? 'availability_watch'
          : 'price_watch',
      sourceRequest: input.sourceRequest,
      condition: input.condition,
      canonicalName: best.canonical_name,
      baseline,
      notificationChannel: input.notificationChannel,
    });

    return {
      created: true,
      task_id: task.id,
      canonical_name: best.canonical_name,
      condition: input.condition,
      baseline: snapshot ? {
        best_price: snapshot.best_price,
        best_store: snapshot.best_store,
        on_promotion: snapshot.any_promotion,
      } : null,
      notification_channel: task.notification_channel,
    };
  },
});
