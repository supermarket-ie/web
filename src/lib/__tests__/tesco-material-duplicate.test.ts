import { describe, it, expect } from 'vitest';
import { hasMaterialDuplicateCanonicalConflict } from '../tesco-mapping-audit';

// Covers the independent same-SKU canonical-group inspection used by the batch
// policy to hard-stop a material duplicate-canonical conflict even when an
// ordinary attribute conflict was returned first. Based on two real examples.

function ev(canonicalName: string, group: string[]) {
  return {
    storeProductId: 'x', canonicalName, canonicalBrand: null,
    storeProductName: 'Tesco', storeBrand: null, isOwnBrand: true,
    storeSku: '1', storeUrl: 'u',
    duplicateSkuCount: group.length, duplicateCanonicalNames: group, isFresh: false,
  };
}

describe('hasMaterialDuplicateCanonicalConflict', () => {
  it('false for a unique mapping (no shared SKU)', () => {
    expect(hasMaterialDuplicateCanonicalConflict(ev('Yogurt Rice Cakes 100g', ['Yogurt Rice Cakes 100g']))).toBe(false);
  });

  it('REAL example SKU 308828886: distinct flavours sharing one SKU -> material conflict', () => {
    const group = ['Yogurt Rice Cakes 100g', 'Mixed Berry Yogurt Rice Cakes 96g', 'Sweet Chilli Rice Cakes'];
    expect(hasMaterialDuplicateCanonicalConflict(ev('Yogurt Rice Cakes 100g', group))).toBe(true);
    expect(hasMaterialDuplicateCanonicalConflict(ev('Sweet Chilli Rice Cakes', group))).toBe(true);
  });

  it('REAL example SKU 306647106: distinct Lenor scents sharing one SKU -> material conflict', () => {
    const group = [
      'Lenor Spring Awakening Tumble Dryer 34 Sheets 110g',
      'Lenor Summer Breeze Tumble Dryer 34 Sheets 110g',
    ];
    expect(hasMaterialDuplicateCanonicalConflict(ev(group[0], group))).toBe(true);
    expect(hasMaterialDuplicateCanonicalConflict(ev(group[1], group))).toBe(true);
  });

  it('false for a genuine synonym group with equivalent term-sets (preserve)', () => {
    // Same canonical term-set across the whole group, size matches count.
    const group = ['Whole Milk 1L', 'Milk Whole 1L'];
    expect(hasMaterialDuplicateCanonicalConflict(ev('Whole Milk 1L', group))).toBe(false);
  });

  it('true when the group names are not all equivalent, even if one matches', () => {
    const group = ['Whole Milk 1L', 'Whole Milk 1L', 'Skimmed Milk 1L'];
    expect(hasMaterialDuplicateCanonicalConflict(ev('Whole Milk 1L', group))).toBe(true);
  });

  it('true when the recorded group is incomplete vs duplicateSkuCount (not corroborated)', () => {
    const m = ev('Whole Milk 1L', ['Whole Milk 1L']);
    m.duplicateSkuCount = 2; // two share the SKU but only one name supplied
    expect(hasMaterialDuplicateCanonicalConflict(m)).toBe(true);
  });
});
