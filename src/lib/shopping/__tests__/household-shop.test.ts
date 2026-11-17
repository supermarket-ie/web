import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION, householdShopToolOutputSchema } from '../household-shop-contract';
import { groundHouseholdShop } from '../household-shop';

const catalogue = [
  { canonical_product_id: 'milk-id', canonical_name: 'Irish Milk 2L', category: 'Dairy' },
  { canonical_product_id: 'cleaner-id', canonical_name: 'Kitchen Cleaner 750ml', category: 'Cleaning' },
  { canonical_product_id: 'soap-id', canonical_name: 'Hand Soap 250ml', category: 'Toiletries' },
];

const row = (
  productId: string,
  store: string,
  price: number,
  extra: Partial<{
    was_price: number | null;
    on_promotion: boolean;
  }> = {},
) => ({
  canonical_product_id: productId,
  canonical_name: catalogue.find(product => product.canonical_product_id === productId)?.canonical_name ?? 'Unknown',
  category: catalogue.find(product => product.canonical_product_id === productId)?.category ?? null,
  store_product_id: `${store}-${productId}`,
  store,
  // Realistic branded titles: a "<retailer> ..." title is retailer own-label and never the same product cross-store.
  store_product_name: catalogue.find(product => product.canonical_product_id === productId)?.canonical_name ?? 'Unknown',
  store_sku: `${store}-sku`,
  store_url: `https://example.test/${store}/${productId}`,
  price,
  was_price: extra.was_price ?? null,
  on_promotion: extra.on_promotion ?? false,
  observed_at: '2026-09-06T12:00:00.000Z',
  source: `${store}_direct`,
  relationship_type: 'exact' as const,
  freshness_state: 'fresh' as const,
});

const proposal = {
  schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
  household: {
    adults: 2,
    children: 1,
    dietary_requirements: ['gluten-free'],
    budget: 120,
    planning_period: { days: 7, label: 'one week' },
    assumptions_made: ['Lunches are mostly eaten at home.'],
  },
  sections: [
    { id: 'food', label: 'Food and drink', kind: 'food' as const },
    { id: 'cleaning', label: 'Cleaning', kind: 'cleaning' as const },
  ],
  items: [
    {
      line_id: 'milk',
      section_id: 'food',
      canonical_product_id: 'milk-id',
      display_label: 'Milk',
      quantity: 2,
      unit_or_pack_expectation: '2 litre carton',
      reason: 'Breakfasts and drinks',
      purpose: 'breakfast',
    },
    {
      line_id: 'cleaner',
      section_id: 'cleaning',
      canonical_product_id: 'cleaner-id',
      display_label: 'Kitchen cleaner',
      quantity: 1,
      unit_or_pack_expectation: 'one spray bottle',
      reason: 'Weekly household cleaning',
      purpose: 'household cleaning',
    },
  ],
};

describe('groundHouseholdShop', () => {
  it('prices a 2 litre bottle as one bottle, not a two-bottle pack', () => {
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [{ ...proposal.items[0], quantity: 1, unit_or_pack_expectation: '2 litre bottle' }] },
      catalogue_products: catalogue,
      latest_prices: [row('milk-id', 'dunnes', 2.25)],
    });
    expect(result.totals.priced_lines).toBe(1);
    expect(result.totals.selected_total).toBe(2.25);
  });
  it('does not price a requested multipack using an unconfirmed single-product offer', () => {
    const product = { canonical_product_id: 'bar-id', canonical_name: 'Cereal Bar 20g', category: 'Breakfast' };
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [{ ...proposal.items[0], canonical_product_id: 'bar-id', display_label: 'Cereal Bars', unit_or_pack_expectation: '6 pack' }] },
      catalogue_products: [product],
      latest_prices: [{ ...row('bar-id', 'tesco', 2), canonical_name: product.canonical_name, category: product.category, store_product_name: 'Cereal Bar' }],
    });
    expect(result.totals.priced_lines).toBe(0);
    expect(result.items[0].selected_offer).toBeNull();
  });
  it('excludes a mis-mapped baby snack even when it has an exact fresh flag', () => {
    const badProduct = { canonical_product_id: 'banana-id', canonical_name: 'Mini Bananas', category: 'Fruit' };
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [{ ...proposal.items[0], canonical_product_id: 'banana-id', display_label: 'Bananas', unit_or_pack_expectation: 'loose fruit' }] },
      catalogue_products: [badProduct],
      latest_prices: [{ ...row('banana-id', 'supervalu', 2.75), ...badProduct, store_product_name: "Ella's Kitchen Strawberry & Banana Mini Puffs 4 Pack 8g" }],
    });
    expect(result.items[0].selected_offer).toBeNull();
    expect(result.items[0].coverage_status).toBe('unavailable');
    expect(result.totals.priced_lines).toBe(0);
    expect(result.store_coverage.every(store => store.basket_total === null)).toBe(true);
  });

  it('uses only trusted offers and calculates all totals in code', () => {
    const result = groundHouseholdShop({
      proposal: {
        ...proposal,
        items: proposal.items.map(item => ({ ...item, price: 0.01, selected_offer: { price: 0.01 } })),
      },
      catalogue_products: catalogue,
      latest_prices: [
        row('milk-id', 'dunnes', 2.5),
        row('milk-id', 'supervalu', 2.75),
        row('cleaner-id', 'dunnes', 3),
        row('cleaner-id', 'supervalu', 3.25),
      ],
      comparison_retailers: ['dunnes', 'supervalu'],
      generated_at: new Date('2026-09-06T15:00:00.000Z'),
    });

    expect(result.items[0].selected_offer?.current_price).toBe(2.5);
    expect(result.items[0].line_total).toBe(5);
    expect(result.totals.selected_total).toBe(8);
    expect(result.totals.by_selected_retailer).toEqual([
      { retailer: 'dunnes', total: 8, lines: 2, units: 3 },
    ]);
    // Same titles, no independent review: totals are shown but indicative, and no store is named cheapest.
    expect(result.store_coverage[0]).toMatchObject({ retailer: 'dunnes', complete: true, basket_total: 8, comparison_basis: 'indicative', verified_exact_total: null });
    expect(result.recommended_retailer_strategy).toMatchObject({ kind: 'indicative_single_retailer', retailer: null });
    expect(result.items[0].candidate_offers.every(o => o.comparison_status === 'unverified')).toBe(true);
    expect(result.provenance).toMatchObject({ price_boundary: 'latest_prices', totals_calculated_by: 'server' });
  });

  it('names the cheapest store only for complete baskets of independently verified exact matches', () => {
    const at = new Date(Date.now() - 3600_000).toISOString();
    const review = (a: string, b: string) => ({ left_offer_id: a, right_offer_id: b, classification: 'exact_product' as const,
      left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64), left_captured_at: at, right_captured_at: at, reviewed_at: at,
      rationale: 'Independent direct-capture review.', reviewer: 'test' });
    const result = groundHouseholdShop({
      pair_reviews: [review('dunnes-milk-id', 'supervalu-milk-id'), review('dunnes-cleaner-id', 'supervalu-cleaner-id')],
      proposal,
      catalogue_products: catalogue,
      latest_prices: [row('milk-id', 'dunnes', 2.5), row('milk-id', 'supervalu', 2.75), row('cleaner-id', 'dunnes', 3), row('cleaner-id', 'supervalu', 3.25)],
      comparison_retailers: ['dunnes', 'supervalu'],
    });
    expect(result.recommended_retailer_strategy).toMatchObject({ kind: 'single_retailer', retailer: 'dunnes' });
    expect(result.store_coverage[0]).toMatchObject({ retailer: 'dunnes', comparison_basis: 'verified_exact', verified_exact_total: 8 });
    expect(result.items[0].candidate_offers.every(o => o.comparison_status === 'exact_product')).toBe(true);
  });

  it('keeps Flahavan\'s 1kg and Lifeforce 750g on a generic Muesli record out of every store total', () => {
    const muesliCatalogue = [{ canonical_product_id: 'muesli-id', canonical_name: 'Muesli', category: 'Breakfast' }];
    const offer = (store: string, name: string, price: number) => ({ ...row('muesli-id', store, price), canonical_name: 'Muesli', category: 'Breakfast', store_product_name: name });
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [{ ...proposal.items[0], line_id: 'muesli', canonical_product_id: 'muesli-id', display_label: 'Muesli', quantity: 1, unit_or_pack_expectation: 'one bag' }] },
      catalogue_products: muesliCatalogue,
      latest_prices: [offer('dunnes', "Flahavan's Hi8 Muesli Original 1kg", 5.5), offer('supervalu', 'Lifeforce Muesli (750 g)', 5.19)],
      comparison_retailers: ['dunnes', 'supervalu'],
    });
    expect(result.items[0].candidate_offers.map(o => o.comparison_status)).toEqual(['not_comparable', 'not_comparable']);
    expect(result.items[0].selected_offer?.retailer_product_name).toBe('Lifeforce Muesli (750 g)'); // still priced as a muesli choice
    expect(result.store_coverage.every(s => !s.complete && s.basket_total === null && s.different_product_line_ids?.includes('muesli'))).toBe(true);
    expect(result.recommended_retailer_strategy.kind).toBe('mixed_retailer');
    expect(result.recommended_retailer_strategy.rationale).toMatch(/different products/);
  });

  it('downgrades an invalid canonical product id to an unresolved need', () => {
    const result = groundHouseholdShop({
      proposal: {
        ...proposal,
        items: [{ ...proposal.items[0], canonical_product_id: 'invented-id' }],
      },
      catalogue_products: catalogue,
      latest_prices: [row('milk-id', 'dunnes', 2.5)],
      comparison_retailers: ['dunnes'],
    });

    expect(result.items[0]).toMatchObject({
      canonical_product_id: null,
      canonical_name: null,
      unresolved_need: 'Milk',
      coverage_status: 'unresolved',
      selected_offer: null,
      line_total: null,
    });
    expect(result.recommended_retailer_strategy.kind).toBe('insufficient_coverage');
  });

  it('keeps a known product without a trusted live offer as unavailable', () => {
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [proposal.items[1]] },
      catalogue_products: catalogue,
      latest_prices: [],
      comparison_retailers: ['dunnes', 'supervalu'],
    });

    expect(result.items[0]).toMatchObject({
      canonical_product_id: 'cleaner-id',
      coverage_status: 'unavailable',
      candidate_offers: [],
    });
    expect(result.store_coverage.every(store => !store.complete && store.basket_total === null)).toBe(true);
  });

  it('separates retailer promotion evidence from a confirmed monetary saving', () => {
    const result = groundHouseholdShop({
      proposal: { ...proposal, items: [proposal.items[0]] },
      catalogue_products: catalogue,
      latest_prices: [
        row('milk-id', 'dunnes', 2.5, { on_promotion: true }),
        row('milk-id', 'supervalu', 2.75, { on_promotion: true, was_price: 3.5 }),
      ],
      comparison_retailers: ['dunnes', 'supervalu'],
    });

    expect(result.items[0].candidate_offers[0].promotion).toEqual({
      retailer_marked: true,
      confirmed_monetary_saving: false,
      was_price: null,
      saving: null,
    });
    expect(result.items[0].candidate_offers[1].promotion).toEqual({
      retailer_marked: true,
      confirmed_monetary_saving: true,
      was_price: 3.5,
      saving: 0.75,
    });
  });

  it('does not describe partial store coverage as a complete retailer basket', () => {
    const result = groundHouseholdShop({
      proposal,
      catalogue_products: catalogue,
      latest_prices: [row('milk-id', 'dunnes', 2.5), row('cleaner-id', 'supervalu', 3)],
      comparison_retailers: ['dunnes', 'supervalu'],
    });

    expect(result.store_coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ retailer: 'dunnes', complete: false, basket_total: null }),
      expect.objectContaining({ retailer: 'supervalu', complete: false, basket_total: null }),
    ]));
    expect(result.recommended_retailer_strategy.kind).toBe('mixed_retailer');
    expect(result.items.every(item => item.coverage_status === 'partial')).toBe(true);
  });

  it('supports supermarket consumables beyond food', () => {
    const result = groundHouseholdShop({
      proposal: {
        ...proposal,
        sections: [{ id: 'toiletries', label: 'Toiletries', kind: 'toiletries' }],
        items: [{ ...proposal.items[1], line_id: 'soap', section_id: 'toiletries', canonical_product_id: 'soap-id', display_label: 'Hand soap' }],
      },
      catalogue_products: catalogue,
      latest_prices: [row('soap-id', 'dunnes', 1.8)],
      comparison_retailers: ['dunnes'],
    });

    expect(result.sections[0].kind).toBe('toiletries');
    expect(result.items[0]).toMatchObject({ canonical_name: 'Hand Soap 250ml', coverage_status: 'resolved' });
  });

  it('rejects malformed proposals and unknown section references', () => {
    expect(() => groundHouseholdShop({
      proposal: { ...proposal, household: { ...proposal.household, adults: 0 } },
      catalogue_products: catalogue,
      latest_prices: [],
    })).toThrow();

    expect(() => groundHouseholdShop({
      proposal: { ...proposal, items: [{ ...proposal.items[0], section_id: 'missing' }] },
      catalogue_products: catalogue,
      latest_prices: [],
    })).toThrow('Unknown section_id');
  });

  it('accepts only validated household-shop tool output for native rendering', () => {
    const shop = groundHouseholdShop({
      proposal: { ...proposal, items: [proposal.items[0]] },
      catalogue_products: catalogue,
      latest_prices: [row('milk-id', 'dunnes', 2.5)],
      comparison_retailers: ['dunnes'],
    });

    expect(householdShopToolOutputSchema.safeParse({ kind: 'household_shop', shop }).success).toBe(true);
    expect(householdShopToolOutputSchema.safeParse({ kind: 'household_shop', shop: { items: [] } }).success).toBe(false);
    expect(householdShopToolOutputSchema.safeParse({ kind: 'other', shop }).success).toBe(false);
  });
});
