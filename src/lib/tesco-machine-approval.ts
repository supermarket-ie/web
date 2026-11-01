import { independentExactIdentity, type MachineAssessment, type ReentryEvidence } from './tesco-hold-reentry';

// AI verdicts are hypotheses until the independent deterministic source gate
// has verified the CURRENT mapping/page/peers. No AI output authorises a price.
export type AiReviewedMapping = {
  type: 'candidate'; status: string; sku: string; mapping_id: string;
  source_page_id: string; source_body_sha256?: string; source_sha256?: string;
  review_reason: string; positive_independent_code_gate?: boolean;
  canonical_product_id?: string;
  source_identity?: { name: string; brand: string; quantity: Record<string, number> };
  tesco_name?: string; tesco_brand?: string; tesco_quantity?: Record<string, number>;
  source_gtin?: string; tesco_gtin?: string;
  peer_identity?: { store: string; name: string }[];
  peers?: { store: string; store_product_name: string }[];
};

function normal(s: string) {
  return s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function prepareMachineAssessment(
  row: AiReviewedMapping, current: ReentryEvidence | null,
  source: string, model: string,
): MachineAssessment | null {
  if (!current || row.type !== 'candidate'
    || !['AI_VERIFIED_PENDING_AUTHENTICATED_HUMAN_APPROVAL_AND_FRESH_LIVE_FETCH',
      'AI_INDEPENDENTLY_SUPPORTED_PENDING_PRIVILEGED_AUTH_APPROVAL'].includes(row.status)
    || row.positive_independent_code_gate === false
    || typeof row.review_reason !== 'string' || row.review_reason.trim().length < 30
    || !source || model.trim().length < 3
    || row.mapping_id !== current.mapping.id || row.source_page_id !== current.page.id
    || row.sku !== current.mapping.store_sku || (row.canonical_product_id
      && row.canonical_product_id !== current.mapping.product_id)
    || (row.source_body_sha256 ?? row.source_sha256) !== current.page.body_sha256
    || !independentExactIdentity(current)) return null;

  const product = current.page.parsed.products[0];
  if (!product || normal(row.source_identity?.name ?? row.tesco_name ?? '') !== normal(product.name)
    || normal(row.source_identity?.brand ?? row.tesco_brand ?? '') !== normal(product.brand ?? '')
    || JSON.stringify(row.source_identity?.quantity ?? row.tesco_quantity) !== JSON.stringify(product.quantity)
    || (row.source_gtin && row.source_gtin !== product.gtin)
    || (row.tesco_gtin && row.tesco_gtin !== product.gtin)) return null;

  const listedPeers = (row.peer_identity ?? row.peers ?? []).map(p => ({
    store:p.store, name:'name' in p ? p.name : p.store_product_name,
  }));
  if (listedPeers.length !== current.peers.length
    || listedPeers.some(p => !current.peers.some(q => q.store === p.store
      && normal(q.store_product_name) === normal(p.name)))) return null;

  return {
    decision:'verified_exact', model, source, reason:row.review_reason.trim(),
    mapping_id:current.mapping.id, source_page_id:current.page.id,
    source_body_sha256:current.page.body_sha256,
    validation:{independently_exact:true,
      checks:['one_to_one_sku','historical_success','retained_source_hash',
        'mapping_version','canonical_identity','tesco_brand','quantity_pack',
        'barcode_variant','fresh_peer_equivalence','no_pending_or_recent_attempt']},
  };
}
