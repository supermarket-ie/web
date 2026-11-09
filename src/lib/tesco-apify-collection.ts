// Unattended Tesco Apify collection runner (ECS Fargate).
//
// Drives ordinary RENEWAL / EXPANSION of existing proven mappings through the
// Apify provider, using the service_role PostgREST RPC transport added in
// migration 20261108200000. Every guarded transaction boundary is a granted
// RPC (apify_begin_tesco_run / apify_reserve_tesco_request /
// apify_record_tesco_page / apify_close_tesco_run) — no arbitrary SQL, no
// reentry-approval path, no Clubcard/promo price. Identity is validated in
// TypeScript against the fresh Apify page using the SAME deterministic gate the
// supervised collector uses (validateTescoCollectedIdentity); a result is
// finalised only when identity passes AND the minimum established freshness is
// met. Everything else holds.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseTescoCollectedPage,
  tescoPauseUntil,
  tescoResourceUnavailable,
  validateTescoCollectedIdentity,
  type TescoCollectedPage,
  type TescoCollectedProduct,
  type TescoPageResponse,
} from './tesco-direct-collection-core';
import type { TescoMappingEvidence } from './tesco-mapping-audit';
import {
  assessAndCombine,
  identityFingerprint,
  IDENTITY_ASSESSMENT_RULE_VERSION,
  type AssessOptions,
} from './tesco-identity-assessment';
import type { ReentryEvidence } from './tesco-hold-reentry';
import type { ApifyProviderIdentity } from './tesco-apify-fetch';

export const APIFY_GATE = 'apify-tesco-ie-20261108';

export type ApifyCollectionMode = 'renewal' | 'expansion';

export type ApifyMapping = {
  id: string;
  product_id: string;
  canonical_name: string;
  canonical_brand: string | null;
  canonical_ean: string | null;
  store_product_name: string;
  store_brand: string | null;
  is_own_brand: boolean;
  store_sku: string;
  store_url: string;
  url_status: string;
  gtin: string | null;
  observed_at: string | null;
  price: number | null;
  peerCanonicalNames: string[];
  sameSkuCount: number;
};

export type ApifyFetchResult = { response: TescoPageResponse; provider: ApifyProviderIdentity | null };

export type ApifyCollectionDeps = {
  sb: SupabaseClient;
  // Runs the Apify fetch for one URL and returns the page response plus the
  // captured provider identity (original payload + hash + freshness).
  fetchApify: (url: string) => Promise<ApifyFetchResult>;
  // Budget guard in USD, enforced against DURABLE accounting (actual provider
  // charges reconciled from the provider API) + this run's requests. The loop
  // stops before the next request could exceed the cap.
  budgetUsd: number;
  perRequestUsd: number;
  // USD already spent by this campaign BEFORE this invocation (durable; read by
  // the caller from provider-evidence accounting). Defaults 0.
  spentUsd?: number;
  // AI inference options (model/runner). When omitted, the real Bedrock model
  // is used by assessAndCombine. Injectable for tests.
  assessOptions?: AssessOptions;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: Record<string, unknown>) => void;
};

async function rpc<T = unknown>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// Select eligible mappings for the mode via PostgREST reads (no arbitrary SQL).
// Mirrors the supervised eligibility: resolved + proven + due/not-observed, not
// recently attempted. Shared-SKU groups are deferred (one-to-one guard).
export async function selectApifyMappings(
  sb: SupabaseClient,
  mode: ApifyCollectionMode,
  limit: number,
): Promise<ApifyMapping[]> {
  // Pull resolved tesco mappings with canonical identity.
  const mappings: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('store_products')
      .select('id,product_id,store_sku,store_url,store_product_name,brand,is_own_brand,url_status,gtin,products(canonical_name,brand,ean)')
      .eq('store', 'tesco').eq('url_status', 'resolved').not('store_sku', 'is', null)
      .order('id').range(offset, offset + 999);
    if (error) throw new Error(`Loading Tesco mappings: ${error.message}`);
    mappings.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  // Freshness + proven + recent-attempt lookups.
  const fresh = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('latest_prices').select('store_product_id,observed_at,price')
      .eq('store', 'tesco').order('store_product_id').range(offset, offset + 999);
    if (error) throw new Error(`Loading freshness: ${error.message}`);
    for (const r of data ?? []) fresh.set(String(r.store_product_id), String(r.observed_at));
    if ((data ?? []).length < 1000) break;
  }
  const priceByMapping = new Map<string, number | null>();
  for (let offset = 0; ; offset += 1000) {
    const { data } = await sb.from('latest_prices').select('store_product_id,price')
      .eq('store', 'tesco').order('store_product_id').range(offset, offset + 999);
    for (const r of data ?? []) priceByMapping.set(String(r.store_product_id), r.price == null ? null : Number(r.price));
    if ((data ?? []).length < 1000) break;
  }
  const proven = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('scrape_product_receipts').select('store_product_id,outcome')
      .eq('outcome', 'success').order('store_product_id').range(offset, offset + 999);
    if (error) throw new Error(`Loading receipts: ${error.message}`);
    for (const r of data ?? []) proven.add(String(r.store_product_id));
    if ((data ?? []).length < 1000) break;
  }
  // Recently attempted / pending URLs (24h) to exclude up front (the RPC also
  // re-checks this, but we avoid wasting Apify runs on them).
  const recentUrls = new Set<string>();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('tesco_direct_collection_pages')
      .select('requested_url,created_at,outcome').gte('created_at', since)
      .order('created_at', { ascending: false }).range(offset, offset + 999);
    if (error) throw new Error(`Loading recent attempts: ${error.message}`);
    for (const r of data ?? []) recentUrls.add(String(r.requested_url));
    if ((data ?? []).length < 1000) break;
  }

  const canonical = (r: Record<string, unknown>) => (Array.isArray(r.products) ? r.products[0] : r.products) as Record<string, unknown> | undefined;
  // Same-SKU group sizes (defer shared-SKU, one-to-one guard).
  const skuGroups = new Map<string, Record<string, unknown>[]>();
  for (const r of mappings) {
    const sku = String(r.store_sku);
    skuGroups.set(sku, [...(skuGroups.get(sku) ?? []), r]);
  }

  const rows: ApifyMapping[] = [];
  for (const r of mappings) {
    const id = String(r.id);
    const sku = String(r.store_sku);
    const url = `https://www.tesco.ie/shop/en-IE/products/${sku}`;
    if (String(r.store_url) !== url) continue;
    if (!proven.has(id)) continue;                        // only proven mappings
    if (recentUrls.has(url)) continue;                    // pending/recent exclusion
    const group = skuGroups.get(sku) ?? [];
    if (group.length > 1) continue;                       // defer shared-SKU
    const observedAt = fresh.get(id) ?? null;
    if (mode === 'renewal') {
      if (!observedAt || Date.parse(observedAt) > Date.now() - 4 * 24 * 3600_000) continue;
    } else if (observedAt) continue;                      // expansion needs no prior observation
    const c = canonical(r);
    rows.push({
      id, product_id: String(r.product_id),
      canonical_name: String(c?.canonical_name ?? ''), canonical_brand: (c?.brand as string) ?? null,
      canonical_ean: (c?.ean as string) ?? null,
      store_product_name: String(r.store_product_name ?? ''), store_brand: (r.brand as string) ?? null,
      is_own_brand: r.is_own_brand === true, store_sku: sku, store_url: url, url_status: 'resolved',
      gtin: (r.gtin as string) ?? null,
      observed_at: observedAt, price: priceByMapping.get(id) ?? null,
      peerCanonicalNames: group.map(g => String((canonical(g))?.canonical_name ?? '')),
      sameSkuCount: group.length,
    });
  }
  // Renewal: oldest first (closest to expiry). Expansion: stable by id.
  rows.sort((a, b) => mode === 'renewal'
    ? (a.observed_at ?? '').localeCompare(b.observed_at ?? '') || a.id.localeCompare(b.id)
    : a.id.localeCompare(b.id));
  return rows.slice(0, limit);
}

function mappingEvidence(m: ApifyMapping): TescoMappingEvidence {
  return {
    storeProductId: m.id, canonicalName: m.canonical_name, canonicalBrand: m.canonical_brand,
    storeProductName: m.store_product_name, storeBrand: m.store_brand, isOwnBrand: m.is_own_brand,
    storeSku: m.store_sku, storeUrl: m.store_url, duplicateSkuCount: m.sameSkuCount,
    duplicateCanonicalNames: m.peerCanonicalNames, isFresh: !!m.observed_at,
  };
}

// A ReentryEvidence envelope wrapping the mapping + the fresh live product, for
// the independent AI assessment (assessAndCombine). Peers are empty: this path
// verifies Tesco identity only (never a cross-retailer price comparison), and
// the AI never overrides a deterministic rejection.
function assessmentEvidence(m: ApifyMapping, pageId: string, bodySha256: string, live: TescoCollectedProduct): ReentryEvidence {
  return {
    mapping: {
      id: m.id, product_id: m.product_id, canonical_name: m.canonical_name,
      canonical_brand: m.canonical_brand, canonical_ean: m.canonical_ean,
      store_product_name: m.store_product_name, store_brand: m.store_brand,
      is_own_brand: m.is_own_brand, store_sku: m.store_sku, store_url: m.store_url,
      url_status: m.url_status, gtin: m.gtin,
    },
    sameSkuCount: m.sameSkuCount, proven: true, freshTesco: false, pending: false, recentAttempt: false,
    page: {
      id: pageId, requested_url: m.store_url, final_url: m.store_url, outcome: 'ok', http_status: 200,
      body_sha256: bodySha256, mode: 'products', parsed: { products: [live], listing: null },
    },
    sourceRun: { status: 'success', finished_at: new Date().toISOString() },
    peers: [],
  };
}

export type ReusableVerification = {
  identity_fingerprint: string;
  rule_version: string;
  reusable_until: string;
  invalidated_at: string | null;
} | null;

// Read the ACTIVE reusable identity verification for a mapping (defect 3). A
// renewal may reuse a cheap deterministic check ONLY when a stored verification
// exists AND binds to the unchanged canonical/mapping/live identity fingerprint,
// the current rule version, has not expired, and is not invalidated/held.
export async function readActiveVerification(sb: SupabaseClient, storeProductId: string): Promise<ReusableVerification> {
  const { data, error } = await sb.from('tesco_identity_verifications')
    .select('identity_fingerprint,rule_version,reusable_until,invalidated_at')
    .eq('store_product_id', storeProductId).is('invalidated_at', null)
    .order('verified_at', { ascending: false }).limit(1);
  if (error) throw new Error(`Reading identity verification: ${error.message}`);
  return (data?.[0] as ReusableVerification) ?? null;
}

export function verificationReusable(v: ReusableVerification, liveFingerprint: string): boolean {
  return !!v && v.invalidated_at == null
    && v.identity_fingerprint === liveFingerprint
    && v.rule_version === IDENTITY_ASSESSMENT_RULE_VERSION
    && Date.parse(v.reusable_until) > Date.now();
}

export type ApifyCollectionResult = {
  runId: string;
  mode: ApifyCollectionMode;
  requested: number;
  accepted: number;
  held: number;
  unavailable: number;
  stopped: string | null;
  spentUsd: number;
  perProduct: Array<{
    storeProductId: string; sku: string; outcome: string; accepted: boolean;
    reasons: string[]; price: number | null; freshness: string | null;
  }>;
};

export async function collectTescoApify(
  mode: ApifyCollectionMode,
  limit: number,
  deps: ApifyCollectionDeps,
): Promise<ApifyCollectionResult> {
  const { sb } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const owner = `fargate-${createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 24)}`;
  let spentUsd = deps.spentUsd ?? 0;

  const mappings = await selectApifyMappings(sb, mode, limit);
  const result: ApifyCollectionResult = {
    runId: '', mode, requested: 0, accepted: 0, held: 0, unavailable: 0, stopped: null, spentUsd, perProduct: [],
  };
  if (!mappings.length) { result.stopped = 'no_eligible_products'; return result; }

  const begin = await rpc<{ runId: string; leaseToken: string }>(sb, 'apify_begin_tesco_run', {
    p_egress_key: APIFY_GATE, p_mode: mode, p_target_count: mappings.length, p_owner: owner,
  });
  const runId = begin.runId;
  const leaseToken = begin.leaseToken;
  result.runId = runId;
  deps.log?.({ event: 'run_started', runId, mode, eligible: mappings.length });

  // Finalisation is a SEPARATE fencing-token-guarded RPC (apify_finalise), so we
  // stage accepted items during the loop and finalise them after recording.
  // There is no per-batch freshness audit (removed: a second actor run advancing
  // scraped_at proves nothing). Freshness is the per-item best-available
  // precondition only, carried with its documented limitation.
  const staged: Array<{ m: ApifyMapping; product: TescoCollectedProduct; adapterBody: string;
    method: 'deterministic' | 'deterministic_plus_ai'; rationale: string; model: string | null;
    fingerprint: string }> = [];

  try {
    for (const m of mappings) {
      // Budget guard (defect 5): stop before the next request would exceed the
      // cap. spentUsd is seeded by the caller from ACTUAL reconciled provider
      // charges (all run statuses), so this holds across invocations.
      if (spentUsd + deps.perRequestUsd > deps.budgetUsd) { result.stopped = 'budget_exhausted'; break; }

      if (result.requested > 0) await sleep(10_000);

      // Reserve (atomic guard: ownership, mode, due/observation, pending/recent, pacing).
      try {
        await rpc(sb, 'apify_reserve_tesco_request', {
          p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
          p_store_product_id: m.id, p_store_url: m.store_url, p_mode: mode,
        });
      } catch (e) {
        deps.log?.({ event: 'reserve_skipped', sku: m.store_sku, reason: (e as Error).message });
        continue;
      }

      const { response, provider } = await deps.fetchApify(m.store_url);
      spentUsd += deps.perRequestUsd;
      result.requested += 1;

      let parsed: TescoCollectedPage | null = null;
      let outcome: string = response.outcome;
      try { if (outcome === 'ok') parsed = parseTescoCollectedPage(response.html, response.finalUrl); }
      catch { outcome = 'parse_error'; }
      const product: TescoCollectedProduct | undefined = parsed?.products.find(p => p.sku === m.store_sku);
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      const adapterBody = createHash('sha256').update(response.html).digest('hex');

      // --- Identity + inference acceptance path (defects 2 + 3) ---
      // Deterministic gate FIRST (authoritative; AI can never override a reject).
      const deterministicReasons = product
        ? validateTescoCollectedIdentity(mappingEvidence(m), product)
        : ['missing_exact_product'];
      // Best-available freshness precondition (provider-asserted; see
      // APIFY_FRESHNESS_LIMITATION — not independently verified).
      const perItemFreshOk = provider?.freshness.preconditionMet === true;

      let decision: 'accept_pending_finalise' | 'hold' = 'hold';
      let method: 'deterministic' | 'deterministic_plus_ai' = 'deterministic';
      let rationale = '';
      let model: string | null = null;
      let liveFingerprint = '';
      const reasons = [...deterministicReasons];

      if (outcome === 'ok' && product && perItemFreshOk && deterministicReasons.length === 0) {
        liveFingerprint = identityFingerprint({
          canonical: { name: m.canonical_name, brand: m.canonical_brand, ean: m.canonical_ean },
          tesco: { sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin, quantity: product.quantity },
        });
        // Reuse path (defect 3): an UNCHANGED, previously-verified mapping in
        // RENEWAL may use the cheap deterministic check alone.
        const existing = await readActiveVerification(sb, m.id);
        const reuse = mode === 'renewal' && verificationReusable(existing, liveFingerprint);
        if (reuse) {
          decision = 'accept_pending_finalise';
          method = 'deterministic';
          rationale = 'Unchanged mapping: reused active identity verification; deterministic renewal check passed against fresh evidence.';
        } else {
          // New, changed or uncertain → run the independent AI inference and
          // require BOTH it and the deterministic gate to agree (and its own
          // facts to be internally consistent, and bound to this identity).
          const ev = assessmentEvidence(m, runId, adapterBody, product);
          const verdict = await assessAndCombine(ev, product, runId, deps.assessOptions);
          model = verdict.assessment.model;
          if (verdict.decision === 'verified_exact' && verdict.machineAssessment
            && verdict.assessment.identity_fingerprint === liveFingerprint) {
            decision = 'accept_pending_finalise';
            method = 'deterministic_plus_ai';
            rationale = verdict.machineAssessment.reason;
          } else {
            reasons.push(`ai_${verdict.decision}`);
            if (verdict.holdReason) deps.log?.({ event: 'ai_hold', sku: m.store_sku, holdReason: verdict.holdReason });
          }
        }
      } else if (outcome === 'ok' && product && !perItemFreshOk) {
        reasons.push('freshness_precondition_not_met');
      }

      const pauseUntil = transportStop
        ? tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter)
        : null;
      const blocked = response.outcome === 'access_block';
      const providerJson = provider ? {
        sku: provider.sku, actorId: provider.actorId, actorBuildId: provider.actorBuildId,
        actorBuildNumber: provider.actorBuildNumber, runId: provider.runId, datasetId: provider.datasetId,
        rawItem: provider.rawItem, rawItemSha256: provider.rawItemSha256,
        scrapedAt: provider.scrapedAt, freshness: provider.freshness,
        freshnessVerified: false, // set true only after the batch audit establishes it
      } : null;

      // Record the page NOW (evidence ONLY — the record RPC can never write a
      // price). Finalisation is a separate, fencing-token-guarded RPC that runs
      // after the per-batch freshness audit.
      await rpc(sb, 'apify_record_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
        p_store_product_id: m.id, p_store_url: m.store_url, p_mode: mode,
        p_outcome: outcome, p_http_status: response.status, p_retry_after: response.retryAfter,
        p_elapsed_ms: response.elapsedMs, p_adapter_body_sha256: adapterBody,
        p_parsed: parsed, p_identity_results: [{ storeProductId: m.id, sku: m.store_sku, reasons }],
        p_detail: {
          provider: 'apify',
          disposition: decision === 'accept_pending_finalise' ? 'accept_pending_finalise' : outcome === 'ok' ? 'hold_continue' : undefined,
          resourceUnavailable: unavailable || undefined, freshness: provider?.freshness.level ?? null,
          method, evidenceOrigin: 'synthetic-apify-adapter',
        },
        p_pause: !!pauseUntil, p_pause_until: pauseUntil, p_blocked: blocked,
        p_provider: providerJson,
      });

      if (decision === 'accept_pending_finalise' && product) {
        staged.push({ m, product, adapterBody, method, rationale, model, fingerprint: liveFingerprint });
      } else {
        result.perProduct.push({ storeProductId: m.id, sku: m.store_sku, outcome, accepted: false,
          reasons, price: null, freshness: provider?.freshness.level ?? null });
        if (unavailable) result.unavailable += 1; else if (outcome === 'ok') result.held += 1;
      }
      deps.log?.({ event: 'product', sku: m.store_sku, outcome, decision, method, reasons });
      if (pauseUntil) { result.stopped = outcome; break; }
    }

    // --- Staged finalisation (defect 4: fencing-token + atomic snapshot recheck) ---
    // Each staged item is finalised through apify_finalise_tesco_page, which
    // re-fences the lease, looks the ok page up BY MAPPING, rechecks the
    // immutable mapping snapshot and due/observation atomically before writing.
    for (const s of staged) {
      const rec = await rpc<{ finalised: boolean }>(sb, 'apify_finalise_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
        p_store_product_id: s.m.id, p_mode: mode,
        p_regular_price: s.product.price, p_previous_price: s.m.price,
        p_store_product_name: s.product.name,
      });
      if (rec?.finalised) {
        result.accepted += 1;
        await rpc(sb, 'apify_record_identity_verification', {
          p_store_product_id: s.m.id, p_identity_fingerprint: s.fingerprint,
          p_canonical: { name: s.m.canonical_name, brand: s.m.canonical_brand, ean: s.m.canonical_ean },
          p_tesco: { sku: s.product.sku, name: s.product.name, brand: s.product.brand, gtin: s.product.gtin, quantity: s.product.quantity },
          p_rationale: s.rationale, p_method: s.method, p_rule_version: IDENTITY_ASSESSMENT_RULE_VERSION,
          p_model: s.model, p_source_page_id: null, p_source_body_sha256: s.adapterBody, p_reusable_hours: 720,
        });
        result.perProduct.push({ storeProductId: s.m.id, sku: s.m.store_sku, outcome: 'ok',
          accepted: true, reasons: [], price: s.product.price, freshness: s.method });
      } else {
        result.held += 1;
        result.perProduct.push({ storeProductId: s.m.id, sku: s.m.store_sku, outcome: 'ok',
          accepted: false, reasons: ['finalise_recheck_failed'], price: null, freshness: s.method });
      }
    }
  } finally {
    await rpc(sb, 'apify_close_tesco_run', {
      p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
      p_stop_reason: result.stopped ?? 'complete',
    }).catch(() => undefined);
  }
  result.spentUsd = spentUsd;
  return result;
}
