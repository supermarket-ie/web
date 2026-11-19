// SELF-EVIDENCE first price (owner-approved principle, 19 Nov 2026; flag
// APIFY_FIRST_PRICE_SELF_EVIDENCE, default off). A Tesco first price may rest on
// Tesco's own source instead of two fresh matching peers, ONLY when that source
// positively establishes SKU, brand, barcode, pack and variant, the full
// deterministic gate passes, no present peer contradicts it, and the AI returns
// verified_exact. With the flag off, behaviour is unchanged.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assessFirstPriceCandidate, prepareFirstPriceApprovals, type RetainedEvidencePage } from './tesco-first-price-approval';
import { assessmentEvidence, collectTescoApify, snapshotIdentity, type ApifyFetchResult, type ApifyPeer } from './tesco-apify-collection';
import { parseTescoCollectedPage, type TescoCollectedProduct } from './tesco-direct-collection-core';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';
import { assessmentSchema } from './tesco-identity-assessment';
import { independentExactIdentity, reviewedCanonicalEvidenceGap, selfEvidenceFirstPriceReasons } from './tesco-hold-reentry';
import { createApifyDb, pgliteSupabase } from './test-support/apify-pglite';

const MID = 'dddddddd-0000-0000-0000-0000000000a1';
const SKU = '305123456';
const URL = `https://www.tesco.ie/shop/en-IE/products/${SKU}`;
const SHA = 'c'.repeat(64);
const GTIN = '8000500310427';
const NAME = 'Nutella Hazelnut Chocolate Spread 350g';
const apifyItem = (over: Partial<ApifyItem> = {}): ApifyItem => ({
  product_id: SKU, gtin: GTIN, name: 'Nutella Hazelnut Chocolate Spread 350G', brand_name: 'Nutella',
  price: 3.5, clubcard_price: null, currency: 'EUR', region: 'IE', pack_size: '350', pack_size_unit: 'G',
  net_contents: '350g', in_stock: true, status: 'AvailableForSale', has_promotion: false, promotions: [],
  scraped_at: new Date(Date.now() + 2000).toISOString(), url: `https://www.tesco.ie/groceries/en-IE/products/${SKU}`, ...over,
});
const pageFor = (item: ApifyItem, over: Partial<RetainedEvidencePage> = {}): RetainedEvidencePage => {
  const parsed = parseTescoCollectedPage(renderApifyProductPage(URL, item), URL);
  return { id: 'eeeeeeee-0000-0000-0000-0000000000a1', requested_url: URL, outcome: 'ok', body_sha256: SHA,
    parsed: parsed as never, created_at: new Date(Date.now() - 86400_000).toISOString(), ...over };
};
const snapshot = (over: Record<string, unknown> = {}) => ({
  store_product_id: MID, product_id: 'p-self', store_sku: SKU, store_url: URL, url_status: 'resolved', store_brand: 'Nutella',
  store_product_name: NAME, is_own_brand: false, gtin: null,
  canonical_name: NAME, canonical_brand: 'Nutella', canonical_ean: null,
  same_sku_canonical_names: [NAME], ...over,
});
const peer = (store: 'dunnes' | 'supervalu', over: Partial<ApifyPeer> = {}): ApifyPeer => ({
  id: `peer-${store}`, store, store_product_name: NAME, brand: 'Nutella', gtin: null, store_sku: `${store}-1`,
  observed_at: new Date().toISOString(), price: 3.4, ...over,
});
const facts = { sku_matches: true, brand_matches: true, barcode_matches: 'match', product_type_matches: true,
  flavour_formulation_matches: true, quantity_matches: true, pack_count_matches: true, selling_unit_matches: true };
const runner = (decision: string, onCall?: () => void) => async () => {
  onCall?.();
  return assessmentSchema.parse({ decision, facts, rationale: 'Checked SKU, brand, barcode, net quantity, pack count and variant on the Tesco page.' });
};
const base = { sleep: async () => undefined, aiRetries: 0 };

function evidence(opts: { snap?: Record<string, unknown>; item?: Partial<ApifyItem>; peers?: ApifyPeer[]; proven?: boolean; flag?: boolean } = {}) {
  const page = pageFor(apifyItem(opts.item));
  const live = page.parsed!.products![0] as TescoCollectedProduct;
  const ev = assessmentEvidence(snapshotIdentity(snapshot(opts.snap)), page.id, SHA, live, opts.peers ?? [], opts.proven ?? false,
    null, false, opts.flag ?? true);
  return { ev, live };
}

describe('selfEvidenceFirstPriceReasons: positive checks only', () => {
  it('passes when Tesco\'s own page establishes brand, barcode, stated pack and variant (no peers needed)', () => {
    const { ev, live } = evidence();
    expect(selfEvidenceFirstPriceReasons(ev, live)).toEqual([]);
  });
  const cases: Array<[string, Parameters<typeof evidence>[0], string]> = [
    ['no barcode on the Tesco page', { item: { gtin: null as unknown as string } }, 'source_barcode_missing'],
    ['canonical record states no pack', { snap: { canonical_name: 'Nutella Hazelnut Chocolate Spread' } }, 'canonical_pack_missing'],
    ['a different pack on the Tesco page', { item: { name: 'Nutella Hazelnut Chocolate Spread 750G', pack_size: '750', net_contents: '750g' } }, 'pack_mismatch'],
    ['a different brand on the Tesco page', { item: { brand_name: 'Ferrero', name: 'Ferrero Hazelnut Chocolate Spread 350G' } }, 'canonical_brand_conflict'],
    ['a retailer own-brand source', { item: { brand_name: 'Tesco', name: 'Tesco Hazelnut Chocolate Spread 350G' } }, 'source_brand_not_manufacturer'],
    ['an own-label mapping', { snap: { is_own_brand: true } }, 'own_brand'],
    ['an unbranded canonical record', { snap: { canonical_brand: null } }, 'canonical_brand_missing'],
    ['a variant on one side only', { item: { name: 'Nutella Light Hazelnut Chocolate Spread 350G' } }, 'canonical_variant_conflict'],
    ['a conflicting mapping barcode', { snap: { gtin: '5000000000001' } }, 'mapping_barcode_conflict'],
    ['a conflicting canonical EAN', { snap: { canonical_ean: '5000000000001' } }, 'canonical_barcode_conflict'],
    ['a shared Tesco SKU', { snap: { same_sku_canonical_names: [NAME, 'Other'] } }, 'shared_sku'],
    ['a proven mapping (not a first price)', { proven: true }, 'not_first_price'],
    ['no current price', { item: { in_stock: false, status: 'Unavailable' } }, 'no_current_price'],
    ['the original mapping title names a different product', { snap: { store_product_name: 'Nutella B-ready Wafer Bars 10 Pack' } }, 'mapping_title_unsupported'],
  ];
  for (const [label, opts, reason] of cases) {
    it(`holds on ${label}`, () => {
      const { ev, live } = evidence(opts);
      expect(selfEvidenceFirstPriceReasons(ev, live).some(r => r.startsWith(reason))).toBe(true);
    });
  }
  it('a present peer that CONTRADICTS the Tesco identity holds it (brand, pack, variant, barcode)', () => {
    for (const p of [
      peer('dunnes', { brand: 'Ferrero', store_product_name: 'Ferrero Hazelnut Spread 350g' }),
      peer('supervalu', { store_product_name: 'Nutella Hazelnut Chocolate Spread 750g' }),
      peer('dunnes', { store_product_name: 'Nutella Light Hazelnut Chocolate Spread 350g' }),
      peer('supervalu', { gtin: '5000000000001' }),
    ]) {
      const { ev, live } = evidence({ peers: [p] });
      expect(selfEvidenceFirstPriceReasons(ev, live).some(r => r.startsWith(`peer_disagrees:${p.store}=`))).toBe(true);
    }
  });
  it('an ADDED variant word on the Tesco page holds (titleSupport alone would tolerate it)', () => {
    const snap = { canonical_name: 'Heinz Beanz 415g', store_product_name: 'Heinz Beanz 415g', canonical_brand: 'Heinz', store_brand: 'Heinz' };
    for (const name of ['Heinz Beanz No Added Sugar 415G', 'Heinz Beanz Spicy 415G']) {
      const { ev, live } = evidence({ snap, item: { name, brand_name: 'Heinz', pack_size: '415', net_contents: '415g' } });
      expect(selfEvidenceFirstPriceReasons(ev, live).some(r => r.startsWith('source_words_unexplained:'))).toBe(true);
      expect(independentExactIdentity(ev, live)).toBe(false);
    }
    const exact = evidence({ snap, item: { name: 'Heinz Beanz 415G', brand_name: 'Heinz', pack_size: '415', net_contents: '415g' } });
    expect(selfEvidenceFirstPriceReasons(exact.ev, exact.live)).toEqual([]);
  });
  it('a canonical word missing from the Tesco page holds', () => {
    const { ev, live } = evidence({ item: { name: 'Nutella Chocolate Spread 350G' } });
    expect(selfEvidenceFirstPriceReasons(ev, live).some(r => r.startsWith('canonical_words_missing:hazelnut'))).toBe(true);
  });
  it('retailer own-label sub-brands and spaced retailer names are not manufacturer brands', () => {
    for (const [brand, name] of [['Finest', 'Finest Hazelnut Chocolate Spread 350G'], ['Super Valu', 'Super Valu Hazelnut Chocolate Spread 350G'],
      ['Stockwell', 'Stockwell Hazelnut Chocolate Spread 350G']] as const) {
      const { ev, live } = evidence({ snap: { canonical_brand: brand, store_brand: brand, canonical_name: name, store_product_name: name },
        item: { brand_name: brand, name } });
      expect(selfEvidenceFirstPriceReasons(ev, live)).toContain('source_brand_not_manufacturer');
    }
  });
  it('OWNER DECISION (documented): with no mapping GTIN and no canonical EAN, Tesco\'s own stated GTIN is the barcode evidence', () => {
    const { ev, live } = evidence({ snap: { gtin: null, canonical_ean: null } });
    expect(selfEvidenceFirstPriceReasons(ev, live)).toEqual([]);
  });
  it('a peer that merely omits its pack size is not a contradiction', () => {
    const { ev, live } = evidence({ peers: [peer('dunnes', { store_product_name: 'Nutella Hazelnut Chocolate Spread' })] });
    expect(selfEvidenceFirstPriceReasons(ev, live)).toEqual([]);
  });
});

describe('independentExactIdentity with and without the self-evidence flag', () => {
  it('flag OFF: an unproven mapping with no peers never passes (unchanged)', () => {
    const { ev, live } = evidence({ flag: false });
    expect(ev.selfEvidenceFirstPrice).toBeUndefined();
    expect(independentExactIdentity(ev, live)).toBe(false);
  });
  it('flag ON: passes only when every self-evidence check passes', () => {
    expect(independentExactIdentity(evidence().ev, evidence().live)).toBe(true);
    const noGtin = evidence({ item: { gtin: null as unknown as string } });
    expect(independentExactIdentity(noGtin.ev, noGtin.live)).toBe(false);
    const contra = evidence({ peers: [peer('dunnes', { store_product_name: 'Nutella Hazelnut Chocolate Spread 750g' })] });
    expect(independentExactIdentity(contra.ev, contra.live)).toBe(false);
  });
  it('the flag can never apply to a proven mapping envelope', () => {
    const { ev } = evidence({ proven: true });
    expect(ev.selfEvidenceFirstPrice).toBeUndefined();
  });
  it('the reviewed canonical-gap route never uses self-evidence (keeps its two-peer floor)', () => {
    const { ev, live } = evidence();
    expect(reviewedCanonicalEvidenceGap(ev, live, ['measureExactnessFailed'])).toBe(false);
  });
  it('a changed live page (different pack) fails the live recheck even with self-evidence', () => {
    const { ev } = evidence();
    const changed = pageFor(apifyItem({ name: 'Nutella Hazelnut Chocolate Spread 750G', pack_size: '750', net_contents: '750g' })).parsed!.products![0];
    expect(independentExactIdentity(ev, changed as TescoCollectedProduct)).toBe(false);
  });
});

describe('assessFirstPriceCandidate self-evidence route', () => {
  const page = pageFor(apifyItem());
  const ai = { runModel: runner('verified_exact') as never };
  it('flag OFF: no peers is still refused before any AI call (unchanged)', async () => {
    let asked = false;
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: [], assessOptions: { runModel: runner('verified_exact', () => { asked = true; }) as never } });
    expect(r).toEqual({ ok: false, reason: 'both_fresh_peers_required' });
    expect(asked).toBe(false);
  });
  it('flag ON: approves with route self_evidence_plus_ai when the AI agrees', async () => {
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: [], assessOptions: ai, selfEvidence: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.route).toBe('self_evidence_plus_ai');
    expect(r.args.p_assessment).toMatchObject({ route: 'self_evidence_plus_ai', self_evidence: true, first_price_onboarding: true, decision: 'verified_exact' });
  });
  it('flag ON: the AI is still mandatory', async () => {
    for (const d of ['uncertain', 'rejected']) {
      expect(await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: [], assessOptions: { runModel: runner(d) as never }, selfEvidence: true }))
        .toEqual({ ok: false, reason: `ai_${d}` });
    }
  });
  it('flag ON: a deterministic hold is never rescued, and the AI is not asked', async () => {
    let asked = false;
    const bad = pageFor(apifyItem({ name: 'Ferrero Nutella Hazelnut Spread 750G', brand_name: 'Ferrero', pack_size: '750', net_contents: '750g' }));
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page: bad, peers: [], selfEvidence: true,
      assessOptions: { runModel: runner('verified_exact', () => { asked = true; }) as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.startsWith('deterministic_hold')).toBe(true);
    expect(asked).toBe(false);
  });
  it('flag ON: a missing barcode or a contradicting peer holds before any AI call', async () => {
    let asked = false;
    const opts = { runModel: runner('verified_exact', () => { asked = true; }) as never };
    const noGtin = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page: pageFor(apifyItem({ gtin: null as unknown as string })),
      peers: [], selfEvidence: true, assessOptions: opts });
    expect(noGtin.ok).toBe(false);
    if (!noGtin.ok) expect(noGtin.reason).toContain('self_evidence_hold:');
    const contra = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, selfEvidence: true, assessOptions: opts,
      peers: [peer('dunnes', { brand: 'Ferrero', store_product_name: 'Ferrero Hazelnut Spread 350g' })] });
    expect(contra.ok).toBe(false);
    if (!contra.ok) expect(contra.reason).toContain('peer_disagrees:dunnes');
    expect(asked).toBe(false);
  });
  it('flag ON: two matching peers still use the ordinary route', async () => {
    const r = await assessFirstPriceCandidate({ ...base, snapshot: snapshot(), page, peers: [peer('dunnes'), peer('supervalu')], assessOptions: ai, selfEvidence: true });
    expect(r.ok && r.route).toBe('deterministic_plus_ai');
  });
});

// END-TO-END through the production collector + approval code against PGlite
// with the REAL migrations. The canonical product has NO Dunnes/SuperValu offer.
describe('self-evidence first price end-to-end (real migrations, no peers)', () => {
  const T = '7f000000-0000-0000-0000-000000000001';
  const TP = '7f000000-0000-0000-0000-0000000000a1';
  let db: PGlite;
  let sb: SupabaseClient;
  const fetched: string[] = [];
  const fakeApify = (over: Partial<ApifyItem> = {}) => async (url: string): Promise<ApifyFetchResult> => {
    fetched.push(url);
    const it = apifyItem(over);
    return {
      response: { outcome: 'ok', status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
      provider: {
        provider: 'apify', actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: `r-${fetched.length}`, datasetId: 'd',
        requestedUrl: url, sku: SKU, bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string,
        rawItem: it, rawItemSha256: 'b'.repeat(64), runUsageUsd: 0.0005, runUsageIsTerminal: true,
        freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(),
          afterSubmit: true, productScrapedEvents: 1, level: 'after_submit_asserted' as never,
          preconditionMet: true, limitation: 'provider-asserted', reason: 'test' },
      },
    };
  };
  const deps = (over: Record<string, unknown> = {}) => ({
    sb, fetchApify: fakeApify(), campaign: 'e2e-self', budgetUsd: 10, perRequestUsd: 0.002,
    sleep: async () => { await db.exec(`update public.tesco_egress_pool set last_success_at = null`); },
    assessOptions: { runModel: runner('verified_exact') as never }, aiRetries: 0, ...over,
  });
  const n = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
  const elapse25h = () => db.exec(`update public.tesco_direct_collection_pages set created_at = created_at - interval '25 hours';
    update public.tesco_egress_pool set last_success_at = null`);
  beforeEach(async () => {
    fetched.length = 0;
    db = await createApifyDb();
    sb = pgliteSupabase(db);
    await db.exec(`
      insert into public.products(id, canonical_name, brand, ean) values ('${TP}','${NAME}','Nutella',null);
      insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
        ('${T}','${TP}','tesco','${SKU}','${URL}','${NAME}','Nutella',false,null,'resolved');
    `);
  });
  afterEach(async () => { await db.close(); });

  it('flag OFF: the no-peer mapping is never requested, assessed or priced', async () => {
    await collectTescoApify('evidence', 10, deps());
    expect(fetched).not.toContain(URL);
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, assessOptions: { runModel: runner('verified_exact') as never } });
    expect(ap.considered).toBe(0);
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
  });

  it('flag ON: evidence -> AI-verified single-use approval -> first price, and the approval is consumed', async () => {
    const ev = await collectTescoApify('evidence', 10, deps({ selfEvidenceFirstPrice: true }));
    expect(ev.evidenceRecorded).toBe(1);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, selfEvidence: true, assessOptions: { runModel: runner('verified_exact') as never } });
    expect(ap).toMatchObject({ assessed: 1, approved: 1, recorded: 1 });
    const approval = (await db.query<{ id: string; assessment: Record<string, unknown> }>(
      `select id, assessment from public.tesco_first_price_approvals where store_product_id = $1`, [T])).rows[0];
    expect(approval.assessment.route).toBe('self_evidence_plus_ai');
    await elapse25h(); fetched.length = 0;
    // An approval alone is not enough with the flag off at collection time.
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    const exp = await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true, selfEvidenceFirstPrice: true }));
    const row = exp.perProduct.find(p => p.sku === SKU);
    expect(row?.accepted).toBe(true);
    expect(row?.freshness).toBe('self_evidence_plus_ai');
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(1);
    expect(await n(`select count(*)::int n from public.tesco_first_price_approvals where id = $1 and consumed_at is not null`, [approval.id])).toBe(1);
  });

  it('flag ON: no request is spent on a canonical that states no pack, or on a proven mapping', async () => {
    await db.exec(`update public.products set canonical_name = 'Nutella Hazelnut Chocolate Spread' where id = '${TP}'`);
    await collectTescoApify('evidence', 10, deps({ selfEvidenceFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    await db.exec(`update public.products set canonical_name = '${NAME}' where id = '${TP}';
      insert into public.scrape_runs(id, store, run_id, status, started_at) values ('7f000000-0000-0000-0000-0000000000ff','tesco','seed-self','success', now());
      insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('7f000000-0000-0000-0000-0000000000ff','${T}','success');`);
    await collectTescoApify('evidence', 10, deps({ selfEvidenceFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
  });

  it('flag ON: no approval and no price when the AI is not verified_exact', async () => {
    await collectTescoApify('evidence', 10, deps({ selfEvidenceFirstPrice: true }));
    const ap = await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, selfEvidence: true, assessOptions: { runModel: runner('uncertain') as never } });
    expect(ap).toMatchObject({ assessed: 1, approved: 0, recorded: 0 });
    await elapse25h(); fetched.length = 0;
    await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true, selfEvidenceFirstPrice: true }));
    expect(fetched).not.toContain(URL);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
  });

  it('flag ON: a live page that drifted from the approved evidence holds and leaves the approval unconsumed', async () => {
    await collectTescoApify('evidence', 10, deps({ selfEvidenceFirstPrice: true }));
    await prepareFirstPriceApprovals(sb, { limit: 10, apply: true, selfEvidence: true, assessOptions: { runModel: runner('verified_exact') as never } });
    await elapse25h(); fetched.length = 0;
    const exp = await collectTescoApify('expansion', 10, deps({ allowFirstPrice: true, selfEvidenceFirstPrice: true,
      fetchApify: fakeApify({ gtin: '5000000000001' }) }));
    expect(fetched).toContain(URL);
    expect(exp.perProduct.find(p => p.sku === SKU)?.accepted).toBe(false);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
    expect(await n(`select count(*)::int n from public.tesco_first_price_approvals where store_product_id = $1 and consumed_at is null`, [T])).toBe(1);
  });
});
