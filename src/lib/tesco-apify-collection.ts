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
import { reviewedCanonicalEvidenceGap, type ReentryEvidence } from './tesco-hold-reentry';
import type { ApifyProviderIdentity } from './tesco-apify-fetch';

export const APIFY_GATE = 'apify-tesco-ie-20261108';

// 'evidence' is EVIDENCE-ONLY acquisition: fetch + record a page, NEVER a price
// (the database refuses any finalise in an evidence run).
export type ApifyCollectionMode = 'renewal' | 'expansion' | 'evidence';
export type EvidencePurpose = 'first_price' | 'repair_target' | 'repair_activation';
export type RepairTarget = { mappingId: string; targetSku: string };
export type SelectionOptions = {
  // Return the unproven, never-observed, both-peer mappings with recent Apify
  // evidence and NO live approval (approval-recording script only).
  approvalCandidates?: boolean;
  // Mapping ids to work FIRST, in this order (e.g. the recovery queue).
  priorityIds?: string[];
  // Evidence mode only: differing-SKU repair candidates to acquire evidence for.
  repairTargets?: RepairTarget[];
};

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
  // True when this is an unproven EXPANSION first-price candidate (no prior
  // success receipt). Such a mapping is admitted ONLY with a live, single-use,
  // evidence-bound approval (`approval`); the identity bar below is unchanged
  // (deterministic gate + fresh AI verified_exact on the live page).
  firstPrice: boolean;
  // The live approval for a first-price candidate (null otherwise). Its id is
  // passed to reserve + finalise; its fingerprint is rechecked against the LIVE
  // page identity before anything is staged.
  approval: FirstPriceApproval | null;
  // Evidence mode: the URL to fetch (the mapping URL, or a repair target URL)
  // and why. Undefined in renewal/expansion.
  evidenceUrl?: string;
  evidencePurpose?: EvidencePurpose;
};

export type FirstPriceApproval = { id: string; identityFingerprint: string };

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
  // Extra retries for a TRANSIENT AI failure (same evidence, same open run).
  // Default 2. A clean rejected/uncertain verdict is never retried.
  aiRetries?: number;
  // Enable the narrow EXPANSION FIRST-PRICE path: admit resolved, never-observed
  // mappings with NO prior success receipt, BOTH fresh peers AND a live
  // single-use approval row (tesco_first_price_approvals) bound to the exact
  // mapping snapshot. Without an approval nothing is admitted. Default false.
  allowFirstPrice?: boolean;
  // Priority queue + repair targets (see SelectionOptions).
  selection?: SelectionOptions;
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
  allowFirstPrice = false,
  opts: SelectionOptions = {},
): Promise<ApifyMapping[]> {
  const candidateMode = opts.approvalCandidates === true && mode === 'expansion';
  const evidenceMode = mode === 'evidence';
  const priorityRank = new Map((opts.priorityIds ?? []).map((id, i) => [id, i]));
  const rankOf = (id: string) => priorityRank.get(id) ?? Number.MAX_SAFE_INTEGER;
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
  // Excluded URLs — must mirror apify_reserve_tesco_request EXACTLY, which
  // rejects a URL that has EITHER a pending page (ANY age) OR any page in the
  // last 24h. The selector previously only loaded the last 24h, so a pending
  // page OLDER than 24h was invisible here but still rejected by the RPC — the
  // selector kept re-offering that mapping and every batch churned on
  // attempt_already_recorded. Load BOTH sets. Pending records are only READ
  // here; they are preserved untouched.
  const recentUrls = new Set<string>();
  const pendingUrls = new Set<string>();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('tesco_direct_collection_pages')
      .select('requested_url,created_at,outcome').gte('created_at', since)
      .order('created_at', { ascending: false }).range(offset, offset + 999);
    if (error) throw new Error(`Loading recent attempts: ${error.message}`);
    for (const r of data ?? []) recentUrls.add(String(r.requested_url));
    if ((data ?? []).length < 1000) break;
  }
  // Pending requests of ANY age (unresolved attempts). A URL stuck pending —
  // e.g. a run that recorded the pending page but never finalised/closed —
  // must stay excluded until that pending record is resolved, exactly as the
  // reserve RPC enforces. Without this, pending-older-than-24h mappings churn.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.from('tesco_direct_collection_pages')
      .select('requested_url,outcome').eq('outcome', 'pending')
      .order('requested_url').range(offset, offset + 999);
    if (error) throw new Error(`Loading pending attempts: ${error.message}`);
    for (const r of data ?? []) { recentUrls.add(String(r.requested_url)); pendingUrls.add(String(r.requested_url)); }
    if ((data ?? []).length < 1000) break;
  }
  // Recent Apify provider evidence (<= 14 days), keyed by mapping + URL. Evidence
  // mode skips mappings that already have it; approval candidates require it.
  const apifyEvidence = new Set<string>();
  if (evidenceMode || candidateMode) {
    const evSince = new Date(Date.now() - 14 * 86400_000).toISOString();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.from('tesco_apify_provider_evidence')
        .select('store_product_id,requested_url,captured_at').gte('captured_at', evSince)
        .order('captured_at', { ascending: false }).range(offset, offset + 999);
      if (error) throw new Error(`Loading Apify evidence: ${error.message}`);
      for (const r of data ?? []) apifyEvidence.add(`${r.store_product_id}|${r.requested_url}`);
      if ((data ?? []).length < 1000) break;
    }
  }

  const canonical = (r: Record<string, unknown>) => (Array.isArray(r.products) ? r.products[0] : r.products) as Record<string, unknown> | undefined;
  // Fresh-peer-store count per canonical product_id (distinct of dunnes/
  // supervalu with a priced observation inside the freshness window). Used to
  // RANK expansion so candidates with the strongest cross-retailer evidence
  // (both peers = 2) are attempted FIRST — they are the most likely to pass
  // identity + AI. Loaded here (across ALL eligible products, before the limit
  // slice) so the ranking is correct, not just within the sliced batch.
  const freshPeerStores = new Map<string, Set<string>>();
  {
    const allProductIds = [...new Set(mappings.map(r => String(r.product_id)))];
    const nowMs = Date.now();
    for (let i = 0; i < allProductIds.length; i += 50) {
      const chunk = allProductIds.slice(i, i + 50);
      const { data, error } = await sb.from('store_products')
        .select('product_id,store,latest_prices(observed_at,price)')
        .in('product_id', chunk).in('store', ['dunnes', 'supervalu']);
      if (error) throw new Error(`Loading peer freshness: ${error.message}`);
      for (const r of data ?? []) {
        const lp = Array.isArray(r.latest_prices) ? r.latest_prices[0] : (r.latest_prices as Record<string, unknown> | null);
        const observedAt = lp ? String((lp as Record<string, unknown>).observed_at) : null;
        const price = lp ? Number((lp as Record<string, unknown>).price) : 0;
        if (!observedAt || Date.parse(observedAt) <= nowMs - PEER_FRESH_DAYS * 86400_000 || !(price > 0)) continue;
        const pid = String(r.product_id);
        if (!freshPeerStores.has(pid)) freshPeerStores.set(pid, new Set());
        freshPeerStores.get(pid)!.add(String(r.store));
      }
    }
  }
  const peerStoreCount = (productId: string) => (freshPeerStores.get(productId)?.size ?? 0);

  // Same-SKU group sizes (defer shared-SKU, one-to-one guard).
  const skuGroups = new Map<string, Record<string, unknown>[]>();
  for (const r of mappings) {
    const sku = String(r.store_sku);
    skuGroups.set(sku, [...(skuGroups.get(sku) ?? []), r]);
  }

  // Live first-price approvals (unconsumed, unrevoked, unexpired). Only loaded
  // for expansion with the path enabled. The DB re-validates everything at
  // reserve and finalise; this is the selector-side mirror.
  const approvals = new Map<string, { id: string; identityFingerprint: string; snapshot: unknown }>();
  if (((allowFirstPrice || candidateMode) && mode === 'expansion') || evidenceMode) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.from('tesco_first_price_approvals')
        .select('id,store_product_id,identity_fingerprint,mapping_snapshot,expires_at')
        .is('consumed_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())
        .order('id').range(offset, offset + 999);
      if (error) throw new Error(`Loading first-price approvals: ${error.message}`);
      for (const a of data ?? []) {
        approvals.set(String(a.store_product_id), {
          id: String(a.id), identityFingerprint: String(a.identity_fingerprint), snapshot: a.mapping_snapshot,
        });
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const rows: ApifyMapping[] = [];
  for (const r of mappings) {
    const id = String(r.id);
    const sku = String(r.store_sku);
    const url = `https://www.tesco.ie/shop/en-IE/products/${sku}`;
    if (String(r.store_url) !== url) continue;
    // Proven (prior success receipt) is required EXCEPT a FIRST-PRICE expansion
    // candidate with strong independent evidence: never observed AND both fresh
    // Dunnes+SuperValu peers. Those feed the same deterministic + AI +
    // independentExactIdentity bar below; the reserve RPC waives proven only for
    // this narrow case and ONLY with a live single-use approval. Renewal always
    // requires proven.
    const observedAt = fresh.get(id) ?? null;
    const approval = !candidateMode && allowFirstPrice && mode === 'expansion' ? approvals.get(id) ?? null : null;
    const bothPeers = !observedAt && peerStoreCount(String(r.product_id)) >= 2;
    const hasEvidence = apifyEvidence.has(`${id}|${url}`);
    const firstPriceEligible = candidateMode ? !approvals.has(id) && bothPeers && hasEvidence
      : evidenceMode ? !approvals.has(id) && bothPeers && !hasEvidence
      : !!approval && bothPeers;
    // Evidence + approval candidates are the NO-receipt cohort only; proven
    // mappings use ordinary expansion.
    if ((evidenceMode || candidateMode) && proven.has(id)) continue;
    if (!proven.has(id) && !firstPriceEligible) continue; // only proven mappings (or a first-price candidate)
    // Pending of any age always excludes. The 24h window excludes requests; an
    // approval candidate is assessed from evidence that may be minutes old.
    if (pendingUrls.has(url) || (!candidateMode && recentUrls.has(url))) continue;
    const group = skuGroups.get(sku) ?? [];
    if (group.length > 1) continue;                       // defer shared-SKU
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
      firstPrice: firstPriceEligible,  // an unproven expansion first-price candidate
      approval: approval && firstPriceEligible ? { id: approval.id, identityFingerprint: approval.identityFingerprint } : null,
      ...(evidenceMode ? { evidenceUrl: url, evidencePurpose: 'first_price' as const } : {}),
    });
  }
  if (evidenceMode && opts.repairTargets?.length) {
    rows.push(...await selectRepairTargets(sb, opts.repairTargets, { fresh, proven, recentUrls, apifyEvidence }));
  }
  // Renewal: oldest observation first (closest to expiry) — expiry order.
  // Expansion: strongest cross-retailer evidence first — most fresh peer stores
  // (both dunnes+supervalu = 2) before one, before none; then stable by id. The
  // both-peer cohort is the most likely to pass identity + AI, so collect it
  // first within the batch budget.
  // Expansion / evidence: an explicit priority queue (e.g. the recovery queue)
  // is worked first, in its order; then by peer evidence as before.
  rows.sort((a, b) => mode === 'renewal'
    ? (a.observed_at ?? '').localeCompare(b.observed_at ?? '') || a.id.localeCompare(b.id)
    : rankOf(a.id) - rankOf(b.id)
      || peerStoreCount(b.product_id) - peerStoreCount(a.product_id) || a.id.localeCompare(b.id));
  const selected = rows.slice(0, limit);
  // Capture the authoritative server snapshot at SELECTION time for each chosen
  // mapping, so selection/assessment/reservation all reference the SAME value.
  for (const m of selected) {
    const { data, error } = await sb.rpc('apify_mapping_snapshot', { p_store_product_id: m.id });
    if (error) throw new Error(`Reading mapping snapshot: ${error.message}`);
    m.snapshot = (data as Record<string, unknown>) ?? null;
  }
  // A first-price candidate whose mapping changed since its approval was bound
  // is dropped here (the DB would refuse it at reserve anyway).
  const bound = selected.filter(m => !m.firstPrice || candidateMode || evidenceMode
    || stableStringify(m.snapshot) === stableStringify(approvals.get(m.id)?.snapshot));
  selected.length = 0;
  selected.push(...bound);
  // Load FRESH Dunnes/SuperValu peers for the selected mappings' canonical
  // products. These corroborate the Tesco item's identity (brand/title/
  // quantity/pack) through independentExactIdentity — the cross-retailer
  // evidence the identity rules are designed to use. Only priced peers inside
  // the freshness window qualify; capped to one per store (freshest).
  await attachFreshPeers(sb, selected);
  return selected;
}

// Repair-target evidence candidates (evidence mode only). A differing-SKU lead
// is fetched as EVIDENCE for the guarded (postgres-bridge) repair; nothing here
// changes a mapping. Mirrors the repair guard's preconditions so no request is
// spent on a lead the guard would refuse: proven, branded (not own label), never
// observed, target SKU owned by no Tesco mapping, no pending/recent attempt.
// A mapping already STAGED at the target (url_status failed) gets an activation
// source instead.
async function selectRepairTargets(
  sb: SupabaseClient, targets: RepairTarget[],
  ctx: { fresh: Map<string, string>; proven: Set<string>; recentUrls: Set<string>; apifyEvidence: Set<string> },
): Promise<ApifyMapping[]> {
  const out: ApifyMapping[] = [];
  const ids = [...new Set(targets.map(t => t.mappingId))];
  const rowsById = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await sb.from('store_products')
      .select('id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status,gtin,products(canonical_name,brand,ean)')
      .in('id', ids.slice(i, i + 50));
    if (error) throw new Error(`Loading repair mappings: ${error.message}`);
    for (const r of data ?? []) rowsById.set(String(r.id), r);
  }
  const skus = [...new Set(targets.map(t => t.targetSku))];
  const owners = new Map<string, string[]>();
  for (let i = 0; i < skus.length; i += 50) {
    const { data, error } = await sb.from('store_products').select('id,store_sku')
      .eq('store', 'tesco').in('store_sku', skus.slice(i, i + 50));
    if (error) throw new Error(`Loading repair target owners: ${error.message}`);
    for (const r of data ?? []) owners.set(String(r.store_sku), [...(owners.get(String(r.store_sku)) ?? []), String(r.id)]);
  }
  const claimed = new Set<string>();
  for (const t of targets) {
    const r = rowsById.get(t.mappingId);
    if (!r || r.store !== 'tesco' || !/^\d{6,12}$/.test(t.targetSku)) continue;
    const url = `https://www.tesco.ie/shop/en-IE/products/${t.targetSku}`;
    const activation = String(r.store_sku) === t.targetSku;
    if (activation ? r.url_status !== 'failed' || String(r.store_url) !== url
      : !['resolved', 'failed'].includes(String(r.url_status))) continue;
    if (!ctx.proven.has(t.mappingId) || r.is_own_brand === true || ctx.fresh.has(t.mappingId)) continue;
    const otherOwners = (owners.get(t.targetSku) ?? []).filter(o => o !== t.mappingId);
    if (otherOwners.length > 0 || claimed.has(t.targetSku)) continue; // one lead per target SKU
    if (ctx.recentUrls.has(url)) continue;
    if (!activation && ctx.apifyEvidence.has(`${t.mappingId}|${url}`)) continue;
    claimed.add(t.targetSku);
    const c = (Array.isArray(r.products) ? r.products[0] : r.products) as Record<string, unknown> | undefined;
    out.push({
      id: t.mappingId, product_id: String(r.product_id),
      canonical_name: String(c?.canonical_name ?? ''), canonical_brand: (c?.brand as string) ?? null,
      canonical_ean: (c?.ean as string) ?? null,
      store_product_name: String(r.store_product_name ?? ''), store_brand: (r.brand as string) ?? null,
      is_own_brand: r.is_own_brand === true, store_sku: String(r.store_sku ?? ''), store_url: String(r.store_url ?? ''),
      url_status: String(r.url_status), gtin: (r.gtin as string) ?? null,
      observed_at: null, price: null, peerCanonicalNames: [], sameSkuCount: 1,
      snapshot: null, peers: [], firstPrice: false, approval: null,
      evidenceUrl: url, evidencePurpose: activation ? 'repair_activation' : 'repair_target',
    });
  }
  return out;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
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
export type SnapshotIdentity = {
  storeProductId: string; productId: string; storeSku: string; storeUrl: string;
  canonicalName: string; canonicalBrand: string | null; canonicalEan: string | null;
  storeBrand: string | null; storeProductName: string; isOwnBrand: boolean; gtin: string | null;
  sameSkuCanonicalNames: string[];
};
export function snapshotIdentity(snap: Record<string, unknown>): SnapshotIdentity {
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
export function snapshotMappingEvidence(s: SnapshotIdentity, isFresh: boolean): TescoMappingEvidence {
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
export function assessmentEvidence(s: SnapshotIdentity, pageId: string, bodySha256: string, live: TescoCollectedProduct,
  peers: ApifyPeer[] = [], proven = true): ReentryEvidence {
  return {
    mapping: {
      id: s.storeProductId, product_id: s.productId, canonical_name: s.canonicalName,
      canonical_brand: s.canonicalBrand, canonical_ean: s.canonicalEan,
      store_product_name: s.storeProductName, store_brand: s.storeBrand,
      is_own_brand: s.isOwnBrand, store_sku: s.storeSku, store_url: s.storeUrl,
      url_status: 'resolved', gtin: s.gtin,
    },
    sameSkuCount: Math.max(s.sameSkuCanonicalNames.length, 1), proven, firstPriceOnboarding: !proven, freshTesco: false, pending: false, recentAttempt: false,
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
  // Evidence mode: usable ok pages recorded (never a price).
  evidenceRecorded: number;
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

  const mappings = await selectApifyMappings(sb, mode, limit, deps.allowFirstPrice === true,
    { priorityIds: deps.selection?.priorityIds, repairTargets: deps.selection?.repairTargets });
  const result: ApifyCollectionResult = {
    runId: '', mode, requested: 0, accepted: 0, held: 0, unavailable: 0, stopped: null, evidenceRecorded: 0, spentUsd, perProduct: [],
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
    method: 'deterministic' | 'deterministic_plus_ai' | 'deterministic_plus_ai_peer' | 'canonical_gap_plus_ai_peer'; rationale: string; model: string | null;
    fingerprint: string; snapshot: Record<string, unknown> | null; approval: FirstPriceApproval | null }> = [];

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
          p_store_product_id: m.id, p_store_url: m.evidenceUrl ?? m.store_url, p_mode: mode,
          p_expected_snapshot: m.snapshot,
          // An unproven expansion mapping reserves ONLY with its live approval.
          // Omitted otherwise, so the call also matches the pre-20261113090000
          // 8-argument signature still deployed in production.
          ...(m.approval ? { p_approval_id: m.approval.id } : {}),
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
      // Evidence mode may fetch a repair-target URL rather than the mapping URL.
      const fetchUrl = mode === 'evidence' && m.evidenceUrl ? m.evidenceUrl : ident.storeUrl;
      const targetSku = fetchUrl.slice(fetchUrl.lastIndexOf('/') + 1);
      const { response, provider } = await deps.fetchApify(fetchUrl, deps.perRequestUsd);
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
      const product: TescoCollectedProduct | undefined = parsed?.products.find(p => p.sku === targetSku);
      const unavailable = tescoResourceUnavailable(response);
      const transportStop = outcome !== 'ok' && !unavailable;
      const adapterBody = createHash('sha256').update(response.html).digest('hex');
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

      // --- EVIDENCE-ONLY acquisition: record the page and stop. No AI, no
      // staging, no finalise; the database also refuses any price write in an
      // evidence run. A first-price page is assessed later by the separate,
      // AI-verified approval step; a repair page feeds the guarded repair.
      if (mode === 'evidence') {
        const evReasons = product && m.evidencePurpose === 'first_price'
          ? validateTescoCollectedIdentity(snapshotMappingEvidence(ident, false), product)
          : product ? [] : ['missing_exact_product'];
        const usable = outcome === 'ok' && !!product;
        await rpc(sb, 'apify_record_tesco_page', {
          p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
          p_store_product_id: ident.storeProductId, p_store_url: fetchUrl, p_mode: mode,
          p_outcome: outcome, p_http_status: response.status, p_retry_after: response.retryAfter,
          p_elapsed_ms: response.elapsedMs, p_adapter_body_sha256: adapterBody,
          p_parsed: parsed, p_identity_results: [{ storeProductId: ident.storeProductId, sku: targetSku, reasons: evReasons }],
          p_detail: {
            provider: 'apify', evidenceOnly: true, acquisitionOnly: true, pricesInserted: 0,
            purpose: m.evidencePurpose ?? 'first_price',
            disposition: usable ? 'evidence_recorded' : outcome === 'ok' ? 'evidence_unusable' : undefined,
            resourceUnavailable: unavailable || undefined, freshness: provider?.freshness.level ?? null,
            evidenceOrigin: 'synthetic-apify-adapter',
          },
          p_pause: !!pauseUntil, p_pause_until: pauseUntil, p_blocked: blocked,
          p_provider: providerJson,
        });
        if (usable) result.evidenceRecorded += 1; else if (unavailable) result.unavailable += 1; else if (outcome === 'ok') result.held += 1;
        result.perProduct.push({ storeProductId: ident.storeProductId, sku: targetSku, outcome, accepted: false,
          reasons: evReasons, price: null, freshness: provider?.freshness.level ?? null });
        deps.log?.({ event: 'evidence', sku: targetSku, purpose: m.evidencePurpose, outcome, usable, reasons: evReasons });
        if (pauseUntil) { result.stopped = outcome; break; }
        continue;
      }

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
      let method: 'deterministic' | 'deterministic_plus_ai' | 'deterministic_plus_ai_peer' | 'canonical_gap_plus_ai_peer' = 'deterministic';
      let rationale = '';
      let model: string | null = null;
      let liveFingerprint = '';
      const reasons = [...deterministicReasons];

      // Evidence WITH the fresh Dunnes/SuperValu peers (from `m`, keyed by
      // canonical product_id). Peers corroborate IDENTITY only, never a price.
      // A first-price candidate is NOT proven; say so to the assessment (this
      // also keeps it off the canonical-gap route, which requires proven).
      const ev = product ? assessmentEvidence(ident, runId, adapterBody, product, m.peers, !m.firstPrice) : null;

      // HELD-MAPPING RECOVERY (canonical-evidence gap): the ordinary gate
      // rejects a mapping when the ONLY problem is an incomplete/generic
      // canonical description (measureExactnessFailed, "candidate does not
      // establish full exact canonical identity", inferred pack count). Those
      // records never reached the AI before. reviewedCanonicalEvidenceGap
      // unblocks the deterministic reject ONLY when every remaining reason is
      // in that narrow allowed set AND the STRONGER positive gate
      // independentExactIdentity passes with the fresh peers supplied — so a
      // genuine brand/variant/quantity/pack/barcode conflict can NEVER qualify.
      // It merely admits the item to the SAME AI assessment every other
      // new/changed identity must pass; the AI verified_exact verdict is still
      // required (preserved below).
      const canonicalGapEligible = !!(product && ev && perItemFreshOk && !m.firstPrice
        && deterministicReasons.length > 0
        && reviewedCanonicalEvidenceGap(ev, product, deterministicReasons));
      if (canonicalGapEligible) {
        deps.log?.({ event: 'canonical_gap_recovery_candidate', sku: ident.storeSku, reasons: deterministicReasons });
      }

      if (outcome === 'ok' && product && ev && perItemFreshOk && (deterministicReasons.length === 0 || canonicalGapEligible)) {
        liveFingerprint = identityFingerprint({
          canonical: { name: ident.canonicalName, brand: ident.canonicalBrand, ean: ident.canonicalEan },
          tesco: { sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin, quantity: product.quantity },
        });
        // Reuse path (defect 3): an UNCHANGED, previously-verified mapping in
        // RENEWAL may use the cheap deterministic check alone. A canonical-gap
        // RECOVERY item can NEVER use reuse — it always needs a fresh AI verdict.
        const existing = canonicalGapEligible ? null : await readActiveVerification(sb, ident.storeProductId);
        const reuse = !canonicalGapEligible && mode === 'renewal' && verificationReusable(existing, liveFingerprint);
        if (reuse) {
          decision = 'accept_pending_finalise';
          method = 'deterministic';
          rationale = 'Unchanged mapping: reused active identity verification; deterministic renewal check passed against fresh evidence.';
        } else {
          // New, changed or uncertain → run the independent AI inference and
          // require BOTH the deterministic gate AND an evidence-bound AI
          // verified_exact verdict (bound to this identity fingerprint). The
          // fresh Dunnes/SuperValu peers are passed INTO the assessment via
          // `ev` (assessmentEvidence carries m.peers) to IMPROVE the AI's
          // evidence — they do NOT create a separate accept path. The AI can
          // never be skipped and can never be overridden. A model/transport
          // failure (schema miss, timeout, Bedrock error) for ONE item HOLDS
          // that item, never aborts the campaign and never becomes an accept.
          // A TRANSIENT model/transport failure (schema miss, timeout, throttle,
          // Bedrock 5xx) is retried against the SAME evidence while this guarded
          // run is open — up to `aiRetries` extra attempts with a short backoff.
          // A clean rejected/uncertain VERDICT is NOT transient and is never
          // retried (that is a genuine hold). After exhausting retries the item
          // HOLDS (ai_error) — it never aborts the campaign and never accepts.
          const aiRetries = deps.aiRetries ?? 2;
          let verdict: Awaited<ReturnType<typeof assessAndCombine>> | null = null;
          let lastErr: unknown = null;
          for (let attempt = 0; attempt <= aiRetries; attempt += 1) {
            try { verdict = await assessAndCombine(ev, product, runId, deps.assessOptions); lastErr = null; break; }
            catch (err) {
              lastErr = err;
              deps.log?.({ event: 'ai_transient_failure', sku: ident.storeSku, attempt: attempt + 1,
                message: err instanceof Error ? err.message : 'assessment failed' });
              if (attempt < aiRetries) await sleep(1_000 * (attempt + 1));
            }
          }
          if (verdict) {
            model = verdict.assessment.model;
            if (verdict.decision === 'verified_exact' && verdict.machineAssessment
              && verdict.assessment.identity_fingerprint === liveFingerprint) {
              decision = 'accept_pending_finalise';
              // Record whether peers corroborated the AI-confirmed identity, for
              // auditability — but the ACCEPT authority is the AI verdict +
              // (deterministic gate OR the reviewed canonical-evidence gap with
              // the stronger independentExactIdentity), never the peers alone.
              method = canonicalGapEligible ? 'canonical_gap_plus_ai_peer'
                : m.peers.length > 0 ? 'deterministic_plus_ai_peer' : 'deterministic_plus_ai';
              rationale = canonicalGapEligible
                ? `Held-mapping recovery: canonical description was incomplete (${deterministicReasons.join(', ')}); independentExactIdentity confirmed exact identity with fresh cross-retailer peer(s), and the independent AI returned verified_exact. ${verdict.machineAssessment.reason}`
                : verdict.machineAssessment.reason;
              // On a recovery accept, the canonical-gap reasons are resolved by
              // the stronger gate + AI; don't surface them as hold reasons.
              if (canonicalGapEligible) reasons.length = 0;
              // FIRST PRICE: the live page must carry exactly the identity the
              // approval was bound to. Any drift holds the item; the approval
              // stays unconsumed.
              if (m.approval && m.approval.identityFingerprint !== liveFingerprint) {
                decision = 'hold';
                reasons.push('first_price_live_identity_changed');
              }
            } else {
              reasons.push(`ai_${verdict.decision}`);
              if (verdict.holdReason) deps.log?.({ event: 'ai_hold', sku: ident.storeSku, holdReason: verdict.holdReason });
            }
          } else {
            // Defensive hold: the independent assessment could not be produced
            // after retries, so we cannot establish an exact identity.
            reasons.push('ai_error');
            deps.log?.({ event: 'ai_error', sku: ident.storeSku, attempts: aiRetries + 1,
              message: lastErr instanceof Error ? lastErr.message : 'assessment failed' });
          }
        }
      } else if (outcome === 'ok' && product && !perItemFreshOk) {
        reasons.push('freshness_precondition_not_met');
      }


      // Record the page NOW (evidence ONLY — the record RPC can never write a
      // price). Finalisation is a separate, fencing-token-guarded RPC that runs
      // after the per-batch freshness audit.
      await rpc(sb, 'apify_record_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
        p_store_product_id: ident.storeProductId, p_store_url: fetchUrl, p_mode: mode,
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
        staged.push({ ident, product, previousPrice: m.price, adapterBody, method, rationale, model, fingerprint: liveFingerprint, snapshot: boundSnapshot, approval: m.approval });
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
      let rec: { finalised: boolean } | null;
      try {
      rec = await rpc<{ finalised: boolean }>(sb, 'apify_finalise_tesco_page', {
        p_run_id: runId, p_egress_key: APIFY_GATE, p_lease_token: leaseToken, p_owner: owner,
        p_store_product_id: s.ident.storeProductId, p_mode: mode,
        p_regular_price: s.product.price, p_previous_price: s.previousPrice,
        p_store_product_name: s.product.name, p_assessed_snapshot: s.snapshot,
        // Approval params only for a first price, so a proven write also
        // matches the pre-20261113090000 10-argument signature.
        ...(s.approval ? { p_approval_id: s.approval.id, p_live_identity_fingerprint: s.fingerprint } : {}),
      });
      } catch (err) {
        // A first-price finalise refusal (approval invalid/consumed/changed,
        // identity or evidence mismatch) holds THIS item only: the RPC rolled
        // back, so nothing was written and the approval is unconsumed. Any other
        // failure keeps its previous behaviour (abort + close the run).
        if (!s.approval) throw err;
        deps.log?.({ event: 'first_price_finalise_refused', sku: s.ident.storeSku,
          message: err instanceof Error ? err.message : 'finalise refused' });
        rec = null;
      }
      if (rec?.finalised) {
        result.accepted += 1;
        // The price is now written. Recording the reusable identity verification
        // is a best-effort follow-up: a failure here must NOT abort the campaign
        // or undo the accepted price. The DB method column CHECK accepts
        // 'deterministic' | 'deterministic_plus_ai'. Both AI-backed routes
        // (with or without corroborating peers) record as 'deterministic_plus_ai'
        // (an AI verified_exact verdict authorised them); only the cheap
        // unchanged-reuse route records as 'deterministic'. A verification
        // written WITHOUT an AI model would be mis-trusted by the reuse policy,
        // so an AI-backed accept must carry its model (asserted below).
        // Every AI-backed route (deterministic/canonical-gap + AI, with or
        // without peers) records as the DB-allowed 'deterministic_plus_ai' WITH
        // the model; only the cheap unchanged-reuse route records 'deterministic'.
        const dbMethod = s.method === 'deterministic' ? 'deterministic' : 'deterministic_plus_ai';
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
