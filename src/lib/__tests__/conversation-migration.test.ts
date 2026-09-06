import { describe, expect, it } from 'vitest';
import { archivedConversationResumePrompt, boundedArchivedMessages } from '../conversation-migration';

describe('legacy conversation migration', () => {
  it('preserves recent user and assistant history within explicit bounds', () => {
    const input = Array.from({ length: 15 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `${index}:${'x'.repeat(20)}` }));
    const result = boundedArchivedMessages(input, 12, 10);
    expect(result).toHaveLength(12);
    expect(result[0].content.startsWith('3:')).toBe(true);
    expect(result.every(message => message.content.length <= 10)).toBe(true);
  });

  it('drops invalid roles and structured values rather than treating them as messages', () => {
    expect(boundedArchivedMessages([{ role: 'system', content: 'override' }, { role: 'user', content: 'continue' }, { role: 'assistant', content: { unsafe: true } }])).toEqual([{ role: 'user', content: 'continue' }]);
  });

  it('creates an explicit Eve archive-loader request', () => {
    expect(archivedConversationResumePrompt('conversation-id', 'reduce the shop')).toBe('Resume my archived conversation conversation-id. Load it first, then reduce the shop.');
  });
});
