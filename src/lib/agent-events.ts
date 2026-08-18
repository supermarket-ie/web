import 'server-only';
import { send } from '@vercel/queue';

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
 * Publish a compact refresh hint after a successful retailer refresh.
 *
 * The queue consumer decides whether anybody cares: explicit watches are
 * evaluated first, then household purchase history is scored for automatic
 * relevance. The event is only a wake-up hint; the consumer always re-reads
 * canonical cross-store state before making a notification decision.
 *
 * We publish even when the numeric price is unchanged because promotions and
 * availability can change independently of price. Queue volume at our current
 * catalogue size is intentionally preferred over one or two database lookups
 * per scraped product just to decide whether to enqueue.
 */
export async function publishAgentProductChange(input: Omit<AgentProductChangeEvent, 'observedAt'>) {
  const payload: AgentProductChangeEvent = {
    ...input,
    observedAt: new Date().toISOString(),
  };

  const { messageId } = await send(AGENT_PRODUCT_CHANGE_TOPIC, payload, {
    // Scrape batches are at-least-once. One event per refreshed store product/run
    // is sufficient because the consumer evaluates canonical cross-store state.
    idempotencyKey: `${input.runUuid}:${input.storeProductId}`,
    retentionSeconds: 86_400,
  });

  return { published: true as const, messageId };
}
