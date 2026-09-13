import { describe, expect, it } from 'vitest';
import { MAX_EXPENSIVE_TOOL_CALLS_PER_TURN } from '../../../agent/lib/turn-budget';

describe('Eve runaway-turn policy', () => {
  it('keeps the expensive catalogue/planning tool ceiling deliberately bounded', () => {
    expect(MAX_EXPENSIVE_TOOL_CALLS_PER_TURN).toBeGreaterThanOrEqual(6);
    expect(MAX_EXPENSIVE_TOOL_CALLS_PER_TURN).toBeLessThanOrEqual(12);
  });
});
