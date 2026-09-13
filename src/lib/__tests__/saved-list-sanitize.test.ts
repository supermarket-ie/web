import { describe, expect, it } from 'vitest';
import { sanitizeStoreTotals, sanitizeStructuredItems } from '../saved-list-sanitize';

describe('saved list monetary sanitization', () => {
  it('drops incomplete/null item prices before client currency formatting', () => {
    expect(sanitizeStructuredItems([
      { canonical_name: 'Milk 2L', store: 'tesco', price: null },
      { canonical_name: 'Bread 800g', store: 'dunnes', price: 2.49 },
      { canonical_name: 'Eggs 12', store: 'supervalu' },
    ])).toEqual([
      { canonical_name: 'Bread 800g', store: 'dunnes', price: 2.49, quantity: undefined, category: undefined, store_product_name: undefined, on_promotion: undefined },
    ]);
  });

  it('preserves valid numeric-string monetary values from database JSON', () => {
    expect(sanitizeStructuredItems([
      { canonical_name: 'Bread 800g', store: 'dunnes', price: '2.49' },
    ])?.[0].price).toBe(2.49);
    expect(sanitizeStoreTotals([{ store: 'dunnes', total: '41.20' }])?.[0].total).toBe(41.2);
  });

  it('drops incomplete/null store totals rather than coercing them to zero', () => {
    expect(sanitizeStoreTotals([
      { store: 'tesco', total: null, item_count: 4 },
      { store: 'dunnes', total: 41.2, item_count: 7 },
      { store: 'supervalu', total: Number.NaN, item_count: 5 },
    ])).toEqual([
      { store: 'dunnes', total: 41.2, item_count: 7 },
    ]);
  });

  it('returns null when a saved list contains no safely renderable priced items', () => {
    expect(sanitizeStructuredItems([
      { canonical_name: 'Milk 2L', store: 'tesco', price: null },
    ])).toBeNull();
  });
});
