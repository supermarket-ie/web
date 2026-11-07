import { describe, expect, it } from 'vitest';
import { classifyTescoMapping, classifyTescoReplacement, type TescoMappingEvidence } from './tesco-mapping-audit';

function mapping(overrides: Partial<TescoMappingEvidence> = {}): TescoMappingEvidence {
  return {
    storeProductId: 'sp-1', canonicalName: 'Dolmio Stir In Carbonara Pasta Sauce 150g',
    canonicalBrand: 'Dolmio', storeProductName: 'Dolmio Stir In Pasta Sauce Carbonara 150g',
    storeBrand: 'Dolmio', isOwnBrand: false, storeSku: '250154135',
    storeUrl: 'https://www.tesco.ie/shop/en-IE/products/250154135', duplicateSkuCount: 1,
    isFresh: true, ...overrides,
  };
}

describe('Tesco mapping risk audit', () => {
  it.each([
    ['Tesco Free Range Eggs Large 6 Pack', { pieces: 6 }, 'exact_replacement_candidate', undefined],
    ['Tesco Free Range Eggs Large 12 Pack', { pieces: 12 }, 'material_mismatch', 'packCountConflict'],
    ['Tesco Free Range Eggs Large', {}, 'material_mismatch', 'packExactnessFailed'],
  ])('preserves the trailing egg count against %s', (name, structuredQuantity, expected, reason) => {
    const m = mapping({ canonicalName: 'Free Range Eggs 6', canonicalBrand: null, storeBrand: null });
    const result = classifyTescoReplacement(m, { sku: m.storeSku!, url: m.storeUrl!, name, structuredQuantity, evidenceSource: 'tesco_direct_structured' });
    expect(result.classification).toBe(expected);
    if (reason) expect(result.reasons).toContain(reason);
  });

  it('does not interpret an egg mass as a count', () => {
    const m = mapping({ canonicalName: 'Chocolate Eggs 200 g', canonicalBrand: null, storeBrand: null });
    const result = classifyTescoReplacement(m, { sku: m.storeSku!, url: m.storeUrl!,
      name: 'Chocolate Eggs 6 Pack 200g', structuredQuantity: { grams: 200 }, evidenceSource: 'tesco_direct_structured' });
    expect(result.reasons).toEqual(['packExactnessFailed']);
  });

  it.each(['Deep RiverRock', 'Deep River Rock'])('recognises the documented %s brand spelling', (brand) => {
    const m = mapping({ canonicalName: 'Deep River Rock Apple & Pear Still Water 750ml',
      canonicalBrand: brand, storeBrand: brand, storeProductName: 'Deep River Rock Apple & Pear Still Water 750ml' });
    expect(classifyTescoReplacement(m, { sku: m.storeSku!, url: m.storeUrl!,
      name: 'Deep River Rock Apple & Pear Still Water 750ml', structuredQuantity: { millilitres: 750 }, evidenceSource: 'tesco_direct_structured' })
      .classification).toBe('exact_replacement_candidate');
  });

  it.each([
    ['Other Brand Apple & Pear Still Water 750ml', 750, 'brandConflict'],
    ['Deep River Rock Apple & Pear Still Water 500ml', 500, 'measureConflict'],
    ['Deep River Rock Apple & Pear Still Water 2x750ml', 1500, 'measureConflict'],
    ['Deep River Rock Apple & Pear Still Water 2x375ml', 750, 'packExactnessFailed'],
    ['Deep River Rock Orange Still Water 750ml', 750, 'variantConflict'],
  ])('preserves independent identity conflicts for %s', (name, millilitres, reason) => {
    const m = mapping({ canonicalName: 'Deep River Rock Apple & Pear Still Water 750ml',
      canonicalBrand: 'Deep RiverRock', storeBrand: 'Deep RiverRock' });
    const result = classifyTescoReplacement(m, { sku: m.storeSku!, url: m.storeUrl!, name,
      structuredQuantity: { millilitres }, evidenceSource: 'tesco_direct_structured' });
    expect(result.classification).toBe('material_mismatch');
    expect(result.reasons).toContain(reason);
  });

  it('does not join arbitrary brand words', () => {
    for (const brand of ['RiverRock', 'DeepRiverRock', 'OtherBrand']) {
      const m = mapping({ canonicalName: 'Deep River Rock Apple & Pear Still Water 750ml',
        canonicalBrand: brand, storeBrand: null });
      expect(classifyTescoReplacement(m, { sku: m.storeSku!, url: m.storeUrl!,
        name: 'Deep River Rock Apple & Pear Still Water 750ml', structuredQuantity: { millilitres: 750 }, evidenceSource: 'tesco_direct_structured' })
        .classification).not.toBe('exact_replacement_candidate');
    }
  });

  it.each([
    ['Dr Oetker Bistro Pepperoni Baguettes 2x125g',250,'exact_replacement_candidate'],
    ['Dr Oetker Bistro Pepperoni Baguettes 1x250g',250,'material_mismatch'],
    ['Dr Oetker Bistro Pepperoni Baguettes 2x150g',300,'material_mismatch'],
    ['Other Brand Bistro Pepperoni Baguettes 2x125g',250,'material_mismatch'],
  ])('checks punctuation, total amount and count for %s',(name,grams,expected)=>{
    const m=mapping({canonicalName:'Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g',canonicalBrand:'Dr. Oetker'});
    expect(classifyTescoReplacement(m,{sku:m.storeSku!,url:m.storeUrl!,name,structuredQuantity:{grams},evidenceSource:'tesco_direct_structured'}).classification).toBe(expected);
  });
  it('accepts a current internally consistent unique mapping', () => {
    expect(classifyTescoMapping(mapping()).classification).toBe('exact_unique');
  });

  it('rejects URL and stored SKU disagreement', () => {
    expect(classifyTescoMapping(mapping({ storeUrl: 'https://www.tesco.ie/shop/en-IE/products/999' })).classification).toBe('material_mismatch');
  });

  it('rejects explicit size, product type and variant conflicts', () => {
    const result = classifyTescoMapping(mapping({
      canonicalName: 'Cadbury Twirl Chocolate Bar 43g', canonicalBrand: 'Cadbury',
      storeProductName: 'Cadbury Twirl Orange Chocolate Bar 54g', storeBrand: 'Cadbury',
    }));
    expect(result.classification).toBe('material_mismatch');
    expect(result.reasons).toEqual(expect.arrayContaining(['variantConflict', 'measureConflict']));
  });

  it('does not call a duplicate a synonym when identity disagrees', () => {
    const result = classifyTescoMapping(mapping({
      canonicalName: 'Red Chilli', canonicalBrand: null, storeBrand: null,
      storeProductName: 'Tesco Red Bell Pepper', isOwnBrand: true, duplicateSkuCount: 2,
    }));
    expect(result.classification).toBe('material_mismatch');
  });

  it('requires complete duplicate-group corroboration before calling synonyms', () => {
    expect(classifyTescoMapping(mapping({ duplicateSkuCount: 2 })).classification).toBe('ambiguous');
    expect(classifyTescoMapping(mapping({
      duplicateSkuCount: 2,
      duplicateCanonicalNames: [
        'Dolmio Stir In Carbonara Pasta Sauce 150g',
        'Dolmio Carbonara Pasta Sauce Stir In 150g',
      ],
    })).classification).toBe('exact_synonym_duplicate');
  });

  it('keeps generic canonical identities ambiguous', () => {
    expect(classifyTescoMapping(mapping({ canonicalName: 'Cornflakes', canonicalBrand: null, storeBrand: null })).classification).toBe('ambiguous');
  });

  it('accepts a replacement only when URL, SKU and full identity agree', () => {
    const result = classifyTescoReplacement(mapping({ isFresh: false }), {
      sku: '987654321', url: 'https://www.tesco.ie/shop/en-IE/products/987654321',
      name: 'Dolmio Stir In Carbonara Pasta Sauce 150g', evidenceSource: 'pepesto-products',
    });
    expect(result.classification).toBe('exact_replacement_candidate');
  });

  it('keeps broad Pepesto alternatives unresolved', () => {
    const result = classifyTescoReplacement(mapping({ canonicalName: 'Pancake Mix 500g', canonicalBrand: null, storeBrand: null }), {
      sku: '251968858', url: 'https://www.tesco.ie/shop/en-IE/products/251968858',
      name: 'Tesco Wholemeal Wheat Flour 2 kg', evidenceSource: 'pepesto-products',
    });
    expect(result.classification).toBe('material_mismatch');
  });

  it('requires an explicit replacement size when the canonical has one', () => {
    const result = classifyTescoReplacement(mapping(), {
      sku: '987654321', url: 'https://www.tesco.ie/shop/en-IE/products/987654321',
      name: 'Dolmio Stir In Carbonara Pasta Sauce', evidenceSource: 'pepesto-search-single',
    });
    expect(result.classification).toBe('material_mismatch');
    expect(result.reasons).toContain('measureExactnessFailed');
  });

  it('requires an exact canonical brand in a replacement title', () => {
    const result = classifyTescoReplacement(mapping(), {
      sku: '987654321', url: 'https://www.tesco.ie/shop/en-IE/products/987654321',
      name: 'Tesco Stir In Carbonara Pasta Sauce 150g', evidenceSource: 'pepesto-search-single',
    });
    expect(result.classification).toBe('material_mismatch');
  });

  it('allows a Tesco own-label candidate when the canonical has no explicit brand', () => {
    const result = classifyTescoReplacement(mapping({
      canonicalName: 'Closed Cup Mushrooms 250g', canonicalBrand: null,
    }), {
      sku: '987654321', url: 'https://www.tesco.ie/shop/en-IE/products/987654321',
      name: 'Tesco Closed Cup Mushrooms 250g', evidenceSource: 'pepesto-search-single',
    });
    expect(result.classification).toBe('exact_replacement_candidate');
  });

  it('uses a clarified white pitta canonical to reject the wholemeal variant', () => {
    const white = classifyTescoReplacement(mapping({
      canonicalName: 'White Pitta Bread 6 Pack', canonicalBrand: null,
    }), {
      sku: '254945564', url: 'https://www.tesco.ie/shop/en-IE/products/254945564',
      name: 'Tesco White Plain Pitta Bread 6 Pack', evidenceSource: 'pepesto-search-single',
    });
    const wholemeal = classifyTescoReplacement(mapping({
      canonicalName: 'White Pitta Bread 6 Pack', canonicalBrand: null,
    }), {
      sku: '254945610', url: 'https://www.tesco.ie/shop/en-IE/products/254945610',
      name: 'Tesco Wholemeal Pitta Bread 6 Pack', evidenceSource: 'pepesto-search-single',
    });

    expect(white.classification).toBe('exact_replacement_candidate');
    expect(wholemeal.classification).toBe('material_mismatch');
    expect(wholemeal.reasons).toContain('variantConflict');
  });

  it('uses structured single-piece evidence to corroborate a loose product', () => {
    const result = classifyTescoReplacement(mapping({
      canonicalName: 'Loose Pink Lady Apples 1 Pack', canonicalBrand: null,
    }), {
      sku: '284182372', url: 'https://www.tesco.ie/shop/en-IE/products/284182372',
      name: 'Tesco Pink Lady Apple', structuredQuantity: { pieces: 1 },
      evidenceSource: 'pepesto-search-single',
    });

    expect(result.classification).toBe('exact_replacement_candidate');
  });

  it('rejects a multi-piece pack for a loose single-item canonical', () => {
    const result = classifyTescoReplacement(mapping({
      canonicalName: 'Loose Royal Gala Apples 1 Pack', canonicalBrand: null,
    }), {
      sku: '284475550', url: 'https://www.tesco.ie/shop/en-IE/products/284475550',
      name: 'Tesco Gala Apples', structuredQuantity: { pieces: 5 },
      evidenceSource: 'pepesto-search-single',
    });

    expect(result.classification).toBe('material_mismatch');
    expect(result.reasons).toContain('packCountConflict');
  });
});

it('normalises brand apostrophes while preserving flavour, brand and pack conflicts', () => {
  const row = mapping({ canonicalName: "Jacob's Rice Cakes Sea Salt 90g", canonicalBrand: "Jacob's", storeBrand: "Jacob's" });
  const candidate = { sku: '250154135', url: 'https://www.tesco.ie/shop/en-IE/products/250154135', name: 'Jacobs Rice Cakes Sea Salt 90g', evidenceSource: 'tesco_direct_structured' as const };
  expect(classifyTescoReplacement(row, candidate).classification).toBe('exact_replacement_candidate');
  expect(classifyTescoReplacement(row, { ...candidate, name: 'Other Rice Cakes Sea Salt 90g' }).classification).toBe('material_mismatch');
  expect(classifyTescoReplacement(row, { ...candidate, name: 'Jacobs Rice Cakes Sea Salt 180g' }).classification).toBe('material_mismatch');
  expect(classifyTescoReplacement(row, { ...candidate, name: 'Jacobs Rice Cakes Orange 90g' }).classification).toBe('material_mismatch');
});
