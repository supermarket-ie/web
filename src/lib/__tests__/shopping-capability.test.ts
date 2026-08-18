import { describe, expect, it } from 'vitest';
import { computeBasketStoreTotals, selectOffer } from '../shopping/basket';
import { compareBasketStores } from '../shopping/compare';
import { normaliseHouseholdContext } from '../shopping/household';

describe('shopping capability layer', () => {
  it('normalises household context defaults', () => {
    expect(normaliseHouseholdContext({ subscriber_id: 'sub-1' })).toEqual({
      subscriber_id: 'sub-1',
      family_size: null,
      weekly_budget: null,
      dietary: [],
      dislikes: null,
      preferred_stores: [],
      memory: {},
    });
  });

  it('prefers the cheapest offer within preferred stores', () => {
    const offer = selectOffer([
      { retailer: 'Dunnes', retailer_product_name: 'Milk', price: 2.2, on_promotion: false },
      { retailer: 'SuperValu', retailer_product_name: 'Milk', price: 2.0, on_promotion: false },
      { retailer: 'Aldi', retailer_product_name: 'Milk', price: 1.8, on_promotion: false },
    ], ['Dunnes', 'SuperValu']);

    expect(offer?.retailer).toBe('SuperValu');
  });

  it('computes store totals from selected retailer offers', () => {
    const totals = computeBasketStoreTotals([
      {
        canonical_name: 'Milk 2L',
        quantity: 2,
        selected_offer: {
          retailer: 'SuperValu',
          retailer_product_name: 'Milk 2L',
          price: 2.1,
          on_promotion: false,
        },
      },
    ]);

    expect(totals).toEqual([{ store: 'SuperValu', total: 4.2, item_count: 2 }]);
  });

  it('does not present incomplete retailer coverage as a complete basket', () => {
    const result = compareBasketStores(
      [
        { canonical_name: 'Milk 2L', quantity: 1, current_price: 2.1 },
        { canonical_name: 'Bread 800g', quantity: 1, current_price: 2.5 },
      ],
      [
        { canonical_name: 'Milk 2L', store: 'Dunnes', price: 2.0 },
        { canonical_name: 'Bread 800g', store: 'Dunnes', price: 2.4 },
        { canonical_name: 'Milk 2L', store: 'SuperValu', price: 1.9 },
      ],
    );

    expect(result.comparisons[0]).toMatchObject({
      store: 'Dunnes',
      complete: true,
      total: 4.4,
      covered_products: 2,
    });
    expect(result.comparisons[1]).toMatchObject({
      store: 'SuperValu',
      complete: false,
      missing_products: ['Bread 800g'],
    });
  });
});
