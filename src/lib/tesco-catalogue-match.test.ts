import { describe, expect, it } from 'vitest';
import { indexCatalogue, matchCanonical, type Canonical, type CatalogueItem, type Peer } from './tesco-catalogue-match';

const item = (sku: string, over: Partial<CatalogueItem> = {}): CatalogueItem => ({ sku, gtin: null, name: 'Heinz Baked Beans 415G',
  brand: 'Heinz', url: `https://www.tesco.ie/shop/en-IE/products/${sku}`, department: null, superDepartment: 'Food Cupboard', price: 1.2, ...over });
const canon: Canonical = { id: 'p1', name: 'Heinz Baked Beans 415g', brand: 'Heinz', ean: null };
const peers: Peer[] = [
  { store: 'dunnes', name: 'Heinz Baked Beans 415g', brand: 'Heinz', gtin: null },
  { store: 'supervalu', name: 'Heinz Baked Beans In Tomato Sauce (415 g)', brand: 'Heinz', gtin: null },
];
const run = (items: CatalogueItem[], c = canon, p = peers, mappings = [{ id: 'm1', sku: '111' }], owners = new Map<string, string>()) =>
  matchCanonical(c, p, mappings, indexCatalogue(items), owners);

describe('matchCanonical', () => {
  it('a canonical EAN with independent provenance confirms the current mapping', () => {
    const r = run([item('111', { gtin: '05000157024671' })], { ...canon, ean: '5000157024671', eanIndependent: true });
    expect(r).toMatchObject({ kind: 'barcode_exact', relation: 'confirms_mapping', sku: '111' });
  });
  it('a Tesco-sourced canonical EAN (no provenance) is only a lead, never barcode_exact', () => {
    const r = run([item('111', { gtin: '05000157024671' })], { ...canon, ean: '5000157024671' });
    expect(r).toMatchObject({ kind: 'tesco_sourced_barcode', reasons: ['canonical_ean_not_independent'] });
  });
  it('a peer GTIN hit on a different SKU is a replacement for guarded repair', () => {
    const r = run([item('222', { gtin: '05000157024671' })], canon, [{ ...peers[0], gtin: '05000157024671' }, peers[1]]);
    expect(r).toMatchObject({ kind: 'barcode_exact', relation: 'replacement', sku: '222' });
  });
  it('a barcode hit that contradicts the canonical pack or variant is held, never a link', () => {
    expect(run([item('111', { gtin: '05000157024671', name: 'Heinz Baked Beans 4 x 415G' })], { ...canon, ean: '5000157024671', eanIndependent: true }).kind).toBe('barcode_conflict');
    expect(run([item('111', { gtin: '05000157024671', name: 'Heinz Baked Beans Sugar Free 415G' })], { ...canon, ean: '5000157024671', eanIndependent: true }).kind).toBe('barcode_conflict');
  });
  it('two qualifying SKUs are ambiguous', () => {
    expect(run([item('111', { gtin: '05000157024671' }), item('333', { gtin: '05000157024671' })], { ...canon, ean: '5000157024671', eanIndependent: true }).kind).toBe('ambiguous');
  });
  it('without a barcode, BOTH peers must match for a peer_candidate (AI still required)', () => {
    expect(run([item('111')]).kind).toBe('peer_candidate');
    expect(run([item('111')], canon, [peers[0], { ...peers[1], name: 'Branston Baked Beans (410 g)', brand: 'Branston' }]).kind).toBe('no_match');
    expect(run([item('111')], canon, [peers[0]]).reasons).toEqual(['peers_lt_2']);
  });
  it('a generic pack-less canonical never produces a candidate', () => {
    expect(run([item('111')], { ...canon, name: 'Baked Beans', brand: null }).kind).toBe('no_match');
  });
  it('a SKU owned by another canonical goes to the shared queue', () => {
    const r = run([item('444', { gtin: '05000157024671' })], { ...canon, ean: '5000157024671', eanIndependent: true }, peers, [], new Map([['444', 'other']]));
    expect(r.relation).toBe('shared');
  });
});
