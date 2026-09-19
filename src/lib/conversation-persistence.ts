export type PersistedConversationMessage = { role: 'user' | 'assistant'; content: string };

const MAX_MESSAGES = 80;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_EVE_STATE_BYTES = 750_000;

export function boundedConversationMessages(value: unknown): PersistedConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const role = 'role' in item ? item.role : null;
      const content = 'content' in item ? item.content : null;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return [];
      return [{ role, content: content.trim().slice(0, MAX_MESSAGE_CHARS) }];
    })
    .slice(-MAX_MESSAGES);
}

export function validAgentChatProfile(value: unknown): value is { eve_state: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || !('eve_state' in value)) return false;
  const state = value.eve_state;
  if (!state || typeof state !== 'object') return false;
  try {
    return JSON.stringify(value).length <= MAX_EVE_STATE_BYTES;
  } catch {
    return false;
  }
}
