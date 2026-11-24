import { describe, expect, it } from 'vitest';
import { assessReviewIdentity, decideReview, reviewPrecheck, type ReviewAssessment } from './barcode-review-identity';
import { confirmDunnesSku, dunnesProductApiUrl, type ConfirmationInput } from './dunnes-sku-confirmation';

const sku = '100297972';
const exact: ReviewAssessment = { decision: 'verified_exact', rationale: 'Same brand, product type, flavour, 750ml single bottle; wording only.',
  facts: { brand_matches: true, product_type_matches: true, flavour_formulation_matches: true, variant_matches: true, quantity_matches: true, pack_count_matches: true, age_stage_matches: true } };
const barcode = (skus = [sku]) => ({ gtin: '5391508910138', skus });
const pre = (reasons: string[], over: Partial<Parameters<typeof reviewPrecheck>[0]> = {}) =>
  reviewPrecheck({ confirmationReasons: reasons, barcodeSearch: barcode(), sku, retailerText: '', tescoName: 'Ballygowan Hint of Fruit Summer Fruits 750ml', retailerName: 'Ballygowan Hint of Fruit Summer Fruits 750ml', ...over });

// Real confirmation outcomes from a SKU-bound Dunnes response, so the precheck sees exactly what production sees.
const response = (name: string, size = 750, unit = 'ml') => ({ sku, name, brand: 'Ballygowan', price: '€1.50', available: true,
  unitsOfSize: { abbreviation: unit, size }, attributes: { OwnBrand: false } });
const confirm = (tesco: string, dunnes: string, size?: number, unit?: string) => confirmDunnesSku({ canonicalName: tesco, canonicalBrand: 'Ballygowan',
  candidateSku: sku, candidateName: dunnes, httpStatus: 200, requestedUrl: dunnesProductApiUrl(sku), finalUrl: dunnesProductApiUrl(sku),
  response: response(dunnes, size, unit), skuOwnedElsewhere: false, otherCompatibleCandidates: 0 } as ConfirmationInput).reasons;

describe('review-tier barcode identity (barcode-review-ai-v1)', () => {
  it('POSITIVE: wording-only differences with a fresh exact barcode binding and a consistent AI verdict are accepted', () => {
    const reasons = confirm('Ballygowan Hint of Fruit Summer Fruits Flavoured Water 750ml', 'Ballygowan Hint of Fruit Summer Fruits Bottle 750ml');
    expect(reasons.every(r => r.startsWith('title_words_missing:'))).toBe(true);
    expect(decideReview(pre(reasons), exact)).toEqual({ accept: true, reasons: [] });
  });
  it('POSITIVE: a missing material word is fine when the retailer\'s own SKU-bound description states it', () => {
    const p = pre(['title_words_missing:exotic+bloom+amber'], { retailerText: 'Lenor fabric conditioner Exotic Bloom & Amber scent, 29 washes' });
    expect(p.eligible).toBe(true);
    const flavour = pre(['title_words_missing:strawberry'], { retailerText: 'Greek style yogurt with <b>Strawberry</b> compote' });
    expect(flavour.eligible).toBe(true);
  });
  it('NEGATIVE: a material word only the RETAILER title states holds (strict confirmation does not check retailer extras)', () => {
    const r = confirm('Old El Paso Gluten Free Fajita Kit 462G', 'Old El Paso Gluten Free Fajita Kit Smoky BBQ 462g', 462, 'g');
    const p = pre(r, { tescoName: 'Old El Paso Gluten Free Fajita Kit 462G', retailerName: 'Old El Paso Gluten Free Fajita Kit Smoky BBQ 462g' });
    expect(p.reasons).toEqual(expect.arrayContaining(['material_word_extra:smoky', 'material_word_extra:bbq']));
    expect(decideReview(p, exact).accept).toBe(false);
    expect(pre([], { tescoName: 'Frontier Foods Organic Coconut Milk 400Ml', retailerName: 'Frontier Foods Full Organic Coconut Milk 400ml' }).reasons).toContain('material_word_extra:full');
    // non-material retailer wording is fine
    expect(pre([], { tescoName: 'Tayto Crisps Cheese & Onion 12 X 25G', retailerName: 'Tayto Cheese & Onion Flavour Potato Crisps 12 x 25g' }).eligible).toBe(true);
  });
  it('NEGATIVE: a barcode alone never equates products (no, ambiguous or other SKU in the fresh search)', () => {
    expect(pre(['title_words_missing:still'], { barcodeSearch: barcode([]) }).reasons).toContain('barcode_not_found');
    expect(pre(['title_words_missing:still'], { barcodeSearch: barcode([sku, '100297973']) }).reasons).toContain('barcode_ambiguous');
    expect(pre(['title_words_missing:still'], { barcodeSearch: barcode(['100297973']) }).reasons).toContain('barcode_other_sku');
  });
  it('NEGATIVE: different pack size or quantity is a structural hold, never AI-resolvable', () => {
    const reasons = confirm('Ballygowan Hint of Fruit Summer Fruits 750ml', 'Ballygowan Hint of Fruit Summer Fruits 500ml', 500);
    expect(reasons.some(r => !r.startsWith('title_words_missing:'))).toBe(true);
    expect(decideReview(pre(reasons), exact).accept).toBe(false);
  });
  it('NEGATIVE: a one-sided formulation qualifier is a structural hold (variant conflict)', () => {
    const reasons = confirm('Ballygowan Hint of Fruit Summer Fruits Light 750ml', 'Ballygowan Hint of Fruit Summer Fruits 750ml');
    expect(reasons.some(r => r.startsWith('variant_conflict'))).toBe(true);
    expect(decideReview(pre(reasons), exact).accept).toBe(false);
  });
  it('NEGATIVE: missing flavour, formulation, age-stage, size and numeric words hold unless the retailer states them', () => {
    for (const w of ['strawberry', 'sugar', 'still', 'stage', 'months', 'kids', 'mini', 'sharing', 'decaf']) {
      expect(pre([`title_words_missing:${w}`]).reasons).toContain(`material_word_missing:${w}`);
    }
    expect(pre(['title_words_missing:4']).reasons).toContain('numeric_word_missing:4');
    expect(pre(['title_words_missing:2x']).eligible).toBe(false);
  });
  it('NEGATIVE: different brands are never reconciled (brand check is structural)', () => {
    const r = confirmDunnesSku({ canonicalName: 'Ballygowan Still Water 750ml', canonicalBrand: 'Ballygowan', candidateSku: sku, candidateName: 'Volvic Still Water 750ml',
      httpStatus: 200, requestedUrl: dunnesProductApiUrl(sku), finalUrl: dunnesProductApiUrl(sku),
      response: { ...response('Volvic Still Water 750ml'), brand: 'Volvic' }, skuOwnedElsewhere: false, otherCompatibleCandidates: 0 }).reasons;
    expect(r).toContain('brand_not_confirmed');
    expect(decideReview(pre(r), exact).accept).toBe(false);
  });
  it('NEGATIVE: AI uncertain / rejected / unavailable / self-contradictory verdicts hold', () => {
    const ok = pre(['title_words_missing:sun+ripened']);
    expect(ok.eligible).toBe(true);
    expect(decideReview(ok, { ...exact, decision: 'uncertain' }).reasons[0]).toBe('ai_uncertain');
    expect(decideReview(ok, { ...exact, decision: 'rejected' }).reasons[0]).toBe('ai_rejected');
    expect(decideReview(ok, null).reasons).toEqual(['ai_unavailable']);
    expect(decideReview(ok, { ...exact, facts: { ...exact.facts, flavour_formulation_matches: false } }).reasons).toEqual(['ai_self_contradictory', 'ai_fact:flavour_formulation_matches']);
  });
  it('the AI call is schema-validated (a malformed model answer throws, so the caller holds)', async () => {
    const e = { tesco: { name: 'A', brand: 'B', gtin: '5391508910138', quantity: '750ml' }, retailer: { store: 'dunnes' as const, sku, name: 'A', brand: 'B', size: '750ml', description: '', ingredients: '' } };
    await expect(assessReviewIdentity(e, { runModel: async () => ({ decision: 'yes' }) })).rejects.toThrow();
    expect((await assessReviewIdentity(e, { runModel: async () => exact })).decision).toBe('verified_exact');
  });
});
