/**
 * Tesco mapping-recovery PILOT — discovery + identity-verification ONLY.
 *
 * Bounded, supervised pilot that measures whether correct Tesco mappings can be
 * rediscovered + independently verified for high-value held products (fresh
 * Dunnes AND SuperValu prices, so each recovery is a three-retailer comparison).
 *
 * HARD BOUNDARIES (enforced here by omission):
 *  - NEVER calls finalize_tesco_candidate_discovery (no store_products SKU/URL
 *    change, no trusted price write). It SELECTS a cohort and CLASSIFIES
 *    discovered candidates with the existing deterministic validators.
 *  - NEVER touches the master `products` canonical, protective holds, or the 6
 *    historical unresolved (pending) requests.
 *  - Search-result prices are evidence only, never trusted observations.
 *
 * Two-tier verification (review point 2):
 *  - search_matched: the Pepesto SEARCH candidate passes classifyTescoReplacement
 *    (brand/measure/pack/variant/formulation + url↔sku). A PROPOSAL only.
 *  - exact_verified: additionally corroborated against a FRESH Tesco product page
 *    for the candidate SKU via validateTescoCollectedIdentity (live title, brand,
 *    structured quantity). Only this tier is "fully verified".
 *
 * Correction (updating an approved mapping) + fresh live price verification for a
 * TRUSTED price is a SEPARATE later implementation/release, not in this module.
 */
import { classifyTescoReplacement, type TescoMappingEvidence } from '@/lib/tesco-mapping-audit';
import { validateTescoCollectedIdentity, type TescoCollectedProduct } from '@/lib/tesco-direct-collection-core';

export const PILOT_MAX_PRODUCTS = 50;

export type PilotDefect =
  | 'incorrect_sku'
  | 'missing_on_page'
  | 'wrong_pack_or_quantity'
  | 'wrong_variant_or_formulation'
  | 'brand_or_ownlabel'
  | 'canonical_ambiguous'
  | 'out_of_stock'
  | 'transport'
  | 'other';

/** A held mapping returned by the cohort query (read-only), pre-sampling. */
export type PilotCohortRow = {
  storeProductId: string;
  productId: string;
  canonicalName: string;
  canonicalBrand: string | null;
  storeProductName: string;
  storeBrand: string | null;
  isOwnBrand: boolean | null;
  storeSku: string | null;
  storeUrl: string | null;
  heldReasons: string[];
  liveName: string | null;
  supervaluPrice: number | null;
  dunnesPrice: number | null;
  bothPeers: boolean;
};

export type PilotCandidate = PilotCohortRow & {
  defect: PilotDefect;
  /** Estimated prior-probability of recovery, for within-stratum ranking only. */
  recoverability: 'high' | 'medium' | 'low' | 'na';
};

/** Two-tier verification + the exhaustive outcome set for the report. */
export type PilotClassification =
  | 'exact_verified'            // search candidate AND fresh-page corroborated
  | 'search_matched_unverified' // search candidate exact, no fresh-page check yet
  | 'plausible_more_evidence'   // related but a material attribute unverified
  | 'wrong_product_variant_pack'
  | 'no_reliable_candidate'
  | 'access_or_execution_failure';

export type DiscoveredCandidate = {
  sku: string | null;
  url: string;
  name: string;
  priceCents: number;
  structuredQuantity?: { grams?: number; millilitres?: number; pieces?: number } | null;
};

// ---------------------------------------------------------------------------
// Defect inference + representative stratified sampling (review point 1)
// ---------------------------------------------------------------------------

const DEFECT_ORDER: PilotDefect[] = [
  'incorrect_sku', 'missing_on_page', 'duplicate' as PilotDefect, // placeholder-safe
  'wrong_pack_or_quantity', 'wrong_variant_or_formulation', 'brand_or_ownlabel',
  'canonical_ambiguous', 'out_of_stock', 'transport', 'other',
];

export function inferDefect(reasons: readonly string[]): PilotDefect {
  const has = (s: string) => reasons.some((r) => r.includes(s));
  if (has('different_sku') || has('urlSku')) return 'incorrect_sku';
  if (has('missing_exact_product')) return 'missing_on_page';
  if (has('measure') || has('pack')) return 'wrong_pack_or_quantity';
  if (has('variant') || has('formulation') || has('freshFrozen') || has('productType') || has('raw_ingredient')) return 'wrong_variant_or_formulation';
  if (has('brand') || has('ownLabel')) return 'brand_or_ownlabel';
  if (has('full exact canonical identity')) return 'canonical_ambiguous';
  if (has('unavailable_or_no_regular_price')) return 'out_of_stock';
  if (reasons.some((r) => r.startsWith('transport:'))) return 'transport';
  return 'other';
}

function normTerms(s: string): Set<string> {
  return new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((w) => w.length > 2 && !['the', 'and', 'with', 'tesco', 'pack', 'each'].includes(w)));
}

/** Prior recoverability estimate from stored-vs-live evidence (ranking only). */
export function estimateRecoverability(row: PilotCohortRow, defect: PilotDefect): PilotCandidate['recoverability'] {
  if (defect === 'out_of_stock') return 'na';
  if (defect === 'canonical_ambiguous' && row.liveName) {
    const c = [...normTerms(row.canonicalName)];
    const live = normTerms(row.liveName);
    const coverage = c.length ? c.filter((t) => live.has(t)).length / c.length : 0;
    if (coverage >= 0.99) return 'high'; // mapping likely already correct, name generic
    return 'medium';
  }
  if (defect === 'wrong_pack_or_quantity') return 'medium';
  if (['incorrect_sku', 'missing_on_page', 'wrong_variant_or_formulation', 'brand_or_ownlabel'].includes(defect)) return 'low';
  return 'medium';
}

/**
 * Select a REPRESENTATIVE, high-value sample (review point 1): cover every
 * identity-failure category present, and within each category prioritise the
 * likeliest recoveries (recoverability high>medium>low, then both-peers, then a
 * stable key). Round-robins across categories so the sample is not dominated by
 * the largest bucket, and is NOT alphabetical.
 */
export function selectRepresentativeSample(rows: PilotCohortRow[], limit = PILOT_MAX_PRODUCTS): PilotCandidate[] {
  const n = Math.max(1, Math.min(Math.floor(limit), PILOT_MAX_PRODUCTS));
  const enriched: PilotCandidate[] = rows.map((r) => {
    const defect = inferDefect(r.heldReasons);
    return { ...r, defect, recoverability: estimateRecoverability(r, defect) };
  });
  const rank = { high: 0, medium: 1, low: 2, na: 3 } as const;
  // Group by defect, each group sorted best-first (likely recoveries prioritised).
  const groups = new Map<PilotDefect, PilotCandidate[]>();
  for (const c of enriched) {
    if (!groups.has(c.defect)) groups.set(c.defect, []);
    groups.get(c.defect)!.push(c);
  }
  for (const list of groups.values()) {
    list.sort((a, b) =>
      rank[a.recoverability] - rank[b.recoverability]
      || Number(b.bothPeers) - Number(a.bothPeers)
      || a.storeProductId.localeCompare(b.storeProductId));
  }
  // Round-robin across defect categories (ordered by a fixed priority) so the
  // sample is representative of every failure mode, not just the biggest bucket.
  const order = DEFECT_ORDER.filter((d) => groups.has(d));
  const cursors = new Map<PilotDefect, number>(order.map((d) => [d, 0]));
  const out: PilotCandidate[] = [];
  let progressed = true;
  while (out.length < n && progressed) {
    progressed = false;
    for (const d of order) {
      if (out.length >= n) break;
      const list = groups.get(d)!;
      const i = cursors.get(d)!;
      if (i < list.length) {
        out.push(list[i]);
        cursors.set(d, i + 1);
        progressed = true;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Two-tier classification (review point 2)
// ---------------------------------------------------------------------------

type EvidenceRow = { candidate: DiscoveredCandidate; classification: string; reasons: string[] };

function mappingOf(product: Pick<PilotCohortRow, 'storeProductId' | 'canonicalName' | 'canonicalBrand' | 'storeProductName' | 'storeBrand' | 'isOwnBrand' | 'storeSku' | 'storeUrl'>): TescoMappingEvidence {
  return {
    storeProductId: product.storeProductId,
    canonicalName: product.canonicalName,
    canonicalBrand: product.canonicalBrand ?? null,
    storeProductName: product.storeProductName ?? null,
    storeBrand: product.storeBrand ?? null,
    isOwnBrand: product.isOwnBrand ?? null,
    storeSku: product.storeSku ?? null,
    storeUrl: product.storeUrl ?? null,
    duplicateSkuCount: 1,
    isFresh: false,
  };
}

/**
 * Tier 1 — classify the Pepesto SEARCH candidates for one product. Returns
 * `search_matched_unverified` when exactly one distinct candidate passes the
 * strict deterministic validator (a PROPOSAL, not applied, not a trusted price).
 * A live-page corroboration (tier 2) is required before `exact_verified`.
 */
export function classifySearchCandidates(
  product: Pick<PilotCohortRow, 'storeProductId' | 'canonicalName' | 'canonicalBrand' | 'storeProductName' | 'storeBrand' | 'isOwnBrand' | 'storeSku' | 'storeUrl'>,
  candidates: DiscoveredCandidate[],
  options: { accessOrExecutionFailure?: boolean } = {},
): { outcome: PilotClassification; searchCandidate: DiscoveredCandidate | null; evidence: EvidenceRow[] } {
  if (options.accessOrExecutionFailure) return { outcome: 'access_or_execution_failure', searchCandidate: null, evidence: [] };
  if (!candidates.length) return { outcome: 'no_reliable_candidate', searchCandidate: null, evidence: [] };
  const mapping = mappingOf(product);
  const evidence: EvidenceRow[] = candidates.map((candidate) => {
    const audit = (candidate.name && candidate.priceCents > 0)
      ? classifyTescoReplacement(mapping, {
          sku: candidate.sku ?? '', url: candidate.url, name: candidate.name,
          structuredQuantity: candidate.structuredQuantity ?? null, evidenceSource: 'pilot-discovery-single',
        })
      : { classification: 'insufficient_evidence' as const, reasons: ['candidate requires a non-empty name and positive observed price'] };
    return { candidate, classification: audit.classification, reasons: audit.reasons };
  });
  const exact = evidence.filter((e) => e.classification === 'exact_replacement_candidate' && e.candidate.sku);
  const distinctExactSkus = new Set(exact.map((e) => e.candidate.sku));
  if (exact.length && distinctExactSkus.size === 1) {
    return { outcome: 'search_matched_unverified', searchCandidate: exact[0].candidate, evidence };
  }
  if (evidence.every((e) => e.classification === 'material_mismatch')) {
    return { outcome: 'wrong_product_variant_pack', searchCandidate: null, evidence };
  }
  return { outcome: 'plausible_more_evidence', searchCandidate: null, evidence };
}

/**
 * Tier 2 — corroborate a search-matched candidate against a FRESH Tesco product
 * page for the candidate SKU. Promotes to `exact_verified` ONLY when the live
 * parsed product (same SKU) passes validateTescoCollectedIdentity against the
 * canonical. Any mismatch keeps it unverified (downgraded to plausible). This
 * performs NO write; it only reads a freshly-fetched page the caller provides.
 */
export function verifyAgainstLivePage(
  product: Pick<PilotCohortRow, 'storeProductId' | 'canonicalName' | 'canonicalBrand' | 'storeProductName' | 'storeBrand' | 'isOwnBrand'>,
  searchCandidate: DiscoveredCandidate,
  livePage: { ok: boolean; product: TescoCollectedProduct | null },
): { outcome: PilotClassification; reasons: string[] } {
  if (!livePage.ok) return { outcome: 'access_or_execution_failure', reasons: ['live page fetch failed'] };
  const live = livePage.product;
  if (!live || live.sku !== searchCandidate.sku) {
    return { outcome: 'plausible_more_evidence', reasons: ['candidate SKU not present on its own fresh product page'] };
  }
  const reasons = validateTescoCollectedIdentity({
    storeProductId: product.storeProductId,
    canonicalName: product.canonicalName,
    canonicalBrand: product.canonicalBrand ?? null,
    storeProductName: product.storeProductName ?? null,
    storeBrand: product.storeBrand ?? null,
    isOwnBrand: product.isOwnBrand ?? null,
    storeSku: searchCandidate.sku ?? undefined,
    storeUrl: searchCandidate.url,
    duplicateSkuCount: 1,
    isFresh: false,
  }, live);
  // Benign unavailable is not an identity failure, but we cannot fully verify a
  // product with no live regular price either — keep it unverified.
  const material = reasons.filter((r) => r !== 'unavailable_or_no_regular_price');
  if (reasons.length === 0) return { outcome: 'exact_verified', reasons: [] };
  if (material.length === 0) return { outcome: 'plausible_more_evidence', reasons };
  return { outcome: 'plausible_more_evidence', reasons };
}

// ---------------------------------------------------------------------------
// Read-only cohort SQL (returns the FULL both-/one-peer held set for sampling)
// ---------------------------------------------------------------------------

/**
 * Read-only SQL for the full held cohort (NOT pre-limited): held on an identity
 * reason, unique-SKU, PROVEN, canonical-URL Tesco mappings with NO fresh trusted
 * price and a fresh Dunnes/SuperValu peer. Excludes shared-SKU groups, recent-24h
 * attempts, and ALL pending/unknown URLs (so the 6 historical unresolved are
 * never selected). The caller stratified-samples 50 via selectRepresentativeSample.
 * Read-only; mutates nothing. `bothPeersOnly` restricts to the 139 both-peer set.
 */
export function pilotCohortSql(options: { bothPeersOnly?: boolean } = {}): string {
  const bothPeers = options.bothPeersOnly ? 'and pr.sv and pr.dn' : 'and (pr.sv or pr.dn)';
  return `with m as (
    select s.id, s.product_id, p.canonical_name, p.brand canonical_brand,
      s.store_product_name, s.brand store_brand, s.is_own_brand, s.store_sku, s.store_url, s.url_status,
      l.store_product_id is not null fresh_tesco
    from store_products s join products p on p.id=s.product_id
    left join latest_prices l on l.store_product_id=s.id and l.store='tesco'
    where s.store='tesco'),
  sku_counts as (select store_sku, count(*) c from m group by store_sku),
  peers as (
    select canonical_product_id,
      max((store='supervalu')::int)=1 sv, max((store='dunnes')::int)=1 dn,
      max(price) filter (where store='supervalu') sv_price,
      max(price) filter (where store='dunnes') dn_price
    from latest_prices where store in ('supervalu','dunnes') group by canonical_product_id),
  attempted as (
    select requested_url,
      bool_or(outcome='pending') any_pending,
      bool_or(created_at>now()-interval '24 hours') recent24
    from tesco_direct_collection_pages group by requested_url),
  reasons as (
    select d.requested_url,
      (select jsonb_agg(distinct r) from tesco_direct_collection_pages d2,
        jsonb_array_elements(d2.identity_results) i, jsonb_array_elements_text(i->'reasons') r
        where d2.requested_url=d.requested_url) rs,
      (select p2.name from tesco_direct_collection_pages d3,
        jsonb_array_elements(d3.parsed->'products') p2 where d3.requested_url=d.requested_url
        and p2->>'name' is not null order by d3.created_at desc limit 1) live_name
    from tesco_direct_collection_pages d group by d.requested_url),
  held as (
    select m.*, coalesce(pr.sv,false) sv, coalesce(pr.dn,false) dn,
      pr.sv_price, pr.dn_price, rn.rs, rn.live_name
    from m
    join peers pr on pr.canonical_product_id=m.product_id
    join sku_counts sc on sc.store_sku=m.store_sku
    left join reasons rn on rn.requested_url=m.store_url
    where m.url_status='resolved'
      and not m.fresh_tesco
      and m.store_url='https://www.tesco.ie/shop/en-IE/products/'||m.store_sku
      and sc.c=1
      and exists(select 1 from scrape_product_receipts r where r.store_product_id=m.id and r.outcome='success')
      ${bothPeers}
      and exists(select 1 from tesco_direct_collection_pages d
        where d.requested_url=m.store_url
          and exists(select 1 from jsonb_array_elements(d.identity_results) i
            where i->>'storeProductId'=m.id::text and jsonb_array_length(i->'reasons')>0))
      and not exists(select 1 from attempted a where a.requested_url=m.store_url and (a.any_pending or a.recent24)))
  select id store_product_id, product_id, canonical_name, canonical_brand,
    store_product_name, store_brand, is_own_brand, store_sku, store_url,
    sv, dn, sv_price, dn_price, rs held_reasons, live_name
  from held`;
}
