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
  it('one SKU with no deterministic contradiction is identity_consistent; word order is fine, an extra word is review', () => {
    expect(classifyBarcodeResult(tesco, [{ sku: '100684387', name: 'Dolmio Stir In Red Sun Dried Tomato Pasta Sauce 150g', brand: 'Dolmio' }]))
      .toMatchObject({ outcome: 'identity_consistent', sku: '100684387', reasons: [], tier: 'strong' });
    expect(classifyBarcodeResult(tesco, [{ sku: '100684387', name: 'Dolmio Stir In Sun Dried Tomato Pasta Sauce 150g', brand: 'Dolmio' }]))
      .toMatchObject({ outcome: 'identity_consistent', tier: 'review' });
  });
  it('a different pack, count, brand or variant is identity_conflict (held)', () => {
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Dolmio Stir In Sun Dried Tomato 300g', brand: 'Dolmio' })).toContain('pack');
    expect(barcodeIdentityConflicts({ name: 'Heinz Baked Beans 4 x 415g', brand: 'Heinz' }, { sku: 'x', name: 'Heinz Baked Beans 6 x 415g', brand: 'Heinz' }).length).toBeGreaterThan(0);
    expect(barcodeIdentityConflicts(tesco, { sku: 'x', name: 'Ragu Sun Dried Tomato 150g', brand: 'Ragu' })).toContain('brand');
    expect(barcodeIdentityConflicts({ name: 'Coca-Cola Zero Sugar 500ml', brand: 'Coca-Cola' }, { sku: 'x', name: 'Coca-Cola Full Sugar 500ml', brand: 'Coca-Cola' }).some(r => r.startsWith('variant'))).toBe(true);
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
    expect(classifyBarcodeResult({ name: 'NIVEA Crème Soft Shower Cream 250ml', brand: 'NIVEA' },
      [{ sku: 'x', name: 'Nivea Clay Fresh Shower Cream (250 ml)', brand: 'Nivea' }]).tier).toBe('review');
  });
  it('tiers: strong needs barcode + title; barcode-only is review; conflicts are held', () => {
    expect(evidenceTier('identity_consistent', 0.8)).toBe('strong');
    expect(evidenceTier('identity_consistent', 0.4)).toBe('review');
    expect(evidenceTier('identity_conflict', 1)).toBe('held');
    expect(evidenceTier('ambiguous', 1)).toBe('held');
    expect(evidenceTier('not_found', 0)).toBeNull();
  });
});

import { assessBarcodeHit } from './barcode-matching';
describe('review findings: no false-strong on substitutions, brands, packs', () => {
  const tier = (t: string, tb: string, h: string, hb: string | null, u?: { size: number; abbreviation: string }) =>
    classifyBarcodeResult({ name: t, brand: tb }, [{ sku: 'x', name: h, brand: hb, unitOfSize: u ?? null }]).tier;
  it('different brands that share letters or prefixes are held', () => {
    expect(tier('M&S Plums 400g', 'M&S', 'Dunnes Stores Plums 400g', 'Dunnes Stores')).toBe('held');
    expect(tier('Kellys Sausages 454g', 'Kellys', 'Kellogg Sausages 454g', 'Kellogg')).toBe('held');
    expect(tier('Green Giant Sweetcorn 340g', 'Green Giant', 'Green Isle Sweetcorn 340g', 'Green Isle')).not.toBe('strong');
  });
  it('substituted flavours and variants are never strong', () => {
    expect(tier('Muller Corner Strawberry 135g', 'Muller', 'Muller Corner Raspberry 135g', 'Muller')).not.toBe('strong');
    expect(tier('Kerrygold Mild Cheddar 200g', 'Kerrygold', 'Kerrygold Mature Cheddar 200g', 'Kerrygold')).toBe('held');
    expect(tier("Ben & Jerry's Chocolate Fudge Brownie 465ml", "Ben & Jerry's", "Ben & Jerry's Cookie Dough 465ml", "Ben & Jerry's")).not.toBe('strong');
    expect(tier("Kellogg's Special K Red Berries 500g", "Kellogg's", "Kellogg's Special K Chocolate Berries 500g", "Kellogg's")).not.toBe('strong');
    expect(tier('Bassetts Pepper Sweets 200g', 'Bassetts', 'Bassetts Peppermint Sweets 200g', 'Bassetts')).not.toBe('strong');
    expect(tier('Ballygowan Still Water 500ml', 'Ballygowan', 'Ballygowan Sparkling Water 500ml', 'Ballygowan')).toBe('held');
  });
  it('single vs multipack and unconfirmed packs are never strong', () => {
    expect(tier('Cadbury Dairy Milk 45g', 'Cadbury', 'Cadbury Dairy Milk 6 Pack (45 g)', 'Cadbury')).toBe('held');
    expect(tier('Heinz Beanz', 'Heinz', 'Heinz Beanz 4 Pack', 'Heinz')).not.toBe('strong');
    expect(tier('Knorr Rich Beef Stock Pot 4 x 28g', 'Knorr', 'Knorr Rich Beef Stock 4 Pots (112 g)', 'Knorr')).toBe('strong');
  });
  it('the SKU equal to the queried code is held (an internal code, not a barcode hit)', () => {
    expect(assessBarcodeHit({ name: 'X 100g', brand: 'X' }, { sku: '96189290', name: 'X 100g', brand: 'X' }, '96189290').conflicts).toContain('sku_equals_query');
  });
  it('pilot cases that stay strong: same product words, same variant statements, confirmed pack', () => {
    expect(tier('Walkers Ready Salted Crisps Multipack 6x25g', 'Walkers', 'Walkers Ready Salted Crisps 6 Pack (25 g)', 'Walkers', { size: 0.15, abbreviation: 'kg' })).toBe('strong');
    expect(tier('Knorr Rich Beef Stock Pot 4 x 28g', 'Knorr', 'Knorr Rich Beef Stock 4 Pots (112 g)', 'Knorr')).toBe('strong');
  });
  it('descriptive extra words are review, not strong (a human confirms them; a barcode alone does not)', () => {
    expect(tier('Twix Caramel & Milk Chocolate Biscuit Twin Bars 50g', 'Twix', 'Twix Bar (50 g)', 'Twix', { size: 50, abbreviation: 'g' })).toBe('review');
    expect(tier("L'Oreal Elvive Colour Protect Shampoo 400Ml", "L'Oreal", "L'Oréal Paris Elvive Colour Protect Shampoo, for Coloured & Highlighted Hair, 400ml", "L'Oréal Paris")).toBe('review');
    expect(tier('Barilla Lasagne Pasta Sheets 500g', 'Barilla', 'Barilla Lasagne (500 g)', 'Barilla', { size: 0.5, abbreviation: 'kg' })).toBe('review');
  });
});

describe('re-review findings: a more specific title on either side is never strong', () => {
  const tier = (t: string, tb: string, h: string, hb: string) => classifyBarcodeResult({ name: t, brand: tb }, [{ sku: 'x', name: h, brand: hb }]);
  it('superset titles (extra product words on one side) go to review', () => {
    for (const [t, h] of [
      ['Cadbury Dairy Milk 110g', 'Cadbury Dairy Milk Caramel 110g'],
      ['Cadbury Dairy Milk 110g', 'Cadbury Dairy Milk Big Taste 110g'],
      ["Ben & Jerry's Cookie Dough Ice Cream 465ml", "Ben & Jerry's Ice Cream 465ml"],
      ['Fairy Original Washing Up Liquid 433ml', 'Fairy Platinum Original Washing Up Liquid 433ml'],
    ]) {
      const r = tier(t, t.split(' ')[0] === 'Ben' ? "Ben & Jerry's" : t.split(' ')[0], h, t.split(' ')[0] === 'Ben' ? "Ben & Jerry's" : t.split(' ')[0]);
      expect(r.tier, `${t} | ${h}`).toBe('review');
      expect(r.review.some(x => x.startsWith('extra_words:'))).toBe(true);
    }
  });
  it('a variant-group member stated on one side only goes to review', () => {
    const beans = tier('Heinz Baked Beans 415g', 'Heinz', 'Heinz Baked Beans No Added Sugar 415g', 'Heinz');
    expect(beans.tier).toBe('review');
    expect(beans.review.some(x => x.startsWith('variant_one_sided:no_sugar'))).toBe(true);
    const cheddar = tier('Kerrygold Cheddar 200g', 'Kerrygold', 'Kerrygold Mature Cheddar 200g', 'Kerrygold');
    expect(cheddar.tier).toBe('review');
    expect(cheddar.review.some(x => x.startsWith('variant_one_sided:mature'))).toBe(true);
  });
  it('an item without a SKU is held, never not_found or a clean single hit', () => {
    const t = { name: 'Heinz Baked Beans 415g', brand: 'Heinz' };
    expect(classifyBarcodeResult(t, [{ sku: '', name: 'Heinz Baked Beans 415g', brand: 'Heinz' }])).toMatchObject({ outcome: 'ambiguous', tier: 'held', reasons: ['hit_without_sku'] });
    expect(classifyBarcodeResult(t, [{ sku: '1', name: 'Heinz Baked Beans 415g', brand: 'Heinz' }, { sku: '', name: '?', brand: null }]).tier).toBe('held');
  });
});
