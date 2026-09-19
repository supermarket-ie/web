import { describe, expect, it } from 'vitest';
import { currentShopSummary } from '@/lib/shopping/current-shop-summary';

const base = {
  id: 'list-1',
  name: 'Weekly shop',
  generated_at: '2026-09-18T12:00:00.000Z',
  created_at: '2026-09-18T12:00:00.000Z',
};

describe('currentShopSummary', () => {
  it('calculates a selected-price estimate without claiming unresolved lines', () => {
    const summary = currentShopSummary({
      ...base,
      items: [
        { display_label: 'Milk', category: 'Essentials', quantity: 2, price: 1.5, coverage_status: 'resolved' },
        { unresolved_need: 'A quick dinner', category: 'Meals', quantity: 1, price: null, coverage_status: 'unresolved' },
      ],
    });

    expect(summary).toMatchObject({ itemCount: 2, estimatedTotal: 3, unresolvedCount: 1 });
    expect(summary?.lines[1]).toMatchObject({ label: 'A quick dinner', price: null, unresolved: true });
  });

  it('keeps unavailable and partial structured lines in attention state', () => {
    const summary = currentShopSummary({
      ...base,
      items: [
        { canonical_name: 'Bread', quantity: 1, price: null, coverage_status: 'unavailable' },
        { canonical_name: 'Eggs', quantity: 1, price: 3.2, coverage_status: 'partial' },
      ],
    });

    expect(summary?.unresolvedCount).toBe(2);
    expect(summary?.estimatedTotal).toBe(0);
  });

  it('supports priced legacy rows that predate coverage status', () => {
    const summary = currentShopSummary({
      ...base,
      items: [{ canonical_name: 'Butter', category: 'Dairy', quantity: 1, price: 3.75 }],
    });

    expect(summary).toMatchObject({ itemCount: 1, estimatedTotal: 3.75, unresolvedCount: 0 });
  });
});
