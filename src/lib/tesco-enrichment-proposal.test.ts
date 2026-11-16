import { describe, expect, it } from 'vitest';
import { proposeEnrichment, setBrandLexicon, type Offer } from './tesco-enrichment-proposal';
setBrandLexicon(["Flahavan's", 'Lakeshore', 'Lifeforce', 'Maille', 'Alpro', 'John West']);

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
  it('an Aldi/Lidl offer never substantiates, but a conflicting one is still detached', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      { store: 'aldi' as never, role: 'other', sku: 'a', name: 'Specially Selected Dijon Mustard 185g', brand: 'Specially Selected' }]);
    expect(r.status).toBe('needs_split');
    expect(r.reasons).toContain('core_identity_not_substantiated');
    expect(r.offerVerdicts!.find(v => v.sku === 'a')!.verdict).toBe('conflicts');
  });
  it('production regression: Flahavan\'s Hi8 1kg attached to Lifeforce Muesli 750g (blank brand field) is a conflict, never exact', () => {
    const r = proposeEnrichment(canon('Muesli', 'Lifeforce'), [tesco('Lifeforce Irish Muesli 750G', 'LIFEFORCE'),
      peer('supervalu', 'Lifeforce Muesli (750 g)'), peer('dunnes', "Flahavan's Hi8 Muesli Original 1kg", null, 'd-flahavans')]);
    const fl = r.offerVerdicts!.find(v => v.sku === 'd-flahavans')!;
    expect(fl).toMatchObject({ brand: "Flahavan's", brandSource: 'title', verdict: 'conflicts' });
    expect(fl.conflicts.join(' ')).toMatch(/brand.*pack/);
    expect(r.status).toBe('split_ready');
    expect(r.proposed?.name).toBe('Lifeforce Muesli 750g');
    expect(r.splitInto!.map(g => `${g.brand}|${g.pack}`)).toEqual(['LIFEFORCE|750g', "Flahavan's|1kg"]);
  });
  it('production regression: Lakeshore Dijon 200g attached to Maille Dijon 215g is a conflict', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      peer('supervalu', 'Maille Dijon Mustard (215 g)'), peer('dunnes', 'Lakeshore Dijon Mustard 200g', null, 'd-lake')]);
    expect(r.offerVerdicts!.find(v => v.sku === 'd-lake')).toMatchObject({ brand: 'Lakeshore', verdict: 'conflicts' });
    expect(r.status).toBe('split_ready');
  });
  it('a conflicting offer without a pack is still detached, but its new record is flagged incomplete', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      peer('supervalu', 'Maille Dijon Mustard (215 g)'), peer('dunnes', 'Lakeshore Dijon Mustard', null, 'd-lake')]);
    expect(r.status).toBe('split_ready');
    expect(r.reasons).toContain('a_split_out_product_lacks_brand_or_pack');
    expect(r.splitInto!.find(g => g.brand === 'Lakeshore')!.complete).toBe(false);
  });
  it('without a substantiated core the record is only flagged needs_split (no batch)', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      peer('dunnes', 'Lakeshore Dijon Mustard 200g', null, 'd-lake')]);
    expect(r.status).toBe('needs_split');
    expect(r.reasons).toContain('core_identity_not_substantiated');
  });
  it('a same-brand same-pack offer with different variant words conflicts (Barista vs No Sugars)', () => {
    const r = proposeEnrichment(canon('Oat Drink', 'Alpro'), [tesco('Alpro Barista Oat Drink 1L', 'ALPRO'), peer('supervalu', 'Alpro Barista Oat Drink (1 L)'),
      peer('dunnes', 'Alpro No Sugars Oat Drink 1L', 'Alpro', 'd-ns')]);
    expect(r.offerVerdicts!.find(v => v.sku === 'd-ns')!.verdict).toBe('conflicts');
  });
  it('a silent independent offer is listed for detachment review, not left exact', () => {
    const r = proposeEnrichment(canon('Dijon Mustard', 'Maille'), [tesco('Maille Dijon Original Mustard 215G', 'MAILLE'),
      peer('supervalu', 'Maille Dijon Mustard (215 g)'), peer('dunnes', 'Dijon Mustard', null, 'd-gen')]);
    expect(r.status).toBe('substantiated');
    expect(r.detachForReview).toEqual([{ store: 'dunnes', sku: 'd-gen', name: 'Dijon Mustard' }]);
  });
});
