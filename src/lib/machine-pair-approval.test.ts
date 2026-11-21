import { describe, expect, it } from 'vitest';
import { evaluateMachinePair, type MachineSide } from './machine-pair-approval';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86400000).toISOString();
const GTIN = '8712566479528';
const T = 'tesco-offer', S = 'sv-offer', P = 'record-1';
function pair(over: { tesco?: Partial<MachineSide['source']>; sv?: Partial<MachineSide['source']>; tescoSide?: Partial<MachineSide>; svSide?: Partial<MachineSide>; assoc?: Partial<NonNullable<MachineSide['association']>> | null } = {}) {
  const tesco: MachineSide = { store: 'tesco', offerId: T, productId: P, sku: '273952198', skuShared: false,
    source: { id: 'page-1', kind: 'tesco_page', capturedAt: at(1), sku: '273952198', title: 'Heinz Cream Of Tomato Soup 400G', brand: 'HEINZ', gtin: `0${GTIN}`, ...over.tesco },
    ...over.tescoSide };
  const sv: MachineSide = { store: 'supervalu', offerId: S, productId: P, sku: '1084077003', skuShared: false,
    source: { id: 'resp-1', kind: 'captured_product', capturedAt: at(0.5), sku: '1084077003', title: 'Heinz Cream of Tomato Soup (400 g)', brand: 'Heinz', gtin: null, ...over.sv },
    association: over.assoc === null ? null : { gtin: GTIN, status: 'active', resolvedSku: '1084077003', originOfferId: T, originProductId: P, ...over.assoc },
    ...over.svSide };
  return [tesco, sv] as const;
}
const run = (p: readonly [MachineSide, MachineSide], model: Parameters<typeof evaluateMachinePair>[4] = null) => evaluateMachinePair(p[0], p[1], GTIN, NOW, model);
const sv = (title: string, brand = title.split(' ')[0]) => ({ title, brand });
const tesco = (title: string, brand = title.split(' ')[0]) => ({ title, brand });

describe('machine approval policy barcode-exact-v1', () => {
  it('approves a fully evidenced exact pair (barcode, binding, fresh direct sources, same brand and pack)', () => {
    expect(run(pair())).toMatchObject({ decision: 'approved', reasons: [] });
  });
  it('approves a Dunnes side bound to its SKU-bound product API capture', () => {
    const [t, s] = pair({ svSide: { store: 'dunnes', sku: '100118355' }, sv: { kind: 'captured_product_api', sku: '100118355', title: 'Heinz Cream Of Tomato Soup 400g' }, assoc: { resolvedSku: '100118355' } });
    expect(run([t, s]).decision).toBe('approved');
  });

  describe('known incorrect mappings from the barcode campaign are never approved', () => {
    it.each([
      ['different pack: Club Orange 500ml vs 1.75L', tesco('Club Orange Bottle 500ml'), sv('Club Orange Bottle (1.75 L)')],
      ['different count: Andrex 24 rolls vs 4 rolls', tesco('Andrex Classic Clean Toilet Tissue 24 Rolls'), sv('Andrex Classic Clean Toilet Tissue 4 Rolls')],
      ['different count: Dentastix 21 vs 4-pack', tesco('Pedigree Dentastix Daily Dental Chews Medium Dog 21 Sticks'), sv('Pedigree Dentastix Daily Dental Chews Medium Dog 4 Sticks')],
      ['different brand: Carmex vs Vaseline', tesco('Carmex Original Lip Balm 10g'), sv('Vaseline Original Lip Therapy (10 g)')],
      ['different brand: Elvive vs Pantene', tesco("L'Oreal Elvive Colour Protect Shampoo 400ml", "L'Oreal"), sv('Pantene Colour Protect Shampoo (400 ml)')],
      ['different flavour: Kerrygold Mild vs Mature', tesco('Kerrygold Mild Cheddar 200g'), sv('Kerrygold Mature Cheddar (200 g)')],
      ['different flavour: Muller Corner Strawberry vs Raspberry', tesco('Muller Corner Strawberry Yogurt 135g'), sv('Muller Corner Raspberry Yogurt (135 g)')],
      ['different fat: Avonmore Fresh vs Light Cream', tesco('Avonmore Fresh Cream 250ml'), sv('Avonmore Light Cream (250 ml)')],
      ['different percentage: milk 2% vs 1%', tesco('Avonmore Milk 2% 1L'), sv('Avonmore Milk 1% (1 L)')],
      ['retailer data error: NIVEA Creme Soft vs Clay Fresh', tesco('NIVEA Creme Soft Shower Cream 250ml', 'NIVEA'), sv('Nivea Clay Fresh Shower Cream (250 ml)', 'Nivea')],
      ['formulation stated on one side: No Added Sugar', tesco('Heinz Baked Beans 415g'), sv('Heinz Baked Beans No Added Sugar (415 g)')],
      ['variant word on one side: Dairy Milk vs Caramel', tesco('Cadbury Dairy Milk Chocolate Bar 110g'), sv('Cadbury Dairy Milk Caramel Chocolate Bar (110 g)')],
      ['different container: pouch vs jar', tesco("Ella's Kitchen Apples Pouch 120g", "Ella's Kitchen"), sv("Ella's Kitchen Apples Jar (120 g)", "Ella's Kitchen")],
      ['age stage: 4+ vs 6+ months', tesco("Ella's Kitchen Pear & Apple Baby Rice 4+ Months 120g", "Ella's Kitchen"), sv("Ella's Kitchen Pear & Apple Baby Rice 6+ Months (120 g)", "Ella's Kitchen")],
    ])('%s', (_label, t, s) => {
      expect(run(pair({ tesco: t, sv: s })).decision).not.toBe('approved');
    });
    it('material contradictions are REJECTED, not merely held', () => {
      expect(run(pair({ tesco: tesco('Club Orange Bottle 500ml'), sv: sv('Club Orange Bottle (1.75 L)') })).decision).toBe('rejected');
      expect(run(pair({ tesco: tesco('Carmex Original Lip Balm 10g'), sv: sv('Vaseline Original Lip Therapy (10 g)') })).decision).toBe('rejected');
      expect(run(pair({ tesco: tesco('Kerrygold Mild Cheddar 200g'), sv: sv('Kerrygold Mature Cheddar (200 g)') })).decision).toBe('rejected');
    });
    it('retailer own-label is rejected even with matching words', () => {
      expect(run(pair({ tesco: tesco('Tesco Plums 400g', 'Tesco'), sv: sv('SuperValu Plums (400 g)', 'SuperValu') })).decision).toBe('rejected');
      expect(run(pair({ sv: sv('Dunnes Stores Cream Of Tomato Soup 400g', 'Dunnes Stores') })).decision).toBe('rejected');
    });
  });

  describe('mandatory evidence', () => {
    it('no barcode association, an inactive one, or one from another Tesco offer is held', () => {
      expect(run(pair({ assoc: null }))).toMatchObject({ decision: 'held', reasons: ['supervalu:no_barcode_association'] });
      expect(run(pair({ assoc: { status: 'suspended_sku_changed' } })).decision).toBe('held');
      expect(run(pair({ assoc: { status: 'stale_needs_reverification' } })).decision).toBe('held');
      expect(run(pair({ assoc: { originOfferId: 'another-tesco-offer' } })).decision).toBe('held');
    });
    it('a barcode that resolves to a different SKU, or a page stating another GTIN, is rejected', () => {
      expect(run(pair({ assoc: { resolvedSku: '1084077999' } })).decision).toBe('rejected');
      expect(run(pair({ tesco: { gtin: '5000157062673' } })).decision).toBe('rejected');
      expect(run(pair({ sv: { gtin: '5000157062673' } })).decision).toBe('rejected');
    });
    it('a Tesco page that states no GTIN is held (the barcode must be on the page itself)', () => {
      expect(run(pair({ tesco: { gtin: null } }))).toMatchObject({ decision: 'held', reasons: ['tesco:page_states_no_gtin'] });
    });
    it('missing, listing-only, stale or other-SKU captures never approve', () => {
      expect(run(pair({ svSide: { source: null } })).decision).toBe('held');
      expect(run(pair({ sv: { kind: 'captured_listing' } })).decision).toBe('held');
      expect(run(pair({ sv: { kind: 'captured_product_api' } })).decision).toBe('held');   // product API is a Dunnes-only source
      expect(run(pair({ tesco: { capturedAt: at(13) } })).decision).toBe('held');
      expect(run(pair({ sv: { sku: '1084077999' } })).decision).toBe('rejected');
    });
    it('offers on different catalogue records, or a SKU shared by two offers, are held', () => {
      expect(run(pair({ svSide: { productId: 'record-2' } })).decision).toBe('held');
      expect(run(pair({ svSide: { skuShared: true } })).decision).toBe('held');
    });
    it('an unstated brand is held', () => {
      expect(run(pair({ sv: { brand: null } })).decision).toBe('held');
    });
  });

  describe('model assessment can only hold', () => {
    it('a model "different" or "uncertain" verdict holds an otherwise approvable pair', () => {
      expect(run(pair(), { verdict: 'different', model: 'm' })).toMatchObject({ decision: 'held', reasons: ['model_different'] });
      expect(run(pair(), { verdict: 'uncertain', model: 'm' }).decision).toBe('held');
    });
    it('a model "exact" verdict never overrides a contradiction or missing evidence', () => {
      expect(run(pair({ tesco: tesco('Club Orange Bottle 500ml'), sv: sv('Club Orange Bottle (1.75 L)') }), { verdict: 'exact', model: 'm' }).decision).toBe('rejected');
      expect(run(pair({ assoc: null }), { verdict: 'exact', model: 'm' }).decision).toBe('held');
    });
  });
});

describe('agreement with the customer-facing veto', () => {
  it('a pair the comparison veto would split ("4 x 28g" vs "4 Pots (112 g)") is held, never approved', () => {
    const r = evaluateMachinePair(
      { store: 'tesco', offerId: T, productId: P, sku: '273952198', skuShared: false, source: { id: 'p', kind: 'tesco_page', capturedAt: at(1), sku: '273952198', title: 'Knorr Rich Beef Stock Pot 4 x 28g', brand: 'Knorr', gtin: GTIN } },
      { store: 'supervalu', offerId: S, productId: P, sku: '1084077003', skuShared: false, association: { gtin: GTIN, status: 'active', resolvedSku: '1084077003', originOfferId: T, originProductId: P },
        source: { id: 'r', kind: 'captured_product', capturedAt: at(1), sku: '1084077003', title: 'Knorr Rich Beef Stock 4 Pots (112 g)', brand: 'Knorr', gtin: null } }, GTIN, NOW);
    expect(r).toMatchObject({ decision: 'held', reasons: ['customer_veto:different_pack'] });
  });
});
