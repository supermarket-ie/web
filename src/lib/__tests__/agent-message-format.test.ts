import { describe, expect, it } from 'vitest';
import { agentMessageBlocks, shopperFacingAgentText } from '../agent-message-format';

describe('agent message formatting', () => {
  it('parses a markdown table into structured rows', () => {
    expect(agentMessageBlocks('**Priced:**\n| Item | Qty | Price |\n|---|---|---|\n| Milk | 1 | €3.19 |')).toEqual([
      { type: 'text', text: '**Priced:**' },
      { type: 'table', headers: ['Item', 'Qty', 'Price'], rows: [['Milk', '1', '€3.19']] },
    ]);
  });

  it('replaces internal lookup-limit language in saved responses', () => {
    expect(shopperFacingAgentText('Still unresolved this turn (hit a catalogue lookup limit, so I left these out rather than guess): Milk'))
      .toBe('Still to check: Milk');
  });
});
