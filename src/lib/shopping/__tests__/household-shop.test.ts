import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION } from '../household-shop-contract';
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
  store_product_name: `${store} product`,
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
    expect(result.store_coverage[0]).toMatchObject({ retailer: 'dunnes', complete: true, basket_total: 8 });
    expect(result.recommended_retailer_strategy.kind).toBe('single_retailer');
    expect(result.provenance).toMatchObject({ price_boundary: 'latest_prices', totals_calculated_by: 'server' });
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
});
