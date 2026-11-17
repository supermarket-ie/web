import { describe, expect, it } from 'vitest';
import { classifyOfferGroup, compareBasket, deterministicDifference, isOwnLabel, normalizedUnitPrice, readPack, type BasketLine, type PairReview } from './comparison-policy';

// Regression fixtures for the comparison-safety rule. Real production titles (16 Nov 2026).
const now = Date.parse('2026-11-17T12:00:00Z');
const at = '2026-11-17T10:00:00Z';
const review = (a: string, b: string, classification: PairReview['classification'] = 'exact_product'): PairReview => ({
  left_offer_id: a, right_offer_id: b, classification, left_source_hash: 'a'.repeat(64), right_source_hash: 'b'.repeat(64),
  left_captured_at: at, right_captured_at: at, reviewed_at: at, rationale: 'Independent direct-capture review.', reviewer: 'test' });

// The generic "Muesli" canonical record associates two different commercial products.
const muesli: BasketLine = { id: 'muesli', quantity: 1, offers: [
  { store: 'dunnes', storeProductId: 'd-flahavans', name: "Flahavan's Hi8 Muesli Original 1kg", price: 5.50 },
  { store: 'supervalu', storeProductId: 's-lifeforce', name: 'Lifeforce Muesli (750 g)', price: 5.19 },
] };
const chilli: BasketLine = { id: 'chilli', quantity: 1, offers: [
  { store: 'dunnes', storeProductId: 'd-chilli', name: 'Schwartz Mild Chilli Powder 38g', price: 3.40 },
  { store: 'supervalu', storeProductId: 's-chilli', name: 'Schwartz Chilli Powder Mild (38 g)', price: 3.40 },
] };
const milk: BasketLine = { id: 'milk', quantity: 2, offers: [
  { store: 'dunnes', storeProductId: 'd-milk', name: 'Avonmore Low Fat Super Milk 1 Litre', price: 1.75 },
  { store: 'supervalu', storeProductId: 's-milk', name: 'Avonmore Low Fat Super Milk (1 L)', price: 1.69 },
] };
const STORES = ['dunnes', 'supervalu'];

describe('Flahavan\'s / Lifeforce on one canonical record', () => {
  it('is a different product, not an exact or unverified match', () => {
    expect(deterministicDifference(muesli.offers[0].name, muesli.offers[1].name)).toBe('different_pack');
    expect(classifyOfferGroup(muesli.offers, [], now)).toEqual({ dunnes: 'not_comparable', supervalu: 'not_comparable' });
  });
  it('an asserted exact review cannot override the stated 1kg vs 750g contradiction', () => {
    expect(classifyOfferGroup(muesli.offers, [review('d-flahavans', 's-lifeforce')], now).dunnes).toBe('not_comparable');
  });
  it('is excluded from every store basket total, so no store can be ranked on it', () => {
    const c = compareBasket([chilli, muesli], STORES, [review('d-chilli', 's-chilli')], now);
    for (const s of c.stores) {
      expect(s.differentProductLines).toBe(1);
      expect(s.completeTotal).toBeNull();
      expect(s.verifiedExactTotal).toBeNull();
    }
    expect(c.cheapestVerified).toBeNull();
    expect(c.basis).toBe('incomplete');
  });
});

describe('cheapest claims', () => {
  it('are made only when both baskets are complete and every line is an approved exact match', () => {
    const c = compareBasket([chilli, milk], STORES, [review('d-chilli', 's-chilli'), review('d-milk', 's-milk')], now);
    expect(c.basis).toBe('verified_exact');
    expect(c.cheapestVerified).toEqual({ store: 'supervalu', total: 6.78 });
    expect(c.stores.map(s => s.verifiedExactTotal)).toEqual([6.78, 6.9]);
  });
  it('identical titles and identical prices without a review stay indicative and unranked', () => {
    const c = compareBasket([chilli, milk], STORES, [], now);
    expect(c.basis).toBe('indicative');
    expect(c.cheapestVerified).toBeNull();
    expect(c.stores.every(s => s.verifiedExactTotal === null && s.completeTotal !== null)).toBe(true);
    expect(c.stores.map(s => s.store)).toEqual(['dunnes', 'supervalu']); // neutral order, not by price
  });
  it('one unverified line removes the claim for the whole basket', () => {
    const c = compareBasket([chilli, milk], STORES, [review('d-chilli', 's-chilli')], now);
    expect(c.cheapestVerified).toBeNull();
    expect(c.stores.find(s => s.store === 'supervalu')!.unverifiedLines).toBe(1);
  });
  it('a Similar product review is labelled but never counts towards an exact total', () => {
    const c = compareBasket([chilli, milk], STORES, [review('d-chilli', 's-chilli'), review('d-milk', 's-milk', 'comparable_alternative')], now);
    expect(c.cheapestVerified).toBeNull();
  });
});

describe('incomplete baskets', () => {
  it('a store missing a line has no complete total and is ordered by coverage, never as cheapest', () => {
    const bread: BasketLine = { id: 'bread', quantity: 1, offers: [{ store: 'dunnes', storeProductId: 'd-bread', name: 'Brennans Bakehouse Multiseed 500g', price: 2.75 }] };
    const c = compareBasket([chilli, bread], STORES, [review('d-chilli', 's-chilli')], now);
    const sv = c.stores.find(s => s.store === 'supervalu')!;
    expect(sv).toMatchObject({ missingLines: 1, completeTotal: null, verifiedExactTotal: null, subtotal: 3.4 });
    expect(c.cheapestVerified).toBeNull();
    expect(c.stores[0].store).toBe('dunnes'); // more coverage first, although SuperValu's partial subtotal is lower
  });
});

describe('different packs and misleading canonical associations', () => {
  it('different stated packs are different products', () => {
    expect(deterministicDifference('Avonmore Light Milk 2L', 'Avonmore Light Milk (1 L)')).toBe('different_pack');
    expect(deterministicDifference('Brennans 6 Be Good Plain Bagels 270g', 'Brennans Be Good Plain Bagels 6 Pack (270 g)')).toBeNull();
  });
  it('own-label versus branded, and own-label from two retailers, are different products', () => {
    expect(deterministicDifference('Dunnes Stores Double Cream 250ml', 'Avonmore Double Cream (250 ml)')).toBe('own_label');
    expect(deterministicDifference('Dunnes Stores Fresh Mixed Peppers', 'SuperValu Mixed Peppers (2 Piece)')).toBe('own_label');
  });
  it('a missing pack is never treated as a contradiction or as equivalence', () => {
    const line = [{ store: 'dunnes', storeProductId: 'a', name: 'Heinz Beanz', price: 1 }, { store: 'supervalu', storeProductId: 'b', name: 'Heinz Beanz (415 g)', price: 1 }];
    expect(classifyOfferGroup(line, [], now)).toEqual({ dunnes: 'unverified', supervalu: 'unverified' });
  });
  it('one odd offer among three is marked different without condemning the other two', () => {
    const three = [...milk.offers, { store: 'tesco', storeProductId: 't-milk', name: 'Avonmore Low Fat Super Milk 2L', price: 3 }];
    expect(classifyOfferGroup(three, [], now)).toEqual({ dunnes: 'unverified', supervalu: 'unverified', tesco: 'not_comparable' });
  });
});

describe('review fixes: packs, unit prices and own-label scope', () => {
  it('reads a trailing multipack "125g x 4" the same as "4 x 125g"', () => {
    expect(readPack('Muller Corner 125g x 4')).toMatchObject({ total: 500, unit: 'g', count: 4 });
    expect(deterministicDifference('Muller Corner 125g x 4', 'Muller Corner 4 x 125g')).toBeNull();
  });
  it('gives a unit price for an explicit N x M multipack and none for an ambiguous "8 Pack 454g"', () => {
    expect(normalizedUnitPrice('Muller Corner 4 x 125g', 2)).toEqual({ price: 4, per: 'kg' });
    expect(normalizedUnitPrice('Brennans 8 Pack 454g', 2)).toBeNull();
    expect(normalizedUnitPrice('Avonmore Milk 2L', 3)).toEqual({ price: 1.5, per: 'l' });
  });
  it('a multipack and a single pack of equal weight stay different packs', () => {
    expect(deterministicDifference('Yoplait 2 x 150g', 'Yoplait (300 g)')).toBe('different_pack');
  });
  it('an approved exact review stands when one title states no pack', () => {
    const offers = [
      { store: 'tesco', storeProductId: 't-beanz', name: 'Heinz Beanz', price: 1.2 },
      { store: 'supervalu', storeProductId: 's-beanz', name: 'Heinz Beanz (415 g)', price: 1.2 },
    ];
    expect(classifyOfferGroup(offers, [review('t-beanz', 's-beanz')], now)).toEqual({ tesco: 'exact_product', supervalu: 'exact_product' });
  });
  it('manufacturer brands sharing a range word are not own-label', () => {
    expect(isOwnLabel('Deluxe Biscuits Selection 400g')).toBe(false);
    expect(isOwnLabel('Specially Selected Pasta 500g')).toBe(false);
    expect(isOwnLabel('Tesco Finest Pasta 500g')).toBe(true);
    expect(deterministicDifference('Deluxe Biscuits Selection 400g', 'Deluxe Biscuits Selection (400 g)')).toBeNull();
  });
  it('an expired review (older than 14 days) no longer verifies a pair', () => {
    const old = '2026-10-30T10:00:00Z';
    const stale = { ...review('d-chilli', 's-chilli'), left_captured_at: old, right_captured_at: old, reviewed_at: old };
    expect(classifyOfferGroup(chilli.offers, [stale], now)).toEqual({ dunnes: 'unverified', supervalu: 'unverified' });
  });
});
