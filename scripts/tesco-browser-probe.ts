/**
 * Bounded browser-based Tesco access proof, run as a one-off ECS task from the
 * intended unattended AWS runtime.
 *
 * It does NOT re-implement collection control. It drives the EXISTING
 * `collectTescoDirect` in `probe` mode with the headless-browser transport
 * injected, so the battle-tested path is reused verbatim:
 *   - each request is charged to the ledger (a tesco_direct_collection_pages
 *     row is inserted BEFORE the fetch; a DB failure throws and stops);
 *   - the egress lease is claimed, used and released consistently;
 *   - every stop condition applies (access denial / rate limit / unsafe
 *     navigation / network failure / parse failure) — the first one persists a
 *     pause and stops; no retries, no route switching;
 *   - probe mode writes NO price_observations, NO finalisation, NO mapping
 *     change (pricesWritten is always 0).
 * This script then reads back the run's page rows and reports the evidence.
 *
 * Env (task-scoped): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * PROBE_URLS (JSON array of <=10 tesco.ie product URLs).
 */
import { createClient } from '@supabase/supabase-js';
import { collectTescoDirect } from '@/lib/tesco-direct-collection';
import { fetchTescoCollectedPageViaBrowser } from '@/lib/tesco-browser-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function log(tag: string, obj: unknown) { console.log(`${tag} ${JSON.stringify(obj)}`); }

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase credentials are not configured');
  const probeProductUrls: string[] = JSON.parse(process.env.PROBE_URLS || '[]').slice(0, 10);
  if (probeProductUrls.length === 0) throw new Error('No PROBE_URLS supplied');
  log('PROBE_INPUT', { count: probeProductUrls.length });

  // Drive the real collector in probe mode with the browser transport. All
  // accounting / stop / lease logic is inside collectTescoDirect.
  const result = await collectTescoDirect({
    mode: 'probe',
    probeProductUrls,
    fetcher: (url) => fetchTescoCollectedPageViaBrowser(url),
  });
  log('PROBE_RESULT', result);

  // Read back the evidence the collection wrote for this run (read-only report).
  if ('runUuid' in result && result.runUuid) {
    const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data: pages, error } = await db.from('tesco_direct_collection_pages')
      .select('requested_url,final_url,outcome,http_status,retry_after,elapsed_ms,body_sha256,parsed,identity_results,created_at')
      .eq('run_id', result.runUuid).order('created_at');
    if (error) throw new Error(`Reading probe evidence: ${error.message}`);
    for (const p of pages ?? []) {
      const products = (p.parsed as { products?: Array<Record<string, unknown>> } | null)?.products ?? [];
      const product = products[0] ?? null;
      const expectedSku = String(p.requested_url).match(/\/products\/(\d+)/)?.[1] ?? null;
      log('PROBE_PAGE', {
        requestedUrl: p.requested_url,
        finalUrl: p.final_url,
        outcome: p.outcome,
        httpStatus: p.http_status,
        retryAfter: p.retry_after,
        elapsedMs: p.elapsed_ms,
        capturedAt: p.created_at,
        bodySha256: p.body_sha256,
        region: String(p.final_url ?? p.requested_url).includes('/en-IE/') ? 'IE' : 'unknown',
        skuMatches: product ? product.sku === expectedSku : null,
        // Regular EUR shelf price only (parser uses ProductType.price.actual).
        // Clubcard/promotional prices are never taken as the regular price.
        identity: product ? {
          sku: product.sku, name: product.name, brand: product.brand, gtin: product.gtin,
          regularPriceEUR: product.price, currency: product.currency,
          quantity: product.quantity, available: product.available,
        } : null,
        identityResults: p.identity_results,
      });
    }
    const genuine = (pages ?? []).filter((p) => {
      const products = (p.parsed as { products?: Array<Record<string, unknown>> } | null)?.products ?? [];
      const sku = String(p.requested_url).match(/\/products\/(\d+)/)?.[1] ?? null;
      return p.outcome === 'ok' && products[0] && products[0].sku === sku;
    }).length;
    log('PROBE_SUMMARY', {
      runUuid: result.runUuid,
      requested: (pages ?? []).length,
      genuineProducts: genuine,
      pricesWritten: result.pricesWritten,
      status: result.status,
    });
  } else {
    log('PROBE_SUMMARY', { requested: 0, status: result.status, note: 'no run opened (gate unavailable / no eligible URLs)' });
  }
}

main().catch((e) => { console.error('PROBE_FATAL', e instanceof Error ? e.message : String(e)); process.exit(1); });
