import { describe, expect, it } from 'vitest';
import { sanitizeStoreTotals, sanitizeStructuredItems } from '../saved-list-sanitize';

const fresh = new Date(Date.now() - 3600_000).toISOString();

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
    expect(sanitizeStoreTotals([
      { store: 'dunnes', total: '41.20', basis: 'verified_exact' },
      { store: 'supervalu', total: 42, basis: 'verified_exact' },
    ], fresh)?.[0].total).toBe(41.2);
  });

  it('drops incomplete/null store totals rather than coercing them to zero', () => {
    expect(sanitizeStoreTotals([
      { store: 'tesco', total: null, item_count: 4, basis: 'verified_exact' },
      { store: 'dunnes', total: 41.2, item_count: 7, basis: 'verified_exact' },
      { store: 'aldi', total: 40.5, item_count: 7, basis: 'verified_exact' },
      { store: 'supervalu', total: Number.NaN, item_count: 5, basis: 'verified_exact' },
    ], fresh)).toEqual([
      { store: 'aldi', total: 40.5, item_count: 7, basis: 'verified_exact' },
      { store: 'dunnes', total: 41.2, item_count: 7, basis: 'verified_exact' },
    ]);
  });

  it('never displays legacy or indicative store totals (unverified canonical associations)', () => {
    expect(sanitizeStoreTotals([{ store: 'dunnes', total: 41.2 }, { store: 'supervalu', total: 39 }], fresh)).toEqual([]);
    expect(sanitizeStoreTotals([{ store: 'dunnes', total: 41.2, basis: 'indicative' }, { store: 'supervalu', total: 39, basis: 'indicative' }], fresh)).toEqual([]);
    // A single verified total is not a comparison between stores.
    expect(sanitizeStoreTotals([{ store: 'dunnes', total: 41.2, basis: 'verified_exact' }], fresh)).toEqual([]);
  });

  it('hides verified totals once the 14-day pair-review horizon has passed, or when the time is unknown', () => {
    const both = [{ store: 'dunnes', total: 41.2, basis: 'verified_exact' }, { store: 'supervalu', total: 39, basis: 'verified_exact' }];
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(sanitizeStoreTotals(both, '2026-11-04T12:00:00Z', now)).toHaveLength(2);
    expect(sanitizeStoreTotals(both, '2026-11-03T11:59:00Z', now)).toEqual([]);
    expect(sanitizeStoreTotals(both, null, now)).toEqual([]);
    expect(sanitizeStoreTotals(both, 'not a date', now)).toEqual([]);
  });

  it('returns null when a saved list contains no safely renderable priced items', () => {
    expect(sanitizeStructuredItems([
      { canonical_name: 'Milk 2L', store: 'tesco', price: null },
    ])).toBeNull();
  });
});
