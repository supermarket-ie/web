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
 * Publish a compact product-change hint after a successful catalogue refresh.
 * The consumer re-reads the current canonical snapshot before evaluating tasks,
 * so this event is deliberately not treated as authoritative product state.
 */
export async function publishAgentProductChange(input: Omit<AgentProductChangeEvent, 'observedAt'>) {
  const changed = input.observedPrice !== null &&
    (input.previousPrice === null || Math.abs(input.observedPrice - input.previousPrice) >= 0.01);

  // A newly observed product can satisfy an availability watch even when there
  // is no previous price. Unchanged prices do not need to wake the agent.
  if (!changed) return { published: false as const };

  const payload: AgentProductChangeEvent = {
    ...input,
    observedAt: new Date().toISOString(),
  };

  const { messageId } = await send(AGENT_PRODUCT_CHANGE_TOPIC, payload, {
    // Scrape batches are at-least-once. A stable key prevents duplicate agent
    // events from a redelivered product finalisation within the queue retention window.
    idempotencyKey: `${input.runUuid}:${input.storeProductId}:${input.observedPrice ?? 'na'}`,
    retentionSeconds: 86_400,
  });

  return { published: true as const, messageId };
}
