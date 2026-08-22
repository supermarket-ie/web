import { describe, expect, it } from 'vitest';
import { dunnesPackSignature, isDunnesPackCompatible } from './dunnes-discovery';

describe('Dunnes pack matching', () => {
  it('preserves decimal litre sizes', () => {
    expect(dunnesPackSignature('7UP Lemon & Lime Bottle 1.25L')).toEqual({
      amount: 1250,
      unit: 'ml',
      count: null,
    });
  });

  it('captures multipack count and each-unit size', () => {
    expect(dunnesPackSignature('7UP Lemon & Lime 12 x 330ml')).toEqual({
      amount: 330,
      unit: 'ml',
      count: 12,
    });
  });

  it('accepts small retailer pack-size wording differences', () => {
    expect(isDunnesPackCompatible(
      'Airwick Active Fresh Eucalyptus & Freesia Room Spray 237ml',
      'Air Wick Eucalyptus & Freesia Active Fresh Room Spray 236ml',
    )).toBe(true);
  });

  it('rejects a different single bottle size', () => {
    expect(isDunnesPackCompatible(
      '7UP Zero Sugar Bottle 1.25L',
      '7Up Zero Sugar Bottle 500ml',
    )).toBe(false);
  });

  it('rejects a multipack when the canonical item is a single bottle', () => {
    expect(isDunnesPackCompatible(
      '7UP Lemon & Lime Bottle 1.25L',
      '7UP Refreshing Lemon & Lime Taste Can 12 x 330ml',
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
});
