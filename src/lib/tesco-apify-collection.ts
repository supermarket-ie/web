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
import { independentExactIdentity, type ReentryEvidence } from './tesco-hold-reentry';
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
  // The authoritative server-computed mapping snapshot at SELECTION time
  // (apify_mapping_snapshot). Passed to reserve as the expected snapshot so a
  // change between selection/assessment and reservation is rejected.
  snapshot: Record<string, unknown> | null;
  // FRESH Dunnes/SuperValu peers sharing this canonical product_id (<=2, one
  // per store, priced within the freshness window), shaped for
  // independentExactIdentity. Used ONLY to corroborate the Tesco item's
  // identity (brand/title/quantity/pack) — never a cross-retailer price claim.
  peers: ApifyPeer[];
};

export type ApifyPeer = {
  id: string; store: string; store_product_name: string; brand: string | null;
  gtin: string | null; store_sku: string; observed_at: string; price: number;
};

export type ApifyFetchResult = { response: TescoPageResponse; provider: ApifyProviderIdentity | null };

export type ApifyCollectionDeps = {
  sb: SupabaseClient;
  // Runs the Apify fetch for one URL with an explicit provider-side monetary
  // ceiling (maxChargeUsd) — the amount reserved for THIS request. The actor's
  // maxTotalChargeUsd must not exceed it.
  fetchApify: (url: string, maxChargeUsd: number) => Promise<ApifyFetchResult>;
  // Campaign identifier for the DURABLE budget reservation ledger.
  campaign: string;
  // Hard campaign cap in USD. Each provider launch RESERVES perRequestUsd first
  // (apify_reserve_budget); the reservation is retained while the request is
  // running/uncertain and reconciled to the actual charge on settle. The loop
  // stops when a reservation would exceed the cap.
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
      snapshot: null, // filled below from the authoritative server snapshot
      peers: [],      // filled below from fresh Dunnes/SuperValu peers
    });
  }
  // Renewal: oldest first (closest to expiry). Expansion: stable by id.
  rows.sort((a, b) => mode === 'renewal'
    ? (a.observed_at ?? '').localeCompare(b.observed_at ?? '') || a.id.localeCompare(b.id)
    : a.id.localeCompare(b.id));
  const selected = rows.slice(0, limit);
  // Capture the authoritative server snapshot at SELECTION time for each chosen
  // mapping, so selection/assessment/reservation all reference the SAME value.
  for (const m of selected) {
    const { data, error } = await sb.rpc('apify_mapping_snapshot', { p_store_product_id: m.id });
    if (error) throw new Error(`Reading mapping snapshot: ${error.message}`);
    m.snapshot = (data as Record<string, unknown>) ?? null;
  }
  // Load FRESH Dunnes/SuperValu peers for the selected mappings' canonical
  // products. These corroborate the Tesco item's identity (brand/title/
  // quantity/pack) through independentExactIdentity — the cross-retailer
  // evidence the identity rules are designed to use. Only priced peers inside
  // the freshness window qualify; capped to one per store (freshest).
  await attachFreshPeers(sb, selected);
  return selected;
}

// Freshness window for peer corroboration — matches the 7-day latest_prices
// window used elsewhere; a stale peer is not independent evidence.
const PEER_FRESH_DAYS = 7;

export async function attachFreshPeers(sb: SupabaseClient, mappings: ApifyMapping[]): Promise<void> {
  if (!mappings.length) return;
  const productIds = [...new Set(mappings.map(m => m.product_id))];
  const now = Date.now();
  const byProduct = new Map<string, ApifyPeer[]>();
  for (let i = 0; i < productIds.length; i += 50) {
    const chunk = productIds.slice(i, i + 50);
    const { data, error } = await sb.from('store_products')
      .select('id,product_id,store,store_sku,store_product_name,brand,gtin,latest_prices(observed_at,price)')
      .in('product_id', chunk).in('store', ['dunnes', 'supervalu']);
    if (error) throw new Error(`Loading peers: ${error.message}`);
    for (const r of data ?? []) {
      const lp = Array.isArray(r.latest_prices) ? r.latest_prices[0] : (r.latest_prices as Record<string, unknown> | null);
      const observedAt = lp ? String((lp as Record<string, unknown>).observed_at) : null;
      const price = lp ? Number((lp as Record<string, unknown>).price) : 0;
      if (!observedAt || Date.parse(observedAt) <= now - PEER_FRESH_DAYS * 86400_000 || !(price > 0)) continue;
      const pid = String(r.product_id);
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push({
        id: String(r.id), store: String(r.store), store_product_name: String(r.store_product_name ?? ''),
        brand: (r.brand as string) ?? null, gtin: (r.gtin as string) ?? null,
        store_sku: String(r.store_sku ?? ''), observed_at: observedAt, price,
      });
    }
  }
  for (const m of mappings) {
    const all = byProduct.get(m.product_id) ?? [];
    // One peer per store (freshest first), <=2 total — independentExactIdentity
    // requires distinct stores and at most two peers.
    const byStore = new Map<string, ApifyPeer>();
    for (const p of all.sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))) {
      if (!byStore.has(p.store)) byStore.set(p.store, p);
    }
    m.peers = [...byStore.values()];
  }
}

// Material identity derived SOLELY from the authoritative reserved snapshot
// (apify_mapping_snapshot). Every assessment input is reconstructed from here,
// so no stale selection-time field can leak into the decision.
type SnapshotIdentity = {
  storeProductId: string; productId: string; storeSku: string; storeUrl: string;
  canonicalName: string; canonicalBrand: string | null; canonicalEan: string | null;
  storeBrand: string | null; storeProductName: string; isOwnBrand: boolean; gtin: string | null;
  sameSkuCanonicalNames: string[];
};
function snapshotIdentity(snap: Record<string, unknown>): SnapshotIdentity {
  const names = Array.isArray(snap.same_sku_canonical_names)
    ? (snap.same_sku_canonical_names as unknown[]).map(String) : [];
  return {
    storeProductId: String(snap.store_product_id), productId: String(snap.product_id),
    storeSku: String(snap.store_sku), storeUrl: String(snap.store_url),
    canonicalName: String(snap.canonical_name ?? ''), canonicalBrand: (snap.canonical_brand as string) ?? null,
    canonicalEan: (snap.canonical_ean as string) ?? null, storeBrand: (snap.store_brand as string) ?? null,
    storeProductName: String(snap.store_product_name ?? ''), isOwnBrand: snap.is_own_brand === true,
    gtin: (snap.gtin as string) ?? null, sameSkuCanonicalNames: names,
  };
}
function snapshotMappingEvidence(s: SnapshotIdentity, isFresh: boolean): TescoMappingEvidence {
  return {
    storeProductId: s.storeProductId, canonicalName: s.canonicalName, canonicalBrand: s.canonicalBrand,
    storeProductName: s.storeProductName, storeBrand: s.storeBrand, isOwnBrand: s.isOwnBrand,
    storeSku: s.storeSku, storeUrl: s.storeUrl, duplicateSkuCount: Math.max(s.sameSkuCanonicalNames.length, 1),
    duplicateCanonicalNames: s.sameSkuCanonicalNames, isFresh,
  };
}



// A ReentryEvidence envelope wrapping the mapping + the fresh live product, for
// the independent AI assessment (assessAndCombine). Peers are empty: this path
// verifies Tesco identity only (never a cross-retailer price comparison), and
// the AI never overrides a deterministic rejection.
function assessmentEvidence(s: SnapshotIdentity, pageId: string, bodySha256: string, live: TescoCollectedProduct,
  peers: ApifyPeer[] = []): ReentryEvidence {
  return {
    mapping: {
      id: s.storeProductId, product_id: s.productId, canonical_name: s.canonicalName,
      canonical_brand: s.canonicalBrand, canonical_ean: s.canonicalEan,
      store_product_name: s.storeProductName, store_brand: s.storeBrand,
      is_own_brand: s.isOwnBrand, store_sku: s.storeSku, store_url: s.storeUrl,
      url_status: 'resolved', gtin: s.gtin,
    },
    sameSkuCount: Math.max(s.sameSkuCanonicalNames.length, 1), proven: true, freshTesco: false, pending: false, recentAttempt: false,
    page: {
      id: pageId, requested_url: s.storeUrl, final_url: s.storeUrl, outcome: 'ok', http_status: 200,
      body_sha256: bodySha256, mode: 'products', parsed: { products: [live], listing: null },
    },
    sourceRun: { status: 'success', finished_at: new Date().toISOString() },
    // Fresh Dunnes/SuperValu peers corroborate the Tesco IDENTITY only
    // (brand/title/quantity/pack). They never assert a cross-retailer price.
    peers,
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
  const staged: Array<{ ident: SnapshotIdentity; product: TescoCollectedProduct; previousPrice: number | null; adapterBody: string;
    method: 'deterministic' | 'deterministic_plus_ai' | 'deterministic_plus_independent_peer'; rationale: string; model: string | null;
    fingerprint: string; snapshot: Record<string, unknown> | null }> = [];

  try {
    for (const m of mappings) {
      // Durable budget RESERVATION before the provider launch (defect: enforce
      // $cap). Reserve perRequestUsd; if it would exceed the cap the ledger
      // raises and we stop. The reservation is retained until settled, so a
      // crash/uncertain request keeps counting against the cap.
      let reservationId: string | null = null;
      let remainingUsd = deps.budgetUsd;
      try {
        const r = await rpc<{ reservationId: string; remainingUsd: number }>(sb, 'apify_reserve_budget', {
          p_campaign: deps.campaign, p_run_id: runId, p_amount: deps.perRequestUsd, p_cap: deps.budgetUsd,
        });
        reservationId = r.reservationId;
        remainingUsd = r.remainingUsd;
      } catch (e) {
        if (String((e as Error).message).includes('budget_exhausted')) { result.stopped = 'budget_exhausted'; break; }
        throw e;
      }

      if (result.requested > 0) await sleep(10_000);

      // Reserve (atomic guard: ownership, mode, due/observation, pending/recent,
      // pacing) AND snapshot binding: pass the snapshot we SELECTED/assessed
      // against; reserve rejects if the mapping changed since. The authoritative
      // snapshot it returns is what we bind assessment + finalise to.
      let boundSnapshot: Record<string, unknown> | null = null;
      try {
        const reserved = await rpc<{ reserved: boolean; snapshot: Record<string, unknown> }>(sb, 'apify_reserve_tesco_request', {
          p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
          p_store_product_id: m.id, p_store_url: m.store_url, p_mode: mode,
          p_expected_snapshot: m.snapshot,
        });
        boundSnapshot = reserved?.snapshot ?? null;
      } catch (e) {
        // No provider launch happened — release the budget reservation.
        if (reservationId) await rpc(sb, 'apify_settle_budget', { p_reservation_id: reservationId, p_actual_usd: 0, p_provider_run_id: null }).catch(() => undefined);
        deps.log?.({ event: 'reserve_skipped', sku: m.store_sku, reason: (e as Error).message });
        continue;
      }

      // ALL assessment inputs are reconstructed from the single authoritative
      // reserved snapshot — never the stale selection-time fields on `m`.
      const ident = boundSnapshot ? snapshotIdentity(boundSnapshot) : null;
      if (!ident) {
        if (reservationId) await rpc(sb, 'apify_settle_budget', { p_reservation_id: reservationId, p_actual_usd: 0, p_provider_run_id: null }).catch(() => undefined);
        continue;
      }

      // Pass the RESERVED amount as the provider-side ceiling for this request.
      const { response, provider } = await deps.fetchApify(ident.storeUrl, deps.perRequestUsd);
      result.requested += 1;
      // Settle ONLY when a CONFIRMED TERMINAL charge is known: provider identity
      // present, a non-null runUsageUsd, AND runUsageIsTerminal. Provider
      // identity ALONE does not establish billing — a missing cost is UNKNOWN
      // (null) and a completion-time total is PRELIMINARY. In every other case
      // (provider error → no identity; unknown cost; preliminary total) the
      // reservation is RETAINED at its reserved amount until the between-batch
      // terminal reconciliation (reconcileRun) confirms the charge. We never
      // settle a 0/estimate as an actual.
      spentUsd = remainingUsd; // local view; the cap is enforced durably in the ledger
      const terminalCharge = provider && provider.runUsageIsTerminal && provider.runUsageUsd != null
        ? provider.runUsageUsd : null;
      if (reservationId && terminalCharge != null) {
        await rpc(sb, 'apify_settle_budget', {
          p_reservation_id: reservationId,
          p_actual_usd: terminalCharge,
          p_provider_run_id: provider!.runId,
        }).catch(() => undefined);
      } else if (reservationId) {
        // Record the provider run id so the terminal reconciliation can later
        // settle THIS reservation to the confirmed charge; keep it 'reserved'.
        if (provider?.runId) {
          await rpc(sb, 'apify_link_reservation_run', {
            p_reservation_id: reservationId, p_provider_run_id: provider.runId,
          }).catch(() => undefined);
        }
        deps.log?.({ event: 'budget_reservation_retained', sku: ident.storeSku,
          reason: provider ? 'charge not yet terminal/known; reservation kept for reconciliation' : 'provider error; reservation kept' });
      }

      let parsed: TescoCollectedPage | null = null;
      let outcome: string = response.outcome;
      try { if (outcome === 'ok') parsed = parseTescoCollectedPage(response.html, response.finalUrl); }
      catch { outcome = 'parse_error'; }
      const product: TescoCollectedProduct | undefined = parsed?.products.find(p => p.sku === ident.storeSku);
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      const adapterBody = createHash('sha256').update(response.html).digest('hex');

      // --- Identity + inference acceptance path (defects 2 + 3) ---
      // Deterministic gate FIRST (authoritative; AI can never override a reject).
      // Evidence is built from the reserved snapshot identity (ident), NOT `m`.
      const evidenceForGate = snapshotMappingEvidence(ident, !!m.observed_at);
      const deterministicReasons = product
        ? validateTescoCollectedIdentity(evidenceForGate, product)
        : ['missing_exact_product'];
      // Best-available freshness precondition (provider-asserted; see
      // APIFY_FRESHNESS_LIMITATION — not independently verified).
      const perItemFreshOk = provider?.freshness.preconditionMet === true;

      let decision: 'accept_pending_finalise' | 'hold' = 'hold';
      let method: 'deterministic' | 'deterministic_plus_ai' | 'deterministic_plus_independent_peer' = 'deterministic';
      let rationale = '';
      let model: string | null = null;
      let liveFingerprint = '';
      const reasons = [...deterministicReasons];

      if (outcome === 'ok' && product && perItemFreshOk && deterministicReasons.length === 0) {
        liveFingerprint = identityFingerprint({
          canonical: { name: ident.canonicalName, brand: ident.canonicalBrand, ean: ident.canonicalEan },
          tesco: { sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin, quantity: product.quantity },
        });
        // Build evidence WITH the fresh Dunnes/SuperValu peers (from `m`, keyed
        // by canonical product_id). These feed both the strict positive gate
        // and the AI assessment. snapshotIdentity carries material identity;
        // peers are product-level cross-retailer corroboration.
        const ev = assessmentEvidence(ident, runId, adapterBody, product, m.peers);
        // Reuse path (defect 3): an UNCHANGED, previously-verified mapping in
        // RENEWAL may use the cheap deterministic check alone.
        const existing = await readActiveVerification(sb, ident.storeProductId);
        const reuse = mode === 'renewal' && verificationReusable(existing, liveFingerprint);
        if (reuse) {
          decision = 'accept_pending_finalise';
          method = 'deterministic';
          rationale = 'Unchanged mapping: reused active identity verification; deterministic renewal check passed against fresh evidence.';
        } else if (independentExactIdentity(ev, product)) {
          // PEER-CORROBORATED route: the deterministic gate passed AND the
          // strict positive gate independentExactIdentity passes with the fresh
          // Dunnes/SuperValu peers supplied. independentExactIdentity itself
          // enforces barcode/brand/variant/quantity/multipack (sameBarcode,
          // canonicalVariantConflict, independentPackConflict, peerIdentity-
          // Conflict), so a genuine conflict can NEVER reach here. This is the
          // same positive gate the reviewed hold-reentry path trusts; it does
          // not require the AI to also confirm (the AI was the sole blocker on
          // these — ai_uncertain — while real peers were never supplied before).
          decision = 'accept_pending_finalise';
          method = 'deterministic_plus_independent_peer';
          rationale = `Deterministic identity gate passed and independentExactIdentity confirmed exact identity using ${m.peers.length} fresh cross-retailer peer(s) (brand/title/quantity/pack corroboration; no barcode required). Peers corroborate identity only, never a price claim.`;
        } else {
          // New, changed or uncertain → run the independent AI inference and
          // require BOTH it and the deterministic gate to agree (and its own
          // facts to be internally consistent, and bound to this identity).
          // A model/transport failure (schema miss, timeout, Bedrock error)
          // for ONE item must HOLD that item, never abort the campaign and
          // never become an accept. Catch it, log it, and fall through to hold.
          try {
            const verdict = await assessAndCombine(ev, product, runId, deps.assessOptions);
            model = verdict.assessment.model;
            if (verdict.decision === 'verified_exact' && verdict.machineAssessment
              && verdict.assessment.identity_fingerprint === liveFingerprint) {
              decision = 'accept_pending_finalise';
              method = 'deterministic_plus_ai';
              rationale = verdict.machineAssessment.reason;
            } else {
              reasons.push(`ai_${verdict.decision}`);
              if (verdict.holdReason) deps.log?.({ event: 'ai_hold', sku: ident.storeSku, holdReason: verdict.holdReason });
            }
          } catch (err) {
            // Defensive hold: the independent assessment could not be produced,
            // so we cannot establish an exact identity. Decision stays 'hold'.
            reasons.push('ai_error');
            deps.log?.({ event: 'ai_error', sku: ident.storeSku,
              message: err instanceof Error ? err.message : 'assessment failed' });
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
        p_store_product_id: ident.storeProductId, p_store_url: ident.storeUrl, p_mode: mode,
        p_outcome: outcome, p_http_status: response.status, p_retry_after: response.retryAfter,
        p_elapsed_ms: response.elapsedMs, p_adapter_body_sha256: adapterBody,
        p_parsed: parsed, p_identity_results: [{ storeProductId: ident.storeProductId, sku: ident.storeSku, reasons }],
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
        staged.push({ ident, product, previousPrice: m.price, adapterBody, method, rationale, model, fingerprint: liveFingerprint, snapshot: boundSnapshot });
      } else {
        result.perProduct.push({ storeProductId: ident.storeProductId, sku: ident.storeSku, outcome, accepted: false,
          reasons, price: null, freshness: provider?.freshness.level ?? null });
        if (unavailable) result.unavailable += 1; else if (outcome === 'ok') result.held += 1;
      }
      deps.log?.({ event: 'product', sku: ident.storeSku, outcome, decision, method, reasons });
      if (pauseUntil) { result.stopped = outcome; break; }
    }

    // --- Staged finalisation (defect 4: fencing-token + atomic snapshot recheck) ---
    // Each staged item is finalised through apify_finalise_tesco_page, which
    // re-fences the lease, looks the ok page up BY MAPPING, rechecks the
    // immutable mapping snapshot and due/observation atomically before writing.
    for (const s of staged) {
      const rec = await rpc<{ finalised: boolean }>(sb, 'apify_finalise_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
        p_store_product_id: s.ident.storeProductId, p_mode: mode,
        p_regular_price: s.product.price, p_previous_price: s.previousPrice,
        p_store_product_name: s.product.name, p_assessed_snapshot: s.snapshot,
      });
      if (rec?.finalised) {
        result.accepted += 1;
        // The price is now written. Recording the reusable identity verification
        // is a best-effort follow-up: a failure here (e.g. the DB method
        // CHECK not yet extended for a new method label) must NOT abort the
        // campaign or undo the accepted price. The method column accepts
        // 'deterministic' | 'deterministic_plus_ai'; the peer-corroborated
        // route is established WITHOUT the AI, so it records as 'deterministic'
        // (the precise route is preserved in the rationale + run logs). When a
        // migration extends the CHECK, this mapping can record the exact label.
        const dbMethod = s.method === 'deterministic_plus_ai' ? 'deterministic_plus_ai' : 'deterministic';
        try {
          await rpc(sb, 'apify_record_identity_verification', {
            p_store_product_id: s.ident.storeProductId, p_identity_fingerprint: s.fingerprint,
            p_canonical: { name: s.ident.canonicalName, brand: s.ident.canonicalBrand, ean: s.ident.canonicalEan },
            p_tesco: { sku: s.product.sku, name: s.product.name, brand: s.product.brand, gtin: s.product.gtin, quantity: s.product.quantity },
            p_rationale: s.rationale, p_method: dbMethod, p_rule_version: IDENTITY_ASSESSMENT_RULE_VERSION,
            p_model: s.model, p_source_page_id: null, p_source_body_sha256: s.adapterBody, p_reusable_hours: 720,
          });
        } catch (err) {
          deps.log?.({ event: 'verification_record_failed', sku: s.ident.storeSku, method: s.method,
            message: err instanceof Error ? err.message : 'record failed' });
        }
        result.perProduct.push({ storeProductId: s.ident.storeProductId, sku: s.ident.storeSku, outcome: 'ok',
          accepted: true, reasons: [], price: s.product.price, freshness: s.method });
      } else {
        result.held += 1;
        result.perProduct.push({ storeProductId: s.ident.storeProductId, sku: s.ident.storeSku, outcome: 'ok',
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
