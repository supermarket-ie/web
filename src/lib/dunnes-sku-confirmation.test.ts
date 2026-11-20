import { describe, expect, it } from 'vitest';
import { brandConfirmed, confirmDunnesSku, dunnesProductApiUrl, parseEuro, structuredPackSize, type ConfirmationInput } from './dunnes-sku-confirmation';

const sku = '100685432';
// Shape of a real product-by-SKU response (probe, 18 Nov 2026).
const response = { sku, name: 'Heinz Cream of Tomato Soup 400g', brand: 'Heinz', price: '€2.50', available: true,
  unitsOfSize: { abbreviation: 'g', size: 400 }, attributes: { OwnBrand: false } };
const base: ConfirmationInput = { canonicalName: 'Heinz Cream of Tomato Soup 400g', canonicalBrand: 'Heinz', candidateSku: sku,
  candidateName: 'Heinz Cream of Tomato Soup 400g', httpStatus: 200, requestedUrl: dunnesProductApiUrl(sku), finalUrl: dunnesProductApiUrl(sku),
  response, skuOwnedElsewhere: false, otherCompatibleCandidates: 0 };
const reasons = (over: Partial<ConfirmationInput>) => confirmDunnesSku({ ...base, ...over }).reasons;

describe('Dunnes SKU-bound confirmation', () => {
  it('confirms an exact, SKU-bound, branded, structured-pack match and takes the SKU-bound price', () => {
    expect(confirmDunnesSku(base)).toEqual({ ok: true, reasons: [], price: 2.5, structuredPack: '400g' });
  });
  it.each([
    ['sku_mismatch', { response: { ...response, sku: '100685433' } }],
    ['title_mismatch', { candidateName: 'Heinz Cream of Tomato Soup Reduced Salt 400g' }],
    ['brand_not_confirmed', { response: { ...response, brand: null } }],
    ['brand_not_confirmed', { canonicalBrand: 'Baxters' }],
    ['own_label', { response: { ...response, attributes: { OwnBrand: true } } }],
    ['structured_pack_missing', { response: { ...response, unitsOfSize: null } }],
    ['structured_pack_differs', { response: { ...response, unitsOfSize: { abbreviation: 'g', size: 300 } } }],
    ['canonical_pack_unstated', { canonicalName: 'Heinz Cream of Tomato Soup' }],
    ['variant_conflict', { canonicalName: 'Heinz Cream of Tomato Soup Light 400g' }],
    ['ambiguous_candidates', { otherCompatibleCandidates: 1 }],
    ['sku_already_owned', { skuOwnedElsewhere: true }],
    ['no_current_price', { response: { ...response, price: null } }],
    ['no_current_price', { response: { ...response, available: false } }],
    ['http_403', { httpStatus: 403, response: null }],
    ['not_sku_bound_request', { requestedUrl: 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=heinz' }],
    ['not_sku_bound_request', { finalUrl: 'https://www.dunnesstoresgrocery.com/' }],
  ] as const)('holds on %s', (reason, over) => {
    expect(reasons(over as Partial<ConfirmationInput>).some(r => r === reason || r.startsWith(`${reason}:`))).toBe(true);
  });
  it('title checks: every canonical word must be stated; one-sided qualifiers are different products', async () => {
    const { titleWordProblems } = await import('./dunnes-sku-confirmation');
    expect(titleWordProblems('Heinz Cream of Tomato Soup 400g', 'Heinz Cream of Tomato Soup 400g')).toEqual([]);
    expect(titleWordProblems('Knorr Quick Soup Chicken 45g', 'Knorr Chicken Quick Soup 3 x 15g (45g)')).toEqual([]);
    expect(titleWordProblems('Avonmore Milk 1L', 'Avonmore Light Milk 1L')).toEqual(['variant_conflict:light']);
    expect(titleWordProblems('Flahavans High Protein Porridge Oats Vanilla 45 g', "Flahavan's High Protein Fortified Porridge Oats Vanilla 45g")).toEqual([]);
    expect(titleWordProblems("Flahavan's Gluten Free Irish Pure Oats 550 g", "Flahavan's Gluten Free Pure Oats 550g")).toEqual(['title_words_missing:irish']);
    expect(titleWordProblems('Kerrygold Garlic & Herb Cream Cheese 150 g', 'Kerrygold Garlic and Herb Cream Cheese 150g')).toEqual([]);
    expect(titleWordProblems('Kerrygold Garlic & Herb Cream Cheese 150 g', 'Kerrygold Light Garlic and Herb Cream Cheese 150g')).toEqual(['variant_conflict:light']);
    expect(titleWordProblems('Barry\'s Gold Blend Tea 80 Pack', 'Barry\'s Classic Blend Tea 80 Pack')).toEqual(['title_words_missing:gold']);
  });
  it('a multipack canonical is never confirmed by a single structured size', () => {
    expect(reasons({ canonicalName: 'Heinz Cream of Tomato Soup 4 x 400g' }).some(r => r === 'multipack_differs' || r === 'multipack_not_supported' || r === 'structured_pack_differs')).toBe(true);
  });
  it('helpers parse prices, sizes and brands conservatively', () => {
    expect(parseEuro('€2.50')).toBe(2.5);
    expect(parseEuro('€2.50/kg')).toBeNull();
    expect(parseEuro('0')).toBeNull();
    expect(structuredPackSize({ abbreviation: 'kg', size: 1 })).toEqual({ amount: 1000, unit: 'g' });
    expect(structuredPackSize({ abbreviation: 'l', size: 0.75 })).toEqual({ amount: 750, unit: 'ml' });
    expect(structuredPackSize({ abbreviation: 'each', size: 6 })).toBeNull();
    expect(brandConfirmed("Jacob's", 'Jacobs')).toBe(false); // spelling variants are not silently merged
    expect(brandConfirmed('Ben & Jerry', 'Ben & Jerry')).toBe(true);
  });
  it('recognises the SAME multipack written differently, and nothing else', async () => {
    const { multipackOf } = await import('./dunnes-sku-confirmation');
    expect(multipackOf('Walkers Ready Salted Crisps 6 Pack 25 g')).toEqual({ count: 6, unitAmount: 25, unit: 'g' });
    expect(multipackOf('Walkers Ready Salted Multipack Crisps 6x25g')).toEqual({ count: 6, unitAmount: 25, unit: 'g' });
    expect(multipackOf('Heinz Cream of Tomato Soup 400g')).toBeNull();
    const walkers = { ...base, canonicalName: 'Walkers Ready Salted Crisps 6 Pack 25 g', canonicalBrand: 'Walkers', candidateName: 'Walkers Ready Salted Multipack Crisps 6x25g',
      response: { ...response, name: 'Walkers Ready Salted Multipack Crisps 6x25g', brand: 'Walkers', unitsOfSize: { abbreviation: 'g', size: 150 } } };
    expect(confirmDunnesSku(walkers).ok).toBe(true);
    expect(confirmDunnesSku({ ...walkers, response: { ...walkers.response, unitsOfSize: { abbreviation: 'g', size: 25 } } }).ok).toBe(true);
    expect(reasons({ ...walkers, candidateName: 'Walkers Ready Salted Multipack Crisps 12x25g', response: { ...walkers.response, name: 'Walkers Ready Salted Multipack Crisps 12x25g' } })).toContain('multipack_differs');
    expect(reasons({ ...walkers, response: { ...walkers.response, unitsOfSize: { abbreviation: 'g', size: 300 } } })).toContain('structured_pack_differs');
    // a multipack is never a single pack
    expect(reasons({ ...walkers, candidateName: 'Walkers Ready Salted Crisps 150g', response: { ...walkers.response, name: 'Walkers Ready Salted Crisps 150g' } })).toContain('multipack_differs');
  });
});


import { brandCatalogueCandidates } from './dunnes-sku-confirmation';
describe('brand catalogue walk candidates (listing data narrows; it never proves identity)', () => {
  // Real listing shapes from the Dunnes brand-facet walk (probe, 19 Nov 2026).
  const heinz = [
    { sku: '100684285', name: 'Heinz Tomato Ketchup 910g', brand: 'Heinz' },
    { sku: '100873410', name: 'Heinz Tomato Ketchup 650g', brand: 'Heinz' },
    { sku: '100733918', name: 'Heinz Tomato Ketchup 460g', brand: 'Heinz' },
    { sku: '100733919', name: 'Heinz Tomato Ketchup Reduced Sugar & Salt 460g', brand: 'Heinz' },
    { sku: '100111378', name: 'Heinz Baked Beans 415g', brand: 'Heinz' },
    { sku: '100112275', name: 'Heinz Baked Beans 4 x 415g', brand: 'Heinz' },
    { sku: '100999999', name: 'Dunnes Stores Baked Beans 415g', brand: 'Heinz' },
  ];
  it('the exact pack, words and variant of the reference select exactly one SKU', () => {
    expect(brandCatalogueCandidates('Heinz', ['Heinz Tomato Ketchup 460 g'], heinz).map(c => c.sku)).toEqual(['100733918']);
    expect(brandCatalogueCandidates('Heinz', ['Heinz Baked Beans 415 g'], heinz).map(c => c.sku)).toEqual(['100111378']);
  });
  it('a one-sided qualifier, a different pack or a multipack never qualifies', () => {
    expect(brandCatalogueCandidates('Heinz', ['Heinz Tomato Ketchup 500 g'], heinz)).toEqual([]);
    expect(brandCatalogueCandidates('Heinz', ['Heinz Baked Beans 4 x 415g'], heinz).map(c => c.sku)).toEqual(['100112275']);
    expect(brandCatalogueCandidates('Heinz', ['Heinz Reduced Sugar Tomato Ketchup 460 g'], heinz)).toEqual([]);
  });
  it('every reference must fit: a candidate fitting the SuperValu title but not the Tesco title is dropped', () => {
    expect(brandCatalogueCandidates('Heinz', ['Heinz Tomato Ketchup 460 g', 'Heinz Tomato Ketchup Top Down 460g'], heinz)).toEqual([]);
  });
  it('own-label and other-brand items are excluded; duplicates collapse', () => {
    expect(brandCatalogueCandidates('Heinz', ['Baked Beans 415 g'], heinz).map(c => c.sku)).toEqual(['100111378']);
    expect(brandCatalogueCandidates('Kerrygold', ['Kerrygold Butter 454 g'], heinz)).toEqual([]);
    expect(brandCatalogueCandidates('Heinz', ['Heinz Baked Beans 415 g'], [...heinz, heinz[4]]).length).toBe(1);
  });
  it('several fitting SKUs are all returned (the caller then holds as ambiguous)', () => {
    const two = [...heinz, { sku: '100111379', name: 'Heinz Baked Beans 415g', brand: 'Heinz' }];
    expect(brandCatalogueCandidates('Heinz', ['Heinz Baked Beans 415 g'], two).length).toBe(2);
  });
});
