import { describe, expect, it } from 'vitest';
import { CANONICAL_NAME_CORRECTIONS, correctedNameForSlug, nameKey, nameQualityIssues } from './catalogue-name-quality';
import { productSlug } from './product-catalogue';

describe('canonical name quality', () => {
  it('flags the confirmed brand-prefix typo with a suggestion', () => {
    expect(nameQualityIssues({ name: 'Batchelore Hot & Spicy Beans 420g', brand: 'Batchelors', confirmingBrands: ['Batchelors', 'Batchelors', 'Batchelors'] }))
      .toEqual([{ kind: 'brand_prefix_typo', found: 'Batchelore', expected: 'Batchelors', suggestion: 'Batchelors Hot & Spicy Beans 420g' }]);
  });
  it('never suggests a brand fix without two confirming offers, for a short brand, or for a different brand', () => {
    expect(nameQualityIssues({ name: 'Batchelore Beans 420g', brand: 'Batchelors', confirmingBrands: ['Batchelors'] })[0].kind).toBe('brand_missing');
    expect(nameQualityIssues({ name: 'Bisto Gravy 170g', brand: 'Bist', confirmingBrands: ['Bist', 'Bist'] }).some(i => i.kind === 'brand_prefix_typo')).toBe(false);
    expect(nameQualityIssues({ name: 'Heinz Beans 415g', brand: 'Branston', confirmingBrands: ['Branston', 'Branston'] })[0].kind).toBe('brand_missing');
  });
  it('a correct name with the brand anywhere is clean; formatting issues are reported, not fixed', () => {
    expect(nameQualityIssues({ name: 'Batchelors Hot & Spicy Beans 420g', brand: 'Batchelors', confirmingBrands: [] })).toEqual([]);
    expect(nameQualityIssues({ name: 'Mr Kipling Batchelors Pies', brand: 'Batchelors', confirmingBrands: [] })).toEqual([]);
    expect(nameQualityIssues({ name: 'Heinz  Beans 415G', brand: 'Heinz', confirmingBrands: [] }).map(i => i.kind)).toEqual(['whitespace', 'unit_case']);
  });
  it('duplicate keys equate case, units, "and"/"&" and a brand-prefix typo', () => {
    expect(nameKey('Batchelor Curried Beans 400G', 'Batchelors')).toBe(nameKey('Batchelors Curried Beans 400g', 'Batchelors'));
    expect(nameKey('Batchelors Hot And Spicy Beans 420G', 'Batchelors')).toBe(nameKey('Batchelors Hot & Spicy Beans 420g', 'Batchelors'));
    expect(nameKey('Batchelors Curried Beans 400g', 'Batchelors')).not.toBe(nameKey('Batchelors Curried Beans 420g', 'Batchelors'));
  });
  it('every applied correction keeps its old URL (redirect to the corrected name) and changes the slug', () => {
    for (const c of CANONICAL_NAME_CORRECTIONS) {
      expect(productSlug(c.from)).not.toBe(productSlug(c.to));
      expect(correctedNameForSlug(productSlug(c.from))).toBe(c.to);
      expect(correctedNameForSlug(productSlug(c.to))).toBeNull();
    }
    expect(correctedNameForSlug('batchelore-hot-spicy-beans-420g')).toBe('Batchelors Hot & Spicy Beans 420g');
    expect(correctedNameForSlug('some-other-product')).toBeNull();
  });
});
