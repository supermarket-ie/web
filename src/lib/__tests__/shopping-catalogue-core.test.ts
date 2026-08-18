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
});
