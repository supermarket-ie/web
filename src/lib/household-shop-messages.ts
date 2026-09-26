import type { EveMessage, EveMessagePart } from 'eve/react';
import { householdShopToolOutputSchema, type HouseholdShopContract } from './shopping/household-shop-contract';

export function householdShopFromPart(part: EveMessagePart): HouseholdShopContract | null {
  if (part.type !== 'dynamic-tool' || part.toolName !== 'present_household_shop' ||
      part.state !== 'output-available' || part.partial) return null;
  const parsed = householdShopToolOutputSchema.safeParse(part.output);
  return parsed.success ? parsed.data.shop : null;
}

/** Keep the latest completed proposal for each user turn, including when Eve
 * appends several tool results to the same assistant message. Preserve history
 * across separate user turns and ignore unfinished or malformed revisions. */
export function visibleHouseholdShops(messages: readonly Pick<EveMessage, 'id' | 'role' | 'parts'>[]) {
  const visible = new Map<string, HouseholdShopContract>();
  let current: { messageId: string; shop: HouseholdShopContract } | null = null;
  const retain = () => { if (current) visible.set(current.messageId, current.shop); };
  for (const message of messages) {
    if (message.role === 'user') { retain(); current = null; }
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      const shop = householdShopFromPart(part);
      if (shop) current = { messageId: message.id, shop };
    }
  }
  retain();
  return visible;
}
