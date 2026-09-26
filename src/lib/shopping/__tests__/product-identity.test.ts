import { describe, expect, it } from 'vitest';
import { hasProductIdentityConflict } from '../product-identity';
import { resolveCatalogueRows } from '../catalogue-core';

describe('material product identity contradictions', () => {
  it.each([
    ['Mini Bananas', "Ella's Kitchen Strawberry & Banana Mini Puffs 10+ Months 4 Pack (8 g)", 'Fruit'],
    ['Onions 1kg', 'Breaded Onion Rings 1kg', 'Vegetables'],
    ['Bananas Loose', 'Fyffes 5 Organic Fairtrade Bananas', 'Fruit'],
    ['Mushrooms 250g', 'Closed Cup Mushrooms 300g', 'Vegetables'],
    ['Chicken Breast Fillets ~500g-1kg pack', 'Chicken Breast Fillets 291g', 'Meat'],
    ['Butter 200-250g', 'Butter 400g', 'Dairy'],
    ['White Bread 800g', 'Wholemeal Bread 800g', 'Bakery'],
  ])('rejects %s mapped to %s', (expected, actual, category) => {
    expect(hasProductIdentityConflict(expected, actual, category)).toBe(true);
  });

  it.each([
    ['Bananas Loose', 'SuperValu Single Loose Banana (1 kg)', 'Fruit'],
    ['Fresh Whole Milk 2L', 'Dunnes Stores Irish Whole Milk 2L', 'Dairy'],
    ['Butter 200-250g', 'Kerrygold Butter 227g', 'Dairy'],
    ['Chicken Breast Fillets 500g-1kg', 'Chicken Breast Fillets 0.6kg', 'Meat'],
    ["Ella's Kitchen Strawberry & Banana Mini Puffs 4 Pack", "Ella's Kitchen Strawberry & Banana Mini Puffs 4 x 8g", 'Baby'],
  ])('retains compatible %s', (expected, actual, category) => {
    expect(hasProductIdentityConflict(expected, actual, category)).toBe(false);
  });

  it('does not offer a baby snack through a corrupted fruit mapping', () => {
    expect(resolveCatalogueRows('bananas', [{
      canonical_product_id: 'mini-bananas', canonical_name: 'Mini Bananas', category: 'Fruit',
      store: 'supervalu', store_product_name: "Ella's Kitchen Strawberry & Banana Mini Puffs 4 Pack 8g",
      price: 2.75, was_price: null, on_promotion: false,
    }])).toEqual([]);
  });
});
