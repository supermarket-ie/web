import { discover, type DiscoveryInput } from './tesco-discovery';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import type { Candidate, ExecuteSql } from './tesco-supervised-collection';

// Explicit operator-selected, completed acquisition evidence only. No writes,
// cached-price finalisation, network calls or automatic source-page selection.
export type AcquisitionSnapshot = {
  page: { id: string; run_id: string; requested_url: string; final_url: string; mode: string;
    outcome: string; http_status: number; body_sha256: string; created_at: string;
    detail: string; parsed: { products: TescoCollectedProduct[]; listing: unknown };
    identity_results: { storeProductId: string; sku: string; reasons: string[] }[] };
  run: { status: string; finished_at: string | null; error_summary: string };
  mappings: DiscoveryInput['mappings']; peers: DiscoveryInput['peers'];
  attempts: { id: string; requested_url: string; outcome: string }[]; receipts: number;
};
export type Acquisition = { pageId: string; snapshot: AcquisitionSnapshot };
export function handoffUuid(id: string) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid acquisition page ID');
  return `'${id}'`;
}
// Same snapshot is compared under the runner's gate/run locks at reservation and
// finalisation. An own reservation is excluded, but other attempts never are.
export function acquisitionSnapshotSql(pageId: string, ownRun?: string) {
  return `(select jsonb_build_object('page',to_jsonb(d),'run',jsonb_build_object('status',r.status,
    'finished_at',r.finished_at,'error_summary',r.error_summary),
    'mappings',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from (
      select s.id,s.product_id,p.canonical_name,p.brand canonical_brand,s.store_product_name,s.brand store_brand,
        s.is_own_brand,s.store_sku,s.store_url,s.url_status,s.gtin,l.observed_at,
        exists(select 1 from scrape_product_receipts z where z.store_product_id=s.id and z.outcome='success') proven
      from store_products s join products p on p.id=s.product_id left join latest_prices l on l.store_product_id=s.id
      where s.store='tesco' and s.store_sku=d.parsed->'products'->0->>'sku') m),'[]'::jsonb),
    'peers',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from (
      select s.id,s.product_id,s.store,s.store_product_name,s.brand,s.gtin,s.store_sku,l.observed_at
      from store_products s left join latest_prices l on l.store_product_id=s.id
      where s.store in ('supervalu','dunnes') and s.product_id in (select product_id from store_products
        where store='tesco' and store_sku=d.parsed->'products'->0->>'sku')) p),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'requested_url',a.requested_url,'outcome',a.outcome) order by a.id)
      from tesco_direct_collection_pages a where a.requested_url=d.requested_url
        ${ownRun ? `and a.run_id<>${handoffUuid(ownRun)}` : ''}),'[]'::jsonb),
    'receipts',(select count(*) from scrape_product_receipts where run_id=d.run_id))
    from tesco_direct_collection_pages d join scrape_runs r on r.id=d.run_id where d.id=${handoffUuid(pageId)})`;
}
export function acquisitionDecision(snapshot: AcquisitionSnapshot, live?: TescoCollectedProduct) {
  try {
    const { page, run, mappings, peers } = snapshot;
    const detail = JSON.parse(page.detail), summary = JSON.parse(run.error_summary);
    if (!run.finished_at || !['success', 'degraded'].includes(run.status) || summary.activeSupervisor != null
      || summary.protocol !== 'tesco-supervised-discovery-v1' || summary.pricesAllowed !== false
      || detail.acquisitionOnly !== true || detail.pricesInserted !== 0 || snapshot.receipts !== 0
      || page.outcome !== 'ok' || page.http_status !== 200 || page.mode !== 'products'
      || page.parsed.listing !== null || page.parsed.products.length !== 1 || mappings.length !== 1
      || snapshot.attempts.length !== 1 || snapshot.attempts[0].id !== page.id
      || snapshot.attempts[0].outcome !== 'ok') return null;
    const m = mappings[0], product = page.parsed.products[0];
    if (page.requested_url !== product.url || page.final_url !== product.url
      || product.url !== `https://www.tesco.ie/shop/en-IE/products/${product.sku}`
      || m.store_url !== product.url || m.store_sku !== product.sku
      || !page.identity_results.some(i => i.storeProductId === m.id && i.sku === product.sku && i.reasons.length === 0)) return null;
    const observed = Date.parse(detail.observedAt), reserved = Date.parse(page.created_at), finished = Date.parse(run.finished_at);
    if (!Number.isFinite(observed) || observed < reserved || observed > finished || observed > Date.now()) return null;
    const input: DiscoveryInput = { asOf: new Date().toISOString(), mappings, peers, demand: [], rejections: [],
      evidence: [{ product: live ?? product, page_id: page.id, body_sha256: page.body_sha256,
        created_at: detail.observedAt,
        requested_url: page.requested_url, final_url: page.final_url, mode: 'products' }],
      attempts: [{ requested_url: page.requested_url, unresolved: false,
        acquisitionPageId: page.id, acquisitionBodySha256: page.body_sha256 }] };
    // Live mode uses only the NEW parsed product for validation, never its price
    // or time as a replacement for the retained acquisition record.
    const decision = discover(input).decisions[0];
    return decision?.classification === 'ready' ? decision : null;
  } catch { return null; }
}
export async function selectAcquisitionCandidates(execute: ExecuteSql, pageIds: string[]): Promise<Candidate[]> {
  if (!pageIds.length || pageIds.length > 5 || new Set(pageIds).size !== pageIds.length) throw new Error('Select 1–5 distinct acquisition pages');
  pageIds.forEach(handoffUuid);
  const selected: Candidate[] = [];
  for (const pageId of pageIds) {
    const [row] = await execute(`select ${acquisitionSnapshotSql(pageId)} snapshot`);
    const s = row?.snapshot as AcquisitionSnapshot | null;
    if (!s || !acquisitionDecision(s)) continue;
    const m = s.mappings[0];
    if (!m.id || !m.store_sku || !m.store_url || !m.store_product_name || !m.url_status) continue;
    const peer = { id: m.id, product_id: m.product_id, canonical_name: m.canonical_name,
      canonical_brand: m.canonical_brand, store_product_name: m.store_product_name, store_brand: m.store_brand,
      is_own_brand: !!m.is_own_brand, store_sku: m.store_sku, store_url: m.store_url, url_status: m.url_status };
    selected.push({ ...peer, observed_at: null, price: null, due: false, held: false, proven: m.proven,
      overlap: new Set(s.peers.filter(p => p.observed_at && Date.parse(p.observed_at) > Date.now() - 7 * 86400000).map(p => p.store)).size,
      peers: [peer], acquisition: { pageId, snapshot: s } });
  }
  return selected.sort((a, b) => b.overlap - a.overlap || a.id.localeCompare(b.id));
}
