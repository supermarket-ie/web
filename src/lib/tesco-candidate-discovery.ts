import { supabaseAdmin } from '@/lib/supabase';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

type PriorMapping = {
  canonical_name?: string;
  canonical_brand?: string | null;
  store_product_name?: string | null;
  store_brand?: string | null;
  is_own_brand?: boolean | null;
  store_sku?: string | null;
  store_url?: string | null;
};

type AuditRow = {
  store_product_id: string;
  prior_mapping: PriorMapping;
};

export async function selectAuditedTescoDiscoveryProducts(limit: number): Promise<TescoQueueProduct[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 5));
  const { data: decisions, error: decisionError } = await supabaseAdmin
    .from('retailer_mapping_audit_decisions')
    .select('store_product_id,prior_mapping')
    .eq('decision_batch', 'tesco-risk-audit-2026-09-20-v1')
    .eq('classification', 'material_mismatch')
    .eq('applied_action', 'invalidate_trusted_mapping')
    .order('store_product_id');
  if (decisionError) throw new Error(`Failed selecting audited Tesco mappings: ${decisionError.message}`);

  const rows = (decisions ?? []) as AuditRow[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.store_product_id);
  const { data: attempted, error: attemptedError } = await supabaseAdmin
    .from('tesco_candidate_discovery_evidence')
    .select('store_product_id')
    .in('store_product_id', ids);
  if (attemptedError) throw new Error(`Failed selecting prior Tesco discovery evidence: ${attemptedError.message}`);
  const attemptedIds = new Set((attempted ?? []).map((row) => String(row.store_product_id)));
  const { data: priorRuns, error: priorRunError } = await supabaseAdmin.from('scrape_runs')
    .select('id').eq('store', 'tesco').eq('retrieval_method', 'pepesto_candidate_discovery');
  if (priorRunError) throw new Error(`Failed selecting prior Tesco discovery runs: ${priorRunError.message}`);
  const priorRunIds = (priorRuns ?? []).map((row) => String(row.id));
  if (priorRunIds.length) {
    const { data: sessions, error: sessionError } = await supabaseAdmin.from('pepesto_tesco_sessions')
      .select('products').in('run_uuid', priorRunIds);
    if (sessionError) throw new Error(`Failed selecting prior Tesco discovery sessions: ${sessionError.message}`);
    for (const session of sessions ?? []) {
      if (!Array.isArray(session.products)) continue;
      for (const product of session.products as Array<{storeProductId?:unknown}>) {
        if (product?.storeProductId) attemptedIds.add(String(product.storeProductId));
      }
    }
  }

  const eligible = rows.filter((row) => !attemptedIds.has(row.store_product_id));
  const canonicalNames = eligible.map((row) => row.prior_mapping.canonical_name).filter((name): name is string => Boolean(name));
  const demand = new Map<string, number>();
  if (canonicalNames.length) {
    const { data: items, error: itemError } = await supabaseAdmin
      .from('list_items')
      .select('canonical_name,quantity')
      .in('canonical_name', canonicalNames);
    if (itemError) throw new Error(`Failed ranking audited Tesco mappings: ${itemError.message}`);
    for (const item of items ?? []) {
      const name = String(item.canonical_name || '');
      demand.set(name, (demand.get(name) ?? 0) + Math.max(Number(item.quantity || 1), 1));
    }
  }

  return eligible
    .sort((left, right) => {
      const demandDiff = (demand.get(right.prior_mapping.canonical_name ?? '') ?? 0) - (demand.get(left.prior_mapping.canonical_name ?? '') ?? 0);
      return demandDiff || left.store_product_id.localeCompare(right.store_product_id);
    })
    .slice(0, safeLimit)
    .map((row) => {
      const prior = row.prior_mapping;
      const canonicalName = prior.canonical_name ?? prior.store_product_name ?? '';
      return {
        storeProductId: row.store_product_id,
        canonicalName,
        canonicalBrand: prior.canonical_brand ?? null,
        storeProductName: prior.store_product_name ?? canonicalName,
        storeBrand: prior.store_brand ?? null,
        isOwnBrand: prior.is_own_brand ?? null,
        storeUrl: prior.store_url ?? `https://www.tesco.ie/shop/en-IE/search?query=${encodeURIComponent(canonicalName)}`,
        storeSku: prior.store_sku ?? null,
        previousPrice: null,
        discoveryMode: 'audited_candidate_discovery',
      };
    });
}

export async function createTescoCandidateDiscoveryRun(products: TescoQueueProduct[]) {
  if (!products.length) return null;
  const runId = `pepesto_tesco_discovery_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const { data, error } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'tesco',
    retrieval_method: 'pepesto_candidate_discovery',
    run_scope: 'discovery',
    started_at: new Date().toISOString(),
    status: 'running',
    target_count: products.length,
    threshold_pct: 70,
    attempted_count: 0,
    fetched: 0,
    extracted: 0,
    inserted: 0,
    unchanged_count: 0,
    failed: 0,
    silently_skipped_count: 0,
    threshold_breached: false,
    scrapingbee_requests: 0,
    scrapingbee_credits: 0,
  }).select('id').single();
  if (error || !data?.id) throw new Error(`Failed opening Tesco candidate discovery run: ${error?.message || 'missing id'}`);
  return { runUuid: String(data.id), runId, products };
}
