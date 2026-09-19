import { describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
import { parseResolutionCandidates } from './route';

describe('product resolution evidence parsing', () => {
  it('extracts retailer candidates and constructs a safe product URL', () => {
    const candidates = parseResolutionCandidates({
      failure_id: 'failure-1', store: 'dunnes', canonical_name: 'Penne Pasta 500g',
      store_product_name: 'Penne Pasta', store_sku: null, store_url: null,
      failure_reason: 'no_confident_match', demand_units: 12, demand_rank: 4,
      created_at: '2026-09-19T00:00:00Z',
      raw_error: 'candidates=1001:Roma Penne Pasta 500g:€1.99 | 1002:Wrong Pasta 400g:€1.50',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      sku: '1001', name: 'Roma Penne Pasta 500g', price: 1.99,
      url: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/roma-penne-pasta-500g/1001',
    });
  });

  it('ignores missing and duplicate SKU evidence', () => {
    const candidates = parseResolutionCandidates({
      failure_id: 'failure-1', store: 'supervalu', canonical_name: 'Bread',
      store_product_name: 'Bread', store_sku: null, store_url: null,
      failure_reason: 'no_confident_remap', demand_units: 0, demand_rank: null,
      created_at: '2026-09-19T00:00:00Z',
      raw_error: 'candidates=no-sku:Unknown:€2 | 1001:Good Bread:€2 | 1001:Good Bread:€2',
    });
    expect(candidates.map((candidate) => candidate.sku)).toEqual(['1001']);
  });
});
