import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectTescoApify, verificationReusable, type ApifyFetchResult } from './tesco-apify-collection';
import { renderApifyProductPage, createApifyFetchPage, type ApifyItem } from './tesco-apify-fetch';
import { IDENTITY_ASSESSMENT_RULE_VERSION, assessmentSchema } from './tesco-identity-assessment';

type Row = Record<string, unknown>;

// Fake Supabase: records RPC calls, serves selector reads + the reusable-
// verification read, and lets a test control finalise outcomes.
function makeFakeSb(opts: {
  mappings: Row[]; latest: Row[]; receipts: Row[]; recent: Row[]; verifications?: Row[];
  peers?: Row[]; // dunnes/supervalu rows with nested latest_prices, for attachFreshPeers
  verificationError?: string; // force apify_record_identity_verification to error
  finaliseResult?: (args: Row) => { finalised: boolean };
  reserveResult?: (args: Row) => { data: unknown; error: { message: string } | null };
  initialCommittedUsd?: number;
  // Override the AUTHORITATIVE snapshot a mapping resolves to, independent of
  // the initial selector query rows — models "query returned rice, the snapshot
  // RPC returns eggs" so we can prove assessment uses the snapshot, not query.
  snapshotOverride?: (mid: string) => Row | null;
}): { sb: SupabaseClient; calls: Array<{ fn: string; args: Row }>; budgetState: { committed: number; n: number; byId: Record<string, number> } } {
  const calls: Array<{ fn: string; args: Row }> = [];
  const budgetState = { committed: opts.initialCommittedUsd ?? 0, n: 0, byId: {} as Record<string, number> };
  // Build the authoritative snapshot exactly as apify_mapping_snapshot would,
  // reading CURRENT opts.mappings so a mid-test product_id change is reflected.
  const snapshotFor = (mid: string): Row | null => {
    if (opts.snapshotOverride) return opts.snapshotOverride(mid);
    const row = opts.mappings.find(m => m.id === mid);
    if (!row) return null;
    const c = (Array.isArray(row.products) ? row.products[0] : row.products) as Row | undefined;
    const names = opts.mappings.filter(m => m.store_sku === row.store_sku)
      .map(m => String(((Array.isArray(m.products) ? m.products[0] : m.products) as Row | undefined)?.canonical_name ?? ''));
    return {
      store_product_id: row.id, product_id: row.product_id, store_sku: row.store_sku,
      store_url: row.store_url, url_status: row.url_status, store_brand: row.brand,
      store_product_name: row.store_product_name, is_own_brand: row.is_own_brand === true,
      gtin: row.gtin, canonical_name: c?.canonical_name, canonical_brand: c?.brand,
      canonical_ean: c?.ean, same_sku_canonical_names: names,
    };
  };
  const table = (name: string) => {
    // attachFreshPeers queries store_products filtered to dunnes/supervalu via
    // .in('store', [...]) and resolves via await on the query (no .range). We
    // detect that by the 'store' in-filter and serve opts.peers.
    const state = { peerQuery: false };
    const dataFor = (): Row[] => name === 'store_products' ? (state.peerQuery ? (opts.peers ?? []) : opts.mappings)
      : name === 'latest_prices' ? opts.latest
      : name === 'scrape_product_receipts' ? opts.receipts
      : name === 'tesco_identity_verifications' ? (opts.verifications ?? [])
      : name === 'tesco_direct_collection_pages' ? opts.recent : [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain; builder.eq = chain; builder.not = chain; builder.gte = chain;
    builder.is = chain; builder.order = chain;
    builder.in = (col: string) => { if (col === 'store') state.peerQuery = true; return builder; };
    // attachFreshPeers awaits the builder directly (no .range/.limit); support
    // that by making the builder thenable, resolving to the peer rows.
    builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: state.peerQuery ? (opts.peers ?? []) : [], error: null });
    builder.limit = async () => ({ data: dataFor(), error: null });
    builder.range = async (from: number) => ({ data: from === 0 ? dataFor() : [], error: null });
    return builder;
  };
  const sb = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: Row) => {
      calls.push({ fn, args });
      if (fn === 'apify_begin_tesco_run') return { data: { runId: 'run-1', leaseToken: 'tok-1' }, error: null };
      if (fn === 'apify_mapping_snapshot') {
        return { data: snapshotFor(String(args.p_store_product_id)), error: null };
      }
      if (fn === 'apify_reserve_budget') {
        // Track committed spend in the closure; enforce the cap.
        budgetState.committed += Number(args.p_amount);
        if (budgetState.committed > Number(args.p_cap)) {
          budgetState.committed -= Number(args.p_amount);
          return { data: null, error: { message: 'budget_exhausted: over cap' } };
        }
        const id = `resv-${++budgetState.n}`;
        budgetState.byId[id] = Number(args.p_amount);
        return { data: { reservationId: id, committedUsd: budgetState.committed, remainingUsd: Number(args.p_cap) - budgetState.committed }, error: null };
      }
      if (fn === 'apify_settle_budget') {
        const id = String(args.p_reservation_id);
        const reserved = budgetState.byId[id] ?? 0;
        budgetState.committed += Number(args.p_actual_usd) - reserved; // reconcile to actual
        delete budgetState.byId[id];
        return { data: null, error: null };
      }
      if (fn === 'apify_reserve_tesco_request') {
        if (opts.reserveResult) return opts.reserveResult(args);
        // Model the server binding: reject if the caller's expected snapshot
        // differs from the CURRENT snapshot (rice→eggs reproduction).
        const current = snapshotFor(String(args.p_store_product_id));
        const expected = args.p_expected_snapshot as Row | null;
        if (expected && JSON.stringify(expected) !== JSON.stringify(current)) {
          return { data: null, error: { message: 'expected_snapshot_changed' } };
        }
        return { data: { reserved: true, snapshot: current }, error: null };
      }
      if (fn === 'apify_record_tesco_page') return { data: { recorded: true }, error: null };
      if (fn === 'apify_finalise_tesco_page') {
        const r = opts.finaliseResult ? opts.finaliseResult(args) : { finalised: true };
        return { data: r, error: null };
      }
      if (fn === 'apify_link_reservation_run') return { data: null, error: null };
      if (fn === 'apify_record_identity_verification') {
        if (opts.verificationError) return { data: null, error: { message: opts.verificationError } };
        return { data: 'ver-1', error: null };
      }
      if (fn === 'apify_close_tesco_run') return { data: { leaseReleased: true }, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { sb, calls, budgetState };
}

function item(over: Partial<ApifyItem> = {}): ApifyItem {
  return {
    product_id: '254877356', gtin: '05000119309228', name: 'Tesco Easy Cook Long Grain Rice 1Kg',
    brand_name: 'TESCO', price: 1.35, clubcard_price: null, currency: 'EUR', region: 'IE',
    pack_size: '1000', pack_size_unit: 'G', net_contents: '1kg e', in_stock: true,
    status: 'AvailableForSale', has_promotion: false, promotions: [],
    scraped_at: new Date(Date.now() + 2000).toISOString(),
    url: 'https://www.tesco.ie/groceries/en-IE/products/254877356', ...over,
  };
}

// Records the maxChargeUsd each call received, so a test can assert the
// outgoing provider monetary limit equals the reserved amount.
const fetchCeilings: number[] = [];
function okFetch(it: ApifyItem, preconditionMet = true): (url: string, maxChargeUsd?: number) => Promise<ApifyFetchResult> {
  return async (url: string, maxChargeUsd?: number) => {
    fetchCeilings.push(maxChargeUsd as number);
    return {
      response: { outcome: 'ok' as const, status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
      provider: {
        provider: 'apify' as const, actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: 'r', datasetId: 'd',
        requestedUrl: url, sku: String(it.product_id), bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string,
        rawItem: it, rawItemSha256: 'b'.repeat(64), runUsageUsd: 0.0005, runUsageIsTerminal: true,
        freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(),
          afterSubmit: preconditionMet, productScrapedEvents: 1,
          level: (preconditionMet ? 'after_submit_asserted' : 'not_after_submit') as never,
          preconditionMet, limitation: 'provider-asserted', reason: 'test' },
      },
    };
  };
}

// Fake AI runner producing a structured verdict (no Bedrock).
const aiFacts = (over: Record<string, unknown> = {}) => ({
  sku_matches: true, brand_matches: true, barcode_matches: 'match', product_type_matches: true,
  flavour_formulation_matches: true, quantity_matches: true, pack_count_matches: true, selling_unit_matches: true, ...over,
});
const aiRunner = (decision: string, over: Record<string, unknown> = {}) =>
  async () => assessmentSchema.parse({ decision, facts: aiFacts(over), rationale: 'Checked all material attributes against the fresh evidence.' });

function fixtures(overMapping: Row = {}, overLatest: Row = {}) {
  const id = '11111111-1111-1111-1111-111111111111';
  return {
    id,
    mappings: [{
      id, product_id: 'p1', store_sku: '254877356',
      store_url: 'https://www.tesco.ie/shop/en-IE/products/254877356',
      store_product_name: 'Tesco Easy Cook Long Grain Rice 1kg', brand: 'Tesco', is_own_brand: true,
      url_status: 'resolved', gtin: '05000119309228',
      products: { canonical_name: 'Long Grain Rice 1kg', brand: null, ean: '05000119309228' }, ...overMapping,
    }],
    latest: [{ store_product_id: id, observed_at: '2026-10-01T00:00:00Z', price: 1.3, ...overLatest }],
    receipts: [{ store_product_id: id, outcome: 'success' }],
    recent: [] as Row[],
  };
}

// A fixture whose canonical has NO ean and whose mapping has NO gtin, so the
// barcode path in independentExactIdentity cannot pass on its own. With no
// peers supplied, independentExactIdentity returns false and the ONLY accept
// route is AI agreement — this isolates the AI-path tests from the new
// peer/barcode-corroborated route.
function noBarcodeFixtures(overMapping: Row = {}, overLatest: Row = {}) {
  const id = '22222222-2222-2222-2222-222222222222';
  return {
    id,
    mappings: [{
      id, product_id: 'p2', store_sku: '254877356',
      store_url: 'https://www.tesco.ie/shop/en-IE/products/254877356',
      store_product_name: 'Tesco Easy Cook Long Grain Rice 1kg', brand: 'Tesco', is_own_brand: true,
      url_status: 'resolved', gtin: null,
      products: { canonical_name: 'Long Grain Rice 1kg', brand: null, ean: null }, ...overMapping,
    }],
    latest: [{ store_product_id: id, observed_at: '2026-10-01T00:00:00Z', price: 1.3, ...overLatest }],
    receipts: [{ store_product_id: id, outcome: 'success' }],
    recent: [] as Row[],
  };
}
// An Apify item that keeps a valid GTIN (so the renderer is happy) — the
// no-barcode property comes from the MAPPING having gtin=null and canonical
// ean=null, so independentExactIdentity's barcode path cannot apply and, with
// no peers + own-brand, it returns false (isolating the AI path).
const noBarcodeItem = (over: Partial<ApifyItem> = {}) => item({ ...over });

const baseDeps = (sb: SupabaseClient, fetchApify: (u: string, maxChargeUsd?: number) => Promise<ApifyFetchResult>, over: Record<string, unknown> = {}) => ({
  sb, fetchApify, campaign: 'tesco-apify-test', budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
  assessOptions: { runModel: aiRunner('verified_exact') as never }, ...over,
});

describe('collectTescoApify — identity + AI inference acceptance path', () => {
  it('finalises a new/changed mapping only when AI + deterministic agree, via the separate finalise RPC', async () => {
    // Barcode-backed fixture: canonical EAN matches the live GTIN, so the
    // strict positive gate independentExactIdentity passes and the mapping is
    // accepted (the AI concurs). This is a legitimate accept.
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item())));
    expect(res.accepted).toBe(1);
    // record (evidence only, never writes a price) then a SEPARATE finalise RPC.
    expect(calls.some(c => c.fn === 'apify_record_tesco_page')).toBe(true);
    // record RPC no longer carries any finalise/p_accept arg.
    const recArgs = calls.find(c => c.fn === 'apify_record_tesco_page')!.args;
    expect('p_accept' in recArgs).toBe(false);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(true);
    expect(calls.some(c => c.fn === 'apify_record_identity_verification')).toBe(true);
  });

  it('assessment uses the AUTHORITATIVE snapshot identity, NOT the stale selector-query fields', async () => {
    // Initial selector query returns RICE; the authoritative snapshot is EGGS
    // (models a product_id change between query and snapshot). The AI runner
    // must be shown the EGGS canonical — proving no mixed-version object.
    const fx = fixtures(); // query rows say rice
    const eggsSnap = (mid: string) => ({
      store_product_id: mid, product_id: 'p-eggs', store_sku: '254877356',
      store_url: 'https://www.tesco.ie/shop/en-IE/products/254877356', url_status: 'resolved',
      store_brand: 'Tesco', store_product_name: 'Tesco Free Range Eggs 12', is_own_brand: true,
      gtin: null, canonical_name: 'Free Range Eggs 12', canonical_brand: null,
      canonical_ean: null, same_sku_canonical_names: ['Free Range Eggs 12'],
    });
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent, snapshotOverride: eggsSnap });
    // The live Apify item matches the EGGS snapshot identity (so the
    // deterministic gate passes and the AI is actually invoked). No barcode and
    // no peers, so the AI path — not the peer/barcode route — is exercised.
    const eggsLive = item({ product_id: '254877356', name: 'Tesco Free Range Eggs 12', brand_name: 'TESCO',
      gtin: '05000436926832', pack_size: '12', pack_size_unit: 'each', net_contents: '12 eggs' });
    let seenCanonical: string | null = null;
    const spyRunner = async (a: { system: string; prompt: string }) => { seenCanonical = a.prompt; return aiRunner('verified_exact')(); };
    await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(eggsLive), { assessOptions: { runModel: spyRunner as never } }));
    // The AI prompt (built from the assessment evidence) carries the EGGS
    // canonical name from the snapshot, never the rice query field.
    expect(seenCanonical).toContain('Free Range Eggs 12');
    expect(seenCanonical).not.toContain('Long Grain Rice');
  });

  it('HOLDS when the AI rejects, even though the deterministic gate would pass (fail-closed)', async () => {
    const fx = noBarcodeFixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(noBarcodeItem()), {
      assessOptions: { runModel: aiRunner('rejected', { flavour_formulation_matches: false }) as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS when the AI is uncertain', async () => {
    const fx = noBarcodeFixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(noBarcodeItem()), {
      assessOptions: { runModel: aiRunner('uncertain') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
  });

  it('HOLDS (does not abort, never accepts) when the AI assessment THROWS (e.g. schema miss / model error)', async () => {
    const fx = noBarcodeFixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const throwingRunner = async () => { throw new Error('No object generated: response did not match schema.'); };
    // The run must COMPLETE (not reject) and hold the item, writing no price.
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(noBarcodeItem()), {
      assessOptions: { runModel: throwingRunner as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(res.stopped).not.toBe('fatal');
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
    expect(res.perProduct[0].reasons).toContain('ai_error');
  });

  // ---- Fresh-peer corroboration (no canonical EAN, no peer GTIN) ----
  // A branded manufacturer product whose canonical has no EAN. Fresh
  // Dunnes/SuperValu peers corroborate identity by brand + title + pack total.
  function brandedFixture(overMapping: Row = {}) {
    const id = '33333333-3333-3333-3333-333333333333';
    return {
      id,
      mappings: [{
        id, product_id: 'p3', store_sku: '305123456',
        store_url: 'https://www.tesco.ie/shop/en-IE/products/305123456',
        store_product_name: 'Nutella Hazelnut Chocolate Spread 350g', brand: 'Nutella', is_own_brand: false,
        url_status: 'resolved', gtin: null,
        products: { canonical_name: 'Nutella Hazelnut Chocolate Spread 350g', brand: 'Nutella', ean: null }, ...overMapping,
      }],
      latest: [{ store_product_id: id, observed_at: '2026-10-01T00:00:00Z', price: 3.5 }],
      receipts: [{ store_product_id: id, outcome: 'success' }],
      recent: [] as Row[],
    };
  }
  const brandedItem = (over: Partial<ApifyItem> = {}) => item({
    product_id: '305123456', name: 'Nutella Hazelnut Chocolate Spread 350G', brand_name: 'Nutella',
    gtin: null as unknown as string, pack_size: '350', pack_size_unit: 'G', net_contents: '350g',
    url: 'https://www.tesco.ie/groceries/en-IE/products/305123456', ...over,
  });
  // Two fresh peers (one per store) matching brand + pack total + title.
  const freshNutellaPeers = (name = 'Nutella Hazelnut Chocolate Spread 350g'): Row[] => ([
    { id: 'peer-d', product_id: 'p3', store: 'dunnes', store_sku: 'd1', store_product_name: name,
      brand: 'Nutella', gtin: null, latest_prices: { observed_at: new Date().toISOString(), price: 3.4 } },
    { id: 'peer-s', product_id: 'p3', store: 'supervalu', store_sku: 's1', store_product_name: name,
      brand: 'Nutella', gtin: null, latest_prices: { observed_at: new Date().toISOString(), price: 3.6 } },
  ]);

  it('ACCEPTS a peer-corroborated identity ONLY via AI verified_exact; peers are passed INTO the AI, which is actually invoked', async () => {
    const fx = brandedFixture();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    // Spy proves the AI is invoked AND the fresh peers are in its prompt.
    let seenPrompt: string | null = null;
    const spyRunner = async (a: { system: string; prompt: string }) => { seenPrompt = a.prompt; return aiRunner('verified_exact')(); };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem()), {
      assessOptions: { runModel: spyRunner as never },
    }));
    expect(seenPrompt).not.toBeNull();
    // Peers appear in the AI evidence (identity corroboration only).
    expect(seenPrompt).toContain('dunnes');
    expect(seenPrompt).toContain('supervalu');
    expect(res.accepted).toBe(1);
    // Method records the AI route with peer corroboration; the ACCEPT authority
    // is the AI verdict, never the peers alone.
    expect(res.perProduct[0].freshness).toBe('deterministic_plus_ai_peer');
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(true);
    // The verification record carries the DB-allowed AI method AND a model.
    const ver = calls.find(c => c.fn === 'apify_record_identity_verification');
    expect(ver).toBeTruthy();
    expect(ver!.args.p_method).toBe('deterministic_plus_ai');
    expect(typeof ver!.args.p_model).toBe('string');
    expect(String(ver!.args.p_model).length).toBeGreaterThan(2);
  });

  it('HOLDS when the AI is UNCERTAIN even though fresh peers corroborate identity (peers never bypass the AI)', async () => {
    const fx = brandedFixture();
    let invoked = false;
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    const spyRunner = async () => { invoked = true; return aiRunner('uncertain')(); };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem()), {
      assessOptions: { runModel: spyRunner as never },
    }));
    expect(invoked).toBe(true);           // AI was actually invoked
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS when the AI REJECTS even though a MATCHING BARCODE and fresh peers exist (barcode does not bypass the AI)', async () => {
    // Canonical EAN matches the live GTIN AND fresh peers corroborate — yet an
    // AI rejection must still hold. Proves no barcode/peer bypass remains.
    const fx = brandedFixture({ gtin: null,
      products: { canonical_name: 'Nutella Hazelnut Chocolate Spread 350g', brand: 'Nutella', ean: '7622300441074' } });
    let invoked = false;
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    const spyRunner = async () => { invoked = true; return aiRunner('rejected', { flavour_formulation_matches: false })(); };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem({ gtin: '7622300441074' })), {
      assessOptions: { runModel: spyRunner as never },
    }));
    expect(invoked).toBe(true);
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS (never accepts) when the AI THROWS even with matching barcode and fresh peers', async () => {
    const fx = brandedFixture({ gtin: null,
      products: { canonical_name: 'Nutella Hazelnut Chocolate Spread 350g', brand: 'Nutella', ean: '7622300441074' } });
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    const throwing = async () => { throw new Error('No object generated: response did not match schema.'); };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem({ gtin: '7622300441074' })), {
      assessOptions: { runModel: throwing as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(res.stopped).not.toBe('fatal');
    expect(res.perProduct[0].reasons).toContain('ai_error');
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('does NOT abort or un-accept when apify_record_identity_verification errors (price already finalised)', async () => {
    const fx = brandedFixture();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers(), verificationError: 'db down' });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem()), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    // The finalise succeeded and the accept stands; the verification-record
    // failure is logged, not fatal.
    expect(res.accepted).toBe(1);
    expect(res.stopped).not.toBe('fatal');
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(true);
  });

  it('HOLDS with peers supplied when there is a genuine BRAND conflict (peer cannot rescue a brand mismatch)', async () => {
    // Canonical brand Nutella; the live product is a different brand.
    const fx = brandedFixture();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(
      brandedItem({ name: 'Tesco Hazelnut Chocolate Spread 350G', brand_name: 'Tesco' })), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS with peers supplied when there is a genuine VARIANT conflict (added strong flavour)', async () => {
    const fx = brandedFixture({ store_product_name: 'Nutella Hazelnut Chocolate Spread 350g',
      products: { canonical_name: 'Nutella Hazelnut Chocolate Spread 350g', brand: 'Nutella', ean: null } });
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    // Live adds an explicit variant ("Orange") absent from the canonical.
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(
      brandedItem({ name: 'Nutella Orange Hazelnut Chocolate Spread 350G' })), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS with peers supplied when there is a genuine PACK/MEASURE conflict (different size)', async () => {
    const fx = brandedFixture();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: freshNutellaPeers() });
    // Live is 750g vs canonical 350g — a real size difference.
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(
      brandedItem({ name: 'Nutella Hazelnut Chocolate Spread 750G', pack_size: '750', net_contents: '750g' })), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS when peers themselves CONFLICT on pack/variant (a peer that disagrees cannot corroborate)', async () => {
    const fx = brandedFixture();
    // Peer states a different pack size → peerIdentityConflict → no corroboration.
    const conflictingPeers: Row[] = [
      { id: 'peer-d', product_id: 'p3', store: 'dunnes', store_sku: 'd1',
        store_product_name: 'Nutella Hazelnut Chocolate Spread 750g', brand: 'Nutella', gtin: null,
        latest_prices: { observed_at: new Date().toISOString(), price: 5.0 } },
    ];
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts,
      recent: fx.recent, peers: conflictingPeers });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(brandedItem()), {
      assessOptions: { runModel: aiRunner('uncertain') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('REJECTS a genuine barcode conflict via the deterministic gate (AI cannot override)', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Live GTIN differs from canonical EAN → deterministic reject; AI says exact.
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item({ gtin: '05099999999999' })), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
  });

  it('mapping changed before reservation (rice→eggs): reserve rejects the expected snapshot → no fetch, no write', async () => {
    const fx = fixtures();
    // The server reserve RPC rejects because the current mapping no longer
    // matches the snapshot the collector selected/assessed (expected_snapshot_changed).
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent,
      reserveResult: () => ({ data: null, error: { message: 'expected_snapshot_changed' } }) });
    let fetched = 0;
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, async (u) => { fetched++; return okFetch(item())(u); }));
    expect(fetched).toBe(0);                 // never collected on stale evidence
    expect(res.accepted).toBe(0);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);  // nothing written
  });

  it('REJECTS an equal-weight multipack with a different pack layout', async () => {
    // canonical "4 Pack 580g" vs live "2x290g": same total, different count.
    const fx = fixtures(
      { store_product_name: 'Example Tuna 4x145g', gtin: null, products: { canonical_name: 'Example Tuna 4 Pack 580g', brand: 'Example', ean: null } },
    );
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const live = item({ name: 'Example Tuna 2x290g', brand_name: 'Example', gtin: null, pack_size: '580', pack_size_unit: 'G' });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(live), {
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
  });
});

describe('collectTescoApify — freshness precondition (defect 1)', () => {
  it('HOLDS when the freshness precondition fails (scraped_at not after submit) — no finalise', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item(), /*preconditionMet*/ false)));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });
});

describe('collectTescoApify — reusable verification (defect 3)', () => {
  it('reuses an active verification (cheap deterministic renewal) without calling the AI', async () => {
    const fx = fixtures();
    // Seed an active verification whose fingerprint matches the live identity.
    // Compute the expected fingerprint by reading it off a first AI-free pass is
    // hard here; instead assert the AI runner is NOT invoked when reuse applies.
    let aiCalls = 0;
    const countingRunner = async () => { aiCalls++; return aiRunner('verified_exact')(); };
    // Provide a verification row with a matching fingerprint: we capture it by
    // running once WITHOUT a stored verification, reading the recorded fp.
    const first = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    await collectTescoApify('renewal', 10, baseDeps(first.sb, okFetch(item())));
    const fp = String(first.calls.find(c => c.fn === 'apify_record_identity_verification')!.args.p_identity_fingerprint);

    const second = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent,
      verifications: [{ identity_fingerprint: fp, rule_version: IDENTITY_ASSESSMENT_RULE_VERSION,
        reusable_until: new Date(Date.now() + 86_400_000).toISOString(), invalidated_at: null }] });
    const res = await collectTescoApify('renewal', 10, {
      sb: second.sb, fetchApify: okFetch(item()), campaign: 'tesco-apify-test', budgetUsd: 10, perRequestUsd: 0.002,
      sleep: async () => {}, assessOptions: { runModel: countingRunner as never },
    });
    expect(res.accepted).toBe(1);
    expect(aiCalls).toBe(0); // reuse path skipped the AI
  });

  it('verificationReusable is false for a mismatched fingerprint, stale rule, expiry or invalidation', () => {
    const now = new Date(Date.now() + 1_000_000).toISOString();
    const good = { identity_fingerprint: 'f', rule_version: IDENTITY_ASSESSMENT_RULE_VERSION, reusable_until: now, invalidated_at: null };
    expect(verificationReusable(good, 'f')).toBe(true);
    expect(verificationReusable(good, 'other')).toBe(false);
    expect(verificationReusable({ ...good, rule_version: 'old' }, 'f')).toBe(false);
    expect(verificationReusable({ ...good, reusable_until: '2000-01-01T00:00:00Z' }, 'f')).toBe(false);
    expect(verificationReusable({ ...good, invalidated_at: now }, 'f')).toBe(false);
    expect(verificationReusable(null, 'f')).toBe(false);
  });
});

describe('collectTescoApify — durable budget reservations (defect 5)', () => {
  it('RESERVES before each provider launch and stops when a reservation would exceed the cap', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { budgetUsd: 0.001, perRequestUsd: 0.002 }));
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
    // A reservation was ATTEMPTED before any fetch.
    expect(calls.some(c => c.fn === 'apify_reserve_budget')).toBe(true);
    expect(calls.some(c => c.fn === 'apify_reserve_tesco_request')).toBe(false);
  });

  it('$9.99 already committed: a 0.002 reservation against a $10 cap is refused (restart safety)', async () => {
    const fx = fixtures();
    // initialCommittedUsd models durable prior spend surviving a restart.
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent, initialCommittedUsd: 9.999 });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { budgetUsd: 10, perRequestUsd: 0.002 }));
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
  });

  it('settles the reservation to the ACTUAL provider charge after a successful fetch', async () => {
    const fx = fixtures();
    const { sb, calls, budgetState } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item())));
    const settle = calls.find(c => c.fn === 'apify_settle_budget')!;
    expect(settle.args.p_actual_usd).toBe(0.0005); // the run's actual usageTotalUsd
    // committed reconciled to the actual (0.0005), not the 0.002 reservation.
    expect(budgetState.committed).toBeCloseTo(0.0005, 6);
  });

  it('delayed/uncertain billing: a reservation that is never settled KEEPS counting against the cap', async () => {
    const fx = fixtures();
    const { sb, budgetState } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // fetch throws AFTER the reservation (uncertain outcome) → no settle.
    await expect(collectTescoApify('renewal', 10, baseDeps(sb, async () => { throw new Error('provider timeout'); },
      { budgetUsd: 10, perRequestUsd: 0.002 }))).rejects.toThrow();
    // The reservation remains committed (0.002) because it was never settled.
    expect(budgetState.committed).toBeCloseTo(0.002, 6);
  });

  it('passes the RESERVED amount as the outgoing provider monetary ceiling', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    fetchCeilings.length = 0;
    await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { perRequestUsd: 0.003 }));
    // The outgoing request's maxChargeUsd equals the reserved amount (0.003).
    expect(fetchCeilings).toEqual([0.003]);
  });

  it('caught provider timeout (REAL transport): network_error, no provider → reservation RETAINED (not settled as estimate)', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Use the REAL transport wiring: createApifyFetchPage over a client whose
    // runProductUrls throws (a caught provider timeout). The transport returns
    // network_error with NO provider identity.
    const throwingClient = { runProductUrls: async () => { throw new Error('UND_ERR_HEADERS_TIMEOUT'); } };
    const realFetch = async (u: string, maxChargeUsd?: number) => {
      void maxChargeUsd;
      let captured: unknown = null;
      const fp = createApifyFetchPage({ client: throwingClient as never, onProviderIdentity: (i) => { captured = i; } });
      const response = await fp(u, maxChargeUsd);
      return { response, provider: captured as ApifyFetchResult['provider'] };
    };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, realFetch, { perRequestUsd: 0.002 }));
    expect(res.accepted).toBe(0);
    // The reservation was NOT settled (no actual cost known): no settle call for it.
    expect(calls.some(c => c.fn === 'apify_settle_budget')).toBe(false);
  });

  it('successful retrieval with MISSING usageTotalUsd: reservation RETAINED, not settled as zero', async () => {
    const fx = fixtures();
    const { sb, calls, budgetState } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // Provider returns a product but NO cost (runUsageUsd null, not terminal).
    const noCost = async (url: string, max?: number) => {
      const r = await okFetch(item())(url, max);
      return { response: r.response, provider: { ...r.provider!, runUsageUsd: null, runUsageIsTerminal: false } };
    };
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, noCost, { perRequestUsd: 0.002 }));
    expect(res.accepted).toBe(1); // the price write still happens (identity ok)
    // No settle occurred; the reservation stays committed at the reserved amount.
    expect(calls.some(c => c.fn === 'apify_settle_budget')).toBe(false);
    expect(budgetState.committed).toBeCloseTo(0.002, 6);
  });

  it('PRELIMINARY total (present but not terminal): reservation RETAINED until a confirmed terminal charge', async () => {
    const fx = fixtures();
    const { sb, calls, budgetState } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    // A completion-time total of 0 that is NOT terminal must not be booked.
    const prelim = async (url: string, max?: number) => {
      const r = await okFetch(item())(url, max);
      return { response: r.response, provider: { ...r.provider!, runUsageUsd: 0, runUsageIsTerminal: false } };
    };
    await collectTescoApify('renewal', 10, baseDeps(sb, prelim, { perRequestUsd: 0.002 }));
    expect(calls.some(c => c.fn === 'apify_settle_budget')).toBe(false);
    // The reserved amount is retained; the preliminary 0 was NOT settled.
    expect(budgetState.committed).toBeCloseTo(0.002, 6);
    // It was linked to the provider run for later terminal reconciliation.
    expect(calls.some(c => c.fn === 'apify_link_reservation_run')).toBe(true);
  });

  it('RESTART with an outstanding (unsettled) reservation: it still counts against the cap', async () => {
    const fx = fixtures();
    // Model a prior process that reserved 0.002 but never settled it (crash
    // before terminal reconciliation): initialCommittedUsd carries it over.
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent, initialCommittedUsd: 9.999 });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { budgetUsd: 10, perRequestUsd: 0.002 }));
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
  });

  it('releases the reservation (settle 0) when the per-request reservation RPC refuses — no fetch', async () => {
    const fx = fixtures();
    const { sb, calls, budgetState } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent,
      reserveResult: () => ({ data: null, error: { message: 'attempt_already_recorded' } }) });
    let fetched = 0;
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, async (u) => { fetched++; return okFetch(item())(u); }));
    expect(fetched).toBe(0);
    expect(res.requested).toBe(0);
    // Budget reservation was released (settled to 0) so it does not leak.
    expect(calls.some(c => c.fn === 'apify_settle_budget' && c.args.p_actual_usd === 0)).toBe(true);
    expect(budgetState.committed).toBeCloseTo(0, 6);
  });
});
