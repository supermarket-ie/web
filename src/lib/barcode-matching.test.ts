import { describe, expect, it } from 'vitest';
import { barcodeIdentityConflicts, classifyBarcodeResult, gs1CheckDigitValid, normaliseGtin, relationToMapping } from './barcode-matching';

describe('GTIN normalisation (retail unit only)', () => {
  it('validates GS1 check digits', () => {
    expect(gs1CheckDigitValid('5010034592605')).toBe(true);
    expect(gs1CheckDigitValid('5010034592604')).toBe(false);
    expect(gs1CheckDigitValid('96189290')).toBe(true);
  });
  it('unpads zero-padded GTIN-14 to EAN-13 / EAN-8 / UPC-A and gives the forms retailers index', () => {
    expect(normaliseGtin('05010034592605')).toEqual({ ok: true, kind: 'gtin13', gtin14: '05010034592605', retail: '5010034592605', queryForms: ['5010034592605'] });
    expect(normaliseGtin('00000096189290')).toMatchObject({ ok: true, kind: 'gtin8', retail: '96189290', queryForms: ['96189290'] });
    const upc = normaliseGtin('00012345678905');
    expect(upc).toMatchObject({ ok: true, kind: 'gtin12', retail: '012345678905', queryForms: ['0012345678905', '012345678905'] });
  });
  it('rejects packaging-level GTIN-14s, variable measure, restricted circulation, coupons and malformed values', () => {
    expect(normaliseGtin('15010034592602')).toMatchObject({ ok: false, reason: 'packaging_gtin14' });
    expect(normaliseGtin('95010034592608')).toMatchObject({ ok: false, reason: 'variable_measure' });
    // A GS1-valid EAN-8 on loose produce is not detectable from the code alone (the retailer search simply returns 0).
    expect(normaliseGtin('00000010021170')).toMatchObject({ ok: true, kind: 'gtin8', retail: '10021170' });
    expect(normaliseGtin('2000000000008')).toMatchObject({ ok: false, reason: 'restricted_circulation' });
    expect(normaliseGtin('0200000000004')).toMatchObject({ ok: false, reason: 'restricted_circulation' });
    expect(normaliseGtin('20000004')).toMatchObject({ ok: false, reason: 'restricted_circulation' });
    expect(normaliseGtin('9800000000007')).toMatchObject({ ok: false, reason: 'coupon_or_refund' });
    expect(normaliseGtin('5010034592604')).toMatchObject({ ok: false, reason: 'bad_check_digit' });
    expect(normaliseGtin('50100345926')).toMatchObject({ ok: false, reason: 'bad_length' });
    expect(normaliseGtin('ABC')).toMatchObject({ ok: false, reason: 'not_digits' });
  });
});

describe('barcode hit classification (discovery evidence, never approval)', () => {
  it('omissions and formatting are NOT contradictions under a shared barcode (real pilot cases)', () => {
    expect(barcodeIdentityConflicts({ name: 'Walkers Ready Salted Crisps Multipack 6x25g', brand: 'Walkers' }, { sku: 'x', name: 'Walkers Ready Salted Crisps 6 Pack (25 g)', brand: 'Walkers', unitOfSize: { abbreviation: 'kg', size: 0.15 } })).toEqual([]);
    expect(barcodeIdentityConflicts({ name: 'Twix Caramel & Milk Chocolate Biscuit Twin Bars 50g', brand: 'Twix' }, { sku: 'x', name: 'Twix Bar (50 g)', brand: 'Twix' })).toEqual([]);
    expect(barcodeIdentityConflicts({ name: 'MULLERICE PROTEIN Chocolate 180g', brand: 'MULLERICE' }, { sku: 'x', name: 'Muller Rice Protein Chocolate Dessert', brand: 'Müller', unitOfSize: { abbreviation: 'g', size: 180 } })).toEqual([]);
    expect(barcodeIdentityConflicts({ name: 'Ballygowan Hint of Fruit Peach Sugar Free Flavoured Still Water 750ml', brand: 'Ballygowan' }, { sku: 'x', name: 'Ballygowan Hint of Fruit Peach (750 ml)', brand: 'Ballygowan', unitOfSize: { abbreviation: 'l', size: 0.75 } })).toEqual([]);
    expect(barcodeIdentityConflicts({ name: 'FELIX ORIGINAL Farm Selection in Jelly Wet Cat Food 12x85g', brand: 'Felix' }, { sku: 'x', name: 'Felix Farm Selection In Jelly Cat Food Pouch 12 Pack (85 g)', brand: 'Felix', unitOfSize: { abbreviation: 'kg', size: 1.02 } })).toEqual([]);
  });
  const tesco = { name: 'Dolmio Stir In Pasta Sauce Sun Dried Tomato Red Sauce 150g', brand: 'Dolmio' };
  it('one SKU with no deterministic contradiction is identity_consistent (reworded titles are fine)', () => {
    expect(classifyBarcodeResult(tesco, [{ sku: '100684387', name: 'Dolmio Stir In Sun Dried Tomato Pasta Sauce 150g', brand: 'Dolmio' }]))
      .toEqual({ outcome: 'identity_consistent', sku: '100684387', reasons: [] });
  });
  it('a different pack, count, brand or variant is identity_conflict (held)', () => {
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Dolmio Stir In Sun Dried Tomato 300g', brand: 'Dolmio' })).toContain('pack');
    expect(barcodeIdentityConflicts({ name: 'Heinz Baked Beans 4 x 415g', brand: 'Heinz' }, { sku: 'x', name: 'Heinz Baked Beans 6 x 415g', brand: 'Heinz' })).toContain('count');
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Ragu Sun Dried Tomato 150g', brand: 'Ragu' })).toContain('brand');
    expect(barcodeIdentityConflicts({ name: 'Coca-Cola Zero Sugar 500ml', brand: 'Coca-Cola' }, { sku: 'x', name: 'Coca-Cola Original Taste 500ml', brand: 'Coca-Cola' })).toContain('variant');
    expect(barcodeIdentityConflicts({ name: 'Brennans Sliced Batch Loaf 780G', brand: 'Brennans' }, { sku: 'x', name: 'Brennans Batch White Loaf 800g', brand: 'Brennans' })).toContain('pack');
  });
  it('a structured size is used when the hit title states none', () => {
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Dolmio Stir In Sun Dried Tomato', brand: 'Dolmio', unitOfSize: { size: 300, abbreviation: 'g' } })).toContain('pack');
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Dolmio Stir In Sun Dried Tomato', brand: 'Dolmio', unitOfSize: { size: 150, abbreviation: 'g' } })).toEqual([]);
  });
  it('brand spelling across retailers ("Dr Oetker" / "Dr. Oetker", "MULLER X MY PROTEIN" / "Müller") is handled conservatively', () => {
    expect(barcodeIdentityConflicts({ name: 'Dr Oetker Bistro Baguette Pepperoni 2X125g', brand: 'Dr Oetker' },
      { sku: 'x', name: 'Dr. Oetker Bistro Baguette Pepperoni 2 x 125g (250g)', brand: 'Dr. Oetker' })).toEqual([]);
  });
  it('several SKUs for one barcode are ambiguous; none is not_found', () => {
    expect(classifyBarcodeResult(tesco, [{ sku: 'a', name: 'x', brand: null }, { sku: 'b', name: 'y', brand: null }]).outcome).toBe('ambiguous');
    expect(classifyBarcodeResult(tesco, []).outcome).toBe('not_found');
    // the same SKU returned by two query forms is ONE hit
    expect(classifyBarcodeResult(tesco, [{ sku: 'a', name: 'Dolmio Stir In Sun Dried Tomato 150g', brand: 'Dolmio' }, { sku: 'a', name: 'Dolmio Stir In Sun Dried Tomato 150g', brand: 'Dolmio' }]).outcome).toBe('identity_consistent');
  });
  it('relation to our existing mappings', () => {
    expect(relationToMapping('1', ['1'], false)).toBe('confirms_mapping');
    expect(relationToMapping('2', ['1'], false)).toBe('conflicts_with_mapping');
    expect(relationToMapping('2', [], false)).toBe('new_relationship');
    expect(relationToMapping('2', [], true)).toBe('sku_owned_by_other_canonical');
  });
});

import { evidenceTier, titleAgreement } from './barcode-matching';
describe('title agreement: the second, independent signal', () => {
  it('reworded titles of the same product agree; a different variant under the same barcode does not', () => {
    expect(titleAgreement({ name: 'Dolmio Stir In Pasta Sauce Sun Dried Tomato Red Sauce 150g', brand: 'Dolmio' },
      { sku: 'x', name: 'Dolmio Stir In Sun Dried Tomato Pasta Sauce 150g', brand: 'Dolmio' })).toBeGreaterThanOrEqual(0.6);
    expect(titleAgreement({ name: "L'Oreal Elvive Colour Protect Shampoo 400Ml", brand: "L'Oreal" },
      { sku: 'x', name: "L'Oréal Paris Elvive Colour Protect Shampoo, for Coloured & Highlighted Hair, 400ml", brand: "L'Oréal Paris" })).toBeGreaterThanOrEqual(0.6);
    expect(titleAgreement({ name: 'NIVEA Crème Soft Shower Cream 250ml', brand: 'NIVEA' },
      { sku: 'x', name: 'Nivea Clay Fresh Shower Cream (250 ml)', brand: 'Nivea' })).toBeLessThan(0.6);
  });
  it('tiers: strong needs barcode + title; barcode-only is review; conflicts are held', () => {
    expect(evidenceTier('identity_consistent', 0.8)).toBe('strong');
    expect(evidenceTier('identity_consistent', 0.4)).toBe('review');
    expect(evidenceTier('identity_conflict', 1)).toBe('held');
    expect(evidenceTier('ambiguous', 1)).toBe('held');
    expect(evidenceTier('not_found', 0)).toBeNull();
  });
});
