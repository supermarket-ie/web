import { describe, expect, it } from 'vitest';
import { planRegroup, planSupervaluAttach, supervaluProductUrl, type RecordOffer } from './barcode-catalogue-repair';

const tesco = { id: 't', title: 'Gem Granulated Sugar 500G', brand: 'Gem' };
const T: RecordOffer = { id: 't', store: 'tesco', sku: '1', name: 'Gem Granulated Sugar 500G', brand: 'Gem' };
const base = (record: RecordOffer[], resolved: Record<string, string> = { supervalu: '200' }) => ({ gtin: '5000000000001', tesco, record, resolved, shared: new Set<string>() });

describe('regroup (split a mixed record)', () => {
  it('splits when the barcode resolved another SKU and the remaining offer contradicts the Tesco product', () => {
    const p = planRegroup(base([T, { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints Sugar Free Strawberry 20g', brand: 'Complimints' }], { dunnes: '100' }));
    expect(p).toMatchObject({ action: 'regroup', members: [] });
  });
  it('takes the barcode-resolved partner with it', () => {
    const p = planRegroup(base([T, { id: 's1', store: 'supervalu', sku: '200', name: 'Gem Granulated Sugar (500 g)', brand: 'Gem' },
      { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints Sugar Free Strawberry 20g', brand: 'Complimints' }], { supervalu: '200', dunnes: '100' }));
    expect(p).toMatchObject({ action: 'regroup', members: ['s1'] });
  });
  it('holds when a remaining offer is not contradicted (could be a duplicate listing of the same product)', () => {
    const p = planRegroup(base([T, { id: 's2', store: 'supervalu', sku: '999', name: 'Gem Granulated Sugar (500 g)', brand: 'Gem' }]));
    expect(p).toMatchObject({ action: 'held', reasons: ['remainder_not_contradicted:supervalu'] });
  });
  it('does nothing without barcode evidence of a mix, or when the record is not mixed', () => {
    expect(planRegroup(base([T, { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints 20g', brand: 'Complimints' }], {})).action).toBe('none');
    expect(planRegroup(base([T, { id: 's1', store: 'supervalu', sku: '200', name: 'Gem Granulated Sugar (500 g)', brand: 'Gem' }])).action).toBe('none');
  });
  it('holds with a second Tesco offer, a shared SKU, or a barcode-resolved member that now disagrees', () => {
    expect(planRegroup(base([T, { ...T, id: 't2', sku: '2' }, { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints 20g', brand: 'Complimints' }], { dunnes: '1' })).action).toBe('held');
    const shared = base([T, { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints 20g', brand: 'Complimints' }], { dunnes: '100' });
    shared.shared.add('t');
    expect(planRegroup(shared).action).toBe('held');
    expect(planRegroup(base([T, { id: 's1', store: 'supervalu', sku: '200', name: 'Gem Caster Sugar (500 g)', brand: 'Gem' },
      { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints 20g', brand: 'Complimints' }], { supervalu: '200', dunnes: '100' })).action).toBe('held');
  });
  it('an own-label remaining offer contradicts a manufacturer-branded Tesco product', () => {
    expect(planRegroup(base([T, { id: 's2', store: 'supervalu', sku: '999', name: 'SuperValu Granulated Sugar (500 g)', brand: 'SuperValu' }])).action).toBe('regroup');
  });
});

describe('SuperValu attach', () => {
  const attach = (o: Partial<Parameters<typeof planSupervaluAttach>[0]> = {}) => planSupervaluAttach({ gtin: 'g', tesco, record: [T], sku: '200', skuOwned: false,
    capture: { title: 'Gem Granulated Sugar (500 g)', brand: 'Gem', sku: '200' }, ...o });
  it('attaches a strong, unowned, directly captured SKU to a record without a SuperValu offer', () => expect(attach()).toEqual({ attach: true, reasons: [] }));
  it('holds on an existing SuperValu offer, owned SKU, missing capture, other SKU, contradiction, own-label or a contradicting Dunnes offer', () => {
    expect(attach({ record: [T, { id: 's', store: 'supervalu', sku: '9', name: 'x', brand: null }] }).attach).toBe(false);
    expect(attach({ skuOwned: true }).attach).toBe(false);
    expect(attach({ capture: null }).attach).toBe(false);
    expect(attach({ capture: { title: 'Gem Granulated Sugar (500 g)', brand: 'Gem', sku: '201' } }).attach).toBe(false);
    expect(attach({ capture: { title: 'Gem Granulated Sugar (1 kg)', brand: 'Gem', sku: '200' } }).attach).toBe(false);
    expect(attach({ capture: { title: 'Gem Caster Sugar (500 g)', brand: 'Gem', sku: '200' } }).attach).toBe(false);
    expect(attach({ record: [T, { id: 'd', store: 'dunnes', sku: '9', name: 'Complimints 20g', brand: 'Complimints' }] }).attach).toBe(false);
  });
  it('builds the storefront product URL from the product name', () => {
    expect(supervaluProductUrl('Vaseline Lip Therapy Original Lip Balm (20 g)', '1010312001'))
      .toBe('https://shop.supervalu.ie/sm/delivery/rsid/5550/product/vaseline-lip-therapy-original-lip-balm-20-g-id-1010312001');
    expect(supervaluProductUrl("Folláin Nothing But Fruit Strawberry Jam (340 g)", '1')).toBe('https://shop.supervalu.ie/sm/delivery/rsid/5550/product/follain-nothing-but-fruit-strawberry-jam-340-g-id-1');
  });
});

describe('SKU-less placeholder offers', () => {
  it('a remaining offer without a SKU is never evidence of a mix', () => {
    const p = planRegroup({ gtin: 'g', tesco, record: [T, { id: 'd', store: 'dunnes', sku: null, name: 'Complimints 20g', brand: 'Complimints' }], resolved: { dunnes: '100' }, shared: new Set() });
    expect(p).toMatchObject({ action: 'none', reasons: ['no_barcode_evidence_of_mix'] });
  });
});
