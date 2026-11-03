import { describe, expect, it } from 'vitest';
import {
  COMPARISON_LABELS, classifyOfferGroup, differentPack, isVerifiedExactThree,
  normalizedUnitPrice, readPack, type OfferIdentity, type PairReview,
} from './comparison-policy';
import { weeklyShopTotals, type WeeklyItem } from './weekly-shop';
import { buildShopCatalogue } from './shop-builder-catalogue';
import type { ProductPrice } from './price-data';

const now = Date.parse('2026-11-03T14:00:00Z');
const at = '2026-11-03T12:00:00Z';
const offers: OfferIdentity[] = [
  { store: 'tesco', storeProductId: 't', name: 'Avonmore Whole Milk 1L', price: 1.5 },
  { store: 'supervalu', storeProductId: 's', name: 'Avonmore Whole Milk 1000ml', price: 1.55 },
  { store: 'dunnes', storeProductId: 'd', name: 'Dunnes Whole Milk 1L', price: 1.3 },
];
function review(a: string, b: string, classification: PairReview['classification']): PairReview {
  return { left_offer_id: a, right_offer_id: b, classification,
    left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
    left_captured_at: at, right_captured_at: at, reviewed_at: at,
    rationale: 'Independently captured and reviewed product evidence.', reviewer: 'operational-review' };
}
const exact = [review('t','s','exact_product'), review('t','d','exact_product'), review('s','d','exact_product')];
const alternatives = [review('t','s','exact_product'),review('t','d','comparable_alternative'),review('s','d','comparable_alternative')];

describe('pairwise offer classification', () => {
  it('requires all three independently supported exact edges', () => {
    const samePack = offers.map(o => ({ ...o, name: 'Avonmore Whole Milk 1L' }));
    expect(isVerifiedExactThree(samePack, exact, now)).toBe(true);
    expect(isVerifiedExactThree(samePack, exact.slice(0,2), now)).toBe(false);
    expect(Object.values(classifyOfferGroup(samePack, exact.slice(0,2), now))).toEqual(['unverified','unverified','unverified']);
  });
  it('labels an alternative next to the affected retailer, never by canonical association', () => {
    expect(classifyOfferGroup(offers, alternatives, now)).toEqual({
      tesco: 'exact_product', supervalu: 'exact_product', dunnes: 'comparable_alternative',
    });
    expect(COMPARISON_LABELS.comparable_alternative).toBe('Comparable alternative');
  });
  it('rejects confirmed incompatibility and does not auto-promote unverified names', () => {
    expect(classifyOfferGroup(offers, [review('t','d','not_comparable'),...exact], now).tesco).toBe('not_comparable');
    expect(classifyOfferGroup(offers, [], now).dunnes).toBe('unverified');
    expect(classifyOfferGroup(offers, [review('t','s','exact_product')], now).tesco).toBe('unverified');
  });
  it('vetoes contradictory pack or variant even if an exact review is asserted', () => {
    const sameBrand = offers.map(o => ({ ...o, name: 'Avonmore Whole Milk 1L' }));
    sameBrand[2].name = 'Avonmore Whole Milk 1.75L';
    expect(classifyOfferGroup(sameBrand, exact, now).tesco).toBe('not_comparable');
    sameBrand[2].name = 'Avonmore Protein Milk Chocolate 1L';
    sameBrand[0].name = 'Avonmore Protein Milk Original 1L';
    expect(classifyOfferGroup(sameBrand, exact, now).tesco).toBe('not_comparable');
  });
  it('holds expired, incomplete and forged evidence', () => {
    expect(classifyOfferGroup(offers, alternatives.map(r => ({ ...r, left_source_hash: 'bad' })), now).tesco).toBe('unverified');
    expect(classifyOfferGroup(offers, alternatives.map(r => ({ ...r, reviewed_at: '2026-10-01T00:00:00Z' })), now).tesco).toBe('unverified');
  });
});
describe('pack and basket disclosures', () => {
  it('normalises unit prices but never treats two retail packs as identical', () => {
    expect(readPack('Yogurt 2x500g')).toMatchObject({ count: 2, total: 1000, unit: 'g' });
    expect(normalizedUnitPrice('Yogurt 2x500g', 4)).toEqual({ price: 4, per: 'kg' });
    expect(normalizedUnitPrice('Milk 1.75L', 2.1)?.price).toBeCloseTo(1.2);
    expect(differentPack('Milk 1L','Milk 1.75L')).toBe(true);
    expect(differentPack('Milk','Milk 1L')).toBe(true);
  });
  it('counts reviewed alternatives separately, excludes different packs and discloses uncertainty', () => {
    const items: WeeklyItem[] = [
      { id:'a',name:'Milk 1L',quantity:1,offers:{
        tesco:{name:'Milk 1L',price:1.5,observedAt:at,comparisonType:'exact_product'},
        dunnes:{name:'Dunnes Milk 1L',price:1.3,observedAt:at,comparisonType:'comparable_alternative'},
        supervalu:{name:'Milk 1L',price:1.6,observedAt:at,comparisonType:'unverified'},
      }},
      { id:'b',name:'Cream 500ml',quantity:1,offers:{
        dunnes:{name:'Cream 250ml',price:1,observedAt:at,comparisonType:'comparable_alternative',differentPack:true},
        tesco:{name:'Cream 500ml',price:2,observedAt:at,comparisonType:'exact_product'},
      }},
    ];
    const totals = weeklyShopTotals(items,{a:1,b:1});
    expect(totals.find(x=>x.store==='dunnes')).toMatchObject({
      alternativeCount:2,excludedComparisonCount:1,pricedCount:1,total:null,subtotal:1.3,
    });
    expect(totals.find(x=>x.store==='supervalu')).toMatchObject({unverifiedCount:1,total:null,verifiedComparableTotal:null});
    expect(totals.find(x=>x.store==='tesco')).toMatchObject({alternativeCount:0,total:3.5});
  });
  it('keeps raw three-store overlap unverified without a separate pair review ledger', () => {
    const prices = offers.map(o => ({
      store:o.store,store_product_id:o.storeProductId,canonical_product_id:'canonical',
      canonical_name:'Avonmore Whole Milk 1L',category:'Dairy',store_product_name:o.name,
      price:o.price,observed_at:at,relationship_type:'exact',freshness_state:'fresh',
    })) as ProductPrice[];
    const catalogue = buildShopCatalogue(prices,now);
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0].offers.tesco?.comparisonType).toBe('unverified');
  });
});
