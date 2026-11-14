// Evidence-bound, single-use FIRST-PRICE approvals (migration 20261113090000).
//
// An approval authorises exactly ONE first price for ONE mapping with no prior
// success receipt. It is created from RETAINED Tesco evidence (an ok page for the
// mapping's canonical URL, <= 14 days old) by an independent AI assessment, and
// it is bound to: the mapping snapshot, the evidence page id + body sha256, and
// the identity fingerprint the AI assessed. The database re-validates every
// binding when recording, then again at reserve and finalise, and consumes the
// approval atomically with the price + receipt write.
//
// This module only PREPARES and RECORDS approvals. It never writes a price.
// The AI verdict is mandatory and is never bypassed by peers or the gate.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateTescoCollectedIdentity,
  type TescoCollectedProduct,
} from './tesco-direct-collection-core';
import { assessAndCombine, type AssessOptions } from './tesco-identity-assessment';
import { firstPriceCorroboration } from './tesco-hold-reentry';
import {
  assessmentEvidence, selectApifyMappings, snapshotIdentity, snapshotMappingEvidence,
  type ApifyPeer, type SelectionOptions,
} from './tesco-apify-collection';

export const EVIDENCE_MAX_AGE_DAYS = 14;

export type RetainedEvidencePage = {
  id: string;
  requested_url: string;
  outcome: string;
  body_sha256: string | null;
  parsed: { products?: TescoCollectedProduct[] } | null;
  created_at: string;
};

export type FirstPriceApprovalArgs = {
  p_store_product_id: string;
  p_evidence_page_id: string;
  p_evidence_body_sha256: string;
  p_identity_fingerprint: string;
  p_assessment: Record<string, unknown>;
  p_expected_snapshot: Record<string, unknown>;
};

export type ApprovalAssessment =
  | { ok: true; args: FirstPriceApprovalArgs; route: 'deterministic_plus_ai' }
  | { ok: false; reason: string };

// Pure (apart from the injected model): decide whether a retained page supports
// an approval and, if so, build the exact RPC arguments.
export async function assessFirstPriceCandidate(input: {
  snapshot: Record<string, unknown>;
  page: RetainedEvidencePage;
  peers: ApifyPeer[];
  assessOptions?: AssessOptions;
  now?: number;
  aiRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ApprovalAssessment> {
  const { snapshot, page, peers } = input;
  const now = input.now ?? Date.now();
  const ident = snapshotIdentity(snapshot);

  if (ident.sameSkuCanonicalNames.length > 1) return { ok: false, reason: 'shared_sku_requires_review' };
  if (snapshot.url_status !== 'resolved'
    || ident.storeUrl !== `https://www.tesco.ie/shop/en-IE/products/${ident.storeSku}`) {
    return { ok: false, reason: 'mapping_not_resolved' };
  }
  if (page.outcome !== 'ok' || page.requested_url !== ident.storeUrl) return { ok: false, reason: 'evidence_not_ok_page_for_url' };
  if (!page.body_sha256 || !/^[a-f0-9]{64}$/.test(page.body_sha256)) return { ok: false, reason: 'evidence_hash_missing' };
  if (Date.parse(page.created_at) < now - EVIDENCE_MAX_AGE_DAYS * 86400_000) return { ok: false, reason: 'evidence_stale' };
  const matches = (page.parsed?.products ?? []).filter(p => p.sku === ident.storeSku);
  if (matches.length !== 1) return { ok: false, reason: 'evidence_not_exactly_one_product' };
  const product = matches[0];
  if (new Set(peers.map(p => p.store)).size < 2) return { ok: false, reason: 'both_fresh_peers_required' };

  // proven=false: the mapping has NO success receipt and the evidence says so
  // (firstPriceOnboarding), which requires BOTH fresh peers in the stronger gate.
  const ev = assessmentEvidence(ident, page.id, page.body_sha256, product, peers, false);
  // The ordinary deterministic gate must pass outright. The canonical-gap
  // recovery route is NOT available to a first price.
  const reasons = validateTescoCollectedIdentity(snapshotMappingEvidence(ident, false), product);
  if (reasons.length > 0) return { ok: false, reason: `deterministic_hold:${reasons.join(',')}` };
  // BOTH peers must independently match; one matching peer is never enough.
  const corroboration = firstPriceCorroboration(ev, product);
  if (!corroboration.ok) {
    const detail = corroboration.perPeer.filter(p => p.reasons.length).map(p => `${p.store}=${p.reasons.join('+')}`);
    return { ok: false, reason: `first_price_peer_hold:${detail.join(';') || `stores=${corroboration.stores}`}` };
  }

  const retries = input.aiRetries ?? 2;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let verdict: Awaited<ReturnType<typeof assessAndCombine>> | null = null;
  for (let attempt = 0; attempt <= retries && !verdict; attempt += 1) {
    try { verdict = await assessAndCombine(ev, product, page.id, input.assessOptions); }
    catch { if (attempt < retries) await sleep(1_000 * (attempt + 1)); }
  }
  if (!verdict) return { ok: false, reason: 'ai_error' };
  if (verdict.decision !== 'verified_exact' || !verdict.machineAssessment) return { ok: false, reason: `ai_${verdict.decision}` };

  const fingerprint = verdict.assessment.identity_fingerprint;
  const m = verdict.machineAssessment;
  return {
    ok: true,
    route: 'deterministic_plus_ai',
    args: {
      p_store_product_id: ident.storeProductId,
      p_evidence_page_id: page.id,
      p_evidence_body_sha256: page.body_sha256,
      p_identity_fingerprint: fingerprint,
      p_assessment: {
        decision: m.decision, model: m.model, reason: m.reason,
        rule_version: verdict.assessment.rule_version,
        mapping_id: m.mapping_id, source_page_id: m.source_page_id, source_body_sha256: m.source_body_sha256,
        identity_fingerprint: fingerprint,
        source: m.source, assessed_at: verdict.assessment.assessed_at,
        route: 'deterministic_plus_ai', first_price_onboarding: true,
      },
      p_expected_snapshot: snapshot,
    },
  };
}

export type ApprovalRunSummary = {
  considered: number; noEvidence: number; assessed: number; approved: number; recorded: number;
  rejected: Record<string, number>;
};

// Select first-price candidates (unproven, never observed, both fresh peers, no
// live approval), assess each against its newest retained evidence page, and
// (only when apply=true) record the approvals. apply=false is a dry run.
export async function prepareFirstPriceApprovals(
  sb: SupabaseClient,
  opts: { limit: number; apply: boolean; assessOptions?: AssessOptions; ttlHours?: number;
    log?: (e: Record<string, unknown>) => void; scan?: number; priorityIds?: SelectionOptions['priorityIds'] },
): Promise<ApprovalRunSummary> {
  const summary: ApprovalRunSummary = { considered: 0, noEvidence: 0, assessed: 0, approved: 0, recorded: 0, rejected: {} };
  const reject = (reason: string) => { const k = reason.split(':')[0]; summary.rejected[k] = (summary.rejected[k] ?? 0) + 1; };
  const cutoff = new Date(Date.now() - EVIDENCE_MAX_AGE_DAYS * 86400_000).toISOString();
  // Candidates already HAVE recent Apify evidence (the selector requires it) and
  // are not excluded by the 24h request window: evidence minutes old is fine.
  const candidates = await selectApifyMappings(sb, 'expansion', opts.scan ?? 1000, false,
    { approvalCandidates: true, priorityIds: opts.priorityIds });

  for (const m of candidates) {
    if (summary.approved >= opts.limit) break;
    summary.considered += 1;
    // Newest IMMUTABLE provider-evidence row for this mapping's own URL, then its
    // page. Legacy pages without provider evidence are never used.
    const { data: prov, error: provError } = await sb.from('tesco_apify_provider_evidence')
      .select('page_id,adapter_body_sha256,captured_at')
      .eq('store_product_id', m.id).eq('requested_url', m.store_url).gte('captured_at', cutoff)
      .order('captured_at', { ascending: false }).limit(1);
    if (provError) throw new Error(`Loading provider evidence: ${provError.message}`);
    const pe = prov?.[0];
    let page: RetainedEvidencePage | null = null;
    if (pe) {
      const { data, error } = await sb.from('tesco_direct_collection_pages')
        .select('id,requested_url,outcome,body_sha256,parsed,created_at').eq('id', pe.page_id).limit(1);
      if (error) throw new Error(`Loading retained evidence: ${error.message}`);
      const p = (data?.[0] ?? null) as RetainedEvidencePage | null;
      page = p && p.body_sha256 === pe.adapter_body_sha256 ? p : null;
    }
    if (!page || !m.snapshot) { summary.noEvidence += 1; continue; }
    summary.assessed += 1;
    const r = await assessFirstPriceCandidate({ snapshot: m.snapshot, page, peers: m.peers, assessOptions: opts.assessOptions });
    if (!r.ok) { reject(r.reason); opts.log?.({ event: 'approval_rejected', sku: m.store_sku, reason: r.reason }); continue; }
    summary.approved += 1;
    if (!opts.apply) { opts.log?.({ event: 'approval_dry_run', sku: m.store_sku, route: r.route }); continue; }
    try {
      const { data: id, error: rpcError } = await sb.rpc('apify_record_first_price_approval', {
        ...r.args, p_ttl_hours: opts.ttlHours ?? 72,
      });
      if (rpcError) throw new Error(rpcError.message);
      summary.recorded += 1;
      opts.log?.({ event: 'approval_recorded', sku: m.store_sku, route: r.route, approvalId: id });
    } catch (e) {
      reject(`record_refused:${e instanceof Error ? e.message : 'error'}`);
      opts.log?.({ event: 'approval_record_refused', sku: m.store_sku, message: e instanceof Error ? e.message : 'error' });
    }
  }
  return summary;
}
