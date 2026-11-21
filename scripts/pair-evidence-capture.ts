// Direct product-page capture for PAIR-REVIEW evidence (one-off ECS task; dry run unless APPLY=1).
// For each listed Dunnes/SuperValu offer: re-read the offer (store, SKU, stored product URL), one governed GET of that
// product page, then captureIdentityResponse re-parses the page and only yields evidence when the page's own product
// node carries the offer's SKU and the EXPECTED title (the retailer's own title from the barcode search, not our
// mapped name). A direct capture (requested = final = product URL) is retained as `captured_product` plus a durable
// identity observation. It writes NO price, mapping, receipt or pair review.
// Env: T = base64(brotli(JSON [{offer_id, title}])), APPLY.
import { brotliDecompressSync } from 'node:zlib';
import { captureIdentityResponse } from '@/lib/retailer-identity-response';
import { recordIdentityObservation, retainIdentityResponse } from '@/lib/retailer-identity-retention';
import { denialReason, withRetailerRequestSlot } from '@/lib/retailer-request-governor';
import { supabaseAdmin as sb } from '@/lib/supabase';

type Target = { offer_id: string; title: string };
type Store = 'dunnes' | 'supervalu';
const APPLY = process.env.APPLY === '1';
const SITE: Record<Store, string> = { dunnes: 'https://www.dunnesstoresgrocery.com', supervalu: 'https://shop.supervalu.ie' };
const METHOD: Record<Store, string> = { dunnes: 'dunnes_sku_confirmed_discovery', supervalu: 'vercel_direct_product_page' };
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

async function governedPage(store: Store, url: string) {
  return withRetailerRequestSlot(store, async () => {
    const res = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      Referer: SITE[store] }, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status >= 500) throw new Error(`${store} HTTP ${res.status}`);
    return { status: res.status, finalUrl: res.url || url, contentType: res.headers.get('content-type') ?? '', body };
  }, { classifyError: (e: unknown) => {
    const m = /HTTP (\d{3})/.exec(e instanceof Error ? e.message : String(e));
    return { reason: m ? denialReason({ status: Number(m[1]) }) : denialReason({ errorReason: e instanceof Error ? `${e.name} ${e.message}` : String(e) }) };
  } });
}

async function main() {
  const raw = JSON.parse(brotliDecompressSync(Buffer.from(process.env.T ?? '', 'base64')).toString('utf8')) as Target[];
  const list = [...new Map(raw.map(t => [t.offer_id, t])).values()].slice(0, 60);
  const runs: Partial<Record<Store, string>> = {};
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  for (const t of list) {
    try {
      const { data: o, error } = await sb.from('store_products').select('id,store,store_sku,store_url').eq('id', t.offer_id).maybeSingle();
      if (error) throw error;
      if (!o || (o.store !== 'dunnes' && o.store !== 'supervalu') || !o.store_sku || !o.store_url) { log({ event: 'skipped', offer_id: t.offer_id, reason: 'offer_unusable' }); bump('offer_unusable'); continue; }
      const store = o.store as Store, url = String(o.store_url);
      const p = await governedPage(store, url);
      const resp = p.status === 200 ? captureIdentityResponse({ store, sku: String(o.store_sku), title: t.title, productUrl: url, requestedUrl: url,
        finalUrl: p.finalUrl, contentType: p.contentType, body: p.body }) : null;
      const kind = resp?.source_kind ?? null;
      log({ event: kind === 'captured_product' ? 'captured' : 'not_captured', offer_id: t.offer_id, store, sku: o.store_sku, status: p.status, kind,
        title: resp?.identity?.title ?? null, bytes: p.body.length, apply: APPLY });
      if (kind !== 'captured_product') { bump(`not_captured_${p.status}`); continue; }
      if (APPLY) {
        if (!runs[store]) {
          const { data: run, error: re } = await sb.from('scrape_runs').insert({ run_id: `pair_evidence_${store}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
            store, started_at: new Date().toISOString(), target_count: list.length, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0,
            unchanged_count: 0, failed: 0, retrieval_method: METHOD[store], threshold_pct: 0, status: 'running' }).select('id').single();
          if (re) throw re; runs[store] = run.id;
        }
        await retainIdentityResponse(resp, runs[store]!, o.id);
        await recordIdentityObservation(resp, runs[store]!, o.id);
      }
      bump('captured');
    } catch (e) {
      bump('error'); log({ event: 'error', offer_id: t.offer_id, message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
      if (/circuit|blocked|slot/i.test(String(e))) break;
    }
  }
  for (const id of Object.values(runs)) await sb.from('scrape_runs').update({ status: 'success', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running');
  log({ event: 'summary', apply: APPLY, targets: list.length, tally, runs });
}
main().catch(e => { console.error(e); process.exit(1); });
