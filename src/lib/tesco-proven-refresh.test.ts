import { describe, expect, it } from 'vitest';
import { independentlyReturnedProductIds, oneProductSearchAttemptIds, oneProductSearchAttemptCanonicalIds, selectUniqueCanonicalCandidates } from './tesco-proven-refresh-core';

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

describe('canonical Tesco selection', () => {
  const candidate = (productId: string, storeProductId: string, demandUnits = 0, proven = false) => ({
    productId, storeProductId, demandUnits, proven, resolved: true, audited: true, value: storeProductId,
  });

  it('selects only one Tesco row per canonical product', () => {
    const selected = selectUniqueCanonicalCandidates([candidate('p1','s1'), candidate('p1','s2',0,true)], 50);
    expect(selected.map(x => x.storeProductId)).toEqual(['s2']);
  });

  it('excludes an already-live or previously attempted canonical regardless of row', () => {
    const selected = selectUniqueCanonicalCandidates([candidate('p1','s2'), candidate('p2','s3')], 50, new Set(['p1']));
    expect(selected.map(x => x.productId)).toEqual(['p2']);
  });

  it('ranks demand before provenance and higher demand first', () => {
    const selected = selectUniqueCanonicalCandidates([
      candidate('p0','s0',0,true), candidate('p1','s1',2,false), candidate('p2','s2',5,false),
    ], 50);
    expect(selected.map(x => x.productId)).toEqual(['p2','p1','p0']);
  });

  it('is deterministic and non-overlapping when prior canonical attempts are excluded', () => {
    const all = [candidate('p2','s2'), candidate('p1','s1'), candidate('p3','s3')];
    const first = selectUniqueCanonicalCandidates(all, 2);
    const second = selectUniqueCanonicalCandidates(all, 2, new Set(first.map(x => x.productId)));
    expect(first.map(x => x.productId)).toEqual(['p1','p2']);
    expect(second.map(x => x.productId)).toEqual(['p3']);
  });

  it('maps legacy one-product attempts to canonical product IDs', () => {
    const ids = oneProductSearchAttemptCanonicalIds([{
      run_uuid:'r', products:[{storeProductId:'old-row'}], result_summary:{items:0},
    }], new Map([['old-row','canonical']]));
    expect([...ids]).toEqual(['canonical']);
  });
});
