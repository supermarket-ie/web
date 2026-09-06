export type LegacyConversationMessage = { role: string; content: string };

export function boundedArchivedMessages(value: unknown, limit = 12, maxChars = 1_000) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message): message is LegacyConversationMessage => Boolean(
      message && typeof message === 'object'
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string',
    ))
    .slice(-limit)
    .map(message => ({ role: message.role as 'user' | 'assistant', content: message.content.slice(0, maxChars) }));
}

export function archivedConversationResumePrompt(conversationId: string, requestedPrompt?: string | null) {
  const id = conversationId.trim();
  const continuation = requestedPrompt?.trim() || 'help me continue from where I left off';
  return `Resume my archived conversation ${id}. Load it first, then ${continuation}.`;
}
