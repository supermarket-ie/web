import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
vi.mock('../supabase', () => ({ supabaseAdmin: {} }));

import { compareBasketStores } from '../shopping/compare';
import { repriceBasket } from '../shopping/reprice';
import { priceChangesAtSameStore } from '../shopping/price-history';
import { buildSmartList } from '../list-generator';
import type { PairReview } from '../comparison-policy';

// Regression coverage for every customer path that used to treat a shared canonical record as the same product.
const at = new Date(Date.now() - 3600_000).toISOString();
const review = (a: string, b: string): PairReview => ({ left_offer_id: a, right_offer_id: b, classification: 'exact_product',
  left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64), left_captured_at: at, right_captured_at: at, reviewed_at: at,
  rationale: 'Independent direct-capture review.', reviewer: 'test' });

const muesliRows = [
  { canonical_name: 'Muesli', store: 'dunnes', price: 5.5, store_product_id: 'd-flahavans', store_product_name: "Flahavan's Hi8 Muesli Original 1kg" },
  { canonical_name: 'Muesli', store: 'supervalu', price: 5.19, store_product_id: 's-lifeforce', store_product_name: 'Lifeforce Muesli (750 g)' },
];
const chilliRows = [
  { canonical_name: 'Chilli Powder 38g', store: 'dunnes', price: 3.4, store_product_id: 'd-chilli', store_product_name: 'Schwartz Mild Chilli Powder 38g' },
  { canonical_name: 'Chilli Powder 38g', store: 'supervalu', price: 3.35, store_product_id: 's-chilli', store_product_name: 'Schwartz Chilli Powder Mild (38 g)' },
];

describe('agent compare_shop_stores (compareBasketStores)', () => {
  it('Flahavan\'s vs Lifeforce: no complete total, no cheapest store, the different product is named', () => {
    const r = compareBasketStores([{ canonical_name: 'Muesli' }, { canonical_name: 'Chilli Powder 38g' }], [...muesliRows, ...chilliRows], undefined, [review('d-chilli', 's-chilli')]);
    expect(r.cheapest_verified_store).toBeNull();
    for (const c of r.comparisons) {
      expect(c).toMatchObject({ complete: false, total: null, verified_exact_total: null, different_products: ['Muesli'] });
      expect(c.lines.find(l => l.canonical_name === 'Muesli')).toMatchObject({ comparison: 'Different product or pack' });
    }
    // each retailer's own product title is carried through
    expect(r.comparisons.flatMap(c => c.lines.map(l => l.retailer_product_name))).toContain('Lifeforce Muesli (750 g)');
  });
  it('identical-looking unreviewed products are indicative: totals shown, no cheapest store, no saving vs current', () => {
    const r = compareBasketStores([{ canonical_name: 'Chilli Powder 38g', current_price: 3.4 }], chilliRows);
    expect(r.comparison_basis).toBe('indicative');
    expect(r.cheapest_verified_store).toBeNull();
    expect(r.comparisons.every(c => c.total !== null && c.verified_exact_total === null && c.difference_vs_current === null)).toBe(true);
  });
  it('a line only one store sells is labelled single_store, never Exact match', () => {
    const r = compareBasketStores([{ canonical_name: 'Chilli Powder 38g' }, { canonical_name: 'Muesli' }], [chilliRows[0], muesliRows[0]]);
    const dunnes = r.comparisons.find(c => c.store === 'dunnes')!;
    expect(dunnes.lines.map(l => l.comparison)).toEqual(['single_store', 'single_store']);
  });
  it('a verified complete basket names the cheapest store', () => {
    const r = compareBasketStores([{ canonical_name: 'Chilli Powder 38g', current_price: 3.4 }], chilliRows, undefined, [review('d-chilli', 's-chilli')]);
    expect(r.cheapest_verified_store).toEqual({ store: 'supervalu', total: 3.35 });
    expect(r.comparisons[0]).toMatchObject({ store: 'supervalu', comparison_basis: 'verified_exact', difference_vs_current: -0.05 });
  });
});

describe('list generator (buildSmartList)', () => {
  const offers = [...muesliRows, ...chilliRows].map(r => ({ ...r, canonical_product_id: r.canonical_name, category: null, store_url: null }));
  it('publishes no store totals or recommended store without verified exact matches, and labels each item', () => {
    const list = buildSmartList(offers, [], '2', undefined);
    expect(list.store_totals).toEqual([]);
    expect(list.recommended_store).toBe('');
    expect(list.items.find(i => i.canonical_name === 'Muesli')?.price_comparison).toBe('different_products');
    expect(list.items.find(i => i.canonical_name === 'Chilli Powder 38g')?.price_comparison).toBe('indicative');
  });
  it('a different product on one line blocks any verified basket total even when the other line is verified', () => {
    const list = buildSmartList(offers, [review('d-chilli', 's-chilli')], '2', undefined);
    expect(list.store_totals).toEqual([]);
    expect(list.items.find(i => i.canonical_name === 'Chilli Powder 38g')?.price_comparison).toBe('verified_exact');
  });
  it('verified complete baskets produce marked totals and a recommended store', () => {
    const list = buildSmartList(chilliRows.map(r => ({ ...r, canonical_product_id: 'c', category: null, store_url: null })), [review('d-chilli', 's-chilli')], '2', undefined);
    expect(list.recommended_store).toBe('supervalu');
    expect(list.store_totals.every(t => t.basis === 'verified_exact')).toBe(true);
  });
});

describe('plan reprice (repriceBasket)', () => {
  const items = [
    { canonical_name: 'Muesli', store: 'supervalu', price_paid: 4.0, quantity: 1 },
    { canonical_name: 'Chilli Powder 38g', store: 'dunnes', price_paid: 3.0, quantity: 1 },
  ];
  it('never fills a store\'s missing item with a historical paid price, and names no cheapest store', () => {
    const r = repriceBasket(items, chilliRows, ['dunnes', 'supervalu']);
    expect(r.singleStoreTotals.every(s => s.total === 3.4 || s.total === 3.35)).toBe(true); // current prices only
    expect(r.singleStoreTotals.every(s => !s.complete)).toBe(true);
    expect(r.bestSingleStore).toBeNull();
    expect(r.savings).toBeNull();
    expect(r.bestSplitTotal).toBeNull(); // Muesli is no longer priced at the store bought from in this fixture
  });
  it('Flahavan\'s vs Lifeforce: no single store is complete or cheapest', () => {
    const r = repriceBasket(items, [...muesliRows, ...chilliRows], ['dunnes', 'supervalu'], [review('d-chilli', 's-chilli')]);
    expect(r.bestSingleStore).toBeNull();
    expect(r.savings).toBeNull();
    expect(r.bestSplitTotal).toBe(8.59); // today's prices at the shopper's chosen stores (5.19 + 3.40)
  });
});

describe('price-change notices', () => {
  it('compare the last paid price with the SAME store only, never another store\'s product', () => {
    const changes = priceChangesAtSameStore(
      [{ canonical_name: 'Muesli', store: 'dunnes', price_paid: 6.0 }],
      muesliRows,
    );
    expect(changes).toEqual([expect.objectContaining({ last_store: 'dunnes', best_store_now: 'dunnes', best_price_now: 5.5, change: -0.5 })]);
  });
});

describe('verified subset of retailers (Tesco + SuperValu verified, Dunnes indicative)', () => {
  const three = [
    { canonical_name: 'Soup 400g', store: 'tesco', price: 2.49, store_product_id: 't-soup', store_product_name: 'Heinz Cream Of Tomato Soup 400G' },
    { canonical_name: 'Soup 400g', store: 'supervalu', price: 2.5, store_product_id: 's-soup', store_product_name: 'Heinz Cream Of Tomato Soup (400 g)' },
    { canonical_name: 'Soup 400g', store: 'dunnes', price: 2.0, store_product_id: 'd-soup', store_product_name: 'Heinz Cream of Tomato Soup 400g' },
  ];
  it('agent comparison names the verified stores and calls Dunnes indicative', () => {
    const r = compareBasketStores([{ canonical_name: 'Soup 400g' }], three, undefined, [review('t-soup', 's-soup')]);
    expect(r.cheapest_verified_store).toEqual({ store: 'tesco', total: 2.49 });
    expect(r.verified_stores).toEqual(['tesco', 'supervalu']);
    expect(r.indicative_complete_stores).toEqual(['dunnes']);
    expect(r.explanation).toContain('Tesco is cheaper than SuperValu for this basket (verified exact matches). Dunnes Stores: indicative total only');
    expect(r.comparisons.find(c => c.store === 'dunnes')).toMatchObject({ comparison_basis: 'indicative', verified_exact_total: null, total: 2 });
  });
  it('list generator persists totals ONLY for the verified stores', () => {
    const list = buildSmartList(three.map(r => ({ ...r, canonical_product_id: 'soup', category: null, store_url: null })), [review('t-soup', 's-soup')], '2', undefined);
    expect(list.store_totals.map(t => t.store)).toEqual(['tesco', 'supervalu']);
    expect(list.recommended_store).toBe('tesco');
  });
  it('reprice scopes the cheapest store to the verified stores', () => {
    const r = repriceBasket([{ canonical_name: 'Soup 400g', store: 'supervalu', price_paid: 2.5, quantity: 1 }], three, ['tesco', 'supervalu', 'dunnes'], [review('t-soup', 's-soup')]);
    expect(r.verifiedStores).toEqual(['tesco', 'supervalu']);
    expect(r.bestSingleStore?.store).toBe('tesco');
    expect(r.explanation).toContain('Dunnes Stores: indicative total only');
  });
});

describe('partially verified list lines and client-supplied labels', () => {
  it('a line verified between two of three stores is partially_verified with per-store labels', () => {
    const rows = [
      { canonical_name: 'Soup 400g', store: 'tesco', price: 2.49, store_product_id: 't-soup', store_product_name: 'Heinz Cream Of Tomato Soup 400G' },
      { canonical_name: 'Soup 400g', store: 'supervalu', price: 2.5, store_product_id: 's-soup', store_product_name: 'Heinz Cream Of Tomato Soup (400 g)' },
      { canonical_name: 'Soup 400g', store: 'dunnes', price: 2.0, store_product_id: 'd-soup', store_product_name: 'Heinz Cream of Tomato Soup 400g' },
    ].map(r => ({ ...r, canonical_product_id: 'soup', category: null, store_url: null }));
    const item = buildSmartList(rows, [review('t-soup', 's-soup')], '2', undefined).items[0];
    expect(item.price_comparison).toBe('partially_verified');
    expect(Object.fromEntries(item.all_prices.map(p => [p.store, p.comparison]))).toEqual({ tesco: 'exact_product', supervalu: 'exact_product', dunnes: 'unverified' });
  });
  it('client-supplied item labels are never stored as verification', async () => {
    const { downgradeClientItemLabels } = await import('../saved-list-sanitize');
    expect(downgradeClientItemLabels([
      { price_comparison: 'partially_verified', all_prices: [{ store: 'tesco', comparison: 'exact_product' }, { store: 'dunnes', comparison: 'unverified' }] },
      { price_comparison: 'different_products' },
    ])).toEqual([
      { price_comparison: 'indicative', all_prices: [{ store: 'tesco', comparison: 'unverified' }, { store: 'dunnes', comparison: 'unverified' }] },
      { price_comparison: 'different_products' },
    ]);
  });
});
