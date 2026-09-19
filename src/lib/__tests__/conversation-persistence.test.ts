import { describe, expect, it } from 'vitest';
import { boundedConversationMessages, validAgentChatProfile } from '@/lib/conversation-persistence';

describe('conversation persistence', () => {
  it('keeps only bounded user and assistant text', () => {
    const result = boundedConversationMessages([
      { role: 'system', content: 'ignore' },
      { role: 'user', content: '  make my shop cheaper  ' },
      { role: 'assistant', content: 'Done' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'make my shop cheaper' },
      { role: 'assistant', content: 'Done' },
    ]);
  });

  it('rejects unbounded agent state', () => {
    expect(validAgentChatProfile({ eve_state: { events: [] } })).toBe(true);
    expect(validAgentChatProfile({ eve_state: { events: ['x'.repeat(760_000)] } })).toBe(false);
  });
});
