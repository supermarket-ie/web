import { describe, expect, it } from 'vitest';
import { MAX_SHOP_LINES, ShoppingActionRejected, requireCanonicalProductId, requireLineCapacity, requireMatchingTrustedOffer, requireSensibleQuantity } from '../action-gates';

describe('shopping action gates', () => {
  it('rejects unresolved product-specific writes', () => {
    expect(() => requireCanonicalProductId('')).toThrow(ShoppingActionRejected);
  });

  it('rejects stale, non-exact and mismatched offers', () => {
    const base = { requestedCanonicalProductId: 'p1', offerCanonicalProductId: 'p1', relationshipType: 'exact', freshnessState: 'fresh', price: 2.5 };
    expect(requireMatchingTrustedOffer(base)).toBe(2.5);
    expect(() => requireMatchingTrustedOffer({ ...base, offerCanonicalProductId: 'p2' })).toThrow(/does not match/);
    expect(() => requireMatchingTrustedOffer({ ...base, freshnessState: 'stale' })).toThrow(/does not match/);
  });

  it('enforces quantity and line caps', () => {
    expect(requireSensibleQuantity(20)).toBe(20);
    expect(() => requireSensibleQuantity(21)).toThrow(/between 1 and 20/);
    expect(() => requireLineCapacity(MAX_SHOP_LINES, 1)).toThrow(/cannot contain/);
  });
});
