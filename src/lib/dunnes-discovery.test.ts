import { describe, expect, it } from 'vitest';
import {
  dunnesPackRatio,
  dunnesPackSignature,
  hasDunnesVariantConflict,
  isDunnesPackCompatible,
} from './dunnes-discovery';

describe('Dunnes pack matching', () => {
  it('preserves decimal litre sizes', () => {
    expect(dunnesPackSignature('7UP Lemon & Lime Bottle 1.25L')).toEqual({
      amount: 1250,
      unit: 'ml',
      count: null,
      multipack: false,
    });
  });

  it('captures multipack count and each-unit size', () => {
    expect(dunnesPackSignature('7UP Lemon & Lime 12 x 330ml')).toEqual({
      amount: 330,
      unit: 'ml',
      count: 12,
      multipack: true,
    });
  });

  it('captures a leading item count before descriptive product words', () => {
    expect(dunnesPackSignature('Birds Eye Chicken Shop 2 Sizzler Breaded Chicken Fillet Burgers 227g')).toEqual({
      amount: 227,
      unit: 'g',
      count: 2,
      multipack: false,
    });

    expect(dunnesPackSignature('Birds Eye 14 Breaded Fish Fingers 350g')).toEqual({
      amount: 350,
      unit: 'g',
      count: 14,
      multipack: false,
    });
  });

  it('accepts the same counted product when the retailer also states total weight', () => {
    expect(isDunnesPackCompatible(
      'Birds Eye Sizzler Chicken Fillet Burger 2 Pack',
      'Birds Eye Chicken Shop 2 Sizzler Breaded Chicken Fillet Burgers 227g',
    )).toBe(true);
  });

  it('requires exact normalized amount identity for exact mappings', () => {
    expect(isDunnesPackCompatible(
      'Airwick Active Fresh Eucalyptus & Freesia Room Spray 237ml',
      'Air Wick Eucalyptus & Freesia Active Fresh Room Spray 236ml',
    )).toBe(false);

    expect(isDunnesPackCompatible(
      "Ben's Original Sweet & Sour No Added Sugar Sauce 450g",
      'Bens Original Sweet and Sour No Added Sugar Sauce 440g',
    )).toBe(false);
  });

  it('rejects a different single bottle size', () => {
    expect(isDunnesPackCompatible(
      '7UP Zero Sugar Bottle 1.25L',
      '7Up Zero Sugar Bottle 500ml',
    )).toBe(false);
  });

  it('rejects a multipack when the canonical item is a single item', () => {
    expect(isDunnesPackCompatible(
      '7UP Lemon & Lime Bottle 1.25L',
      '7UP Refreshing Lemon & Lime Taste Can 12 x 330ml',
    )).toBe(false);

    expect(isDunnesPackCompatible(
      'Cadbury Dairy Milk Freddo Caramel Chocolate Bar 19g',
      'Cadbury Dairy Milk Caramel Freddo Chocolate Bar 4 Pack Multipack 78g (4 x 19.5g)',
    )).toBe(false);
  });

  it('matches equal roll counts and rejects different roll counts', () => {
    expect(isDunnesPackCompatible(
      'Andrex Ultimate Quilts Toilet Tissue 4 Roll',
      'Andrex Ultimate Quilts Toilet Tissue 4 Rolls',
    )).toBe(true);

    expect(isDunnesPackCompatible(
      'Andrex Ultimate Quilts Toilet Tissue 4 Roll',
      'Andrex Ultimate Quilts Toilet Tissue 9 Rolls',
    )).toBe(false);
  });

  it('requires a candidate size when the canonical product has one', () => {
    expect(isDunnesPackCompatible(
      'Avonmore Light Milk 2L',
      'Avonmore Light Milk',
    )).toBe(false);
  });

  it('records an implicit single-unit ratio against an explicit canonical pack', () => {
    expect(dunnesPackRatio(
      'Bunalun Chopped Tomatoes 4 Pack',
      'Bunalun Organic Chopped Tomatoes 400g',
    )).toBe(0.25);
  });

  it('uses total quantity when comparing multipacks', () => {
    expect(dunnesPackRatio(
      'Cadbury Dairy Milk Freddo Caramel Chocolate Bar 19g',
      'Cadbury Dairy Milk Caramel Freddo Chocolate Bar 4 x 19.5g',
    )).toBeCloseTo(78 / 19);
  });
});

describe('Dunnes variant protection', () => {
  it('rejects spaghetti hoops for plain spaghetti', () => {
    expect(hasDunnesVariantConflict(
      'Heinz Spaghetti In Tomato Sauce 400g',
      'Heinz Spaghetti Hoops in Tomato Sauce Snap Pots 4 x 190g (760g)',
    )).toBe(true);
  });

  it('does not treat identical variant terms as a conflict', () => {
    expect(hasDunnesVariantConflict(
      'Heinz Spaghetti Hoops 400g',
      'Heinz Spaghetti Hoops in Tomato Sauce 400g',
    )).toBe(false);
  });

  it('compares salted and unsalted as exact tokens', () => {
    expect(hasDunnesVariantConflict('Kerrygold Salted Butter 227g', 'Kerrygold Unsalted Butter 227g')).toBe(true);
    expect(hasDunnesVariantConflict('Kerrygold Unsalted Butter 227g', 'Kerrygold Unsalted Butter 227g')).toBe(false);
  });
});
