import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_EXECUTION_CONFIG,
  assertStorefrontMutationAllowed,
  extractRetailerStoreId,
  prepareStorefrontBasketContext,
} from './storefront';

describe('Storefront execution contract', () => {
  it('recognises store context in SuperValu and Dunnes product URLs', () => {
    expect(extractRetailerStoreId('https://shop.supervalu.ie/sm/delivery/rsid/123/product/example/456')).toBe('123');
    expect(extractRetailerStoreId('https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/example/100736039')).toBe('258');
  });

  it('records the proven Dunnes boundary without claiming its mutation contract', () => {
    const config = STOREFRONT_EXECUTION_CONFIG.dunnes;
    expect(config.platform).toBe('instacart_storefront');
    expect(config.cartResourceConfirmed).toBe(true);
    expect(config.authRequired).toBe(true);
    expect(config.singleAddContractConfirmed).toBe(false);
    expect(config.bulkAddContractConfirmed).toBe(false);
    expect(config.mutationEnabled).toBe(false);
  });

  it('records the understood SuperValu add contract but keeps mutation disabled', () => {
    const config = STOREFRONT_EXECUTION_CONFIG.supervalu;
    expect(config.singleAddContractConfirmed).toBe(true);
    expect(config.bulkAddContractConfirmed).toBe(true);
    expect(config.mutationEnabled).toBe(false);
  });

  it('prepares a single-store Dunnes basket context from mapped products', () => {
    const context = prepareStorefrontBasketContext('dunnes', [
      {
        retailer: 'dunnes',
        retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/example/100736039',
        retailerProductId: '100736039',
        quantity: 2,
      },
      {
        retailer: 'dunnes',
        retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/another/100736040',
        retailerProductId: '100736040',
        quantity: 1,
      },
    ]);

    expect(context.retailerStoreId).toBe('258');
    expect(context.items).toHaveLength(2);
    expect(context.items[0].quantity).toBe(2);
  });

  it('rejects mixed retailer store contexts', () => {
    expect(() => prepareStorefrontBasketContext('dunnes', [
      {
        retailer: 'dunnes',
        retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/example/1',
      },
      {
        retailer: 'dunnes',
        retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/312/product/details/example/2',
      },
    ])).toThrow(/multiple dunnes store contexts/i);
  });

  it('rejects the wrong retailer domain', () => {
    expect(() => prepareStorefrontBasketContext('dunnes', [
      {
        retailer: 'dunnes',
        retailerUrl: 'https://example.com/sm/delivery/rsid/258/product/example/1',
      },
    ])).toThrow(/invalid dunnes storefront product url/i);
  });

  it('hard-stops Dunnes mutation until its POST contract is confirmed', () => {
    expect(() => assertStorefrontMutationAllowed('dunnes')).toThrow(/exact authenticated Storefront POST contract/i);
  });
});
