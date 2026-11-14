import { describe, expect, it } from 'vitest';
import { assessFirstPriceCandidate, type RetainedEvidencePage } from './tesco-first-price-approval';
import type { ApifyPeer } from './tesco-apify-collection';
import { parseTescoCollectedPage } from './tesco-direct-collection-core';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';
import { assessmentSchema } from './tesco-identity-assessment';

const MID = 'dddddddd-0000-0000-0000-00000000000f';
const SKU = '305123456';
const URL = `https://www.tesco.ie/shop/en-IE/products/${SKU}`;
const SHA = 'c'.repeat(64);

const apifyItem = (over: Partial<ApifyItem> = {}): ApifyItem => ({
  product_id: SKU, gtin: null as unknown as string, name: 'Nutella Hazelnut Chocolate Spread 350G', brand_name: 'Nutella',
  price: 3.5, clubcard_price: null, currency: 'EUR', region: 'IE', pack_size: '350', pack_size_unit: 'G',
  net_contents: '350g', in_stock: true, status: 'AvailableForSale', has_promotion: false, promotions: [],
  scraped_at: new Date().toISOString(), url: `https://www.tesco.ie/groceries/en-IE/products/${SKU}`, ...over,
});
const pageFor = (item: ApifyItem, over: Partial<RetainedEvidencePage> = {}): RetainedEvidencePage => {
  const parsed = parseTescoCollectedPage(renderApifyProductPage(URL, item), URL);
  return { id: 'eeeeeeee-0000-0000-0000-000000000001', requested_url: URL, outcome: 'ok', body_sha256: SHA,
    parsed: parsed as never, created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), ...over };
};
const snapshot = (over: Record<string, unknown> = {}) => ({
  store_product_id: MID, product_id: 'p3', store_sku: SKU, store_url: URL, url_status: 'resolved', store_brand: 'Nutella',
  store_product_name: 'Nutella Hazelnut Chocolate Spread 350g', is_own_brand: false, gtin: null,
  canonical_name: 'Nutella Hazelnut Chocolate Spread 350g', canonical_brand: 'Nutella', canonical_ean: null,
  same_sku_canonical_names: ['Nutella Hazelnut Chocolate Spread 350g'], ...over,
});
const name = 'Nutella Hazelnut Chocolate Spread 350g';
const peers = (): ApifyPeer[] => ([
  { id: 'peer-d', store: 'dunnes', store_product_name: name, brand: 'Nutella', gtin: null, store_sku: 'd1', observed_at: new Date().toISOString(), price: 3.4 },
  { id: 'peer-s', store: 'supervalu', store_product_name: name, brand: 'Nutella', gtin: null, store_sku: 's1', observed_at: new Date().toISOString(), price: 3.6 },
]);
const facts = { sku_matches: true, brand_matches: true, barcode_matches: 'match', product_type_matches: true,
  flavour_formulation_matches: true, quantity_matches: true, pack_count_matches: true, selling_unit_matches: true };
const runner = (decision: string) => async () => assessmentSchema.parse({ decision, facts,
  rationale: 'Checked all material attributes against the retained evidence page.' });
const base = { sleep: async () => undefined, aiRetries: 0 };

describe('assessFirstPriceCandidate', () => {
  it('builds approval args bound to the mapping, the retained page, its sha256 and the assessed fingerprint', async () => {
    const page = pageFor(apifyItem());
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers(), assessOptions: { runModel: runner('verified_exact') as never } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args.p_store_product_id).toBe(MID);
    expect(r.args.p_evidence_page_id).toBe(page.id);
    expect(r.args.p_evidence_body_sha256).toBe(SHA);
    expect(r.args.p_identity_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const a = r.args.p_assessment;
    expect(a.decision).toBe('verified_exact');
    expect(a.mapping_id).toBe(MID);
    expect(a.source_page_id).toBe(page.id);
    expect(a.source_body_sha256).toBe(SHA);
    expect(a.identity_fingerprint).toBe(r.args.p_identity_fingerprint);
    expect(String(a.model).length).toBeGreaterThan(2);
    expect(String(a.reason).length).toBeGreaterThanOrEqual(30);
    expect(String(a.rule_version).length).toBeGreaterThan(0);
    expect(r.args.p_expected_snapshot).toEqual(snapshot());
  });

  it('never approves without an AI verified_exact verdict (uncertain / rejected / model failure)', async () => {
    const page = pageFor(apifyItem());
    for (const d of ['uncertain', 'rejected']) {
      const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers(), assessOptions: { runModel: runner(d) as never } });
      expect(r).toEqual({ ok: false, reason: `ai_${d}` });
    }
    const boom = async () => { throw new Error('throttled'); };
    const err = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers(), assessOptions: { runModel: boom as never } });
    expect(err).toEqual({ ok: false, reason: 'ai_error' });
  });

  it('refuses evidence that is stale, for another URL, unhashed, not ok, or not exactly one matching product', async () => {
    const ai = { runModel: runner('verified_exact') as never };
    const run = (page: RetainedEvidencePage) => assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers(), assessOptions: ai });
    expect(await run(pageFor(apifyItem(), { created_at: new Date(Date.now() - 15 * 86400_000).toISOString() }))).toEqual({ ok: false, reason: 'evidence_stale' });
    expect(await run(pageFor(apifyItem(), { requested_url: 'https://www.tesco.ie/shop/en-IE/products/999999999' }))).toEqual({ ok: false, reason: 'evidence_not_ok_page_for_url' });
    expect(await run(pageFor(apifyItem(), { body_sha256: null }))).toEqual({ ok: false, reason: 'evidence_hash_missing' });
    expect(await run(pageFor(apifyItem(), { outcome: 'hold' }))).toEqual({ ok: false, reason: 'evidence_not_ok_page_for_url' });
    expect(await run(pageFor(apifyItem(), { parsed: { products: [] } }))).toEqual({ ok: false, reason: 'evidence_not_exactly_one_product' });
  });

  it('requires both fresh peers and a one-to-one SKU', async () => {
    const ai = { runModel: runner('verified_exact') as never };
    const page = pageFor(apifyItem());
    expect(await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers().slice(0, 1), assessOptions: ai }))
      .toEqual({ ok: false, reason: 'both_fresh_peers_required' });
    expect(await assessFirstPriceCandidate({ ...base, snapshot: snapshot({ same_sku_canonical_names: ['a', 'b'] }), page, peers: peers(), assessOptions: ai }))
      .toEqual({ ok: false, reason: 'shared_sku_requires_review' });
  });

  it('holds a genuine identity conflict at the deterministic gate; the AI is never asked to override it', async () => {
    let asked = false;
    const spy = async () => { asked = true; return assessmentSchema.parse({ decision: 'verified_exact', facts, rationale: 'Checked all material attributes against the evidence.' }); };
    const page = pageFor(apifyItem({ name: 'Ferrero Nutella Hazelnut Spread 750G', brand_name: 'Ferrero', pack_size: '750', net_contents: '750g' }));
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: peers(), assessOptions: { runModel: spy as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.startsWith('deterministic_hold')).toBe(true);
    expect(asked).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { planRecoveryQueue } from './tesco-recovery-queue';
import { independentExactIdentity } from './tesco-hold-reentry';
import { assessmentEvidence, snapshotIdentity } from './tesco-apify-collection';

describe('first-price onboarding in independentExactIdentity', () => {
  const page = pageFor(apifyItem());
  const live = page.parsed!.products![0];
  const ev = (peerList: ApifyPeer[], proven: boolean) =>
    assessmentEvidence(snapshotIdentity(snapshot()), page.id, SHA, live, peerList, proven);
  it('accepts an unproven mapping ONLY with both distinct fresh peers', () => {
    expect(independentExactIdentity(ev(peers(), false), live)).toBe(true);
    expect(independentExactIdentity(ev(peers().slice(0, 1), false), live)).toBe(false);
    expect(independentExactIdentity(ev([], false), live)).toBe(false);
  });
  it('without the onboarding flag an unproven mapping never passes (unchanged legacy behaviour)', () => {
    expect(independentExactIdentity({ ...ev(peers(), false), firstPriceOnboarding: false }, live)).toBe(false);
  });
  it('the proven path is unchanged (one peer still suffices)', () => {
    expect(independentExactIdentity(ev(peers().slice(0, 1), true), live)).toBe(true);
  });
});

describe('planRecoveryQueue (13 Nov 2026 owner queue)', () => {
  const plan = planRecoveryQueue(JSON.parse(readFileSync('scripts/data/tesco-recovery-queue-20261113.json', 'utf8')));
  it('splits the 122 entries into the agreed workflows', () => {
    expect(plan.expansionPriority).toHaveLength(19);     // A, same SKU: ordinary expansion first
    expect(plan.evidencePriority).toHaveLength(71);      // B, same SKU: evidence -> approval -> first price
    expect(plan.repairStageRows).toHaveLength(9);        // A, differing SKU with a retained page
    expect(plan.repairEvidenceTargets).toHaveLength(2);  // C, public catalogue leads (no page)
    expect(plan.repairUnsupported).toHaveLength(21);     // B, differing SKU: repair guard needs a receipt
    expect(plan.repairEvidenceTargets).toEqual([
      { mappingId: 'bb2d1dcd-6429-421f-a938-b56baf6c06e8', targetSku: '305429764' },
      { mappingId: 'ace2d397-308c-4125-b157-cf222760f2b9', targetSku: '309762431' },
    ]);
  });
});
