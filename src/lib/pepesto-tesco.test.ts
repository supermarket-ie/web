import { describe, expect, it } from 'vitest';
import { pepestoSearchQuery } from './pepesto-query';
import type { TescoQueueProduct } from './tesco-queue-worker';

function product(overrides: Partial<TescoQueueProduct> = {}): TescoQueueProduct {
  return {
    storeProductId: 'sp-1',
    canonicalName: 'Onions 1kg',
    storeProductName: 'Tesco Breaded Onion Rings',
    storeUrl: 'https://www.tesco.ie/shop/en-IE/products/257218318',
    storeSku: '257218318',
    previousPrice: null,
    ...overrides,
  };
}

describe('Pepesto Tesco search query', () => {
  it('retains stored retailer titles for exact-SKU price refreshes', () => {
    expect(pepestoSearchQuery([product()])).toBe('Tesco Breaded Onion Rings');
  });

  it('uses the canonical identity for audited candidate discovery', () => {
    expect(pepestoSearchQuery([product({ discoveryMode: 'audited_candidate_discovery' })])).toBe('Onions 1kg');
  });
});
