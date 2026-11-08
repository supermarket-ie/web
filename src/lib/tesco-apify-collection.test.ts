import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectTescoApify, verificationReusable, type ApifyFetchResult, type ApifyAuditClient } from './tesco-apify-collection';
import { renderApifyProductPage, type ApifyItem } from './tesco-apify-fetch';
import { IDENTITY_ASSESSMENT_RULE_VERSION, assessmentSchema } from './tesco-identity-assessment';

type Row = Record<string, unknown>;

// Fake Supabase: records RPC calls, serves selector reads + the reusable-
// verification read, and lets a test control finalise outcomes.
function makeFakeSb(opts: {
  mappings: Row[]; latest: Row[]; receipts: Row[]; recent: Row[]; verifications?: Row[];
  finaliseResult?: (args: Row) => { finalised: boolean };
}): { sb: SupabaseClient; calls: Array<{ fn: string; args: Row }> } {
  const calls: Array<{ fn: string; args: Row }> = [];
  const table = (name: string) => {
    const dataFor = (): Row[] => name === 'store_products' ? opts.mappings
      : name === 'latest_prices' ? opts.latest
      : name === 'scrape_product_receipts' ? opts.receipts
      : name === 'tesco_identity_verifications' ? (opts.verifications ?? [])
      : name === 'tesco_direct_collection_pages' ? opts.recent : [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain; builder.eq = chain; builder.not = chain; builder.gte = chain;
    builder.is = chain; builder.order = chain;
    builder.limit = async () => ({ data: dataFor(), error: null });
    builder.range = async (from: number) => ({ data: from === 0 ? dataFor() : [], error: null });
    return builder;
  };
  const sb = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: Row) => {
      calls.push({ fn, args });
      if (fn === 'apify_begin_tesco_run') return { data: 'run-1', error: null };
      if (fn === 'apify_reserve_tesco_request') return { data: true, error: null };
      if (fn === 'apify_record_tesco_page') return { data: { finalised: false }, error: null };
      if (fn === 'apify_finalise_tesco_page') {
        const r = opts.finaliseResult ? opts.finaliseResult(args) : { finalised: true };
        return { data: r, error: null };
      }
      if (fn === 'apify_record_identity_verification') return { data: 'ver-1', error: null };
      if (fn === 'apify_close_tesco_run') return { data: null, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
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

function okFetch(it: ApifyItem, preconditionMet = true): (url: string) => Promise<ApifyFetchResult> {
  return async (url: string) => ({
    response: { outcome: 'ok', status: 200, finalUrl: url, html: renderApifyProductPage(url, it), retryAfter: null, elapsedMs: 10 },
    provider: {
      provider: 'apify', actorId: 'A', actorBuildId: 'B', actorBuildNumber: '1', runId: 'r', datasetId: 'd',
      requestedUrl: url, sku: String(it.product_id), bodySha256: 'a'.repeat(64), scrapedAt: it.scraped_at as string,
      rawItem: it, rawItemSha256: 'b'.repeat(64),
      freshness: { scrapedAt: it.scraped_at as string, requestSubmittedAt: new Date(Date.now() - 1000).toISOString(),
        afterSubmit: preconditionMet, productScrapedEvents: 1,
        level: preconditionMet ? 'after_submit_precondition_met' : 'not_after_submit',
        perItemPreconditionMet: preconditionMet, reason: 'test' },
    },
  });
}

// Audit client whose re-run advances scraped_at (establishes live behaviour).
const advancingAudit: ApifyAuditClient = {
  runProductUrls: async () => ({ items: [{ product_id: '254877356', scraped_at: new Date(Date.now() + 60_000).toISOString() }] }),
};
// Audit client that does NOT advance (static/replay) → batch held.
const staticAudit: ApifyAuditClient = {
  runProductUrls: async () => ({ items: [{ product_id: '254877356', scraped_at: '2000-01-01T00:00:00Z' }] }),
};

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

const baseDeps = (sb: SupabaseClient, fetchApify: (u: string) => Promise<ApifyFetchResult>, over: Record<string, unknown> = {}) => ({
  sb, fetchApify, auditClient: advancingAudit, budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
  assessOptions: { runModel: aiRunner('verified_exact') as never }, ...over,
});

describe('collectTescoApify — identity + AI inference acceptance path', () => {
  it('finalises a new/changed mapping only when AI + deterministic agree, after the batch freshness audit', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item())));
    expect(res.accepted).toBe(1);
    // record (p_accept false, staged) then a SEPARATE finalise after the audit.
    expect(calls.some(c => c.fn === 'apify_record_tesco_page' && c.args.p_accept === false)).toBe(true);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(true);
    expect(calls.some(c => c.fn === 'apify_record_identity_verification')).toBe(true);
  });

  it('HOLDS when the AI rejects, even though the deterministic gate would pass (fail-closed)', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), {
      assessOptions: { runModel: aiRunner('rejected', { flavour_formulation_matches: false }) as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS when the AI is uncertain', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), {
      assessOptions: { runModel: aiRunner('uncertain') as never },
    }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
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

describe('collectTescoApify — freshness audit (defect 1)', () => {
  it('HOLDS the whole batch when the per-batch freshness audit does not advance', async () => {
    const fx = fixtures();
    const { sb, calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { auditClient: staticAudit }));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
    expect(res.stopped).toBe('freshness_not_established');
    // Never finalised.
    expect(calls.some(c => c.fn === 'apify_finalise_tesco_page')).toBe(false);
  });

  it('HOLDS when per-item freshness precondition fails (no finalise, no audit needed)', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item(), /*preconditionMet*/ false)));
    expect(res.accepted).toBe(0);
    expect(res.held).toBe(1);
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
      sb: second.sb, fetchApify: okFetch(item()), auditClient: advancingAudit, budgetUsd: 10, perRequestUsd: 0.002,
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

describe('collectTescoApify — budget + reservation (defects 4 + 5)', () => {
  it('stops before the next request + required audit could exceed the budget', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { budgetUsd: 0.001, perRequestUsd: 0.002 }));
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
  });

  it('honours durable prior spend (spentUsd) when enforcing the cap', async () => {
    const fx = fixtures();
    const { sb } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const res = await collectTescoApify('renewal', 10, baseDeps(sb, okFetch(item()), { budgetUsd: 10, perRequestUsd: 0.002, spentUsd: 9.999 }));
    expect(res.requested).toBe(0);
    expect(res.stopped).toBe('budget_exhausted');
  });

  it('skips a product the reservation RPC refuses (recently attempted) without fetching', async () => {
    const fx = fixtures();
    const { calls } = makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent });
    const sb2 = {
      from: makeFakeSb({ mappings: fx.mappings, latest: fx.latest, receipts: fx.receipts, recent: fx.recent }).sb.from,
      rpc: async (fn: string, args: Row) => {
        calls.push({ fn, args });
        if (fn === 'apify_begin_tesco_run') return { data: 'run-1', error: null };
        if (fn === 'apify_reserve_tesco_request') return { data: null, error: { message: 'attempt_already_recorded' } };
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;
    let fetched = 0;
    const res = await collectTescoApify('renewal', 10, {
      sb: sb2, fetchApify: async (u) => { fetched++; return okFetch(item())(u); },
      auditClient: advancingAudit, budgetUsd: 10, perRequestUsd: 0.002, sleep: async () => {},
      assessOptions: { runModel: aiRunner('verified_exact') as never },
    });
    expect(fetched).toBe(0);
    expect(res.requested).toBe(0);
  });
});
