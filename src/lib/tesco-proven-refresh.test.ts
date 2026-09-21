import { describe, expect, it } from 'vitest';
import { independentlyReturnedProductIds, oneProductSearchAttemptIds } from './tesco-proven-refresh-core';

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

describe('oneProductSearchAttemptIds', () => {
  it('remembers corrected one-product attempts even when no item was returned', () => {
    const ids = oneProductSearchAttemptIds([{
      run_uuid: 'current-run',
      products: [{ storeProductId: 'attempted' }],
      result_summary: { items: 0 },
    }, {
      run_uuid: 'legacy-run',
      products: [{ storeProductId: 'legacy-a' }, { storeProductId: 'legacy-b' }],
      result_summary: { items: 2 },
    }]);
    expect([...ids]).toEqual(['attempted']);
  });
});
