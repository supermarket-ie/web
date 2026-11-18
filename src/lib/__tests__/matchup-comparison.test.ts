import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('../supabase', () => ({ supabaseAdmin: {} }));

import { buildMatchup } from '../matchup-comparison';
import { compareBasketStores } from '../shopping/compare';
import { repriceBasket } from '../shopping/reprice';
import { groundHouseholdShop } from '../shopping/household-shop';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION } from '../shopping/household-shop-contract';
import type { PairReview } from '../comparison-policy';

const at = new Date(Date.now() - 3600_000).toISOString();
const review = (a: string, b: string): PairReview => ({ left_offer_id: a, right_offer_id: b, classification: 'exact_product',
  left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64), left_captured_at: at, right_captured_at: at, reviewed_at: at,
  rationale: 'Independent direct-capture review.', reviewer: 'test' });
const row = (name: string, store: string, price: number, id: string, title: string, category = 'Tinned') =>
  ({ canonical_name: name, category, store, price, store_product_id: id, store_product_name: title });

const rows = [
  row('Soup 400g', 'tesco', 2.49, 't-soup', 'Heinz Cream Of Tomato Soup 400G'),
  row('Soup 400g', 'dunnes', 2.0, 'd-soup', 'Heinz Cream of Tomato Soup 400g'),
  row('Peas 420g', 'tesco', 1.0, 't-peas', 'Batchelors Peas 420G'),
  row('Peas 420g', 'dunnes', 0.8, 'd-peas', 'Dunnes Stores Peas 420g'),
];

describe('store head-to-head (matchup) page', () => {
  it('with no approved pairs, ranks nothing and lists every shared product with titles and labels', () => {
    const m = buildMatchup(rows, 'tesco', 'dunnes', []);
    expect(m.verified).toHaveLength(0);
    expect(m.overallWinner).toBeNull();
    expect(m.diffs).toEqual([]);
    expect(m.categories).toEqual([]);
    expect(m.unverified.map(p => [p.name, p.a.label, p.b.label])).toEqual([
      ['Peas 420g', 'Different product or pack', 'Different product or pack'],
      ['Soup 400g', 'Unverified', 'Unverified'],
    ]);
  });
  it('ranks ONLY approved identical products; own-label and unverified products never count', () => {
    const m = buildMatchup(rows, 'tesco', 'dunnes', [review('t-soup', 'd-soup')]);
    expect(m.verified.map(p => p.name)).toEqual(['Soup 400g']);
    expect(m.overallWinner).toBe('b');
    expect(m.saving).toBe(0.49);
    expect(m.unverified.map(p => p.name)).toEqual(['Peas 420g']);
  });
});

describe('ties for the lowest verified total', () => {
  const tied = [
    { canonical_name: 'Beans', store: 'tesco', price: 1, store_product_id: 't', store_product_name: 'Heinz Beanz 415g' },
    { canonical_name: 'Beans', store: 'supervalu', price: 1, store_product_id: 's', store_product_name: 'Heinz Beanz (415 g)' },
  ];
  it('the agent tool names no cheapest store and says they cost the same', () => {
    const r = compareBasketStores([{ canonical_name: 'Beans' }], tied, undefined, [review('t', 's')]);
    expect(r.cheapest_verified_store).toBeNull();
    expect(r.verified_tie).toBe(true);
    expect(r.explanation).toMatch(/(Tesco and SuperValu|SuperValu and Tesco) cost the same for this basket/);
  });
  it('reprice names no best single store', () => {
    const r = repriceBasket([{ canonical_name: 'Beans', store: 'tesco', price_paid: 1, quantity: 1 }], tied, ['tesco', 'supervalu'], [review('t', 's')]);
    expect(r.bestSingleStore).toBeNull();
    expect(r.savings).toBeNull();
  });
  it('the household shop keeps the verified basis but names no retailer', () => {
    const offer = (store: string, id: string, name: string) => ({ canonical_product_id: 'beans', canonical_name: 'Beans', category: null, store_product_id: id, store,
      store_product_name: name, store_sku: `${store}-sku`, store_url: null, price: 1, was_price: null, on_promotion: false, observed_at: at, source: `${store}_direct`,
      relationship_type: 'exact' as const, freshness_state: 'fresh' as const });
    const shop = groundHouseholdShop({ pair_reviews: [review('t', 's')],
      proposal: { schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION, household: { adults: 1, children: 0, dietary_requirements: [], budget: null, planning_period: { days: 7, label: 'one week' }, assumptions_made: [] },
        sections: [{ id: 'food', label: 'Food', kind: 'food' as const }],
        items: [{ line_id: 'beans', section_id: 'food', canonical_product_id: 'beans', display_label: 'Beans', quantity: 1, unit_or_pack_expectation: 'one tin', reason: 'r', purpose: 'p' }] },
      catalogue_products: [{ canonical_product_id: 'beans', canonical_name: 'Beans', category: null }],
      latest_prices: [offer('tesco', 't', 'Heinz Beanz 415g'), offer('supervalu', 's', 'Heinz Beanz (415 g)')], comparison_retailers: ['tesco', 'supervalu'] });
    expect(shop.recommended_retailer_strategy).toMatchObject({ kind: 'single_retailer', retailer: null });
    expect(shop.recommended_retailer_strategy.rationale).toContain('cost the same');
  });
});
