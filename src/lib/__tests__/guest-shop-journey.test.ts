import { describe, expect, it } from 'vitest';
import type { EveMessage, EveMessagePart } from 'eve/react';
import { guestShopJourney, shopRevisionSummary } from '../guest-shop-journey';
import { guestShopFixture } from './fixtures/registration-shop';

type Message = Pick<EveMessage, 'id' | 'role' | 'parts'>;
const user = (id: string, text: string): Message => ({ id, role: 'user', parts: [{ type: 'text', text }] });
const answer = (id: string, text: string): Message => ({ id, role: 'assistant', parts: [{ type: 'text', text }] });
const proposal = (id: string, partial = false): Message => ({ id, role: 'assistant', parts: [{
  type: 'dynamic-tool', toolName: 'present_household_shop', toolCallId: id, state: 'output-available', input: {},
  output: { kind: 'household_shop', shop: guestShopFixture().shop }, ...(partial ? { partial: true as const } : {}),
} as EveMessagePart] });

describe('guest shop journey', () => {
  it('opens a receipt for a shop request, not a standalone price question', () => {
    expect(guestShopJourney([user('1', 'Plan my weekly household shop')]).shopping).toBe(true);
    expect(guestShopJourney([user('1', 'What is the price of milk?')]).shopping).toBe(false);
    expect(guestShopJourney([user('1', 'Plan four dinners')]).shopping).toBe(true);
  });
  it('allows one revision after a direct first-turn proposal, then gates', () => {
    const messages = [user('1', 'Build a household shop'), proposal('2')];
    expect(guestShopJourney(messages)).toMatchObject({ gated: false, revisionAvailable: true });
    expect(guestShopJourney([...messages, user('3', 'Make the milk quantity two'), proposal('4')])).toMatchObject({ gated: true, revisionAvailable: false });
  });
  it('does not consume the revision allowance on the initial clarification', () => {
    const messages = [user('1', 'Build a household shop'), { id: '2', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'How many people? [[guest_clarification]]' }] }, user('3', 'Two adults'), proposal('4')];
    expect(guestShopJourney(messages)).toMatchObject({ gated: false, revisionAvailable: true });
    expect(guestShopJourney([...messages, user('5', 'Add two milks')]).gated).toBe(true);
  });
  it('retains the two-turn bound without a valid proposal and for partial tool output', () => {
    const messages = [user('1', 'Build a household shop'), user('2', 'Two adults'), proposal('3', true)];
    expect(guestShopJourney(messages)).toMatchObject({ gated: true, revisionAvailable: false });
  });
  it('still gates a persistent watch request immediately', () => {
    expect(guestShopJourney([user('1', 'Watch the price of milk'), proposal('2')])).toMatchObject({ gated: true, revisionAvailable: false });
  });
  it('keeps ideas exploratory but requires registration after two answers without a shop', () => {
    const messages = [user('1', 'Suggest different ways to use Philadelphia cheese'), answer('2', 'Try creamy pasta or stuffed peppers. Which would you like a shopping list for?')];
    expect(guestShopJourney(messages)).toMatchObject({ shopping: false, gated: false, revisionAvailable: false });
    expect(guestShopJourney([...messages, user('3', 'Tell me more about the peppers'), answer('4', 'Mix the cheese with herbs and bake in pepper halves.')])).toMatchObject({ shopping: false, gated: true, revisionAvailable: false });
  });
  it('lets an ideas conversation become a shop, then requires registration after one revision', () => {
    const messages = [user('1', 'What could I make with Philadelphia?'), answer('2', 'Creamy pasta. Shall I prepare a shopping list?'), user('3', 'Yes, for two. I already have the cheese.'), proposal('4')];
    expect(guestShopJourney(messages)).toMatchObject({ shopping: true, gated: false, revisionAvailable: true });
    expect(guestShopJourney([...messages, user('5', 'Add a garlic baguette'), proposal('6')])).toMatchObject({ shopping: true, gated: true, revisionAvailable: false });
  });
  it('describes real quantity changes without treating changing line IDs as products added', () => {
    const previous = guestShopFixture().shop;
    const current = structuredClone(previous);
    current.items[0].line_id = 'new-generated-id';
    current.items[0].quantity = 2;
    expect(shopRevisionSummary(previous, current)).toBe('Shop changes: 1 updated.');
  });
  it('describes additions and removals without inventing a saving', () => {
    const previous = guestShopFixture().shop;
    const current = structuredClone(previous);
    current.items[0].display_label = 'Bread';
    expect(shopRevisionSummary(previous, current)).toBe('Shop changes: 1 added · 1 removed.');
    expect(shopRevisionSummary(null, current)).toBeNull();
  });
});
