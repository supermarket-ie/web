import { describe, expect, it } from 'vitest';
import { selectEveCapabilities } from '../../../agent/lib/instruction-routing';
import { capabilityContextForMessage, instructionsForTurn } from '../../../agent/lib/capability-instructions';

describe('Eve capability instruction routing', () => {
  it('selects complete-shop rules with supporting budget and price context', () => {
    expect(selectEveCapabilities('Build a complete household shop under €120 around current offers')).toEqual(expect.arrayContaining(['household_shop', 'budget', 'price']));
    expect(instructionsForTurn('Build a complete household shop under €120').content).toMatch(/Do not spend individual resolve_product or get_current_price calls on every shop line/);
  });
  it('routes the first incoming delivery before it exists in history', () => {
    const context = capabilityContextForMessage('Help me prepare a weekly household shop for two adults with a budget of 100 euro. What can you do?').join('\n');
    expect(context).toContain('HOUSEHOLD-SHOP PLANNING');
    expect(context).toContain('After a successful present_household_shop result');
    expect(context).toContain('BUDGET REVIEW');
  });
  it('routes structured text parts without copying shopper text into application guidance', () => {
    const context = capabilityContextForMessage([{ type: 'text', text: 'Prepare a small household shop for two adults with milk.' }]).join('\n');
    expect(context).toContain('HOUSEHOLD-SHOP PLANNING');
    expect(context).not.toContain('Prepare a small household shop for two adults');
  });
  it('selects meal and ingredient guidance' , () => {
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
