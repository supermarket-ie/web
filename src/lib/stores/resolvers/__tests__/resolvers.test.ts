import { describe, it, expect } from 'vitest';
import { TescoResolver } from '../tesco';
import { DunnesResolver } from '../dunnes';
import { SuperValuResolver } from '../supervalu';
import { LidlResolver } from '../lidl';
import { AldiResolver } from '../aldi';
import { getResolver } from '../index';
import type { StoreProductRow } from '../../types';

function makeProduct(overrides: Partial<StoreProductRow> = {}): StoreProductRow {
  return {
    id: 'sp-001',
    product_id: 'p-001',
    store: 'tesco',
    store_product_name: 'Avonmore Fresh Milk 2L',
    store_url: null,
    store_sku: null,
    products: {
      id: 'p-001',
      canonical_name: 'Fresh Milk 2L',
      search_profile: {
        required_tokens: ['milk', '2l'],
        exclude_tokens: ['goat'],
        preferred_tokens: ['avonmore', 'fresh'],
      },
    },
    ...overrides,
  };
}

// --- Tesco ---

describe('TescoResolver', () => {
  it('returns existing store_url if already set', () => {
    const product = makeProduct({
      store: 'tesco',
      store_url: 'https://www.tesco.ie/groceries/en-IE/products/123',
      store_sku: '123',
    });
    const result = TescoResolver.resolve(product);
    expect(result.store_url).toBe('https://www.tesco.ie/groceries/en-IE/products/123');
    expect(result.store_sku).toBe('123');
  });

  it('builds URL from SKU when no store_url', () => {
    const product = makeProduct({ store: 'tesco', store_sku: '456' });
    const result = TescoResolver.resolve(product);
    expect(result.store_url).toBe('https://www.tesco.ie/groceries/en-IE/products/456');
    expect(result.store_sku).toBe('456');
  });

  it('falls back to search URL when no SKU', () => {
    const product = makeProduct({ store: 'tesco' });
    const result = TescoResolver.resolve(product);
    expect(result.store_url).toContain('https://www.tesco.ie/groceries/en-IE/search?query=');
    expect(result.store_url).toContain('Avonmore');
    expect(result.store_sku).toBeNull();
  });
});

// --- Dunnes ---

describe('DunnesResolver', () => {
  it('returns existing store_url if already set', () => {
    const product = makeProduct({
      store: 'dunnes',
      store_url: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/milk-123',
      store_sku: '123',
    });
    const result = DunnesResolver.resolve(product);
    expect(result.store_url).toContain('dunnesstoresgrocery.com');
    expect(result.store_sku).toBe('123');
  });

  it('builds URL from SKU with slugified name', () => {
    const product = makeProduct({ store: 'dunnes', store_sku: '789' });
    const result = DunnesResolver.resolve(product);
    expect(result.store_url).toContain('dunnesstoresgrocery.com');
    expect(result.store_url).toContain('avonmore-fresh-milk-2l');
    expect(result.store_url).toContain('789');
  });

  it('falls back to search URL', () => {
    const product = makeProduct({ store: 'dunnes' });
    const result = DunnesResolver.resolve(product);
    expect(result.store_url).toContain('search?q=');
    expect(result.store_sku).toBeNull();
  });
});

// --- SuperValu ---

describe('SuperValuResolver', () => {
  it('returns existing store_url if already set', () => {
    const product = makeProduct({
      store: 'supervalu',
      store_url: 'https://shop.supervalu.ie/shopping/product/milk-100',
      store_sku: '100',
    });
    const result = SuperValuResolver.resolve(product);
    expect(result.store_url).toContain('shop.supervalu.ie');
  });

  it('builds URL from SKU', () => {
    const product = makeProduct({ store: 'supervalu', store_sku: '200' });
    const result = SuperValuResolver.resolve(product);
    expect(result.store_url).toContain('shop.supervalu.ie/shopping/product/');
    expect(result.store_url).toContain('200');
  });

  it('falls back to search URL', () => {
    const product = makeProduct({ store: 'supervalu' });
    const result = SuperValuResolver.resolve(product);
    expect(result.store_url).toContain('search-results?q=');
  });
});

// --- Lidl ---

describe('LidlResolver', () => {
  it('returns existing store_url', () => {
    const product = makeProduct({
      store: 'lidl',
      store_url: 'https://www.lidl.ie/p/milk/p12345',
      store_sku: '12345',
    });
    const result = LidlResolver.resolve(product);
    expect(result.store_url).toBe('https://www.lidl.ie/p/milk/p12345');
  });

  it('builds URL from SKU', () => {
    const product = makeProduct({ store: 'lidl', store_sku: '99' });
    const result = LidlResolver.resolve(product);
    expect(result.store_url).toContain('www.lidl.ie/p/');
    expect(result.store_url).toContain('/p99');
  });

  it('falls back to search URL', () => {
    const product = makeProduct({ store: 'lidl' });
    const result = LidlResolver.resolve(product);
    expect(result.store_url).toContain('lidl.ie/q/query/');
  });
});

// --- Aldi ---

describe('AldiResolver', () => {
  it('returns existing store_url', () => {
    const product = makeProduct({
      store: 'aldi',
      store_url: 'https://groceries.aldi.ie/en-GB/p-milk-55',
      store_sku: '55',
    });
    const result = AldiResolver.resolve(product);
    expect(result.store_url).toBe('https://groceries.aldi.ie/en-GB/p-milk-55');
  });

  it('builds URL from SKU', () => {
    const product = makeProduct({ store: 'aldi', store_sku: '77' });
    const result = AldiResolver.resolve(product);
    expect(result.store_url).toContain('groceries.aldi.ie/en-GB/p-');
    expect(result.store_url).toContain('77');
  });

  it('falls back to search URL', () => {
    const product = makeProduct({ store: 'aldi' });
    const result = AldiResolver.resolve(product);
    expect(result.store_url).toContain('aldi.ie/en-GB/Search?query=');
  });
});

// --- getResolver registry ---

describe('getResolver', () => {
  it.each(['tesco', 'dunnes', 'supervalu', 'lidl', 'aldi'] as const)(
    'returns a resolver for %s',
    (store) => {
      const resolver = getResolver(store);
      expect(resolver).toBeDefined();
      expect(typeof resolver.resolve).toBe('function');
    }
  );
});
