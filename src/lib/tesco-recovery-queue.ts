// The owner-supplied Tesco recovery queue (scripts/data/tesco-recovery-queue-*.json).
// Discovery candidates only: every entry is rechecked live by the selector and
// the database guards. This module only derives ORDER and repair LEADS.
import type { RepairTarget } from './tesco-apify-collection';

type QueueCandidate = {
  mapping_id: string;
  prior_success_receipt?: boolean;
  fresh_peer_count?: number;
  other_owner_count?: number;
  candidate: { sku: string };
  current_mapping: { sku: string | null } | null;
  source?: { page_id: string; body_sha256: string } | null;
};
export type RecoveryQueueFile = {
  schema_version: number;
  snapshot_date: string;
  retained_barcode_candidates: QueueCandidate[];
  public_catalogue_hints: Array<{ mapping_id: string; candidate: { sku: string }; current_mapping: { sku: string | null } | null }>;
};
export type RecoveryPlan = {
  // Same-SKU, prior receipt: ordinary expansion, worked FIRST (queue order).
  expansionPriority: string[];
  // Same-SKU, NO receipt: evidence acquisition -> approval -> first price.
  // Both-peer entries first (only those are admitted by the selector).
  evidencePriority: string[];
  // Differing SKU with NO retained page (public catalogue leads): fetch the
  // target as repair evidence (stage hint).
  repairEvidenceTargets: RepairTarget[];
  // Differing SKU WITH a retained page and a prior receipt: ready for a
  // dry-run of the supervised repair stage (postgres bridge only).
  repairStageRows: Array<{ mapping_id: string; source_page_id: string; target_sku: string; source_body_sha256: string }>;
  // Differing SKU, NO receipt: the existing repair guard requires a prior
  // receipt, so these are reported, not acted on.
  repairUnsupported: string[];
};

const sameSku = (c: { candidate: { sku: string }; current_mapping: { sku: string | null } | null }) =>
  !!c.current_mapping?.sku && c.current_mapping.sku === c.candidate.sku;

export function planRecoveryQueue(q: RecoveryQueueFile): RecoveryPlan {
  if (q.schema_version !== 1 || !Array.isArray(q.retained_barcode_candidates)) throw new Error('Unsupported recovery queue');
  const c = q.retained_barcode_candidates;
  const byPeers = (a: QueueCandidate, b: QueueCandidate) => (b.fresh_peer_count ?? 0) - (a.fresh_peer_count ?? 0);
  return {
    expansionPriority: c.filter(x => x.prior_success_receipt && sameSku(x)).map(x => x.mapping_id),
    evidencePriority: c.filter(x => !x.prior_success_receipt && sameSku(x)).sort(byPeers).map(x => x.mapping_id),
    repairEvidenceTargets: (q.public_catalogue_hints ?? []).filter(x => !sameSku(x))
      .map(x => ({ mappingId: x.mapping_id, targetSku: x.candidate.sku })),
    repairStageRows: c.filter(x => x.prior_success_receipt && !sameSku(x) && x.source?.page_id)
      .map(x => ({ mapping_id: x.mapping_id, source_page_id: x.source!.page_id, target_sku: x.candidate.sku,
        source_body_sha256: x.source!.body_sha256 })),
    repairUnsupported: c.filter(x => !x.prior_success_receipt && !sameSku(x)).map(x => x.mapping_id),
  };
}
