import { describe, expect, it } from 'vitest';
import {
  getCatalogueSeed,
  resolveCatalogueRows,
  type CataloguePriceRow,
} from '@/lib/shopping/catalogue-core';

const rows: CataloguePriceRow[] = [
  {
    canonical_name: 'Hellmanns Real Mayonnaise 500ml',
    category: 'Condiments',
    store: 'SuperValu',
    store_product_name: 'Hellmanns Real Mayonnaise 500 ML',
    price: 4.5,
    was_price: 5.0,
    on_promotion: true,
  },
  {
    canonical_name: 'Hellmanns Real Mayonnaise 500ml',
    category: 'Condiments',
    store: 'Dunnes',
    store_product_name: 'Hellmanns Real Mayo 500ml',
    price: 4.25,
    was_price: null,
    on_promotion: false,
  },
  {
    canonical_name: 'Heinz Seriously Good Mayonnaise 500ml',
    category: 'Condiments',
    store: 'SuperValu',
    store_product_name: 'Heinz Seriously Good Mayo 500ml',
    price: 4.0,
    was_price: null,
    on_promotion: false,
  },
];

describe('shopping catalogue core', () => {
  it('selects a safe distinctive seed from natural product wording', () => {
    expect(getCatalogueSeed("Hellmann's mayonnaise")).toBe('hellmann');
  });

  it('groups retailer offers behind one resolved canonical product', () => {
    const [result] = resolveCatalogueRows("Hellmann's mayonnaise", rows, 5);

    expect(result.canonical_name).toBe('Hellmanns Real Mayonnaise 500ml');
    expect(result.best_store).toBe('Dunnes');
    expect(result.best_price).toBe(4.25);
    expect(result.offers).toHaveLength(2);
    expect(result.on_promotion).toBe(true);
  });

  it('does not let a cheaper unrelated brand outrank the requested brand', () => {
    const [result] = resolveCatalogueRows('Hellmanns mayonnaise', rows, 5);
    expect(result.canonical_name).toContain('Hellmanns');
  });

  it('ranks whole-word grocery staples above cheaper substring matches', () => {
    const stapleRows: CataloguePriceRow[] = [
      { canonical_name: 'Buttermilk Pancakes 6 Pack', category: 'Bakery', store: 'SuperValu', store_product_name: 'Buttermilk Pancakes 6 Pack', price: 0.94, was_price: null, on_promotion: false },
      { canonical_name: 'Butterhead Lettuce 1 Pack', category: 'Vegetables', store: 'SuperValu', store_product_name: 'Butterhead Lettuce', price: 0.95, was_price: null, on_promotion: false },
      { canonical_name: 'Kerrygold Unsalted Butter 227g', category: 'Dairy', store: 'Dunnes', store_product_name: 'Kerrygold Unsalted Butter 227g', price: 2.99, was_price: null, on_promotion: false },
    ];

    expect(resolveCatalogueRows('butter', stapleRows, 3)[0]?.canonical_name)
      .toBe('Kerrygold Unsalted Butter 227g');
  });

  it.each([
    ['milk', 'Fresh Whole Milk 2L'],
    ['bread', 'Brown Bread 800g'],
  ])('keeps %s suggestions in the expected staple category', (query, expected) => {
    const stapleRows: CataloguePriceRow[] = [
      { canonical_name: expected, category: query === 'milk' ? 'Dairy' : 'Bakery', store: 'Dunnes', store_product_name: expected, price: 2.25, was_price: null, on_promotion: false },
      { canonical_name: query === 'milk' ? 'Milk & Honey Shower Cream 250ml' : 'Breaded Chicken Nuggets', category: query === 'milk' ? 'Personal Care' : 'Meat', store: 'SuperValu', store_product_name: query === 'milk' ? 'Milk Shower Cream' : 'Breaded Chicken Nuggets', price: 1.5, was_price: null, on_promotion: false },
    ];

    expect(resolveCatalogueRows(query, stapleRows, 2)[0]?.canonical_name).toBe(expected);
  });

  it.each([
    ['cheese', 'Mature Cheddar Cheese 400g', 'Vanilla Cheesecake'],
    ['coffee', 'Ground Coffee 227g', 'Coffee Chocolate Biscuits'],
    ['shampoo', 'Moisturising Shampoo 500ml', 'Shampoo & Conditioner Gift Set'],
    ['eggs', 'Free Range Eggs 12 Pack', 'Egg Noodles 250g'],
  ])('uses general title semantics for unseen search %s', (query, expected, incidental) => {
    const generalRows: CataloguePriceRow[] = [
      { canonical_name: incidental, category: 'Other', store: 'SuperValu', store_product_name: incidental, price: 0.99, was_price: null, on_promotion: false },
      { canonical_name: expected, category: 'Other', store: 'Dunnes', store_product_name: expected, price: 3.49, was_price: null, on_promotion: false },
    ];

    expect(resolveCatalogueRows(query, generalRows, 2)[0]?.canonical_name).toBe(expected);
  });

  it('prefers a concise product-headed title to an incidental pet-food ingredient', () => {
    const generalRows: CataloguePriceRow[] = [
      { canonical_name: 'Pedigree Rodeo with Chicken 7 Pack', category: 'Pet Care', store: 'Tesco', store_product_name: 'Pedigree Rodeo with Chicken 7 Pack', price: 3.79, was_price: null, on_promotion: false },
      { canonical_name: 'Chicken Drumsticks', category: 'Meat', store: 'SuperValu', store_product_name: 'Chicken Drumsticks', price: 3.99, was_price: null, on_promotion: false },
    ];

    expect(resolveCatalogueRows('chicken', generalRows, 2)[0]?.canonical_name).toBe('Chicken Drumsticks');
  });
});
