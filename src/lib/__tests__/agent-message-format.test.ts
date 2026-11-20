import { describe, expect, it } from 'vitest';
import { shopperFacingAgentText } from '../agent-message-format';

describe('agent message formatting', () => {
  it('replaces internal lookup-limit language in saved responses', () => {
    expect(shopperFacingAgentText('Still unresolved this turn (hit a catalogue lookup limit, so I left these out rather than guess): Milk'))
      .toBe('Still to check: Milk');
  });
});
