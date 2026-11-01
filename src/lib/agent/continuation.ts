import type { UIMessage } from 'ai';
import { boundedConversationMessages, type PersistedConversationMessage } from '../conversation-persistence';
import { visibleHouseholdShops } from '../household-shop-messages';
import type { HouseholdShopContract } from '../shopping/household-shop-contract';

/**
 * Message-based registration continuation for the lightweight stateless agent.
 *
 * Eve produced a continuation from its authoritative event log; the lightweight
 * runtime has no such events, only the AI SDK `UIMessage[]` the client already
 * holds. These helpers derive the same display transcript + shop view from
 * messages so the signup/continuation flow works identically without Eve.
 */

export type AgentUIMessage = UIMessage;

/** Extract the plain-text transcript from UIMessages, bounded for transport. */
export function messagesToTranscript(messages: AgentUIMessage[]): PersistedConversationMessage[] {
  return boundedConversationMessages(
    messages.map(message => ({
      role: message.role,
      content: (message.parts ?? [])
        .filter((part): part is Extract<AgentUIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
        .map(part => part.text)
        .join(''),
    })),
  );
}

/** Latest completed household shop across the conversation, or null. */
export function latestShopFromMessages(messages: AgentUIMessage[]): HouseholdShopContract | null {
  // visibleHouseholdShops reads the `dynamic-tool` part shape shared by both
  // runtimes; the UIMessage shape matches what it expects.
  const shops = visibleHouseholdShops(messages as Parameters<typeof visibleHouseholdShops>[0]);
  return [...shops.values()].at(-1) ?? null;
}

/**
 * Continuation payload shaped for `<InlineEmailSignup continuation=...>`. It
 * carries the message transcript (never Eve events) so `/api/subscribe` can
 * stage a message-based continuation. `events` is intentionally absent.
 */
export function buildMessageContinuation(messages: AgentUIMessage[]): { events?: never; messages: PersistedConversationMessage[] } {
  return { messages: messagesToTranscript(messages) };
}
