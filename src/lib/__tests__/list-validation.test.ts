import { describe, it, expect } from 'vitest';
import {
  findDietaryViolations,
  reconcilePrices,
  recomputeStoreTotals,
  type ValidatedListItem,
  type CataloguePriceRow,
} from '../list-validation';

const item = (canonical_name: string, store = 'tesco', price = 1, quantity = 1): ValidatedListItem => ({
  canonical_name,
  store,
  price,
  quantity,
});

describe('findDietaryViolations', () => {
  it('returns no violations when no dietary requirements are set', () => {
    expect(findDietaryViolations([item('Chicken Fillets 500g')], [])).toEqual([]);
  });

  it('flags meat and fish for vegetarians', () => {
    const violations = findDietaryViolations(
      [item('Chicken Fillets 500g'), item('Salmon Darnes'), item('Broccoli')],
      ['vegetarian'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual([
      'Chicken Fillets 500g',
      'Salmon Darnes',
    ]);
  });

  it('does not flag vegetarian/vegan-labelled products', () => {
    const violations = findDietaryViolations(
      [item('Vegetarian Sausages'), item('Vegan Chicken Pieces'), item('Meat-Free Mince')],
      ['vegetarian'],
    );
    expect(violations).toEqual([]);
  });

  it('flags dairy and eggs for vegans but not plant alternatives', () => {
    const violations = findDietaryViolations(
      [
        item('Whole Milk 2L'),
        item('Free Range Eggs 12pk'),
        item('Oat Milk 1L'),
        item('Peanut Butter Crunchy'),
        item('Butternut Squash'),
      ],
      ['vegan'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual([
      'Whole Milk 2L',
      'Free Range Eggs 12pk',
    ]);
  });

  it('flags gluten for gluten-free but not gluten-free variants', () => {
    const violations = findDietaryViolations(
      [item('Sliced White Bread'), item('Gluten-Free Bread 400g'), item('Penne Pasta 500g')],
      ['gluten-free'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual([
      'Sliced White Bread',
      'Penne Pasta 500g',
    ]);
  });

  it('handles diet name variants (case, spaces)', () => {
    expect(findDietaryViolations([item('Sliced White Bread')], ['Gluten Free'])).toHaveLength(1);
    expect(findDietaryViolations([item('Chicken Breast')], ['Vegetarian'])).toHaveLength(1);
  });

  it('does not flag coconut for nut-free (whole-word matching)', () => {
    const violations = findDietaryViolations(
      [item('Coconut Milk 400ml'), item('Mixed Nuts 200g')],
      ['nut-free'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual(['Mixed Nuts 200g']);
  });

  it('flags pork and alcohol for halal', () => {
    const violations = findDietaryViolations(
      [item('Bacon Rashers'), item('Chicken Fillets'), item('Red Wine 75cl')],
      ['halal'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual(['Bacon Rashers', 'Red Wine 75cl']);
  });

  it('allows fish but not meat for pescatarians', () => {
    const violations = findDietaryViolations(
      [item('Salmon Darnes'), item('Beef Mince 500g')],
      ['pescatarian'],
    );
    expect(violations.map(v => v.canonical_name)).toEqual(['Beef Mince 500g']);
  });

  it('ignores unknown dietary requirements rather than over-flagging', () => {
    expect(findDietaryViolations([item('Chicken Fillets')], ['low-carb'])).toEqual([]);
  });
});

describe('reconcilePrices', () => {
  const catalogue: CataloguePriceRow[] = [
    { canonical_name: 'Whole Milk 2L', store: 'tesco', price: 2.15 },
    { canonical_name: 'Whole Milk 2L', store: 'dunnes', price: 2.09 },
    { canonical_name: 'Sliced White Bread', store: 'tesco', price: 1.45 },
    { canonical_name: 'Sliced White Bread', store: 'tesco', price: 2.1 }, // larger pack, same canonical name
  ];

  it('keeps items whose claimed price matches the catalogue', () => {
    const { items, corrections, unverified } = reconcilePrices(
      [item('Whole Milk 2L', 'tesco', 2.15)],
      catalogue,
    );
    expect(items[0].price).toBe(2.15);
    expect(corrections).toEqual([]);
    expect(unverified).toEqual([]);
  });

  it('corrects a hallucinated price to the closest real price at that store', () => {
    const { items, corrections } = reconcilePrices(
      [item('Whole Milk 2L', 'tesco', 1.5)],
      catalogue,
    );
    expect(items[0].price).toBe(2.15);
    expect(corrections).toEqual([
      { canonical_name: 'Whole Milk 2L', store: 'tesco', claimed_price: 1.5, actual_price: 2.15 },
    ]);
  });

  it('matches store case-insensitively', () => {
    const { corrections } = reconcilePrices([item('Whole Milk 2L', 'Tesco', 2.15)], catalogue);
    expect(corrections).toEqual([]);
  });

  it('accepts any real price when a store has multiple pack sizes', () => {
    const { corrections } = reconcilePrices(
      [item('Sliced White Bread', 'tesco', 2.1)],
      catalogue,
    );
    expect(corrections).toEqual([]);
  });

  it('reports items missing from the catalogue at that store as unverified', () => {
    const { items, unverified, corrections } = reconcilePrices(
      [item('Imaginary Artisan Loaf', 'tesco', 3.5), item('Whole Milk 2L', 'supervalu', 2.2)],
      catalogue,
    );
    expect(unverified).toEqual(['Imaginary Artisan Loaf', 'Whole Milk 2L']);
    expect(corrections).toEqual([]);
    expect(items.map(i => i.price)).toEqual([3.5, 2.2]); // passed through untouched
  });
});

describe('recomputeStoreTotals', () => {
  it('computes totals and item counts per store from items', () => {
    const totals = recomputeStoreTotals([
      item('Milk', 'tesco', 2.15),
      item('Bread', 'tesco', 1.45),
      item('Eggs', 'dunnes', 3.99),
    ]);
    // Sorted cheapest store first
    expect(totals).toEqual([
      { store: 'tesco', total: 3.6, item_count: 2 },
      { store: 'dunnes', total: 3.99, item_count: 1 },
    ]);
  });

  it('multiplies by quantity and defaults missing quantity to 1', () => {
    const totals = recomputeStoreTotals([
      item('Yoghurt', 'aldi', 0.99, 4),
      { canonical_name: 'Bananas', store: 'aldi', price: 1.5 },
    ]);
    expect(totals).toEqual([{ store: 'aldi', total: 5.46, item_count: 5 }]);
  });

  it('normalises store casing and avoids float drift', () => {
    const totals = recomputeStoreTotals([
      item('A', 'Tesco', 0.1),
      item('B', 'tesco', 0.2),
    ]);
    expect(totals).toEqual([{ store: 'tesco', total: 0.3, item_count: 2 }]);
  });

  it('returns an empty array for no items', () => {
    expect(recomputeStoreTotals([])).toEqual([]);
  });
});
