import { describe, expect, it } from 'vitest';
import { independentlyReturnedProductIds } from './tesco-proven-refresh-core';

describe('independentlyReturnedProductIds', () => {
  it('accepts sessions that returned one item per requested product', () => {
    const ids = independentlyReturnedProductIds([{
      run_uuid: 'old-run',
      products: [{ storeProductId: 'a' }, { storeProductId: 'b' }],
      result_summary: { items: 2 },
    }]);
    expect([...ids]).toEqual(['a', 'b']);
  });

  it('rejects the current collapsed multi-product search response', () => {
    const ids = independentlyReturnedProductIds([{
      run_uuid: 'collapsed-run',
      products: [{ storeProductId: 'a' }, { storeProductId: 'b' }],
      result_summary: { items: 1 },
    }]);
    expect([...ids]).toEqual([]);
  });
});
