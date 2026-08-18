import 'server-only';
import { send } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';

export const AGENT_PRODUCT_CHANGE_TOPIC = 'agent-product-changes';

export type AgentProductChangeEvent = {
  canonicalName: string;
  store: string;
  runUuid: string;
  storeProductId: string;
  previousPrice: number | null;
  observedPrice: number | null;
  observedAt: string;
};

/**
 * Publish a compact refresh hint only when somebody is actively watching the
 * canonical product. The consumer re-reads the canonical snapshot, so the
 * event itself does not need to carry authoritative price/promotion state.
 *
 * We intentionally publish even when the numeric price is unchanged because
 * promotion and availability state can change independently of price.
 */
export async function publishAgentProductChange(input: Omit<AgentProductChangeEvent, 'observedAt'>) {
  const { count, error } = await supabaseAdmin
    .from('agent_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('canonical_name', input.canonicalName)
    .in('type', ['price_watch', 'promotion_watch', 'availability_watch']);

  if (error) throw new Error(`Failed checking watched product: ${error.message}`);
  if (!count) return { published: false as const };

  const payload: AgentProductChangeEvent = {
    ...input,
    observedAt: new Date().toISOString(),
  };

  const { messageId } = await send(AGENT_PRODUCT_CHANGE_TOPIC, payload, {
    // Scrape batches are at-least-once. One event per refreshed store product/run
    // is sufficient because the consumer evaluates the canonical cross-store state.
    idempotencyKey: `${input.runUuid}:${input.storeProductId}`,
    retentionSeconds: 86_400,
  });

  return { published: true as const, messageId };
}
