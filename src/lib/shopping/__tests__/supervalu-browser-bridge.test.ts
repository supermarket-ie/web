import { describe, expect, it } from 'vitest';
import { buildSupervaluBrowserBridgeUrl } from '../retailer-handoff/supervalu-browser-bridge';

describe('buildSupervaluBrowserBridgeUrl', () => {
  it('builds a store-scoped SuperValu URL with an opaque bridge payload', () => {
    const url = buildSupervaluBrowserBridgeUrl([
      {
        sku: '1020723000',
        quantity: 1,
        name: 'Premier Low Fat Milk 2L',
        productUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/premier-low-fat-milk-2-l-id-1020723000',
      },
      {
        sku: '1234567890',
        quantity: 2,
        productUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/example-id-1234567890',
      },
    ]);

    expect(url).toContain('https://shop.supervalu.ie/sm/delivery/rsid/5550/product/');
    expect(url).toContain('#supermarket-ie-cart=');
    expect(url).not.toContain('Premier Low Fat Milk 2L');
  });

  it('rejects non-SuperValu URLs', () => {
    expect(() =>
      buildSupervaluBrowserBridgeUrl([
        {
          sku: '1',
          quantity: 1,
          productUrl: 'https://example.com/product/1',
        },
      ]),
    ).toThrow(/shop\.supervalu\.ie/);
  });

  it('requires store-scoped product URLs', () => {
    expect(() =>
      buildSupervaluBrowserBridgeUrl([
        {
          sku: '1',
          quantity: 1,
          productUrl: 'https://shop.supervalu.ie/product/example-id-1',
        },
      ]),
    ).toThrow(/store-scoped/);
  });
});
