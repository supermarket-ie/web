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
});
