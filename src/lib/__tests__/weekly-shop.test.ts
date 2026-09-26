import { describe, expect, it } from 'vitest';
import { buildWeeklyExample, EXAMPLE_WEEKLY_ITEMS, weeklyShopPrompt, weeklyShopTotals, type WeeklyItem } from '../weekly-shop';
import type { ProductPrice } from '../price-data';

const items: WeeklyItem[] = [
  { id: 'milk', name: 'Milk 2L', quantity: 1, offers: { tesco: { price: 2.25, name: 'Milk 2L', observedAt: '2026-09-25T12:00:00Z' }, dunnes: { price: 2.1, name: 'Milk 2L', observedAt: '2026-09-25T12:00:00Z' } } },
  { id: 'bread', name: 'Bread 800g', quantity: 1, offers: { tesco: { price: 1.19, name: 'Bread 800g', observedAt: '2026-09-25T12:00:00Z' } } },
];

describe('weekly-shop cost truth', () => {
  it('multiplies quantities and separates full totals from incomplete subtotals', () => {
    const [tesco, dunnes, supervalu] = weeklyShopTotals(items, { milk: 3, bread: 2 });
    expect(tesco).toMatchObject({ subtotal: 9.13, total: 9.13, pricedCount: 2, selectedCount: 2 });
    expect(dunnes).toMatchObject({ subtotal: 6.3, total: null, missingCount: 1 });
    expect(supervalu).toMatchObject({ subtotal: null, total: null, pricedCount: 0 });
  });

  it('recalculates coverage when removing a product and never makes an empty basket a zero-cost shop', () => {
    expect(weeklyShopTotals(items, { milk: 1, bread: 0 })[1]).toMatchObject({ total: 2.1, selectedCount: 1 });
    expect(weeklyShopTotals(items, { milk: 0, bread: 0 }).every(store => store.total === null && store.subtotal === null)).toBe(true);
  });

  it('matches only canonical IDs, retains unavailable lines and rejects expired observations', () => {
    const now = Date.parse('2026-09-26T12:00:00Z');
    const base = { canonical_product_id: EXAMPLE_WEEKLY_ITEMS[0].id, canonical_name: 'Renamed milk 2L', store: 'tesco', price: 2.25, relationship_type: 'exact', freshness_state: 'fresh', observed_at: '2026-09-25T12:00:00Z' } as ProductPrice;
    const result = buildWeeklyExample([
      base,
      { ...base, canonical_product_id: 'wrong-id', canonical_name: EXAMPLE_WEEKLY_ITEMS[1].name, store: 'dunnes' },
      { ...base, store: 'supervalu', observed_at: '2026-09-18T12:00:00Z' },
      { ...base, store: 'dunnes', price: 0 },
    ], now);
    expect(result).toHaveLength(EXAMPLE_WEEKLY_ITEMS.length);
    expect(result[0].name).toBe('Renamed milk 2L');
    expect(Object.keys(result[0].offers)).toEqual(['tesco']);
    expect(result[1].offers).toEqual({});
  });

  it('carries household needs and selected quantities into the existing agent without supplied prices', () => {
    const prompt = weeklyShopPrompt({ adults: 2, children: 2, budget: '120', needs: 'School lunches; already have pasta.', useExample: true, items, quantities: { milk: 3, bread: 0 } });
    expect(prompt).toContain('2 adults and 2 children');
    expect(prompt).toContain('€120');
    expect(prompt).toContain('3 × Milk 2L');
    expect(prompt).not.toContain('catalogue ID');
    expect(prompt).not.toContain('Bread 800g');
    expect(prompt).not.toContain('2.25');
    expect(prompt).toContain('already have pasta');
    expect(weeklyShopPrompt({ adults: 1, children: 0, budget: '', needs: 'Vegetarian dinners', useExample: false, items, quantities: { milk: 3 } })).not.toContain('Milk 2L');
  });
});
