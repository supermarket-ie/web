import { describe, expect, it } from 'vitest';
import { buildMarketStarters } from '@/lib/market-starters';
import type { ProductPrice } from '@/lib/price-data';

function price(overrides: Partial<ProductPrice>): ProductPrice {
  return {
    canonical_product_id: 'product-1',
    canonical_name: 'Irish Chicken Fillets 1kg',
    category: 'Meat',
    store: 'dunnes',
    price: 8,
    was_price: 10,
    on_promotion: true,
    store_product_name: 'Irish Chicken Fillets 1kg',
    store_sku: 'sku',
    store_url: null,
    observed_at: '2026-09-01T10:00:00Z',
    source: 'direct',
    relationship_type: 'exact',
    freshness_state: 'fresh',
    ...overrides,
  };
}

describe('buildMarketStarters', () => {
  it('turns current market evidence into diverse prompts', () => {
    const starters = buildMarketStarters([
      price({ canonical_name: 'Irish Chicken Fillets 1kg', category: 'Meat', store: 'dunnes', price: 8, was_price: 10 }),
      price({ canonical_name: 'Laundry Capsules 30 Pack', category: 'Laundry', store: 'tesco', price: 6, was_price: 9 }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', store: 'dunnes', price: 3.5, was_price: null, on_promotion: false }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', store: 'supervalu', price: 4.2, was_price: null, on_promotion: false }),
    ]);

    expect(starters).toHaveLength(4);
    expect(starters.some(item => item.label.includes('Chicken Fillets'))).toBe(true);
    expect(starters.some(item => item.label.includes('Laundry Capsules'))).toBe(true);
    expect(starters.some(item => item.label.includes('Irish Butter'))).toBe(true);
    expect(starters.some(item => item.label.includes('current offers'))).toBe(true);
  });

  it('returns privacy-safe capability prompts when live data is unavailable', () => {
    const starters = buildMarketStarters([]);
    expect(starters).toHaveLength(4);
    expect(starters.every(item => !item.label.includes('Hellmann'))).toBe(true);
  });

  it('rotates through strong live candidates in successive market windows', () => {
    const rows = [
      price({ canonical_name: 'Irish Chicken Fillets 1kg', category: 'Meat', store: 'dunnes', price: 8, was_price: 10 }),
      price({ canonical_name: 'Salmon Fillets 400g', category: 'Fish', store: 'tesco', price: 6, was_price: 8 }),
      price({ canonical_name: 'Lean Irish Beef Mince 500g', category: 'Meat', store: 'supervalu', price: 4, was_price: 5 }),
      price({ canonical_name: 'Laundry Capsules 30 Pack', category: 'Laundry', store: 'tesco', price: 6, was_price: 9 }),
      price({ canonical_name: 'Dishwasher Tablets 40 Pack', category: 'Cleaning', store: 'dunnes', price: 7, was_price: 10 }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', store: 'dunnes', price: 3.5, was_price: null, on_promotion: false }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', store: 'supervalu', price: 4.2, was_price: null, on_promotion: false }),
      price({ canonical_name: 'Whole Milk 2L', category: 'Dairy', store: 'dunnes', price: 2.2, was_price: null, on_promotion: false }),
      price({ canonical_name: 'Whole Milk 2L', category: 'Dairy', store: 'tesco', price: 2.7, was_price: null, on_promotion: false }),
    ];

    expect(buildMarketStarters(rows, 1).map(item => item.label))
      .not.toEqual(buildMarketStarters(rows, 2).map(item => item.label));
  });
});
