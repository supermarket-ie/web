import { describe, expect, it } from 'vitest';
import type { ShoppingBasket } from '../contracts';
import { superValuAdapter } from './supervalu';

describe('superValuAdapter', () => {
  it('prepares a ready handoff when all items have SuperValu mappings', () => {
    const basket: ShoppingBasket = {
      items: [
        {
          canonical_name: "Hellmann's Real Mayonnaise 500ml",
          quantity: 2,
          selected_offer: {
            retailer: 'supervalu',
            retailer_product_id: '12345',
            retailer_product_name: "Hellmann's Real Mayonnaise 500ml",
            retailer_url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/hellmanns-real-mayonnaise-500ml-id-12345',
            price: 4.5,
            on_promotion: false,
          },
        },
      ],
    };

    const result = superValuAdapter.prepareHandoff(basket);
    expect(result.status).toBe('ready');
    expect(result.method).toBe('product_links');
    expect(result.matched_items).toBe(1);
    expect(result.unmatched_items).toEqual([]);
    expect(result.items?.[0].quantity).toBe(2);
    expect(result.cart_url).toBe('https://shop.supervalu.ie/cart');
  });

  it('uses a SuperValu alternative when another retailer is selected', () => {
    const basket: ShoppingBasket = {
      items: [
        {
          canonical_name: 'Whole Milk 2L',
          quantity: 1,
          selected_offer: {
            retailer: 'dunnes',
            retailer_product_name: 'Whole Milk 2L',
            price: 2.2,
            on_promotion: false,
          },
          alternatives: [
            {
              retailer: 'supervalu',
              retailer_product_id: '67890',
              retailer_product_name: 'Whole Milk 2L',
              retailer_url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/whole-milk-2l-id-67890',
              price: 2.25,
              on_promotion: false,
            },
          ],
        },
      ],
    };

    const result = superValuAdapter.prepareHandoff(basket);
    expect(result.status).toBe('ready');
    expect(result.items?.[0].retailer_product_id).toBe('67890');
  });

  it('reports a partial handoff when a product has no SuperValu mapping', () => {
    const basket: ShoppingBasket = {
      items: [
        { canonical_name: 'Mapped Item', quantity: 1, selected_offer: {
          retailer: 'supervalu', retailer_product_id: '1', retailer_product_name: 'Mapped Item',
          retailer_url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/mapped-item-id-1', price: 1, on_promotion: false,
        } },
        { canonical_name: 'Missing Item', quantity: 1 },
      ],
    };

    const result = superValuAdapter.prepareHandoff(basket);
    expect(result.status).toBe('partial');
    expect(result.matched_items).toBe(1);
    expect(result.unmatched_items).toEqual(['Missing Item']);
  });

  it('rejects non-SuperValu product URLs', () => {
    const basket: ShoppingBasket = {
      items: [{
        canonical_name: 'Unsafe URL Item',
        quantity: 1,
        selected_offer: {
          retailer: 'supervalu',
          retailer_product_name: 'Unsafe URL Item',
          retailer_url: 'https://example.com/product/1',
          price: 1,
          on_promotion: false,
        },
      }],
    };

    const result = superValuAdapter.prepareHandoff(basket);
    expect(result.status).toBe('partial');
    expect(result.unmatched_items).toEqual(['Unsafe URL Item']);
  });
});
