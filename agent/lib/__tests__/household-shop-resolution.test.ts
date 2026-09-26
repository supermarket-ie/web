import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_SHOP_SCHEMA_VERSION, type HouseholdShopProposal } from '../../../src/lib/shopping/household-shop-contract';
import type { CataloguePriceRow } from '../../../src/lib/shopping/catalogue-core';
import { householdShopResolutionSeeds, resolveHouseholdShopProposal } from '../household-shop-resolution';

const proposal = (items: HouseholdShopProposal['items']): HouseholdShopProposal => ({
  schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
  household: {
    adults: 2,
    children: 0,
    dietary_requirements: [],
    planning_period: { days: 7, label: 'one week' },
    assumptions_made: [],
  },
  sections: [{ id: 'food', label: 'Food', kind: 'food' }],
  items,
});

const item = (lineId: string, label: string, pack: string, canonicalProductId?: string | null) => ({
  line_id: lineId,
  section_id: 'food',
  canonical_product_id: canonicalProductId,
  unresolved_need: label,
  display_label: label,
  quantity: 1,
  unit_or_pack_expectation: pack,
  reason: 'Weekly shop',
});

const priceRow = (id: string, name: string, price = 2): CataloguePriceRow => ({
  canonical_product_id: id,
  canonical_name: name,
  category: 'Food',
  store: 'dunnes',
  store_product_name: name,
  price,
  was_price: null,
  on_promotion: false,
});

describe('resolveHouseholdShopProposal', () => {
  it('resolves named staple packs without sending each line back to the model', () => {
    const input = proposal([
      item('carrots', 'Carrots', '1kg bag'),
      item('onions', 'Onions', '1kg bag'),
      item('eggs', 'Free range eggs', 'dozen'),
    ]);
    const products = ['Carrots 1kg', 'Onions 1kg', 'Free Range Eggs 12'].map((name, index) => ({
      canonical_product_id: `product-${index}`, canonical_name: name, category: 'Food',
    }));
    const resolved = resolveHouseholdShopProposal(input, products, []);
    expect(resolved.items.map(row => row.canonical_product_id)).toEqual(['product-0', 'product-1', 'product-2']);
  });

  it('does not use a display-name match or supplied ID to override the requested pack', () => {
    const input = proposal([item('carrots', 'Carrots', '500g bag', 'carrots-id')]);
    const products = [{ canonical_product_id: 'carrots-id', canonical_name: 'Carrots 1kg', category: 'Vegetables' }];
    expect(resolveHouseholdShopProposal(input, products, [priceRow('carrots-id', 'Carrots 1kg')]).items[0].canonical_product_id).toBeNull();
  });

  it('batch-resolves exact catalogue names even without a live offer', () => {
    const input = proposal([
      item('pitta', 'Pitta Bread 6 Pack', '6-pack'),
      item('tomatoes', 'Chopped Tomatoes 4 Pack', '4-pack tins'),
    ]);

    const resolved = resolveHouseholdShopProposal(input, [
      { canonical_product_id: 'pitta-id', canonical_name: 'Pitta Bread 6 Pack', category: 'Bakery' },
      { canonical_product_id: 'tomato-id', canonical_name: 'Chopped Tomatoes 4 Pack', category: 'Tinned' },
    ], []);

    expect(resolved.items.map(row => row.canonical_product_id)).toEqual(['pitta-id', 'tomato-id']);
  });

  it('resolves clear live catalogue matches and replaces an invalid supplied id', () => {
    const input = proposal([
      item('rice', 'Basmati Rice 1kg', '1kg bag'),
      item('veg', 'Green Isle Mixed Vegetables 450g', '450g bag', 'invented-id'),
    ]);
    const products = [
      { canonical_product_id: 'rice-id', canonical_name: 'Basmati Rice 1kg', category: 'Rice' },
      { canonical_product_id: 'veg-id', canonical_name: 'Green Isle Mixed Vegetables 450g', category: 'Frozen' },
    ];

    const resolved = resolveHouseholdShopProposal(input, products, [
      priceRow('rice-id', 'Basmati Rice 1kg'),
      priceRow('veg-id', 'Green Isle Mixed Vegetables 450g'),
    ]);

    expect(resolved.items.map(row => row.canonical_product_id)).toEqual(['rice-id', 'veg-id']);
  });

  it('keeps an ambiguous product family unresolved', () => {
    const input = proposal([item('milk', 'Milk', '2 litre carton')]);
    const products = [
      { canonical_product_id: 'whole-id', canonical_name: 'Whole Milk 2L', category: 'Dairy' },
      { canonical_product_id: 'low-id', canonical_name: 'Low Fat Milk 2L', category: 'Dairy' },
    ];

    const resolved = resolveHouseholdShopProposal(input, products, [
      priceRow('whole-id', 'Whole Milk 2L'),
      priceRow('low-id', 'Low Fat Milk 2L'),
    ]);

    expect(resolved.items[0]).toMatchObject({ canonical_product_id: null, unresolved_need: 'Milk' });
  });

  it('derives a bounded unique seed set for batched database lookup', () => {
    const input = proposal([
      item('rice-a', 'Basmati Rice 1kg', '1kg bag'),
      item('rice-b', 'Basmati Rice 1kg', '1kg bag'),
      item('veg', 'Green Isle Mixed Vegetables 450g', '450g bag'),
    ]);

    expect(householdShopResolutionSeeds(input)).toEqual(expect.arrayContaining(['basmati', 'vegetables']));
    expect(new Set(householdShopResolutionSeeds(input)).size).toBe(householdShopResolutionSeeds(input).length);
  });
});
