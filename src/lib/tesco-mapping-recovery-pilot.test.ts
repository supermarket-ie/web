import { describe, it, expect } from 'vitest';
import {
  classifySearchCandidates,
  verifyAgainstLivePage,
  selectRepresentativeSample,
  inferDefect,
  estimateRecoverability,
  pilotCohortSql,
  PILOT_MAX_PRODUCTS,
  type DiscoveredCandidate,
  type PilotCohortRow,
} from './tesco-mapping-recovery-pilot';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';

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
    name: partial.name ?? 'Heinz Tomato Ketchup 460g',
    priceCents: partial.priceCents ?? 299,
    structuredQuantity: partial.structuredQuantity ?? { grams: 460 },
  };
}

function liveProduct(partial: Partial<TescoCollectedProduct>): TescoCollectedProduct {
  return {
    sku: partial.sku ?? '222222222',
    url: partial.url ?? 'https://www.tesco.ie/shop/en-IE/products/222222222',
    name: partial.name ?? 'Heinz Tomato Ketchup 460g',
    brand: partial.brand ?? 'Heinz',
    gtin: partial.gtin ?? null,
    price: partial.price ?? 2.99,
    currency: 'EUR',
    available: partial.available ?? true,
    quantity: partial.quantity ?? { grams: 460 },
  };
}

describe('classifySearchCandidates (tier 1) — proposal only, never a trusted price', () => {
  it('access_or_execution_failure short-circuits', () => {
    const r = classifySearchCandidates(base, [cand({})], { accessOrExecutionFailure: true });
    expect(r.outcome).toBe('access_or_execution_failure');
    expect(r.searchCandidate).toBeNull();
  });
  it('no_reliable_candidate when nothing returned', () => {
    expect(classifySearchCandidates(base, []).outcome).toBe('no_reliable_candidate');
  });
  it('search_matched_unverified (NOT exact_verified) for a single exact search candidate', () => {
    const r = classifySearchCandidates(base, [cand({ sku: '222222222' })]);
    expect(r.outcome).toBe('search_matched_unverified');
    expect(r.searchCandidate?.sku).toBe('222222222');
  });
  it('wrong_product_variant_pack when every candidate is a material mismatch', () => {
    const r = classifySearchCandidates(base, [cand({ sku: '333333333', name: 'Heinz Tomato Ketchup 1.35kg', structuredQuantity: { grams: 1350 } })]);
    expect(r.outcome).toBe('wrong_product_variant_pack');
  });
  it('two distinct exact candidates is NOT a single match -> plausible', () => {
    const r = classifySearchCandidates(base, [cand({ sku: '222222222' }), cand({ sku: '555555555' })]);
    expect(r.outcome).toBe('plausible_more_evidence');
    expect(r.searchCandidate).toBeNull();
  });
});

describe('verifyAgainstLivePage (tier 2) — only a fresh page corroboration yields exact_verified', () => {
  const sc = cand({ sku: '222222222' });
  it('promotes to exact_verified when the live page product matches exactly', () => {
    const r = verifyAgainstLivePage(base, sc, { ok: true, product: liveProduct({ sku: '222222222' }) });
    expect(r.outcome).toBe('exact_verified');
  });
  it('stays unverified (plausible) when the live product differs (size)', () => {
    const r = verifyAgainstLivePage(base, sc, { ok: true, product: liveProduct({ sku: '222222222', name: 'Heinz Tomato Ketchup 1.35kg', quantity: { grams: 1350 } }) });
    expect(r.outcome).toBe('plausible_more_evidence');
  });
  it('stays unverified when the SKU is absent from its own page', () => {
    const r = verifyAgainstLivePage(base, sc, { ok: true, product: liveProduct({ sku: '999999999' }) });
    expect(r.outcome).toBe('plausible_more_evidence');
  });
  it('reports access failure when the live fetch fails', () => {
    const r = verifyAgainstLivePage(base, sc, { ok: false, product: null });
    expect(r.outcome).toBe('access_or_execution_failure');
  });
  it('a search match alone never reaches exact_verified without the live check', () => {
    // tier 1 says search_matched; only tier 2 can promote it.
    expect(classifySearchCandidates(base, [sc]).outcome).toBe('search_matched_unverified');
  });
});

describe('inferDefect + estimateRecoverability', () => {
  it('maps reasons to the defect categories', () => {
    expect(inferDefect(['measureExactnessFailed'])).toBe('wrong_pack_or_quantity');
    expect(inferDefect(['brandConflict'])).toBe('brand_or_ownlabel');
    expect(inferDefect(['variantConflict'])).toBe('wrong_variant_or_formulation');
    expect(inferDefect(['different_sku_requires_mapping_review'])).toBe('incorrect_sku');
    expect(inferDefect(['missing_exact_product'])).toBe('missing_on_page');
    expect(inferDefect(['candidate does not establish full exact canonical identity'])).toBe('canonical_ambiguous');
    expect(inferDefect(['unavailable_or_no_regular_price'])).toBe('out_of_stock');
  });
  it('rates a generic-name-with-matching-live-title as high recoverability', () => {
    const row = { canonicalName: 'Broccoli', liveName: 'Tesco Family Pack Broccoli' } as PilotCohortRow;
    expect(estimateRecoverability(row, 'canonical_ambiguous')).toBe('high');
  });
  it('rates wrong-product reasons low and out-of-stock n/a', () => {
    expect(estimateRecoverability({} as PilotCohortRow, 'brand_or_ownlabel')).toBe('low');
    expect(estimateRecoverability({} as PilotCohortRow, 'out_of_stock')).toBe('na');
  });
});

function row(i: number, reasons: string[], both = true): PilotCohortRow {
  return {
    storeProductId: `sp-${String(i).padStart(4, '0')}`,
    productId: `p-${i}`,
    canonicalName: `Z Product ${i}`, // 'Z' so alphabetical would put them last
    canonicalBrand: null, storeProductName: `Store ${i}`, storeBrand: null, isOwnBrand: false,
    storeSku: String(100000 + i), storeUrl: `https://www.tesco.ie/shop/en-IE/products/${100000 + i}`,
    heldReasons: reasons, liveName: null,
    supervaluPrice: both ? 1 : null, dunnesPrice: 1, bothPeers: both,
  };
}

describe('selectRepresentativeSample (review point 1) — representative, not alphabetical', () => {
  it('covers every identity-failure category present rather than one bucket', () => {
    const rows: PilotCohortRow[] = [
      ...Array.from({ length: 40 }, (_, i) => row(i, ['measureExactnessFailed'])),      // pack/qty (big bucket)
      ...Array.from({ length: 10 }, (_, i) => row(100 + i, ['brandConflict'])),          // brand
      ...Array.from({ length: 8 }, (_, i) => row(200 + i, ['variantConflict'])),         // variant
      ...Array.from({ length: 6 }, (_, i) => row(300 + i, ['candidate does not establish full exact canonical identity'])),
      ...Array.from({ length: 3 }, (_, i) => row(400 + i, ['missing_exact_product'])),
    ];
    const sample = selectRepresentativeSample(rows, 50);
    const defects = new Set(sample.map((s) => s.defect));
    // All five categories represented (round-robin), not 50 of the biggest bucket.
    expect(defects.has('wrong_pack_or_quantity')).toBe(true);
    expect(defects.has('brand_or_ownlabel')).toBe(true);
    expect(defects.has('wrong_variant_or_formulation')).toBe(true);
    expect(defects.has('canonical_ambiguous')).toBe(true);
    expect(defects.has('missing_on_page')).toBe(true);
    // The big bucket must NOT crowd out the rest: it should not be ~all 50.
    const packQty = sample.filter((s) => s.defect === 'wrong_pack_or_quantity').length;
    expect(packQty).toBeLessThan(40);
  });
  it('caps at PILOT_MAX_PRODUCTS and prioritises likelier recoveries within a category', () => {
    const rows: PilotCohortRow[] = [
      { ...row(1, ['candidate does not establish full exact canonical identity']), canonicalName: 'Broccoli', liveName: 'Tesco Family Pack Broccoli' }, // high
      { ...row(2, ['candidate does not establish full exact canonical identity']), canonicalName: 'Cheddar', liveName: 'Applewood Smoked Cheddar' },     // medium
    ];
    const sample = selectRepresentativeSample(rows, PILOT_MAX_PRODUCTS);
    expect(sample.length).toBe(2);
    // The high-recoverability one ranks first within the category.
    expect(sample[0].recoverability).toBe('high');
  });
  it('returns at most the requested limit', () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i, ['measureExactnessFailed']));
    expect(selectRepresentativeSample(rows, 50).length).toBe(50);
  });
});

describe('pilotCohortSql — read-only selection guards', () => {
  const sql = pilotCohortSql();
  it('is SELECT-only (no mutation keywords)', () => {
    expect(/\b(insert|update|delete|drop|alter|truncate)\b/i.test(sql)).toBe(false);
  });
  it('excludes shared-SKU groups, pending and recent-24h URLs', () => {
    expect(sql).toContain('sc.c=1');
    expect(sql).toContain('any_pending');
    expect(sql).toContain('not exists(select 1 from attempted');
  });
  it('requires proven + no fresh tesco price + a fresh peer', () => {
    expect(sql).toContain("outcome='success'");
    expect(sql).toContain('not m.fresh_tesco');
    expect(sql).toContain('(pr.sv or pr.dn)');
  });
  it('bothPeersOnly restricts to both-peer canonicals', () => {
    expect(pilotCohortSql({ bothPeersOnly: true })).toContain('and pr.sv and pr.dn');
  });
  it('only considers canonical product URLs', () => {
    expect(sql).toContain("store_url='https://www.tesco.ie/shop/en-IE/products/'||m.store_sku");
  });
});
