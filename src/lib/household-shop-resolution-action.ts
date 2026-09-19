import type { HouseholdShopContract } from './shopping/household-shop-contract';

type ShopItem = HouseholdShopContract['items'][number];

export function householdShopResolutionAction(item: ShopItem) {
  if (item.coverage_status === 'unresolved') {
    return {
      label: 'Choose product',
      prompt: `Help me choose the exact product for "${item.display_label}" in this shop. Show the strongest current catalogue matches and ask me only if the choice materially changes the item.`,
    };
  }
  if (item.coverage_status === 'unavailable') {
    return {
      label: 'Find alternative',
      prompt: `Find a currently priced alternative for "${item.display_label}" in this shop. Keep the same purpose and pack expectation where practical, and let me choose before changing the shop.`,
    };
  }
  return null;
}
