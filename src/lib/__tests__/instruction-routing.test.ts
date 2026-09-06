import { describe, expect, it } from 'vitest';
import { selectEveCapabilities } from '../../../agent/lib/instruction-routing';
import { instructionsForTurn } from '../../../agent/instructions/capabilities';

describe('Eve capability instruction routing', () => {
  it('selects complete-shop rules with supporting budget and price context', () => {
    expect(selectEveCapabilities('Build a complete household shop under €120 around current offers')).toEqual(expect.arrayContaining(['household_shop', 'budget', 'price']));
  });
  it('selects meal and ingredient guidance', () => {
    expect(selectEveCapabilities('Plan four dinners with ingredients reused to reduce waste')).toContain('meal');
  });
  it('keeps safety distinctions inside selected capability content', () => {
    expect(instructionsForTurn('Compare my basket at one supermarket').content).toMatch(/partial basket has no complete total/);
  });
  it('does not expose every capability for an ordinary product lookup', () => {
    const selected = selectEveCapabilities('Find ordinary milk');
    expect(selected).toContain('product');
    expect(selected).not.toContain('monitoring');
  });
});
