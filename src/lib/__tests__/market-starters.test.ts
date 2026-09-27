import { describe, expect, it } from 'vitest';
import { buildMarketStarters } from '@/lib/market-starters';
import type { ProductPrice } from '@/lib/price-data';
import { inferSuggestionIntent } from '@/lib/agent-suggestions';
import { guestShopJourney } from '@/lib/guest-shop-journey';

function price(overrides: Partial<ProductPrice> = {}): ProductPrice {
  const name = overrides.canonical_name ?? 'Irish Chicken Fillets 1kg';
  return {
    canonical_product_id: name,
    canonical_name: name,
    category: 'Meat',
    store: 'dunnes',
    price: 8,
    was_price: 10,
    on_promotion: true,
    store_product_name: name,
    store_sku: 'sku',
    store_url: null,
    observed_at: '2026-09-24T10:00:00Z',
    source: 'direct',
    relationship_type: 'exact',
    freshness_state: 'fresh',
    ...overrides,
  };
}

function comparisonFor(first: string, second: string) {
  return buildMarketStarters([
    price({ canonical_product_id: 'shared-id', store_product_name: first, price: 4 }),
    price({ canonical_product_id: 'shared-id', store_product_name: second, store: 'supervalu', price: 7 }),
  ])[3];
}

describe('buildMarketStarters', () => {
  it('prioritises a household shop, then food, household value and an eligible comparison', () => {
    const starters = buildMarketStarters([
      price(),
      price({ canonical_name: 'Laundry Capsules 30 Pack', category: 'Laundry', store: 'tesco', price: 6, was_price: 9 }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', price: 3.5, was_price: null, on_promotion: false }),
      price({ canonical_name: 'Irish Butter 454g', category: 'Dairy', store: 'supervalu', price: 4.2, was_price: null, on_promotion: false }),
    ]);
    expect(starters.map(item => item.icon)).toEqual(['shop', 'meal', 'offer', 'compare']);
    expect(starters[0].label).toBe('Build my household shop');
    expect(starters[1].label).toContain('Chicken Fillets');
    expect(starters[2].label).toContain('Laundry Capsules');
    expect(starters[3].label).toContain('Irish Butter');
    expect(starters.slice(1).every(item => item.detail.includes('24 Sept 2026'))).toBe(true);
    expect(starters.map(item => item.label + item.detail).join(' ')).not.toMatch(/today|this week|\d+ (?:offers|stores|retailers)/i);
  });

  it('uses honest capability fallbacks and never makes a meal starter from a nonfood deal', () => {
    const fallback = buildMarketStarters([]);
    expect(fallback).toHaveLength(4);
    expect(fallback.every(item => !item.detail.includes('€'))).toBe(true);
    const householdOnly = buildMarketStarters([price({ canonical_name: 'Laundry Capsules 30 Pack', category: 'Laundry' })]);
    expect(householdOnly[1]).toEqual(fallback[1]);
    expect(buildMarketStarters([price()])[2]).toEqual(fallback[2]);
  });

  it('retains the actual retailer brand and pack in offer labels', () => {
    const starters = buildMarketStarters([price({ canonical_name: 'Soft Cheese', store_product_name: 'Philadelphia Original Soft Cream Cheese 165g', category: 'Dairy' })]);
    expect(starters[1].label).toContain('Philadelphia Original Soft Cream Cheese 165g');
    expect(starters[1].prompt).toContain('Recheck any prices');
    expect(inferSuggestionIntent(starters[1].prompt)).toBe('meal');
    expect(guestShopJourney([{ id: 'meal-start', role: 'user', parts: [{ type: 'text', text: starters[1].prompt }] }]).shopping).toBe(false);
  });

  it.each([
    ['Club Lemon Can 4 Pack (330 ml)', 'Fruit'],
    ['Mr Kipling Cherry Bakewells 6 Pack (318 g)', 'Bakery'],
    ['Chocolate Milk 1L', 'Dairy'],
  ])('does not build a meal prompt around %s just because of its category', (name, category) => {
    expect(buildMarketStarters([price({ store_product_name: name, category })])[1].id).toBe('meal:fallback');
  });

  it.each([
    ['Dunnes Stores Breaded Irish Haddock Fillets 250g', 'Loose Haddock Fillets (1 kg)'],
    ['Haddock Fillets 250g', 'Breaded Haddock Fillets 250g'],
    ["L'OR Classique Instant Coffee 100g", 'Kenco Instant Coffee 100g'],
    ['Dunnes Stores Whole Milk 2L', 'SuperValu Whole Milk 2L'],
    ['Philadelphia Original Soft Cream Cheese', 'Philadelphia Original Soft Cream Cheese'],
    ['Brand Yoghurt 4x100g', 'Brand Yoghurt 400g'],
    ['Brand Cheese 165g', 'Brand Cheese 200g'],
    ['Loose Haddock Fillets 1kg', 'Loose Haddock Fillets 1kg'],
  ])('excludes an unproven comparison: %s / %s', (first, second) => {
    expect(comparisonFor(first, second).id).toBe('compare:fallback');
  });

  it.each([
    ['Philadelphia Original Soft Cream Cheese 165g', 'Philadelphia Original Soft Cream Cheese (165 g)'],
    ['Brand Rice 1kg', 'Brand Rice 1000g'],
    ['Brand Laundry Capsules 30 Pack', 'Brand Laundry Capsules 30 Pack'],
  ])('allows explicitly matching retailer names and packs: %s / %s', (first, second) => {
    expect(comparisonFor(first, second).id).toBe('compare:shared-id');
  });

  it('uses the oldest comparison check and does not combine unrelated canonical IDs', () => {
    const rows = [price(), price({ store: 'supervalu', price: 10, observed_at: '2026-09-22T10:00:00Z' })];
    expect(buildMarketStarters(rows)[3].detail).toContain('22 Sept 2026');
    rows[1].canonical_product_id = 'unrelated';
    expect(buildMarketStarters(rows)[3].id).toBe('compare:fallback');
  });

  it('omits price claims for missing names, invalid prices or unknown check dates', () => {
    for (const overrides of [{ store_product_name: '' }, { observed_at: '' }, { price: NaN }, { price: 0 }]) {
      expect(buildMarketStarters([price(overrides)])).toEqual(buildMarketStarters([]));
    }
  });

  it('rotates categories before exhausting one category and keeps identities stable', () => {
    const rows = [
      price({ canonical_name: 'Chicken 1kg', price: 1 }),
      price({ canonical_name: 'Beef 1kg', price: 2 }),
      price({ canonical_name: 'Salmon 400g', category: 'Fish', price: 7 }),
    ];
    const first = buildMarketStarters(rows, 0)[1];
    const second = buildMarketStarters(rows, 1)[1];
    expect(first.label).toContain('Chicken');
    expect(second.label).toContain('Salmon');
    expect(buildMarketStarters(rows, 3)[1].id).toBe(first.id);
  });
});
