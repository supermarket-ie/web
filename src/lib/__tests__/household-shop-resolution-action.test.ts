import { describe, expect, it } from 'vitest';
import type { HouseholdShopContract } from '../shopping/household-shop-contract';
import { householdShopResolutionAction } from '../household-shop-resolution-action';

function item(status: HouseholdShopContract['items'][number]['coverage_status']) {
  return {
    display_label: 'Milk',
    coverage_status: status,
  } as HouseholdShopContract['items'][number];
}

describe('householdShopResolutionAction', () => {
  it('routes ambiguous products into an explicit choice', () => {
    expect(householdShopResolutionAction(item('unresolved'))).toMatchObject({
      label: 'Choose product',
      prompt: expect.stringContaining('strongest current catalogue matches'),
    });
  });

  it('routes known products without a price into alternative discovery', () => {
    expect(householdShopResolutionAction(item('unavailable'))).toMatchObject({
      label: 'Find alternative',
      prompt: expect.stringContaining('currently priced alternative'),
    });
  });

  it('does not add an action to resolved or partially covered products', () => {
    expect(householdShopResolutionAction(item('resolved'))).toBeNull();
    expect(householdShopResolutionAction(item('partial'))).toBeNull();
  });
});
