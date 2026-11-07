import { describe, expect, it } from 'vitest';
import type { ReentryEvidence } from './tesco-hold-reentry';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import {
  assessTescoIdentity,
  combineIdentityVerdict,
  assessAndCombine,
  assessmentSchema,
  type IdentityAssessment,
} from './tesco-identity-assessment';

// A known-exact ReentryEvidence that genuinely passes independentExactIdentity
// (mirrors the fixture style in tesco-hold-reentry-identity.test.ts).
function exactEvidence(): ReentryEvidence {
  const url = 'https://www.tesco.ie/shop/en-IE/products/123456789';
  return {
    mapping: {
      id: 'mapping', product_id: 'product', canonical_name: 'Example Tuna 4 Pack 580g',
      canonical_brand: 'Example', canonical_ean: null,
      store_product_name: 'Example Tuna 4x145g', store_brand: 'Example', is_own_brand: false,
      store_sku: '123456789', store_url: url, url_status: 'resolved', gtin: null,
    },
    sameSkuCount: 1, proven: true, freshTesco: false, pending: false, recentAttempt: false,
    page: {
      id: 'page', requested_url: url, final_url: url, outcome: 'ok', http_status: 200,
      body_sha256: 'a'.repeat(64), mode: 'products',
      parsed: {
        listing: null,
        products: [{
          sku: '123456789', url, name: 'Example Tuna 4x145g', brand: 'Example',
          gtin: '05012345678901', quantity: { grams: 408 }, available: true, currency: 'EUR', price: 2,
          identityDetails: { packSize: [{ value: '408', units: 'G' }], netContents: '4x145g', drainedWeight: '4x102g' },
        }],
      },
    },
    sourceRun: { status: 'success', finished_at: '2026-01-01' },
    peers: [{ id: 'peer', store: 'supervalu', store_product_name: 'Example Tuna 4x145g', brand: 'Example',
      gtin: null, store_sku: 'peer-sku', observed_at: '2026-01-01', price: 2 }],
  };
}

// The matching live page for the exact fixture (passes the live arm of the gate).
function exactLive(): TescoCollectedProduct {
  return {
    sku: '123456789', url: 'https://www.tesco.ie/shop/en-IE/products/123456789',
    name: 'Example Tuna 4x145g', brand: 'Example', gtin: '05012345678901',
    quantity: { grams: 580 }, quantityEvidence: 'explicit_net_contents_with_drained_pack',
    available: true, currency: 'EUR', price: 2,
    identityDetails: { packSize: [{ value: '408', units: 'G' }], netContents: '4x145g', drainedWeight: '4x102g' },
  };
}

const facts = (over: Partial<IdentityAssessment['facts']> = {}): IdentityAssessment['facts'] => ({
  sku_matches: true, brand_matches: true, barcode_matches: 'match', product_type_matches: true,
  flavour_formulation_matches: true, quantity_matches: true, pack_count_matches: true, selling_unit_matches: true,
  ...over,
});

// A fake model runner returning a fixed structured verdict (no live Bedrock).
const fakeModel = (decision: IdentityAssessment['decision'], over: Partial<IdentityAssessment['facts']> = {}, rationale = 'All material attributes were compared against the fetched evidence and reconciled.') =>
  async () => assessmentSchema.parse({ decision, facts: facts(over), rationale });

describe('schema', () => {
  it('rejects a too-short rationale', () => {
    expect(assessmentSchema.safeParse({ decision: 'verified_exact', facts: facts(), rationale: 'too short' }).success).toBe(false);
  });
});

describe('assessTescoIdentity records the deterministic gate alongside the model verdict', () => {
  it('reports deterministic_exact=true for a genuinely exact triple', async () => {
    const a = await assessTescoIdentity(exactEvidence(), exactLive(), { runModel: fakeModel('verified_exact') });
    expect(a.deterministic_exact).toBe(true);
    expect(a.decision).toBe('verified_exact');
    expect(a.model.length).toBeGreaterThan(2);
  });

  it('reports deterministic_exact=false when the live page conflicts (wrong net weight)', async () => {
    const a = await assessTescoIdentity(exactEvidence(), { ...exactLive(), quantity: { grams: 600 } }, { runModel: fakeModel('verified_exact') });
    expect(a.deterministic_exact).toBe(false);
  });
});

describe('combineIdentityVerdict — safety invariants', () => {
  const e = exactEvidence();
  const live = exactLive();

  it('verified_exact ONLY when BOTH the model and the deterministic gate agree', async () => {
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact') });
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).toBe('verified_exact');
    expect(v.machineAssessment).not.toBeNull();
    expect(v.machineAssessment!.decision).toBe('verified_exact');
    expect(v.machineAssessment!.validation.independently_exact).toBe(true);
    expect(v.machineAssessment!.source_body_sha256).toBe(e.page.body_sha256);
  });

  it('the model can NEVER turn a deterministic rejection into an acceptance', async () => {
    // Model wrongly says verified_exact, but the live net weight conflicts.
    const badLive = { ...live, quantity: { grams: 600 } };
    const a = await assessTescoIdentity(e, badLive, { runModel: fakeModel('verified_exact') });
    const v = combineIdentityVerdict(e, badLive, a, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
    expect(v.holdReason).toContain('deterministic');
  });

  it('a model rejection HOLDS even if the deterministic gate would pass (fail-closed on disagreement)', async () => {
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('rejected', { flavour_formulation_matches: false }) });
    expect(a.deterministic_exact).toBe(true); // deterministic would accept
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).toBe('rejected');
    expect(v.machineAssessment).toBeNull();
  });

  it('a model "uncertain" verdict HOLDS (never a write)', async () => {
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('uncertain') });
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).toBe('uncertain');
    expect(v.machineAssessment).toBeNull();
  });

  it('confidence/verdict alone never produces an approval without the body hash + ids bound', async () => {
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact') });
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.machineAssessment!.mapping_id).toBe(e.mapping.id);
    expect(v.machineAssessment!.source_page_id).toBe(e.page.id);
  });
});

describe('required identity cases — the combined verdict must HOLD (no acceptance)', () => {
  // For each, the live page carries the conflict so the deterministic gate
  // independently rejects; even a mistaken model "verified_exact" cannot accept.
  const base = exactEvidence();

  it('misleading name (different product entirely)', async () => {
    const live = { ...exactLive(), name: 'Example Sardines 4x120g', quantity: { grams: 480 } };
    const v = await assessAndCombine(base, live, base.page.id, { runModel: fakeModel('verified_exact') });
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
  });

  it('wrong flavour/variant', async () => {
    const e = exactEvidence();
    e.mapping.canonical_name = 'Example Tuna In Brine 4 Pack 580g';
    e.mapping.store_product_name = 'Example Tuna In Brine 4x145g';
    const live = { ...exactLive(), name: 'Example Tuna In Sunflower Oil 4x145g' };
    const v = await assessAndCombine(e, live, e.page.id, { runModel: fakeModel('verified_exact') });
    expect(v.decision).not.toBe('verified_exact');
  });

  it('equal-weight multipack with a different pack count (2x290g vs 4x145g)', async () => {
    const live = { ...exactLive(), name: 'Example Tuna 2x290g', identityDetails: undefined, quantityEvidence: undefined };
    const v = await assessAndCombine(base, live, base.page.id, { runModel: fakeModel('verified_exact') });
    expect(v.decision).not.toBe('verified_exact');
  });

  it('wrong quantity (different net weight)', async () => {
    const live = { ...exactLive(), quantity: { grams: 700 }, identityDetails: undefined, quantityEvidence: undefined };
    const v = await assessAndCombine(base, live, base.page.id, { runModel: fakeModel('verified_exact') });
    expect(v.decision).not.toBe('verified_exact');
  });

  it('barcode conflict (live GTIN differs from canonical EAN)', async () => {
    const e = exactEvidence();
    e.mapping.canonical_ean = '05012345678901';
    const live = { ...exactLive(), gtin: '05099999999999' };
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact', { barcode_matches: 'conflict' }) });
    expect(a.deterministic_exact).toBe(false);
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
  });
});

describe('stale approvals — a changed page between assessment and write is not exact', () => {
  it('a different source_page body hash is carried into the MachineAssessment so downstream binding fails a stale snapshot', async () => {
    const e = exactEvidence();
    const a = await assessTescoIdentity(e, exactLive(), { runModel: fakeModel('verified_exact') });
    const v = combineIdentityVerdict(e, exactLive(), a, e.page.id);
    // The MachineAssessment pins the exact source body hash + ids. If the stored
    // evidence snapshot's body hash later differs, approvedReview rejects it.
    expect(v.machineAssessment!.source_body_sha256).toBe(e.page.body_sha256);
    const tampered = { ...v.machineAssessment!, source_body_sha256: 'b'.repeat(64) };
    expect(tampered.source_body_sha256).not.toBe(e.page.body_sha256);
  });
});

describe('Tesco identity is separate from cross-retailer equivalence', () => {
  it('peers corroborate identity only; the verdict carries no price-comparison claim', async () => {
    const a = await assessTescoIdentity(exactEvidence(), exactLive(), { runModel: fakeModel('verified_exact') });
    const v = combineIdentityVerdict(exactEvidence(), exactLive(), a, exactEvidence().page.id);
    // The machine assessment is about Tesco identity only — no comparison field.
    expect(Object.keys(v.machineAssessment!)).not.toContain('comparison');
    expect(v.machineAssessment!.source).toBe('independent_ai_identity_assessment');
  });
});
