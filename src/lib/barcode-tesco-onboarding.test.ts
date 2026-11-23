import { describe, expect, it } from 'vitest';
import { planOnboarding } from './barcode-tesco-onboarding';

const tesco = { sku: '300000001', name: 'Heinz Cream Of Tomato Soup 400G', brand: 'Heinz' };
const sv = { store: 'supervalu' as const, sku: '1017371000', title: 'Heinz Cream of Tomato Soup (400 g)' };
const dn = { store: 'dunnes' as const, sku: '100118355', title: 'Heinz Cream Of Tomato Soup 400g' };
const rec = (offers: Array<{ store: string; sku: string | null; name: string; brand?: string | null }>, canonicalName = 'Heinz Cream of Tomato Soup 400g') =>
  ({ canonicalName, offers: offers.map(o => ({ brand: null, ...o })) });

describe('barcode-onboard-v1', () => {
  it('creates a new record when no resolved SKU is in the catalogue', () => {
    expect(planOnboarding({ tesco, hits: [sv, dn], owners: {} })).toEqual({ action: 'create', target: null, reasons: [] });
  });
  it('attaches the Tesco offer to the one record owning the resolved SKUs (fills its Tesco gap)', () => {
    const p = planOnboarding({ tesco, hits: [sv, dn], owners: { supervalu: [{ productId: 'P', offerCount: 1 }], dunnes: [{ productId: 'P', offerCount: 1 }] },
      record: rec([{ store: 'supervalu', sku: sv.sku, name: sv.title }, { store: 'dunnes', sku: dn.sku, name: dn.title }]) });
    expect(p).toEqual({ action: 'attach', target: 'P', reasons: [] });
  });
  it('holds: resolved SKUs on different records, shared SKUs, own-label, no strong hit', () => {
    expect(planOnboarding({ tesco, hits: [sv, dn], owners: { supervalu: [{ productId: 'P', offerCount: 1 }], dunnes: [{ productId: 'Q', offerCount: 1 }] } }).reasons)
      .toEqual(['resolved_skus_on_different_records']);
    expect(planOnboarding({ tesco, hits: [sv], owners: { supervalu: [{ productId: 'P', offerCount: 2 }] } }).action).toBe('held');
    expect(planOnboarding({ tesco: { ...tesco, name: 'Tesco Cream Of Tomato Soup 400G', brand: 'Tesco' }, hits: [sv], owners: {} }).action).toBe('held');
    expect(planOnboarding({ tesco, hits: [], owners: {} }).action).toBe('held');
  });
  it('holds a target that already has a Tesco offer, is mixed, or carries a contradicting offer or name', () => {
    const owners = { supervalu: [{ productId: 'P', offerCount: 1 }] };
    const base = { store: 'supervalu', sku: sv.sku, name: sv.title };
    expect(planOnboarding({ tesco, hits: [sv], owners, record: rec([base, { store: 'tesco', sku: '9', name: 'x' }]) }).reasons).toContain('target_has_tesco_offer');
    expect(planOnboarding({ tesco, hits: [sv, dn], owners, record: rec([base, { store: 'dunnes', sku: '100999999', name: 'Heinz Soup 400g' }]) }).reasons).toContain('target_mixed:dunnes');
    expect(planOnboarding({ tesco, hits: [sv], owners, record: rec([base, { store: 'dunnes', sku: '1', name: 'Heinz Cream Of Tomato Soup 600g' }]) }).reasons).toContain('target_offer_contradicts:dunnes');
    expect(planOnboarding({ tesco, hits: [sv], owners, record: rec([base, { store: 'aldi', sku: null, name: 'Dunnes Stores Tomato Soup 400g' }]) }).reasons).toContain('target_offer_contradicts:aldi');
    expect(planOnboarding({ tesco, hits: [sv], owners, record: rec([base], 'Heinz Cream of Tomato Soup 600g') }).reasons).toContain('target_name_contradicts');
  });
});

import { onboardingCategory } from './barcode-tesco-onboarding';
describe('onboarding category', () => {
  it('maps Tesco department / aisle to the site categories and never guesses', () => {
    expect(onboardingCategory('Cooking Ingredients', 'Stock Cubes & Pots')).toBe('Stock');
    expect(onboardingCategory('Cooking Ingredients', 'Seasoning, Herbs & Spices')).toBe('Seasoning');
    expect(onboardingCategory('Crisps, Nuts and Popcorn', 'Sharing Crisps')).toBe('Snacks');
    expect(onboardingCategory('Tins, Cans & Packets', 'Tinned Fish & Seafood')).toBe('Tinned');
    expect(onboardingCategory('Coffee', 'Ground Coffee')).toBe('Beverages');
    expect(onboardingCategory('Breakfast Cereals', 'Porridge & Oats')).toBe('Breakfast');
    expect(onboardingCategory('Dried Pasta, Rice, Noodles & Cous Cous', 'Rice')).toBe('Pasta & Rice');
    expect(onboardingCategory('Something Unknown', 'Unknown')).toBeNull();
  });
});
