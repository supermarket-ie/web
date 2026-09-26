import { describe, expect, it } from 'vitest';
import type { EveMessage, EveMessagePart } from 'eve/react';
import { visibleHouseholdShops } from '../household-shop-messages';
import { groundHouseholdShop } from '../shopping/household-shop';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION } from '../shopping/household-shop-contract';
import { householdShopModelSummary } from '../../../agent/lib/household-shop-summary';

function shop(label: string) {
  return groundHouseholdShop({
    proposal: {
      schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
      household: { adults: 2, planning_period: { days: 7, label }, assumptions_made: [], dietary_requirements: [] },
      sections: [{ id: 'food', label: 'Food', kind: 'food' }],
      items: [{ line_id: 'milk', section_id: 'food', unresolved_need: 'Milk', display_label: 'Milk', quantity: 1, unit_or_pack_expectation: '2L', reason: 'Breakfast' }],
    }, catalogue_products: [], latest_prices: [],
  });
}
const part = (label: string, partial = false): Extract<EveMessagePart, { type: 'dynamic-tool'; state: 'output-available' }> => ({
  type: 'dynamic-tool', toolName: 'present_household_shop', toolCallId: label,
  state: 'output-available', input: {}, output: { kind: 'household_shop', shop: shop(label) },
  ...(partial ? { partial: true as const } : {}),
});
const message = (id: string, role: 'user' | 'assistant', parts: EveMessagePart[] = []): Pick<EveMessage, 'id' | 'role' | 'parts'> => ({ id, role, parts });

describe('household shop presentation', () => {
  it('selects the last proposal within one message, fixing stale autosave selection', () => {
    const visible = visibleHouseholdShops([message('user', 'user'), message('answer', 'assistant', [part('first'), part('revised')])]);
    expect([...visible.values()].map(value => value.household.planning_period.label)).toEqual(['revised']);
  });

  it('replaces repeated proposals within a turn while preserving earlier user turns', () => {
    const visible = visibleHouseholdShops([
      message('u1', 'user'), message('a1', 'assistant', [part('first')]), message('a2', 'assistant', [part('revision')]),
      message('u2', 'user'), message('a3', 'assistant', [part('next turn')]),
    ]);
    expect([...visible.keys()]).toEqual(['a2', 'a3']);
    expect([...visible.values()].at(-1)?.household.planning_period.label).toBe('next turn');
  });

  it('keeps the completed shop visible while a revision is partial or invalid', () => {
    expect(visibleHouseholdShops([message('answer', 'assistant', [part('complete'), part('partial', true), {
      ...part('invalid'), output: { kind: 'household_shop', shop: {} },
    }])]).get('answer')?.household.planning_period.label).toBe('complete');
  });

  it('gives the model a bounded honest summary without repeating all card data', () => {
    const full = shop('Weekly shop');
    const summary = householdShopModelSummary(full);
    expect(summary).toMatchObject({ state: 'proposed', total_lines: 1, priced_lines: 0, priced_subtotal: 0 });
    expect(summary.unpriced_items).toHaveLength(1);
    expect(summary.store_coverage.every(store => store.basket_total === null)).toBe(true);
    expect(summary).not.toHaveProperty('items');
    expect(summary).not.toHaveProperty('provenance');
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(full).length / 2);
  });
});
