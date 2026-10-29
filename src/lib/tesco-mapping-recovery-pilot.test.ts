import { describe, it, expect } from 'vitest';
import {
  classifyPilotDiscovery,
  pilotCohortSql,
  PILOT_MAX_PRODUCTS,
  type DiscoveredCandidate,
} from './tesco-mapping-recovery-pilot';

const base = {
  storeProductId: '11111111-1111-1111-1111-111111111111',
  canonicalName: 'Heinz Tomato Ketchup 460g',
  canonicalBrand: 'Heinz',
  storeProductName: 'Heinz Tomato Ketchup',
  storeBrand: 'Heinz',
  isOwnBrand: false,
  storeSku: '111111111',
  storeUrl: 'https://www.tesco.ie/shop/en-IE/products/111111111',
};

function cand(partial: Partial<DiscoveredCandidate>): DiscoveredCandidate {
  return {
    sku: partial.sku ?? '222222222',
    url: partial.url ?? `https://www.tesco.ie/shop/en-IE/products/${partial.sku ?? '222222222'}`,
    name: partial.name ?? 'Heinz Tomato Ketchup',
    priceCents: partial.priceCents ?? 299,
    structuredQuantity: partial.structuredQuantity ?? { grams: 460 },
  };
}

describe('classifyPilotDiscovery — the five outcomes (no mutation)', () => {
  it('access_or_execution_failure short-circuits before any classification', () => {
    const r = classifyPilotDiscovery(base, [cand({})], { accessOrExecutionFailure: true });
    expect(r.outcome).toBe('access_or_execution_failure');
    expect(r.exactCandidate).toBeNull();
    expect(r.evidence).toHaveLength(0);
  });

  it('no_reliable_candidate when discovery returns nothing', () => {
    const r = classifyPilotDiscovery(base, []);
    expect(r.outcome).toBe('no_reliable_candidate');
    expect(r.exactCandidate).toBeNull();
  });

  it('exact_verified when exactly one distinct candidate passes the strict validator', () => {
    // Candidate agrees on brand, measure (460g), and URL↔SKU corroborate.
    const r = classifyPilotDiscovery(base, [cand({ sku: '222222222', name: 'Heinz Tomato Ketchup 460g', structuredQuantity: { grams: 460 } })]);
    expect(r.outcome).toBe('exact_verified');
    expect(r.exactCandidate?.sku).toBe('222222222');
  });

  it('wrong_product_variant_pack when every candidate is a material mismatch (different size)', () => {
    // 1.35kg vs canonical 460g -> measure mismatch -> material_mismatch for all.
    const r = classifyPilotDiscovery(base, [
      cand({ sku: '333333333', name: 'Heinz Tomato Ketchup 1.35kg', structuredQuantity: { grams: 1350 } }),
    ]);
    expect(r.outcome).toBe('wrong_product_variant_pack');
    expect(r.exactCandidate).toBeNull();
  });

  it('plausible_more_evidence when the candidate is ambiguous (generic/under-corroborated), not exact', () => {
    // Generic canonical so canonicalTermsCovered/genericCanonical makes it ambiguous
    // rather than a clean exact or a hard material mismatch.
    const generic = { ...base, canonicalName: 'Ketchup', canonicalBrand: null, storeProductName: 'Ketchup' };
    const r = classifyPilotDiscovery(generic, [cand({ sku: '444444444', name: 'Heinz Tomato Ketchup 460g', structuredQuantity: { grams: 460 } })]);
    expect(r.outcome).toBe('plausible_more_evidence');
    expect(r.exactCandidate).toBeNull();
  });

  it('two distinct exact candidates is NOT exact_verified (ambiguous -> plausible)', () => {
    const r = classifyPilotDiscovery(base, [
      cand({ sku: '222222222', name: 'Heinz Tomato Ketchup 460g', structuredQuantity: { grams: 460 } }),
      cand({ sku: '555555555', name: 'Heinz Tomato Ketchup 460g', structuredQuantity: { grams: 460 } }),
    ]);
    expect(r.outcome).not.toBe('exact_verified');
    expect(r.exactCandidate).toBeNull();
  });

  it('never returns a trusted price — only evidence + a proposed SKU for review', () => {
    const r = classifyPilotDiscovery(base, [cand({ sku: '222222222', name: 'Heinz Tomato Ketchup 460g' })]);
    // The result carries no price-trust signal; exactCandidate is a proposal only.
    expect(Object.keys(r)).toEqual(['outcome', 'exactCandidate', 'evidence']);
  });
});

describe('pilotCohortSql — read-only selection guards', () => {
  const sql = pilotCohortSql(50);
  it('caps the limit at PILOT_MAX_PRODUCTS', () => {
    expect(pilotCohortSql(999)).toContain(`limit ${PILOT_MAX_PRODUCTS}`);
    expect(pilotCohortSql(10)).toContain('limit 10');
  });
  it('is SELECT-only (no mutation keywords)', () => {
    expect(/\b(insert|update|delete|drop|alter|truncate)\b/i.test(sql)).toBe(false);
  });
  it('excludes shared-SKU groups (unique SKU only)', () => {
    expect(sql).toContain('sc.c=1');
  });
  it('excludes pending (unknown-outcome) and recent-24h URLs', () => {
    expect(sql).toContain('any_pending');
    expect(sql).toContain('recent24');
    expect(sql).toContain('not exists(select 1 from attempted');
  });
  it('requires a proven receipt and no fresh trusted tesco price', () => {
    expect(sql).toContain("outcome='success'");
    expect(sql).toContain('not m.fresh_tesco');
  });
  it('requires at least one fresh peer and prioritises both peers first', () => {
    expect(sql).toContain('pr.sv or pr.dn');
    expect(sql).toContain('order by (sv and dn) desc');
  });
  it('only considers canonical product URLs', () => {
    expect(sql).toContain("store_url='https://www.tesco.ie/shop/en-IE/products/'||m.store_sku");
  });
});
