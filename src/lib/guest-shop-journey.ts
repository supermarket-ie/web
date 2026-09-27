import type { EveMessage } from 'eve/react';
import { inferSuggestionIntent, isPersistentGuestRequest } from './agent-suggestions';
import { visibleHouseholdShops } from './household-shop-messages';
import type { HouseholdShopContract } from './shopping/household-shop-contract';

type Message = Pick<EveMessage, 'id' | 'role' | 'parts'>;
const textOf = (message: Message) => message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('');

/** A bounded guest experience: up to two turns to build, then one revision.
 * This is a UX gate; authenticated tools retain their existing server boundary. */
export function guestShopJourney(messages: readonly Message[]) {
  const proposals = visibleHouseholdShops(messages);
  let turns = 0;
  let firstProposalTurn: number | null = null;
  let persistent = false;
  let shopping = proposals.size > 0;
  for (const message of messages) {
    if (message.role === 'user') {
      turns++;
      const text = textOf(message);
      const intent = inferSuggestionIntent(text);
      persistent ||= isPersistentGuestRequest(text);
      shopping ||= intent === 'shop' || (['meal', 'budget'].includes(intent) && /\b(plan|shop|feed|prepare)\b/i.test(text));
    }
    if (firstProposalTurn == null && proposals.has(message.id)) firstProposalTurn = turns;
  }
  const limit = firstProposalTurn == null ? 2 : Math.min(3, firstProposalTurn + 1);
  return { shopping, gated: persistent || turns >= limit, revisionAvailable: firstProposalTurn != null && turns < limit && !persistent };
}

/** Describe actual line changes without claiming savings from incomplete totals. */
export function shopRevisionSummary(previous: HouseholdShopContract | null, current: HouseholdShopContract): string | null {
  if (!previous) return null;
  const key = (item: HouseholdShopContract['items'][number]) => item.canonical_product_id ?? item.display_label.toLowerCase().trim();
  const group = (shop: HouseholdShopContract) => {
    const result = new Map<string, string[]>();
    for (const item of shop.items) {
      const identity = key(item);
      result.set(identity, [...(result.get(identity) ?? []), JSON.stringify([item.quantity, item.unit_or_pack_expectation, item.selected_offer?.retailer, item.line_total, item.coverage_status])]);
    }
    return new Map([...result].map(([identity, lines]) => [identity, lines.sort().join('|')]));
  };
  const before = group(previous);
  const after = group(current);
  const added = [...after.keys()].filter(id => !before.has(id)).length;
  const removed = [...before.keys()].filter(id => !after.has(id)).length;
  const changed = [...after].filter(([id, value]) => before.has(id) && before.get(id) !== value).length;
  const changes = [added && `${added} added`, removed && `${removed} removed`, changed && `${changed} updated`].filter(Boolean);
  if (changes.length) return `Shop changes: ${changes.join(' · ')}.`;
  if (JSON.stringify(previous.household) !== JSON.stringify(current.household)) return 'Your household details have been updated.';
  return 'Your shop has been checked again.';
}
