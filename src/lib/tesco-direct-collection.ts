import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { claimTescoEgress, markTescoEgressSuccess, releaseTescoEgress } from '@/lib/tesco-egress';
import { classifyTescoMapping, type TescoMappingEvidence } from '@/lib/tesco-mapping-audit';
import {
  fetchTescoCollectedPage, parseTescoCollectedPage, tescoListingUrl, tescoPauseUntil, tescoProductUrl,
  validateTescoCollectedIdentity, type TescoCollectedPage, type TescoCollectedProduct,
} from '@/lib/tesco-direct-collection-core';

type MappingRow = {
  id: string; product_id: string; store_sku: string | null; store_url: string | null;
  store_product_name: string | null; brand: string | null; is_own_brand: boolean | null; url_status: string | null;
  products: { canonical_name: string; brand: string | null } | { canonical_name: string; brand: string | null }[] | null;
};
type Mapping = TescoMappingEvidence & { productId: string; resolved: boolean; observedAt: string | null; demand: number };
type CachedPage = { requested_url: string; parsed: TescoCollectedPage | null; outcome: string };
export type TescoCollectionMode = 'probe' | 'products' | 'listings';

async function loadMappings(): Promise<Mapping[]> {
  const rows: MappingRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('store_products')
      .select('id,product_id,store_sku,store_url,store_product_name,brand,is_own_brand,url_status,products(canonical_name,brand)')
      .eq('store', 'tesco').order('id').range(offset, offset + 999);
    if (error) throw new Error(`Loading Tesco mappings: ${error.message}`);
    rows.push(...(data ?? []) as MappingRow[]);
    if ((data ?? []).length < 1000) break;
  }
  const fresh = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('latest_prices').select('store_product_id,observed_at')
      .eq('store', 'tesco').order('store_product_id').range(offset, offset + 999);
    if (error) throw new Error(`Loading Tesco freshness: ${error.message}`);
    for (const row of data ?? []) fresh.set(String(row.store_product_id), String(row.observed_at));
    if ((data ?? []).length < 1000) break;
  }
  const demand = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('list_items').select('id,canonical_name,quantity').order('id').range(offset, offset + 999);
    if (error) throw new Error(`Loading Tesco demand ranking: ${error.message}`);
    for (const row of data ?? []) {
      const name = String(row.canonical_name).trim().toLowerCase();
      demand.set(name, (demand.get(name) ?? 0) + Math.max(Number(row.quantity) || 1, 1));
    }
    if ((data ?? []).length < 1000) break;
  }
  const canonical = (r: MappingRow) => Array.isArray(r.products) ? r.products[0] : r.products;
  const peers = new Map<string, string[]>();
  for (const row of rows) {
    if (row.store_sku) peers.set(row.store_sku, [...(peers.get(row.store_sku) ?? []), canonical(row)?.canonical_name ?? '']);
  }
  return rows.map(row => ({
    storeProductId: row.id, productId: row.product_id, canonicalName: canonical(row)?.canonical_name ?? '',
    canonicalBrand: canonical(row)?.brand, storeProductName: row.store_product_name, storeBrand: row.brand,
    isOwnBrand: row.is_own_brand, storeSku: row.store_sku, storeUrl: row.store_url,
    resolved: row.url_status === 'resolved', isFresh: fresh.has(row.id), observedAt: fresh.get(row.id) ?? null,
    duplicateSkuCount: row.store_sku ? (peers.get(row.store_sku)?.length ?? 1) : 1,
    duplicateCanonicalNames: row.store_sku ? peers.get(row.store_sku) : [],
    demand: demand.get((canonical(row)?.canonical_name ?? '').trim().toLowerCase()) ?? 0,
  }));
}

async function recentPages(): Promise<Map<string, CachedPage>> {
  const rows = new Map<string, CachedPage>();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('tesco_direct_collection_pages')
      .select('requested_url,parsed,outcome').gte('created_at', since)
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 999);
    if (error) throw new Error(`Loading recent Tesco requests: ${error.message}`);
    for (const row of data ?? []) if (!rows.has(row.requested_url)) rows.set(row.requested_url, row as CachedPage);
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

async function pauseEgress(egressKey: string, until: string, blocked: boolean) {
  const { error } = await supabaseAdmin.rpc('pause_tesco_collection_egress', { p_egress_key: egressKey, p_until: until, p_blocked: blocked });
  if (error) throw new Error(`Persisting Tesco pause: ${error.message}`);
}

export async function collectTescoDirect(options: { mode: TescoCollectionMode; maxPages?: number; query?: string }) {
  const maxPages = options.mode === 'probe' ? 2 : Math.max(1, Math.min(options.maxPages ?? 5, 6));
  const query = options.query?.trim() || 'milk';
  const listingUrl = tescoListingUrl(query); // validate before opening work
  const { count, error: gateError } = await supabaseAdmin.from('tesco_egress_pool').select('egress_key', { count: 'exact', head: true }).eq('enabled', true);
  if (gateError) throw new Error(`Checking Tesco gate: ${gateError.message}`);
  if (count !== 1) return { status: 'cooldown_or_disabled', requests: 0, pricesWritten: 0 };
  // One lease spans the entire 240s function. This is a deployment-path gate,
  // not a claim that ordinary Vercel egress has a fixed IP address.
  const lease = await claimTescoEgress(600);
  if (!lease) return { status: 'cooldown_or_disabled', requests: 0, pricesWritten: 0 };
  let runUuid: string | null = null;
  let paused = false;
  let released = false;
  let requests = 0;
  let cacheSkips = 0;
  let pricesWritten = 0;
  let stopReason: string | null = null;
  const started = Date.now();
  try {
    const [mappings, cache] = await Promise.all([loadMappings(), recentPages()]);
    const due = (m: Mapping) => !m.observedAt || Date.parse(m.observedAt) <= Date.now() - 4 * 24 * 3600_000;
    const targets = mappings.filter(m => m.resolved && m.storeSku && due(m))
      .filter(m => ['exact_unique', 'obsolete_mapping', 'exact_synonym_duplicate'].includes(classifyTescoMapping(m).classification))
      .sort((a, b) => Number(a.isFresh) - Number(b.isFresh) || b.demand - a.demand || (a.observedAt ?? '').localeCompare(b.observedAt ?? '') || a.storeProductId.localeCompare(b.storeProductId));
    const urls = options.mode === 'probe'
      ? [tescoProductUrl('317297946'), listingUrl]
      : options.mode === 'listings' ? [listingUrl]
        : [...new Set(targets.map(m => tescoProductUrl(m.storeSku!)))].filter(url => !cache.has(url)).slice(0, maxPages);
    if (!urls.length) return { status: 'no_due_products', requests: 0, pricesWritten: 0 };
    const runId = `tesco_direct_${options.mode}_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
    const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
      run_id: runId, store: 'tesco', retrieval_method: 'tesco_direct_structured', run_scope: 'canary',
      started_at: new Date().toISOString(), status: 'running', target_count: 0, threshold_pct: 70,
      attempted_count: 0, fetched: 0, extracted: 0, inserted: 0, unchanged_count: 0, failed: 0,
      silently_skipped_count: 0, threshold_breached: false,
    }).select('id').single();
    if (runError || !run?.id) throw new Error(`Opening Tesco collection: ${runError?.message}`);
    runUuid = run.id;
    const collected = new Map<string, TescoCollectedProduct>();
    const seenUrls = new Set<string>();
    for (let index = 0; index < urls.length && requests < maxPages; index += 1) {
      const url = urls[index];
      if (seenUrls.has(url)) break;
      seenUrls.add(url);
      const prior = cache.get(url);
      if (prior) {
        cacheSkips += 1;
        // Never turn cached evidence into a new observation or a new probe pass.
        if (options.mode === 'listings' && prior.outcome === 'ok' && prior.parsed?.listing?.nextUrl) urls.push(prior.parsed.listing.nextUrl);
        if (seenUrls.size >= 100) break;
        continue;
      }
      if (Date.now() - started > 150_000) { stopReason = 'runtime_budget'; break; }
      if (requests > 0) await new Promise(resolve => setTimeout(resolve, 10_000));
      const { data: pageRow, error: insertError } = await supabaseAdmin.from('tesco_direct_collection_pages').insert({
        run_id: runUuid, egress_key: lease.egressKey, requested_url: url, mode: options.mode, outcome: 'pending',
      }).select('id').single();
      if (insertError || !pageRow) throw new Error(`Reserving Tesco request: ${insertError?.message}`);
      const response = await fetchTescoCollectedPage(url);
      requests += 1;
      let parsed: TescoCollectedPage | null = null;
      let outcome: string = response.outcome;
      let detail: string | null = null;
      if (response.outcome === 'ok') {
        try { parsed = parseTescoCollectedPage(response.html, response.finalUrl); }
        catch (error) { outcome = 'parse_error'; detail = error instanceof Error ? error.message : 'Parse failure'; }
      }
      const identityResults = parsed?.products.flatMap(p => mappings.filter(m => m.storeSku === p.sku).map(m => ({
        storeProductId: m.storeProductId, sku: p.sku,
        reasons: m.resolved ? validateTescoCollectedIdentity(m, p) : ['mapping_not_resolved'],
      }))) ?? [];
      const { error: evidenceError } = await supabaseAdmin.from('tesco_direct_collection_pages').update({
        final_url: response.finalUrl, http_status: response.status, outcome, retry_after: response.retryAfter,
        elapsed_ms: response.elapsedMs, body_sha256: createHash('sha256').update(response.html).digest('hex'),
        parsed, identity_results: identityResults, detail,
      }).eq('id', pageRow.id);
      // Persist the stop before any other operation. Even if evidence storage
      // fails, another invocation must see the transport pause.
      if (outcome !== 'ok') {
        stopReason = outcome;
        paused = true;
        await pauseEgress(lease.egressKey, tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter)!, response.outcome === 'access_block');
      }
      if (evidenceError) throw new Error(`Recording Tesco page: ${evidenceError.message}`);
      if (stopReason) break;
      for (const p of parsed?.products ?? []) collected.set(p.sku, p);
      if (options.mode === 'listings' && parsed?.listing?.nextUrl) urls.push(parsed.listing.nextUrl);
    }
    const accepted = options.mode === 'probe' ? [] : mappings.filter(m => m.resolved && due(m) && m.storeSku && collected.has(m.storeSku))
      .map(m => ({ mapping: m, product: collected.get(m.storeSku!)! }))
      .filter(({ mapping, product }) => validateTescoCollectedIdentity(mapping, product).length === 0);
    // Only existing exact mappings can be refreshed. Discovery evidence stays
    // private; changing a canonical mapping requires a separate reviewed repair.
    const { error: targetError } = await supabaseAdmin.from('scrape_runs').update({ target_count: accepted.length }).eq('id', runUuid);
    if (targetError) throw new Error(`Setting Tesco finalisation count: ${targetError.message}`);
    for (const { mapping, product } of accepted) {
      const { data: inserted, error } = await supabaseAdmin.rpc('finalize_store_scrape_product', {
        p_run_uuid: runUuid, p_store: 'tesco', p_store_product_id: mapping.storeProductId,
        p_success: true, p_price: product.price, p_previous_price: null, p_was_price: null, p_on_promotion: false,
        p_store_url: product.url, p_store_sku: product.sku, p_store_product_name: product.name,
        p_fetched: 1, p_extracted: 1,
      });
      if (error) throw new Error(`Finalising Tesco observation: ${error.message}`);
      if (inserted) pricesWritten += 1;
    }
    const status = stopReason ? 'failed' : 'success';
    const { error: finishError } = await supabaseAdmin.from('scrape_runs').update({
      status, finished_at: new Date().toISOString(), duration_seconds: Math.round((Date.now() - started) / 1000),
      threshold_breached: Boolean(stopReason), error_summary: JSON.stringify({ mode: options.mode, requests, cacheSkips, productsCollected: collected.size, pricesWritten, stopReason }),
    }).eq('id', runUuid);
    if (finishError) throw new Error(`Closing Tesco collection: ${finishError.message}`);
    if (!paused && requests > 0) {
      await markTescoEgressSuccess(lease.egressKey);
      released = true;
    }
    return { status: stopReason ?? (requests ? 'complete' : 'cached_no_requests'), runUuid, requests, cacheSkips, productsCollected: collected.size, pricesWritten };
  } catch (error) {
    if (runUuid) await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_summary: error instanceof Error ? error.message.slice(0, 500) : 'Collection error' }).eq('id', runUuid);
    throw error;
  } finally {
    // Do not clear cooldown, and never release another invocation's active lease:
    // the 600s lease exceeds this route's hard 240s runtime.
    if (!paused && !released) await releaseTescoEgress(lease.egressKey);
  }
}
