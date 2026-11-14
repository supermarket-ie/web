// Bulk review of RETAINED Tesco evidence for mappings without a fresh price.
// Pure classification with the SAME gates the collector uses. It writes nothing
// and never grants trust: every class only decides the NEXT guarded step
// (fresh fetch + deterministic gate + AI verified_exact + guarded finalise).
import { validateTescoCollectedIdentity, type TescoCollectedProduct } from './tesco-direct-collection-core';
import { firstPriceCorroboration, independentExactIdentity, reviewedCanonicalEvidenceGap } from './tesco-hold-reentry';
import { assessmentEvidence, snapshotIdentity, snapshotMappingEvidence, type ApifyPeer } from './tesco-apify-collection';

export type RetainedClass =
  | 'exact_match'          // gate + stronger identity pass on retained evidence
  | 'catalogue_gap'        // only an incomplete canonical description; reviewed gap route applies
  | 'genuine_mismatch'     // material brand/variant/pack/barcode/type conflict -> replacement SKU discovery
  | 'needs_evidence'       // no conflict, but corroboration is insufficient (peers, pack, brand)
  | 'unusable_page';       // page does not carry exactly one product for the mapped SKU

export type RetainedNextStep =
  | 'ordinary_expansion'           // proven: fresh fetch, gate + AI, guarded finalise
  | 'evidence_then_approval'       // no receipt: evidence-only fetch -> AI approval -> first price
  | 'replacement_sku_discovery'    // the mapped SKU is the wrong product
  | 'acquire_evidence'             // fetch fresh evidence / wait for peers
  | 'none';

export type RetainedReview = {
  mappingId: string; sku: string; proven: boolean; peerStores: number;
  klass: RetainedClass; next: RetainedNextStep; reasons: string[]; pageAgeDays: number;
};

const GAP = new Set(['measureExactnessFailed', 'candidate does not establish full exact canonical identity', 'packExactnessFailed']);
const CONFLICT = /Conflict|brandExactnessFailed|raw_ingredient_prepared_meal_conflict|barcode/i;

export function reviewRetained(input: {
  snapshot: Record<string, unknown>;
  page: { id: string; body_sha256: string | null; parsed: { products?: TescoCollectedProduct[] } | null; created_at: string };
  peers: ApifyPeer[];
  proven: boolean;
  now?: number;
}): RetainedReview {
  const ident = snapshotIdentity(input.snapshot);
  const now = input.now ?? Date.now();
  const base = { mappingId: ident.storeProductId, sku: ident.storeSku, proven: input.proven,
    peerStores: new Set(input.peers.map(p => p.store)).size,
    pageAgeDays: Math.round((now - Date.parse(input.page.created_at)) / 86400_000) };
  const matches = (input.page.parsed?.products ?? []).filter(p => p.sku === ident.storeSku);
  if (matches.length !== 1 || !input.page.body_sha256) {
    return { ...base, klass: 'unusable_page', next: 'acquire_evidence', reasons: ['page_not_exactly_one_mapped_product'] };
  }
  const product = matches[0];
  const ev = assessmentEvidence(ident, input.page.id, input.page.body_sha256, product, input.peers, input.proven);
  const reasons = validateTescoCollectedIdentity(snapshotMappingEvidence(ident, false), product);
  const conflicts = reasons.filter(r => CONFLICT.test(r));
  if (conflicts.length) return { ...base, klass: 'genuine_mismatch', next: 'replacement_sku_discovery', reasons };

  const advance: RetainedNextStep = input.proven ? 'ordinary_expansion' : 'evidence_then_approval';
  if (reasons.length === 0) {
    if (!input.proven) {
      const c = firstPriceCorroboration(ev, product);
      if (!c.ok) return { ...base, klass: 'needs_evidence', next: 'acquire_evidence',
        reasons: c.perPeer.length ? c.perPeer.filter(p => p.reasons.length).map(p => `${p.store}:${p.reasons.join('+')}`) : [`peer_stores:${c.stores || 'none'}`] };
    }
    return independentExactIdentity(ev, product)
      ? { ...base, klass: 'exact_match', next: advance, reasons: [] }
      : { ...base, klass: 'needs_evidence', next: 'acquire_evidence', reasons: ['independent_identity_not_established'] };
  }
  // Only canonical-description gaps. The reviewed gap route needs the stronger
  // identity gate (for a first price: BOTH peers independently matching) and
  // still needs the AI verified_exact verdict on the fresh page.
  if (reasons.every(r => GAP.has(r))) {
    if (reviewedCanonicalEvidenceGap(ev, product, reasons)) {
      return { ...base, klass: 'catalogue_gap', next: advance, reasons };
    }
    return { ...base, klass: 'needs_evidence', next: 'acquire_evidence', reasons };
  }
  return { ...base, klass: 'needs_evidence', next: 'acquire_evidence', reasons };
}
