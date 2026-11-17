import { describe, expect, it } from 'vitest';
import { checkRepair, postStateViolations, type OfferEvidence, type RepairContext, type RepairOffer, type RepairOp } from './pair-repair-guard';
import { BRAND_RULES } from './branded-brand-registry';

// Fixture mirrors production on 16 Nov 2026 (read-only snapshot): four Muesli SKUs, the generic
// "Muesli" canonical (Lifeforce) and the Flahavan's canonical with an EMPTY Dunnes placeholder.
const ASOF = '2026-11-16T22:00:00.000Z';
const LF = '1cca7ae6-2118-4871-be9a-d8eeb359f0ed', FL = 'ac3ad0c4-b393-451b-b9a2-9e4a6bb87b7c';
const none = { priceObservations: 0, receipts: 0, failures: 0, latestPrices: 0 };
const offers: RepairOffer[] = [
  { id: 'd-fl', productId: LF, store: 'dunnes', sku: '100673561', title: "Flahavan's Hi8 Muesli Original 1kg", brand: null,
    url: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/flahavan-s-hi8-muesli-original-1kg/100673561',
    dependents: { priceObservations: 84, receipts: 10, failures: 0, latestPrices: 1 } },
  { id: 's-lf', productId: LF, store: 'supervalu', sku: '1008602002', title: 'Lifeforce Muesli (750 g)', brand: 'Lifeforce',
    url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/lifeforce-muesli-750-g-id-1008602002',
    dependents: { priceObservations: 77, receipts: 10, failures: 0, latestPrices: 1 } },
  { id: 's-fl', productId: FL, store: 'supervalu', sku: '1023559000', title: "Flahavan's Hi 8 No Added Sugar Muesli (1 kg)", brand: "Flahavan's",
    url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1023559000',
    dependents: { priceObservations: 38, receipts: 5, failures: 0, latestPrices: 1 } },
  { id: 'd-placeholder', productId: FL, store: 'dunnes', sku: null, title: "Flahavan's Hi 8 No Added Sugar Muesli 1kg", brand: "Flahavan's", url: null, dependents: none },
];
const products = [
  { id: LF, canonicalName: 'Lifeforce Muesli 750g', brand: 'Lifeforce', ean: '05099856000017' },
  { id: FL, canonicalName: "Flahavan's Hi 8 No Added Sugar Muesli 1kg", brand: "Flahavan's", ean: null },
];
const recent = (id: string, kind: OfferEvidence['kind'] = 'captured_listing', at = '2026-11-16T05:00:00.000Z'): OfferEvidence => ({ offerId: id, kind, at });
const evidence = [recent('d-fl'), recent('s-fl'), recent('s-lf')];
const ctx = (over: Partial<RepairContext> = {}): RepairContext => ({ asOf: ASOF, offers, products, evidence, rules: BRAND_RULES, ...over });
const flahavans: RepairOp = { kind: 'repoint', offerId: 'd-fl', fromProductId: LF, toProductId: FL, retirePlaceholderId: 'd-placeholder' };

describe('Dunnes/SuperValu repair guard - Muesli fixture', () => {
  it('holds the Flahavan\'s re-point until identity is reviewed (no contradiction is not identity)', () => {
    const r = checkRepair(flahavans, ctx());
    expect(r).toContain('identity_not_established');
    expect(r.filter(x => x.startsWith('contradiction_with_peer'))).toEqual([]);
  });
  it('allows preparing it with a reviewed identity basis and fresh non-stored evidence', () => {
    expect(checkRepair({ ...flahavans, identityVerifiedBy: 'pair-review:example' }, ctx())).toEqual([]);
  });
  it('never merges 1kg Flahavan\'s with 750g Lifeforce (either direction)', () => {
    const a = checkRepair({ kind: 'repoint', offerId: 's-lf', fromProductId: LF, toProductId: FL, identityVerifiedBy: 'x' }, ctx());
    expect(a).toEqual(expect.arrayContaining(['pack_mismatch_with_target_canonical', 'brand_mismatch_with_target_canonical']));
    const b = checkRepair({ kind: 'repoint', offerId: 'd-fl', fromProductId: FL, toProductId: LF, identityVerifiedBy: 'x' },
      ctx({ offers: offers.map(o => o.id === 'd-fl' ? { ...o, productId: FL } : o) }));
    expect(b).toContain('pack_mismatch_with_target_canonical');
  });
  it('refuses duplicate SKU ownership', () => {
    const dup: RepairOffer = { ...offers[0], id: 'other-owner', productId: 'someone-else' };
    expect(checkRepair({ ...flahavans, identityVerifiedBy: 'x' }, ctx({ offers: [...offers, dup] }))).toContain('duplicate_sku_ownership');
  });
  it('refuses to displace an occupied same-store slot unless the empty placeholder is named', () => {
    expect(checkRepair({ ...flahavans, retirePlaceholderId: undefined, identityVerifiedBy: 'x' }, ctx())).toContain('target_store_slot_occupied');
  });
  it('never retires a placeholder that has price history, receipts or failures (history is preserved)', () => {
    for (const dep of [{ priceObservations: 1 }, { receipts: 1 }, { failures: 1 }, { latestPrices: 1 }]) {
      const withHistory = offers.map(o => o.id === 'd-placeholder' ? { ...o, dependents: { ...none, ...dep } } : o);
      expect(checkRepair({ ...flahavans, identityVerifiedBy: 'x' }, ctx({ offers: withHistory }))).toContain('placeholder_has_dependents');
    }
  });
  it('refuses stale (over 14 days) and stored-mapping-only evidence', () => {
    const stale = [recent('d-fl', 'captured_listing', '2026-10-30T05:00:00.000Z'), recent('s-fl'), recent('s-lf')];
    expect(checkRepair({ ...flahavans, identityVerifiedBy: 'x' }, ctx({ evidence: stale }))).toContain('stale_or_missing_evidence:dunnes:100673561');
    const stored = [recent('d-fl'), { offerId: 's-fl', kind: 'stored_mapping' as const, at: '2026-11-16T05:00:00.000Z' }, recent('s-lf')];
    expect(checkRepair({ ...flahavans, identityVerifiedBy: 'x' }, ctx({ evidence: stored }))).toContain('stale_or_missing_evidence:supervalu:1023559000');
  });
  it('refuses a recent attempt inside the window', () => {
    const attempted = offers.map(o => o.id === 'd-fl' ? { ...o, lastAttemptAt: '2026-11-16T10:00:00.000Z' } : o);
    expect(checkRepair({ ...flahavans, identityVerifiedBy: 'x' }, ctx({ offers: attempted }))).toContain('attempt_within_window');
  });
  it('refuses offers without a verified SKU and stores out of scope', () => {
    expect(checkRepair({ ...flahavans, offerId: 'd-placeholder', fromProductId: FL, toProductId: LF }, ctx())).toContain('offer_has_no_verified_sku');
  });
  it('a batch cannot leave one canonical with two same-store SKUs or a SKU owned twice', () => {
    const second: RepairOffer = { ...offers[0], id: 'd-other', sku: '100999999', title: "Flahavan's Hi8 Muesli 1kg" };
    const batch: RepairOp[] = [flahavans, { kind: 'repoint', offerId: 'd-other', fromProductId: LF, toProductId: FL }];
    expect(postStateViolations(batch, ctx({ offers: [...offers, second] })).some(v => v.startsWith('multiple_same_store_skus_after'))).toBe(true);
    expect(postStateViolations([flahavans], ctx())).toEqual([]);
  });
});
