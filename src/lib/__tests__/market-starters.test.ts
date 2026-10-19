import { describe, expect, it } from 'vitest';
import { buildMarketStarters } from '@/lib/market-starters';
import { MARKET_STARTER_VERSION } from '@/lib/market-starter-options';
import type { ProductPrice } from '@/lib/price-data';
import { inferSuggestionIntent } from '@/lib/agent-suggestions';

function price(overrides: Partial<ProductPrice> = {}): ProductPrice {
  return {
    canonical_product_id: 'test-product',
    canonical_name: 'Test Product 1kg',
    category: 'Meat',
    store: 'dunnes',
    price: 8,
    was_price: 10,
    on_promotion: true,
    store_product_name: 'Test Product 1kg',
    store_sku: 'sku',
    store_url: null,
    observed_at: '2026-10-05T10:00:00Z',
    source: 'direct',
    relationship_type: 'exact',
    freshness_state: 'fresh',
    ...overrides,
  };
}

describe('v3 market starters', () => {
  it('uses four stable high-intent homepage jobs with durable IDs', () => {
    expect(MARKET_STARTER_VERSION).toBe(3);
    const starters = buildMarketStarters([]);
    expect(starters.map(item => item.id)).toEqual([
      'shop:weekly',
      'compare:shopping-list',
      'offer:best-deals',
      'meal:plan-and-shop',
    ]);
    expect(starters.map(item => item.label)).toEqual([
      'Build my weekly shop',
      'Compare my shopping list',
      'Find today’s best deals',
      'Plan meals and shop',
    ]);
    expect(starters.map(item => item.icon)).toEqual(['shop', 'compare', 'offer', 'meal']);
  });

  it('does not change entry propositions when catalogue rows or rotation windows change', () => {
    const baseline = buildMarketStarters([]);
    const priced = buildMarketStarters([
      price(),
      price({ canonical_product_id: 'other', store: 'supervalu', price: 2, store_product_name: 'Other Product 500g' }),
    ], 999999);
    expect(priced).toEqual(baseline);
  });

  it('keeps live SKU, retailer and price claims out of the entry surface', () => {
    const starters = buildMarketStarters([price()]);
    const visibleCopy = starters.map(item => `${item.label} ${item.detail}`).join(' ');
    expect(visibleCopy).not.toContain('Test Product');
    expect(visibleCopy).not.toContain('€8');
    expect(visibleCopy).not.toContain('Dunnes');
    expect(visibleCopy).not.toMatch(/checked \d/i);
  });

  it('makes each prompt execute the advertised user job after selection', () => {
    const [shop, compare, deals, meal] = buildMarketStarters([]);
    expect(shop.prompt).toContain('weekly household shop');
    expect(compare.prompt).toContain('Tesco, Dunnes and SuperValu');
    expect(deals.prompt).toContain('best current deals');
    expect(meal.prompt).toContain('plan practical dinners');
    expect(inferSuggestionIntent(shop.prompt)).toBe('shop');
    expect(inferSuggestionIntent(compare.prompt)).toBe('compare');
    expect(inferSuggestionIntent(meal.prompt)).toBe('meal');
  });
});
