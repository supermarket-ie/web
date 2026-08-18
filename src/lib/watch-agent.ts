import 'server-only';
import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { createAgentTask, listActiveAgentTasks, updateAgentTaskStatus } from '@/lib/agent-tasks';
import { getCurrentProductSnapshot, resolveCatalogueProduct } from '@/lib/catalogue-resolution';
import { supabaseAdmin } from '@/lib/supabase';

export function isPersistentShoppingIntent(text: string): boolean {
  const normal = text.toLowerCase();
  return /\b(notify|notification|alert|watch|monitor|track|remind|tell me (?:if|when)|let me know (?:if|when)|keep an eye)\b/.test(normal)
    || /\b(stop|cancel|remove|delete)\b.*\b(watch|alert|notification|monitoring)\b/.test(normal)
    || /\b(what|which|show|list)\b.*\b(watching|watches|alerts|monitoring|tracking)\b/.test(normal);
}

async function createLegacyPriceAlert(
  subscriberId: string,
  canonicalName: string,
  targetPrice: number,
): Promise<string | null> {
  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('canonical_name', canonicalName)
    .single();
  if (productError || !product?.id) return null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('price_alerts')
    .select('id')
    .eq('subscriber_id', subscriberId)
    .eq('product_id', product.id)
    .eq('active', true)
    .maybeSingle();
  if (existingError) throw new Error(`Could not inspect existing price alert: ${existingError.message}`);

  if (existing?.id) {
    const { error } = await supabaseAdmin
      .from('price_alerts')
      .update({ target_price: targetPrice })
      .eq('id', existing.id)
      .eq('subscriber_id', subscriberId);
    if (error) throw new Error(`Could not update price alert: ${error.message}`);
    return existing.id;
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('price_alerts')
    .insert({
      subscriber_id: subscriberId,
      product_id: product.id,
      target_price: targetPrice,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Could not create price alert: ${error.message}`);
  return inserted?.id ?? null;
}

function watchTools(subscriberId: string | null) {
  return {
    resolve_product: tool({
      description: 'Resolve natural product wording to current Supermarket.ie catalogue products. Use before creating a product watch if the exact item is not already known.',
      inputSchema: z.object({
        query: z.string().min(2),
      }),
      execute: async ({ query }) => resolveCatalogueProduct(query, 5),
    }),

    get_current_price: tool({
      description: 'Get the current price/promotion snapshot for a canonical Supermarket.ie product.',
      inputSchema: z.object({
        canonical_name: z.string().min(2),
      }),
      execute: async ({ canonical_name }) => getCurrentProductSnapshot(canonical_name),
    }),

    create_watch: tool({
      description: 'Create a persistent watch. Use whenever a signed-in user asks to notify, alert, watch, monitor or track a product condition.',
      inputSchema: z.object({
        product_query: z.string().min(2),
        source_request: z.string().min(2),
        condition: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('any_price_change') }),
          z.object({ kind: z.literal('price_below'), amount: z.number().positive(), currency: z.literal('EUR').default('EUR') }),
          z.object({ kind: z.literal('promotion_started') }),
          z.object({ kind: z.literal('available') }),
        ]),
      }),
      execute: async ({ product_query, source_request, condition }) => {
        if (!subscriberId) {
          return {
            created: false,
            reason: 'sign_in_required',
            message: 'Sign in first so I can keep the watch attached to your household and notify you later.',
          };
        }

        const candidates = await resolveCatalogueProduct(product_query, 5);
        if (candidates.length === 0) {
          return { created: false, reason: 'product_not_found', query: product_query };
        }

        const best = candidates[0];
        const second = candidates[1];
        if (second && second.score >= best.score - 1 && second.canonical_name !== best.canonical_name) {
          return {
            created: false,
            reason: 'ambiguous_product',
            candidates: candidates.slice(0, 3).map(c => ({
              canonical_name: c.canonical_name,
              best_price: c.best_price,
              best_store: c.best_store,
            })),
          };
        }

        const snapshot = await getCurrentProductSnapshot(best.canonical_name);
        if (!snapshot && condition.kind !== 'available') {
          return { created: false, reason: 'no_current_price', canonical_name: best.canonical_name };
        }

        const baseline: Record<string, unknown> = snapshot
          ? { ...snapshot, available: true }
          : { available: false, captured_at: new Date().toISOString() };

        // Keep using the proven existing price-alert mailer for threshold alerts
        // until all notification types are consolidated into agent_notifications.
        if (condition.kind === 'price_below') {
          const legacyAlertId = await createLegacyPriceAlert(
            subscriberId,
            best.canonical_name,
            condition.amount,
          );
          if (legacyAlertId) baseline.legacy_alert_id = legacyAlertId;
        }

        const task = await createAgentTask({
          subscriberId,
          type: condition.kind === 'promotion_started'
            ? 'promotion_watch'
            : condition.kind === 'available'
              ? 'availability_watch'
              : 'price_watch',
          sourceRequest: source_request,
          condition,
          canonicalName: best.canonical_name,
          baseline,
          notificationChannel: 'email',
        });

        return {
          created: true,
          task_id: task.id,
          canonical_name: best.canonical_name,
          condition,
          current: snapshot ? {
            best_price: snapshot.best_price,
            best_store: snapshot.best_store,
            on_promotion: snapshot.any_promotion,
          } : null,
        };
      },
    }),

    list_watches: tool({
      description: 'List the signed-in household’s active watches and reminders.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!subscriberId) return [];
        const tasks = await listActiveAgentTasks(subscriberId);
        return tasks.map(task => ({
          id: task.id,
          type: task.type,
          canonical_name: task.canonical_name,
          condition: task.condition,
          source_request: task.source_request,
          created_at: task.created_at,
        }));
      },
    }),

    cancel_watch: tool({
      description: 'Cancel an active watch belonging to the signed-in household.',
      inputSchema: z.object({ task_id: z.string().uuid() }),
      execute: async ({ task_id }) => {
        if (!subscriberId) return { cancelled: false, reason: 'sign_in_required' };

        const { data: task } = await supabaseAdmin
          .from('agent_tasks')
          .select('baseline')
          .eq('id', task_id)
          .eq('subscriber_id', subscriberId)
          .single();

        const legacyAlertId = task?.baseline && typeof task.baseline === 'object'
          ? (task.baseline as Record<string, unknown>).legacy_alert_id
          : null;
        if (typeof legacyAlertId === 'string') {
          await supabaseAdmin
            .from('price_alerts')
            .update({ active: false })
            .eq('id', legacyAlertId)
            .eq('subscriber_id', subscriberId);
        }

        const updated = await updateAgentTaskStatus(subscriberId, task_id, 'cancelled');
        return { cancelled: true, task_id: updated.id };
      },
    }),
  };
}

export function createWatchAgent(subscriberId: string | null) {
  return new ToolLoopAgent({
    model: anthropic('claude-haiku-4-5-20251001'),
    instructions: `You are the persistent household shopping agent for Supermarket.ie.

This request is about an ongoing watch, notification, reminder or monitoring instruction — not meal planning.

Rules:
- If the user asks to watch/notify/monitor/track a supermarket product, use create_watch. Do not claim you cannot monitor things.
- Resolve ambiguous product wording with resolve_product. If there are genuinely multiple close catalogue products and choosing the wrong one materially matters, ask which one they mean.
- "Tell me if the price changes" means any_price_change.
- "Tell me when it is under/below €X" means price_below with amount X.
- "Tell me when it is on offer/on promotion" means promotion_started.
- "Tell me when it is back/in stock/available" means available.
- If the user asks what is being watched, use list_watches.
- If they ask to stop a watch, identify it from list_watches and use cancel_watch.
- A persistent watch requires sign-in. If create_watch returns sign_in_required, explain that succinctly; never pretend the watch was created.
- Never invent catalogue matches, prices, promotions or notification status.
- After a successful tool call, confirm the action in one or two natural sentences. Do not mention internal tools or architecture.
- Supermarket.ie covers groceries and normal household consumables, not just meal ingredients.`,
    tools: watchTools(subscriberId),
    stopWhen: stepCountIs(8),
  });
}
