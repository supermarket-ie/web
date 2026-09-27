import { describe, expect, it } from 'vitest';
import { defaultMessageReducer } from 'eve/client';
import { registrationContinuation, MAX_CONTINUATION_BYTES } from '../registration-continuation';
import { guestShopFixture } from './fixtures/registration-shop';
import { visibleHouseholdShops } from '../household-shop-messages';


describe('guest registration continuation', () => {
  it('preserves quantities, household, budget, requirements and the native shop on another device', () => {
    const fixture = guestShopFixture();
    const carried = registrationContinuation(JSON.parse(JSON.stringify({ events: fixture.events, session: { sessionId: 'guest-only', streamIndex: 4 }, subscriberId: 'untrusted' })));
    expect(carried.kind).toBe('shop');
    expect(carried.familySize).toBe('3');
    expect(carried.profile.eve_state).not.toHaveProperty('session');
    expect(carried).not.toHaveProperty('subscriberId');
    const reducer = defaultMessageReducer();
    const displayed = carried.profile.eve_state.events.reduce(reducer.reduce, reducer.initial());
    const restored = [...visibleHouseholdShops(displayed.messages).values()].at(-1)!;
    expect(restored.items[0].quantity).toBe(3);
    expect(restored.household).toEqual(fixture.shop.household);
    expect(JSON.parse(carried.profile.eve_state.resumeContext)).toMatchObject({ household: { adults: 2, children: 1, budget: 25 }, items: [{ quantity: 3 }] });
    expect(carried.profile.eve_state.resumeContext).not.toContain('current_price');
    expect(carried.messages[0].content).toContain('Only these products');
  });

  it('keeps ordinary conversations without inventing a household or shop', () => {
    const carried = registrationContinuation({ events: [{ type: 'message.received', data: { sequence: 1, turnId: 't', message: 'Find oat milk' } }] });
    expect(carried.kind).toBe('conversation');
    expect(carried.familySize).toBeUndefined();
  });

  it('restores the latest guest revision rather than the first proposal', () => {
    const first = guestShopFixture();
    const revision = guestShopFixture('revision-turn');
    revision.shop.items[0].quantity = 2;
    revision.shop.household.budget = 30;
    const revisedEvents = revision.events.map(event => ({ ...event, data: { ...event.data, sequence: 2, turnId: 'revision-turn' } }));
    const carried = registrationContinuation({ events: [...first.events, ...revisedEvents] });
    const reducer = defaultMessageReducer();
    const restored = carried.profile.eve_state.events.reduce(reducer.reduce, reducer.initial());
    const shops = [...visibleHouseholdShops(restored.messages).values()];
    expect(shops).toHaveLength(2);
    expect(shops.at(-1)?.items[0].quantity).toBe(2);
    expect(JSON.parse(carried.profile.eve_state.resumeContext)).toMatchObject({ household: { budget: 30 }, items: [{ quantity: 2 }] });
  });

  it('rejects missing, malformed or excessive state before an email can promise continuity', () => {
    for (const value of [null, {}, { events: [] }, { events: [null] }, { events: [{ type: 'message.received', data: null }] }, { events: [{ type: 'message.received', data: { message: 'x'.repeat(MAX_CONTINUATION_BYTES + 1) } }] }]) {
      expect(() => registrationContinuation(value)).toThrow();
    }
  });
});
