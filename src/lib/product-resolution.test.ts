import { describe, expect, it } from 'vitest';
import {
  classifyResolution,
  isStrictExactResolution,
  parseResolutionCandidates,
  type ResolutionQueueRow,
} from './product-resolution';

function row(overrides: Partial<ResolutionQueueRow> = {}): ResolutionQueueRow {
  return {
    failure_id: 'failure-1', store: 'dunnes', canonical_name: 'Wholemeal Pitta 6 Pack',
    store_product_name: "Eghoyan's Bakery Ltd 6 Wholemeal Pitta 360g", store_sku: '100316536',
    store_url: null, failure_reason: 'no_confident_match', demand_units: 1, demand_rank: 1,
    created_at: '2026-09-19T00:00:00Z',
    raw_error: "candidates=100316536:Eghoyan's Bakery Ltd 6 Wholemeal Pitta 360g:€1.49",
    ...overrides,
  };
}

describe('strict product resolution', () => {
  it('accepts a corroborated same-SKU exact pack', () => {
    const item = row();
    const [candidate] = parseResolutionCandidates(item);
    expect(isStrictExactResolution(item, candidate)).toBe(true);
    expect(classifyResolution(item).classification).toBe('exact_candidate_available');
  });

  it('rejects caller-attractive evidence with the wrong size', () => {
    const item = row({
      canonical_name: 'Kelloggs Cornflakes 500g', store_product_name: 'Kelloggs Cornflakes 500g', store_sku: '100312536',
      raw_error: 'candidates=100312536:Kelloggs Cornflakes 670g:€4',
    });
    expect(classifyResolution(item).classification).toBe('variant_size_or_pack_mismatch');
  });

  it('rejects a reused SKU whose retailer identity is a different product type', () => {
    const item = row({
      canonical_name: 'Raw King Prawns 160g', store_product_name: 'Cook Healthy Ceramic Skillet', store_sku: '5099015730205',
      raw_error: 'candidates=5099015730205:Cook Healthy 30cm Ceramic Skillet Stone:€25',
    });
    expect(classifyResolution(item).classification).toBe('insufficient_evidence');
  });

  it('rejects a loose canonical item when retailer evidence is a multipack', () => {
    const item = row({
      canonical_name: 'Batchelors Mushy Peas 225g', store_product_name: 'Batchelors Mushy Peas 225g', store_sku: '100739964',
      raw_error: 'candidates=100739964:Batchelors Mushy Peas 3 x 225g:€3.70',
    });
    expect(classifyResolution(item).classification).toBe('variant_size_or_pack_mismatch');
  });

  it('rejects a generic canonical phrase embedded in a different product', () => {
    const item = row({
      canonical_name: 'Chilli Peppers Red', store_product_name: 'Chilli Peppers Red', store_sku: '100287669',
      raw_error: 'candidates=100287669:Gosh! Sweet Potato Pakora with Red Pepper Cumin & Chilli 171g:€3',
    });
    expect(classifyResolution(item).classification).not.toBe('exact_candidate_available');
  });

  it('keeps generic canonical identities out of automatic resolution', () => {
    const item = row({
      canonical_name: 'Cornflakes', store_product_name: 'Kelloggs Cornflakes 500g', store_sku: '100312536',
      raw_error: "candidates=100312536:Kellogg's Corn Flakes 670g:€4",
    });
    expect(classifyResolution(item).classification).toBe('poor_or_malformed_canonical_data');
  });

  it('does not infer retailer absence from a search failure', () => {
    const item = row({ raw_error: 'queries=missing item', failure_reason: 'no_search_results' });
    expect(classifyResolution(item).classification).toBe('retailer_search_query_failure');
  });
});
