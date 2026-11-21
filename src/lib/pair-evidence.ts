// Direct, SKU-bound evidence captures for pair approvals and their monitoring (one governed request per offer).
//   SuperValu: the offer's own product page (captured_product).
//   Dunnes:    the SKU-bound product API (captured_product_api; its product pages are refused from AWS with 403).
// A capture is retained only when captureIdentityResponse finds the offer's SKU with the expected title in the
// response itself. Writes retailer_identity_responses (+ an identity observation for page captures, which the
// database stores only for offers already in a positive pair decision). Never a price, mapping or review.
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureIdentityResponse, dunnesProductApi, type IdentityResponse } from './retailer-identity-response';
import { denialReason, parseRetryAfterMs, withRetailerRequestSlot } from './retailer-request-governor';

export type EvidenceOffer = { id: string; store: 'supervalu' | 'dunnes'; store_sku: string; store_url: string | null };
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36';
const SITE = { dunnes: 'https://www.dunnesstoresgrocery.com', supervalu: 'https://shop.supervalu.ie' } as const;
const METHOD = { dunnes: 'dunnes_sku_confirmed_discovery', supervalu: 'vercel_direct_product_page' } as const;

/** The URL fetched for an offer's evidence. */
export function evidenceUrl(o: EvidenceOffer): string | null {
  if (!o.store_sku) return null;
  return o.store === 'dunnes' ? dunnesProductApi(o.store_sku) : o.store_url;
}

/** A refused response; classified for the governor so its circuit breaker sees 403/429/5xx like any collector. */
export class EvidenceHttpError extends Error { constructor(readonly status: number, readonly retryAfter: string | null, store: string) { super(`${store} HTTP ${status}`); } }
export const classifyEvidenceError = (e: unknown) => e instanceof EvidenceHttpError
  ? { reason: denialReason({ status: e.status }), retryAfterMs: parseRetryAfterMs(e.retryAfter) }
  : { reason: denialReason({ errorReason: e instanceof Error ? `${e.name} ${e.message}` : String(e) }) };
async function governedGet(store: EvidenceOffer['store'], url: string) {
  return withRetailerRequestSlot(store, async () => {
    const headers: Record<string, string> = store === 'dunnes'
      ? { Accept: 'application/json, text/plain, */*', 'User-Agent': UA, 'x-site-host': SITE.dunnes, 'x-site-location': 'HeadersBuilderInterceptor',
          'x-correlation-id': crypto.randomUUID(), 'x-shopping-mode': '22222222-2222-2222-2222-222222222222' }
      : { Accept: 'text/html,application/xhtml+xml', 'User-Agent': UA, Referer: SITE.supervalu };
    const res = await fetch(url, { headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status >= 500) throw new EvidenceHttpError(res.status, res.headers.get('retry-after'), store);
    return { status: res.status, finalUrl: res.url || url, contentType: res.headers.get('content-type') ?? '', body };
  }, { classifyError: classifyEvidenceError });
}

/** Fetch and parse one offer's direct evidence; null when the response does not prove the SKU and title. */
export async function captureOfferEvidence(o: EvidenceOffer, expectedTitle: string): Promise<IdentityResponse | null> {
  const url = evidenceUrl(o);
  if (!url || !o.store_url) return null;
  const p = await governedGet(o.store, url);
  if (p.status !== 200) return null;
  const r = captureIdentityResponse({ store: o.store, sku: o.store_sku, title: expectedTitle, productUrl: o.store_url, requestedUrl: url,
    finalUrl: p.finalUrl, contentType: p.contentType, body: p.body });
  const wanted = o.store === 'dunnes' ? 'captured_product_api' : 'captured_product';
  return r?.source_kind === wanted ? r : null;
}

/** Retain a capture (append-only) under a per-store evidence run; returns the stored response id. */
export async function retainEvidence(sb: SupabaseClient, r: IdentityResponse, offerId: string, runs: Partial<Record<EvidenceOffer['store'], string>>): Promise<string> {
  if (!runs[r.store]) {
    const { data, error } = await sb.from('scrape_runs').insert({ run_id: `pair_evidence_${r.store}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
      store: r.store, started_at: new Date().toISOString(), target_count: 0, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0,
      unchanged_count: 0, failed: 0, retrieval_method: METHOD[r.store], threshold_pct: 0, status: 'running' }).select('id').single();
    if (error) throw error;
    runs[r.store] = data.id;
  }
  const row = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'body_sha256'));
  const { data, error } = await sb.from('retailer_identity_responses').insert({ ...row, run_uuid: runs[r.store], store_product_id: offerId }).select('id').single();
  if (error) throw error;
  if (r.source_kind === 'captured_product') {
    // Stored by the database only for offers already in a positive pair decision (monitoring); silently skipped otherwise.
    await sb.from('retailer_identity_observations').insert({ store_product_id: offerId, store: r.store, sku: r.sku, source_kind: r.source_kind,
      product_url: r.product_url, requested_url: r.requested_url, final_url: r.final_url, body_sha256: r.body_sha256,
      parser_version: r.parser_version, identity: r.identity, observed_at: r.retrieved_at, run_uuid: runs[r.store] });
  }
  return data.id;
}

export async function closeEvidenceRuns(sb: SupabaseClient, runs: Partial<Record<EvidenceOffer['store'], string>>) {
  for (const id of Object.values(runs)) await sb.from('scrape_runs').update({ status: 'success', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running');
}
