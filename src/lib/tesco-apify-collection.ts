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
import { identityFingerprint, IDENTITY_ASSESSMENT_RULE_VERSION } from './tesco-identity-assessment';
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
  // Budget guard in USD; the loop stops before exceeding it. The caller feeds
  // the per-request marginal cost estimate.
  budgetUsd: number;
  perRequestUsd: number;
  spentUsd?: number;
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

  const runId = await rpc<string>(sb, 'apify_begin_tesco_run', {
    p_egress_key: APIFY_GATE, p_mode: mode, p_target_count: mappings.length, p_owner: owner,
  });
  result.runId = runId;
  deps.log?.({ event: 'run_started', runId, mode, eligible: mappings.length });

  try {
    for (const m of mappings) {
      // Budget guard: stop before the next request would exceed the cap.
      if (spentUsd + deps.perRequestUsd > deps.budgetUsd) { result.stopped = 'budget_exhausted'; break; }

      // Pacing: 10s between requests (the RPC also enforces it).
      if (result.requested > 0) await sleep(10_000);

      // Reserve the request (atomic guard: ownership, due, pending/recent, pacing).
      try {
        await rpc(sb, 'apify_reserve_tesco_request', {
          p_run_id: runId, p_egress_key: APIFY_GATE, p_owner: owner,
          p_store_product_id: m.id, p_store_url: m.store_url, p_mode: mode,
        });
      } catch (e) {
        // A reservation refusal (recently attempted, not due, etc.) skips this
        // product without a fetch; continue the batch.
        deps.log?.({ event: 'reserve_skipped', sku: m.store_sku, reason: (e as Error).message });
        continue;
      }

      // Fetch via Apify (one run == one request == one budget unit).
      const { response, provider } = await deps.fetchApify(m.store_url);
      spentUsd += deps.perRequestUsd;
      result.requested += 1;

      let parsed: TescoCollectedPage | null = null;
      let outcome: string = response.outcome;
      try { if (outcome === 'ok') parsed = parseTescoCollectedPage(response.html, response.finalUrl); }
      catch { outcome = 'parse_error'; }
      const product: TescoCollectedProduct | undefined = parsed?.products.find(p => p.sku === m.store_sku);

      // Identity gate (same deterministic validator the supervised collector uses).
      const reasons = product
        ? validateTescoCollectedIdentity(mappingEvidence(m), product)
        : ['missing_exact_product'];
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      // Freshness is REQUIRED to finalise: advancing timestamps or billing alone
      // do not qualify. The transport already fails-closed (holds as a transport
      // error when the per-request proof fails); this is belt-and-braces so a
      // relaxed transport can never cause a stale finalisation here.
      const freshnessOk = provider?.freshness.requiredFreshnessMet === true;
      const accept = outcome === 'ok' && !!product && reasons.length === 0 && freshnessOk;

      const pauseUntil = transportStop
        ? tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter)
        : null;
      const blocked = response.outcome === 'access_block';

      const adapterBody = createHash('sha256').update(response.html).digest('hex');
      const providerJson = provider ? {
        sku: provider.sku, actorId: provider.actorId, actorBuildId: provider.actorBuildId,
        actorBuildNumber: provider.actorBuildNumber, runId: provider.runId, datasetId: provider.datasetId,
        rawItem: provider.rawItem, rawItemSha256: provider.rawItemSha256,
        scrapedAt: provider.scrapedAt, freshness: provider.freshness,
        freshnessVerified: provider.freshness.requiredFreshnessMet,
      } : null;

      const rec = await rpc<{ finalised: boolean; paused?: boolean }>(sb, 'apify_record_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_owner: owner,
        p_store_product_id: m.id, p_store_url: m.store_url, p_mode: mode,
        p_outcome: outcome, p_http_status: response.status, p_retry_after: response.retryAfter,
        p_elapsed_ms: response.elapsedMs, p_adapter_body_sha256: adapterBody,
        p_parsed: parsed, p_identity_results: [{ storeProductId: m.id, sku: m.store_sku, reasons }],
        p_detail: {
          provider: 'apify', disposition: accept ? 'accept' : outcome === 'ok' ? 'hold_continue' : undefined,
          resourceUnavailable: unavailable || undefined, freshness: provider?.freshness.level ?? null,
          evidenceOrigin: 'synthetic-apify-adapter',
        },
        p_accept: accept, p_regular_price: accept ? product!.price : null, p_previous_price: m.price,
        p_store_sku: m.store_sku, p_store_product_name: product?.name ?? m.store_product_name,
        p_pause: !!pauseUntil, p_pause_until: pauseUntil, p_blocked: blocked,
        p_provider: providerJson,
      });

      // Persist / refresh the reusable identity verification on acceptance.
      if (accept && product) {
        const fp = identityFingerprint({
          canonical: { name: m.canonical_name, brand: m.canonical_brand, ean: m.canonical_ean },
          tesco: { sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin, quantity: product.quantity },
        });
        await rpc(sb, 'apify_record_identity_verification', {
          p_store_product_id: m.id, p_identity_fingerprint: fp,
          p_canonical: { name: m.canonical_name, brand: m.canonical_brand, ean: m.canonical_ean },
          p_tesco: { sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin, quantity: product.quantity },
          p_rationale: 'Deterministic identity gate (validateTescoCollectedIdentity) passed against fresh Apify evidence.',
          p_method: 'deterministic', p_rule_version: IDENTITY_ASSESSMENT_RULE_VERSION, p_model: null,
          p_source_page_id: null, p_source_body_sha256: adapterBody, p_reusable_hours: 720,
        });
      }

      result.perProduct.push({
        storeProductId: m.id, sku: m.store_sku, outcome, accepted: accept,
        reasons, price: accept ? (product?.price ?? null) : null,
        freshness: provider?.freshness.level ?? null,
      });
      if (rec?.finalised) result.accepted += 1;
      else if (unavailable) result.unavailable += 1;
      else if (outcome === 'ok') result.held += 1;

      deps.log?.({ event: 'product', sku: m.store_sku, outcome, accepted: !!rec?.finalised, reasons });

      // Transport stop ends the batch (gate paused by the RPC).
      if (pauseUntil) { result.stopped = outcome; break; }
    }
  } finally {
    await rpc(sb, 'apify_close_tesco_run', {
      p_run_id: runId, p_egress_key: APIFY_GATE, p_owner: owner,
      p_stop_reason: result.stopped ?? 'complete',
    }).catch(() => undefined);
  }
  result.spentUsd = spentUsd;
  return result;
}
