import { supabaseAdmin } from '@/lib/supabase';
import { classifyTescoMapping } from '@/lib/tesco-mapping-audit';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';
import { independentlyReturnedProductIds, oneProductSearchAttemptCanonicalIds, selectUniqueCanonicalCandidates, type PepestoSessionEvidence } from '@/lib/tesco-proven-refresh-core';

type StoreProductRow = {
  id: string;
  product_id: string;
  store_product_name: string | null;
  brand: string | null;
  is_own_brand: boolean | null;
  store_url: string | null;
  store_sku: string | null;
  url_status: string | null;
  products: { canonical_name?: string | null; brand?: string | null } | Array<{ canonical_name?: string | null; brand?: string | null }> | null;
};

function relatedProduct(row: StoreProductRow) {
  return Array.isArray(row.products) ? row.products[0] : row.products;
}

function chunks<T>(values: T[], size = 200) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function selectProvenPepestoTescoProducts(limit: number): Promise<TescoQueueProduct[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const { data: runs, error: runError } = await supabaseAdmin.from('scrape_runs')
    .select('id').eq('store', 'tesco').eq('retrieval_method', 'pepesto_search');
  if (runError) throw new Error(`Failed loading prior Tesco search runs: ${runError.message}`);
  const runIds = (runs ?? []).map((row) => String(row.id));
  const sessions: PepestoSessionEvidence[] = [];
  for (const runIdChunk of chunks(runIds)) {
    const { data, error } = await supabaseAdmin.from('pepesto_tesco_sessions')
      .select('run_uuid,products,result_summary').in('run_uuid', runIdChunk);
    if (error) throw new Error(`Failed loading prior Tesco search sessions: ${error.message}`);
    sessions.push(...((data ?? []) as PepestoSessionEvidence[]));
  }
  const independentlyReturnedIds = independentlyReturnedProductIds(sessions);
  const canonicalByStoreProductId = new Map<string, string>();

  const successfulIds = new Set<string>();
  for (const runIdChunk of chunks(runIds)) {
    const { data, error } = await supabaseAdmin.from('scrape_product_receipts')
      .select('store_product_id').in('run_id', runIdChunk).eq('outcome', 'success');
    if (error) throw new Error(`Failed loading prior Tesco search receipts: ${error.message}`);
    for (const row of data ?? []) {
      const id = String(row.store_product_id);
      if (independentlyReturnedIds.has(id)) successfulIds.add(id);
    }
  }
  const rows: StoreProductRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin.from('store_products')
      .select('id,product_id,store_product_name,brand,is_own_brand,store_url,store_sku,url_status,products(canonical_name,brand)')
      .eq('store', 'tesco').order('id').range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed loading Tesco mappings: ${error.message}`);
    rows.push(...((data ?? []) as StoreProductRow[]));
    for (const row of (data ?? []) as StoreProductRow[]) canonicalByStoreProductId.set(row.id, row.product_id);
    if ((data ?? []).length < pageSize) break;
  }

  const oneProductAttemptCanonicalIds = oneProductSearchAttemptCanonicalIds(sessions, canonicalByStoreProductId);

  const freshCanonicalIds = new Set<string>();
  const { data: freshRows, error: freshError } = await supabaseAdmin.from('latest_prices')
    .select('store_product_id').eq('store', 'tesco');
  if (freshError) throw new Error(`Failed checking fresh Tesco mappings: ${freshError.message}`);
  for (const row of freshRows ?? []) {
    const canonical = canonicalByStoreProductId.get(String(row.store_product_id));
    if (canonical) freshCanonicalIds.add(canonical);
  }

  const peersBySku = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.store_sku) continue;
    const canonicalName = relatedProduct(row)?.canonical_name;
    if (!canonicalName) continue;
    peersBySku.set(row.store_sku, [...(peersBySku.get(row.store_sku) ?? []), canonicalName]);
  }

  const eligible = rows.filter((row) => {
    if (row.url_status === 'failed' || freshCanonicalIds.has(row.product_id)) return false;
    const canonical = relatedProduct(row);
    const canonicalName = canonical?.canonical_name ?? '';
    const peers = row.store_sku ? peersBySku.get(row.store_sku) ?? [] : [];
    const result = classifyTescoMapping({
      storeProductId: row.id,
      canonicalName,
      canonicalBrand: canonical?.brand ?? null,
      storeProductName: row.store_product_name,
      storeBrand: row.brand,
      isOwnBrand: row.is_own_brand,
      storeSku: row.store_sku,
      storeUrl: row.store_url!,
      duplicateSkuCount: Math.max(peers.length, 1),
      duplicateCanonicalNames: peers,
      isFresh: false,
    });
    return result.classification === 'obsolete_mapping' || result.classification === 'exact_synonym_duplicate';
  });

  const demand = new Map<string, number>();
  const canonicalNames = eligible.map((row) => relatedProduct(row)?.canonical_name).filter((name): name is string => Boolean(name));
  for (const nameChunk of chunks(canonicalNames)) {
    const { data, error } = await supabaseAdmin.from('list_items').select('canonical_name,quantity').in('canonical_name', nameChunk);
    if (error) throw new Error(`Failed ranking proven Tesco mappings: ${error.message}`);
    for (const item of data ?? []) {
      const name = String(item.canonical_name || '');
      demand.set(name, (demand.get(name) ?? 0) + Math.max(Number(item.quantity || 1), 1));
    }
  }

  const candidates = eligible.map((row) => {
    const canonical = relatedProduct(row);
    const canonicalName = canonical?.canonical_name ?? '';
    return {
      productId: row.product_id,
      storeProductId: row.id,
      demandUnits: demand.get(canonicalName) ?? 0,
      proven: successfulIds.has(row.id),
      resolved: row.url_status === 'resolved' && Boolean(row.store_sku && row.store_url && row.store_product_name),
      audited: true,
      value: row,
    };
  });

  const selected = selectUniqueCanonicalCandidates(candidates, safeLimit, oneProductAttemptCanonicalIds);
  return selected.map(({ value: row }) => {
    const canonical = relatedProduct(row);
    const canonicalName = canonical?.canonical_name ?? row.store_product_name ?? '';
    return {
      storeProductId: row.id,
      productId: row.product_id,
      canonicalName,
      canonicalBrand: canonical?.brand ?? null,
      storeProductName: row.store_product_name ?? canonicalName,
      storeBrand: row.brand,
      isOwnBrand: row.is_own_brand,
      storeUrl: row.store_url!,
      storeSku: row.store_sku,
      previousPrice: null,
    };
  });
}
