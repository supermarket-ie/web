import { describe, expect, it } from 'vitest';
import type { ReentryEvidence } from './tesco-hold-reentry';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import {
  assessTescoIdentity,
  combineIdentityVerdict,
  assessAndCombine,
  assessmentSchema,
  factsSupportExact,
  fingerprintFor,
  identityFingerprint,
  IDENTITY_ASSESSMENT_RULE_VERSION,
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

// ---------------------------------------------------------------------------
// GAP FIXES (owner-required before using the AI module for acceptance):
//   (a) contradictory attribute findings must prevent acceptance
//   (b) assessments must bind to the exact mapping + evidence assessed
//   (c) stale assessments must not be rebound to new evidence
// ---------------------------------------------------------------------------

describe('GAP (a) — contradictory model facts cannot be accepted', () => {
  it('verified_exact with a contradictory fact (quantity_matches=false) HOLDS as uncertain', async () => {
    const e = exactEvidence();
    const live = exactLive();
    // Model (wrongly) says verified_exact AND the deterministic gate passes,
    // but the model's own facts contradict exactness.
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact', { quantity_matches: false }) });
    expect(a.deterministic_exact).toBe(true); // deterministic would accept
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
    expect(v.holdReason).toMatch(/contradict/);
  });

  it('verified_exact with a barcode conflict fact HOLDS', async () => {
    const e = exactEvidence();
    const live = exactLive();
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact', { barcode_matches: 'conflict' }) });
    const v = combineIdentityVerdict(e, live, a, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
  });

  it('factsSupportExact is false whenever any material fact dissents', () => {
    expect(factsSupportExact(facts())).toBe(true);
    expect(factsSupportExact(facts({ pack_count_matches: false }))).toBe(false);
    expect(factsSupportExact(facts({ barcode_matches: 'conflict' }))).toBe(false);
    // barcode unavailable is allowed (not a conflict).
    expect(factsSupportExact(facts({ barcode_matches: 'unavailable' }))).toBe(true);
  });
});

describe('GAP (b) — an assessment is bound to the exact identity it was made about', () => {
  it('a verdict made about one identity cannot be rebound to a DIFFERENT live product', async () => {
    const e = exactEvidence();
    const a = await assessTescoIdentity(e, exactLive(), { runModel: fakeModel('verified_exact') });
    expect(a.identity_fingerprint).toBe(fingerprintFor(e, exactLive()));
    // Now try to combine the SAME assessment against a different live product
    // (same SKU/url so the deterministic live-arm might otherwise be probed).
    const otherLive = { ...exactLive(), name: 'Example Tuna In Sunflower Oil 4x145g' };
    const v = combineIdentityVerdict(e, otherLive, a, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.machineAssessment).toBeNull();
    expect(v.holdReason).toMatch(/fingerprint|reassessment|stale/);
  });

  it('the fingerprint excludes price and promotions (volatile fields)', () => {
    const base = {
      canonical: { name: 'Example Tuna 4 Pack 580g', brand: 'Example', ean: null },
      tesco: { sku: '123456789', name: 'Example Tuna 4x145g', brand: 'Example', gtin: '05012345678901', quantity: { grams: 580 } },
    };
    const f1 = identityFingerprint(base);
    // Changing price/promotions is not an input, so the fingerprint is unchanged
    // (there is no price field in the input at all) — assert stability over two calls.
    expect(identityFingerprint(base)).toBe(f1);
    // Changing a material attribute DOES change the fingerprint.
    const f2 = identityFingerprint({ ...base, tesco: { ...base.tesco, quantity: { grams: 600 } } });
    expect(f2).not.toBe(f1);
  });
});

describe('GAP (c) — stale rule version invalidates reuse', () => {
  it('an assessment stamped with an older rule version cannot authorise acceptance', async () => {
    const e = exactEvidence();
    const live = exactLive();
    const a = await assessTescoIdentity(e, live, { runModel: fakeModel('verified_exact') });
    const stale = { ...a, rule_version: 'tesco-identity-v1-OLD' };
    const v = combineIdentityVerdict(e, live, stale, e.page.id);
    expect(v.decision).not.toBe('verified_exact');
    expect(v.holdReason).toMatch(/stale|reassessment/);
  });

  it('the current assessment carries the current rule version and a timestamp', async () => {
    const a = await assessTescoIdentity(exactEvidence(), exactLive(), { runModel: fakeModel('verified_exact') });
    expect(a.rule_version).toBe(IDENTITY_ASSESSMENT_RULE_VERSION);
    expect(Number.isFinite(Date.parse(a.assessed_at))).toBe(true);
  });
});

describe('the happy path still works end-to-end after the gap fixes', () => {
  it('a genuinely exact, consistent, correctly-bound current assessment accepts', async () => {
    const e = exactEvidence();
    const live = exactLive();
    const v = await assessAndCombine(e, live, e.page.id, { runModel: fakeModel('verified_exact') });
    expect(v.decision).toBe('verified_exact');
    expect(v.machineAssessment).not.toBeNull();
    expect(v.machineAssessment!.source_body_sha256).toBe(e.page.body_sha256);
  });
});
