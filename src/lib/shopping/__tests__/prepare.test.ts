import { describe, expect, it } from 'vitest';
import { prepareHouseholdShop } from '../prepare';

const household = {
  subscriber_id: 'household-1',
  family_size: 2,
  weekly_budget: 120,
  dietary: [],
  dislikes: null,
  preferred_stores: ['SuperValu'],
  memory: {},
};

describe('prepareHouseholdShop', () => {
  it('includes a replenishment-due product and prefers the household retailer', () => {
    const result = prepareHouseholdShop({
      household,
      now: new Date('2026-08-18T12:00:00Z'),
      history: [
        { canonical_name: 'Milk 2L', category: 'Dairy', store: 'Dunnes', price_paid: 2.5, quantity: 1, observed_at: '2026-08-04T12:00:00Z' },
        { canonical_name: 'Milk 2L', category: 'Dairy', store: 'Dunnes', price_paid: 2.4, quantity: 1, observed_at: '2026-07-21T12:00:00Z' },
      ],
      current_items: [],
      catalogue_prices: [
        { canonical_name: 'Milk 2L', category: 'Dairy', store: 'Dunnes', price: 2.2, on_promotion: false },
        { canonical_name: 'Milk 2L', category: 'Dairy', store: 'SuperValu', price: 2.5, on_promotion: false },
      ],
    });

    expect(result.basket.items).toHaveLength(1);
    expect(result.basket.items[0].selected_offer?.retailer).toBe('SuperValu');
    expect(result.decisions[0].action).toBe('included');
  });

  it('suppresses a product the household explicitly dislikes', () => {
    const result = prepareHouseholdShop({
      household: { ...household, dislikes: 'mushrooms' },
      now: new Date('2026-08-18T12:00:00Z'),
      history: [
        { canonical_name: 'Button Mushrooms 250g', category: 'Vegetables', store: 'Dunnes', price_paid: 2, quantity: 1, observed_at: '2026-08-01T12:00:00Z' },
        { canonical_name: 'Button Mushrooms 250g', category: 'Vegetables', store: 'Dunnes', price_paid: 2, quantity: 1, observed_at: '2026-07-15T12:00:00Z' },
      ],
      current_items: [],
      catalogue_prices: [
        { canonical_name: 'Button Mushrooms 250g', category: 'Vegetables', store: 'Dunnes', price: 1.9, on_promotion: true },
      ],
    });

    expect(result.basket.items).toHaveLength(0);
    expect(result.suppressed[0].canonical_name).toBe('Button Mushrooms 250g');
    expect(result.suppressed[0].action).toBe('not_added');
  });

  it('does not re-add a recently purchased recurring product before it is due', () => {
    const result = prepareHouseholdShop({
      household,
      now: new Date('2026-08-18T12:00:00Z'),
      history: [
        { canonical_name: 'Washing Tablets 30pk', category: 'Household', store: 'SuperValu', price_paid: 8, quantity: 1, observed_at: '2026-08-16T12:00:00Z' },
        { canonical_name: 'Washing Tablets 30pk', category: 'Household', store: 'SuperValu', price_paid: 8, quantity: 1, observed_at: '2026-07-19T12:00:00Z' },
      ],
      current_items: [],
      catalogue_prices: [
        { canonical_name: 'Washing Tablets 30pk', category: 'Household', store: 'SuperValu', price: 7.5, on_promotion: true },
      ],
    });

    expect(result.basket.items).toHaveLength(0);
    expect(result.suppressed[0].signals).toContain('recent purchase');
  });
});
