import { describe, expect, it } from 'vitest';
import { proposeEnrichment, type Offer } from './tesco-enrichment-proposal';

const tesco = (name: string, brand: string | null): Offer => ({ store: 'tesco', role: 'proposed', sku: '250858535', name, brand });
const peer = (store: 'dunnes' | 'supervalu', name: string, brand: string | null = null, sku = `${store}-1`): Offer => ({ store, role: 'peer', sku, name, brand });
const canon = (name: string, brand: string | null = null) => ({ id: 'p', name, brand, ean: null });

describe('proposeEnrichment (read-only)', () => {
  it('substantiates brand, agreed variant and pack when Tesco and an independent retailer agree', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'), peer('supervalu', 'Maille Dijon Mustard (215 g)')]);
    expect(r.status).toBe('substantiated');
    expect(r.proposed).toMatchObject({ name: 'Maille Dijon Mustard 215g', pack: '215g' });
    expect(r.supportingSources.map(s => s.store)).toEqual(['tesco', 'supervalu']);
  });
  it('Tesco-only evidence never substantiates', () => {
    expect(proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE')]).status).toBe('insufficient_evidence');
    expect(proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'), peer('dunnes', 'Dijon Mustard')]).status)
      .toBe('insufficient_evidence'); // silent peer: no brand, no pack
  });
  it('a different variant of the same brand and pack is not agreement (Barista vs No Sugars)', () => {
    const r = proposeEnrichment(canon('Oat Milk Unsweetened', 'Alpro'), [tesco('Alpro Barista Oat Long Life Dairy Free Drink 1L', 'ALPRO'), peer('dunnes', 'Alpro No Sugars Oat 1L', 'Alpro')]);
    expect(r.status).not.toBe('substantiated');
  });
  it('flags a generic record whose retailers sell different complete products for a split', () => {
    const r = proposeEnrichment(canon('Tuna in Water', 'John West'), [tesco('John West Tuna Chunks In Spring Water 145G', 'JOHN WEST'),
      peer('dunnes', 'John West Tuna Chunks in Spring Water 240g', 'John West')]);
    expect(r.status).toBe('needs_split');
    expect(r.splitInto!.map(g => g.pack)).toEqual(['145g', '240g']);
    const own = proposeEnrichment(canon('Potatoes 2kg'), [tesco('Tesco Irish Rooster 2Kg', 'TESCO'), peer('supervalu', 'SuperValu Irish Rooster Potatoes 2kg', 'SuperValu')]);
    expect(own.status).toBe('needs_split');
  });
  it('a canonical brand that contradicts the Tesco item is reported, not overwritten', () => {
    const r = proposeEnrichment(canon('Custard Creams', "McVitie's"), [tesco('Tesco Custard Cream Biscuits 400G', 'TESCO'), peer('dunnes', 'Tesco Custard Cream Biscuits 400g')]);
    expect(r.status).toBe('contradicted');
    expect(r.proposed).toBeNull();
  });
  it('ignores non-peer retailers (Aldi/Lidl) for substantiation and splitting', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      { store: 'aldi' as never, role: 'peer', sku: 'a', name: 'Specially Selected Dijon Mustard 185g', brand: 'Specially Selected' }]);
    expect(r.status).toBe('insufficient_evidence');
  });
});
