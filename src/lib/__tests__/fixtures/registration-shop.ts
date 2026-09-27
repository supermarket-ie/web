import { groundHouseholdShop } from '../../shopping/household-shop';

export function guestShopFixture() {
  const shop = groundHouseholdShop({
    proposal: {
      schema_version: 'household_shop.v1',
      household: { adults: 2, children: 1, budget: 25, dietary_requirements: ['Vegetarian'], assumptions_made: ['Only the selected products'], planning_period: { days: 7, label: 'This week' } },
      sections: [{ id: 'food', label: 'Food', kind: 'food' }],
      items: [{ line_id: 'milk', section_id: 'food', unresolved_need: 'Milk', display_label: 'Milk', quantity: 3, unit_or_pack_expectation: '2L', reason: 'Breakfast' }],
    }, catalogue_products: [], latest_prices: [],
  });
  const turn = { sequence: 1, turnId: 'guest-turn', stepIndex: 0 };
  const events = [
    { type: 'message.received', data: { ...turn, message: 'Keep three 2L milks for two adults and one child, vegetarian, budget €25. Only these products.' } },
    { type: 'actions.requested', data: { ...turn, actions: [{ kind: 'tool-call', callId: 'shop', toolName: 'present_household_shop', input: {} }] } },
    { type: 'action.result', data: { ...turn, status: 'completed', result: { kind: 'tool-result', callId: 'shop', toolName: 'present_household_shop', output: { kind: 'household_shop', shop } } } },
    { type: 'message.completed', data: { ...turn, finishReason: 'stop', message: 'Your selected shop is ready to review.' } },
  ];
  return { events, shop };
}
