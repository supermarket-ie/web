/**
 * Tesco mapping-recovery PILOT — discovery + identity-verification ONLY.
 *
 * This module supports a bounded, supervised pilot that measures whether correct
 * Tesco mappings can be rediscovered + independently verified for high-value held
 * products (those with fresh Dunnes AND SuperValu prices, so each recovery is a
 * three-retailer comparison).
 *
 * HARD BOUNDARIES (enforced here by omission):
 *  - It NEVER calls finalize_tesco_candidate_discovery (no store_products SKU/URL
 *    change, no trusted price write). It only SELECTS a cohort and CLASSIFIES
 *    discovered candidates with the existing deterministic validator.
 *  - It NEVER touches the master `products` canonical, protective holds, or the 6
 *    historical unresolved (pending) requests.
 *  - Search-result prices are evidence only, never trusted observations.
 *
 * Correction (updating an approved mapping) + fresh live price verification is a
 * SEPARATE later implementation/release step, intentionally not in this module.
 */
import { classifyTescoReplacement, type TescoMappingEvidence } from '@/lib/tesco-mapping-audit';

export const PILOT_MAX_PRODUCTS = 50;

/** One selected high-value held Tesco mapping for the discovery pilot. */
export type PilotCandidate = {
  storeProductId: string;
  productId: string;
  canonicalName: string;
  canonicalBrand: string | null;
  storeProductName: string;
  storeBrand: string | null;
  isOwnBrand: boolean | null;
  storeSku: string | null;
  storeUrl: string | null;
  // The dominant stored identity-rejection reason(s) (from identity_results).
  heldReasons: string[];
  // Live Tesco title/price last captured for this SKU (evidence, not trusted).
  liveName: string | null;
  livePrice: number | null;
  // Fresh peer prices (for prioritisation / expected new comparisons).
  supervaluPrice: number | null;
  dunnesPrice: number | null;
  bothPeers: boolean;
  // Probable defect bucket + difficulty + class (from the stored vs live evidence).
  defect: PilotDefect;
};

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

/** The five classification outcomes required by the pilot report. */
export type PilotClassification =
  | 'exact_verified'          // one distinct candidate passes classifyTescoReplacement
  | 'plausible_more_evidence' // related but a material attribute unverified
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

/**
 * Classify the candidates discovered for ONE pilot product, WITHOUT applying
 * anything. Reuses the exact-identity validator classifyTescoReplacement so the
 * pilot's verdict matches production acceptance rules (no relaxed matching).
 *
 * Returns the outcome plus the single exact candidate (if exactly one distinct
 * exact SKU) so the report can propose a SKU for operator review — never applied.
 */
export function classifyPilotDiscovery(
  product: Pick<PilotCandidate, 'storeProductId' | 'canonicalName' | 'canonicalBrand' | 'storeProductName' | 'storeBrand' | 'isOwnBrand' | 'storeSku' | 'storeUrl'>,
  candidates: DiscoveredCandidate[],
  options: { accessOrExecutionFailure?: boolean } = {},
): { outcome: PilotClassification; exactCandidate: DiscoveredCandidate | null; evidence: Array<{ candidate: DiscoveredCandidate; classification: string; reasons: string[] }> } {
  if (options.accessOrExecutionFailure) {
    return { outcome: 'access_or_execution_failure', exactCandidate: null, evidence: [] };
  }
  if (!candidates.length) {
    return { outcome: 'no_reliable_candidate', exactCandidate: null, evidence: [] };
  }
  const mapping: TescoMappingEvidence = {
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
  const evidence = candidates.map((candidate) => {
    const audit = (candidate.name && candidate.priceCents > 0)
      ? classifyTescoReplacement(mapping, {
          sku: candidate.sku ?? '',
          url: candidate.url,
          name: candidate.name,
          structuredQuantity: candidate.structuredQuantity ?? null,
          evidenceSource: 'pilot-discovery-single',
        })
      : { classification: 'insufficient_evidence' as const, reasons: ['candidate requires a non-empty name and positive observed price'], signals: undefined as never };
    return { candidate, classification: audit.classification, reasons: audit.reasons };
  });
  const exact = evidence.filter((e) => e.classification === 'exact_replacement_candidate' && e.candidate.sku);
  const distinctExactSkus = new Set(exact.map((e) => e.candidate.sku));
  if (exact.length && distinctExactSkus.size === 1) {
    return { outcome: 'exact_verified', exactCandidate: exact[0].candidate, evidence };
  }
  // Material mismatch on every candidate -> clearly a different product/variant/pack.
  if (evidence.every((e) => e.classification === 'material_mismatch')) {
    return { outcome: 'wrong_product_variant_pack', exactCandidate: null, evidence };
  }
  // Something related but not independently exact (ambiguous / multi-exact / mixed).
  return { outcome: 'plausible_more_evidence', exactCandidate: null, evidence };
}

/**
 * Read-only SQL to select the pilot cohort: held, unique-SKU, PROVEN, canonical-URL
 * Tesco mappings with NO fresh trusted price, prioritising products that already
 * have a fresh price at BOTH Dunnes and SuperValu (then one peer), by canonical
 * name. Excludes shared-SKU groups and any URL with a pending (unknown-outcome)
 * page — so the 6 historical unresolved are never selected.
 *
 * The caller runs this via the supervised SQL bridge (read-only). It does not
 * mutate anything.
 */
export function pilotCohortSql(limit: number): string {
  const n = Math.max(1, Math.min(Math.floor(limit), PILOT_MAX_PRODUCTS));
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
      max((store='supervalu')::int)=1 sv, max((store='dunnes')::int)=1 dn
    from latest_prices where store in ('supervalu','dunnes') group by canonical_product_id),
  attempted as (
    select requested_url,
      bool_or(outcome='pending') any_pending,
      bool_or(created_at>now()-interval '24 hours') recent24
    from tesco_direct_collection_pages group by requested_url),
  held as (
    select m.*, coalesce(pr.sv,false) sv, coalesce(pr.dn,false) dn
    from m
    join peers pr on pr.canonical_product_id=m.product_id
    join sku_counts sc on sc.store_sku=m.store_sku
    where m.url_status='resolved'
      and not m.fresh_tesco
      and m.store_url='https://www.tesco.ie/shop/en-IE/products/'||m.store_sku
      and sc.c=1
      and exists(select 1 from scrape_product_receipts r where r.store_product_id=m.id and r.outcome='success')
      and (pr.sv or pr.dn)
      -- held on an identity reason (has a page with reasons for this product) AND
      -- not a pending/unknown URL and not a recent 24h attempt.
      and exists(select 1 from tesco_direct_collection_pages d
        where d.requested_url=m.store_url
          and exists(select 1 from jsonb_array_elements(d.identity_results) i
            where i->>'storeProductId'=m.id::text and jsonb_array_length(i->'reasons')>0))
      and not exists(select 1 from attempted a where a.requested_url=m.store_url and (a.any_pending or a.recent24)))
  select id store_product_id, product_id, canonical_name, canonical_brand,
    store_product_name, store_brand, is_own_brand, store_sku, store_url, sv, dn
  from held
  order by (sv and dn) desc, canonical_name asc
  limit ${n}`;
}
