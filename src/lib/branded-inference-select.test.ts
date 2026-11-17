import { describe, expect, it } from 'vitest';
import { selectInferenceCandidates } from './branded-inference';

const recs = new Map([
  ['dunnes:100111838', { sku: '100111838', canonicalIds: ['c1'] }],
  ['supervalu:1020898000', { sku: '1020898000', canonicalIds: ['c1'] }],
  ['dunnes:100000001', { sku: '100000001', canonicalIds: ['c2'] }],
  ['supervalu:1000000002', { sku: '1000000002', canonicalIds: ['c3'] }],
  ['dunnes:missing-abc', { sku: '', canonicalIds: ['c4'] }],
]);
const wording = { missing: ['wording_requires_inference_or_corroboration'] };
const pair = (left: string, right: string, result = wording) => ({ id: [left, right].sort().join('|'), left, right, result });

describe('selectInferenceCandidates', () => {
  it('never sends a pair with any non-wording gap (pack, variant, evidence age) to the model', () => {
    const out = selectInferenceCandidates([
      pair('dunnes:100111838', 'supervalu:1020898000', { missing: ['wording_requires_inference_or_corroboration', 'exact_pack_not_established'] }),
      pair('dunnes:100111838', 'supervalu:1020898000', { missing: ['variant_unconfirmed:original'] }),
      pair('dunnes:100111838', 'supervalu:1020898000', { missing: ['independent_recent_retailer_evidence_missing'] }),
    ], recs);
    expect(out).toEqual([]);
  });
  it('excludes SKU-less placeholder records', () => {
    expect(selectInferenceCandidates([pair('dunnes:missing-abc', 'supervalu:1020898000')], recs)).toEqual([]);
  });
  it('a priority list orders eligible pairs but cannot add ineligible ones', () => {
    const a = pair('dunnes:100111838', 'supervalu:1020898000'), b = pair('dunnes:100000001', 'supervalu:1000000002');
    const blocked = pair('dunnes:100000001', 'supervalu:1020898000', { missing: ['exact_pack_not_established'] });
    expect(selectInferenceCandidates([a, b, blocked], recs, [b.id, blocked.id, a.id]).map(p => p.id)).toEqual([b.id, a.id]);
  });
  it('without a priority list, same-canonical pairs come first', () => {
    const a = pair('dunnes:100111838', 'supervalu:1020898000'), b = pair('dunnes:100000001', 'supervalu:1000000002');
    expect(selectInferenceCandidates([b, a], recs).map(p => p.id)).toEqual([a.id, b.id]);
  });
});
