// Dunnes BARCODE RENEWAL (one-off ECS task on the worker image; dry run unless APPLY=1).
// Renews exactly the listed EXISTING Dunnes offers whose SKU the Dunnes storefront search returned for the Tesco GTIN
// of the SAME canonical record (barcode-led discovery, strong tier). Per target:
//   1. re-read the offer: same id, store=dunnes, same SKU, same canonical, and no price in the last 7 days;
//   2. one governed product-by-SKU request;
//   3. confirmDunnesSku against the Tesco offer's own title + brand (SKU-bound URL, title, structured brand and pack,
//      own-label, SKU ownership) -- the barcode is discovery evidence only, Dunnes' own product data must confirm;
//   4. only then the existing finaliser writes the SKU-bound price; the product response body is retained.
// A failed confirmation is recorded as a hold. There is NO replacement search: a different SKU is a different identity.
// ATTACH mode (a target WITHOUT offer_id): the canonical has no SKU-bearing Dunnes offer and the SKU is unowned; the
// finaliser then creates the mapping as in SKU-confirmed discovery. Applying an attach needs ALLOW_ATTACH=1 as well
// as APPLY=1 (owner-authorised batches only). Existing mappings are never re-pointed.
// Env: T = base64(brotli(JSON [{product_id, tesco_offer_id, offer_id?, sku}])), APPLY, ALLOW_ATTACH.
import { brotliDecompressSync } from 'node:zlib';
import { brandConfirmed, confirmDunnesSku, dunnesProductApiUrl, packCompatible, type DunnesProductResponse } from '../src/lib/dunnes-sku-confirmation';
import { normaliseDunnesName } from '@/lib/dunnes-discovery';
import { withRetailerRequestSlot } from '@/lib/retailer-request-governor';
import { captureIdentityResponse } from '@/lib/retailer-identity-response';
import { retainIdentityResponse } from '@/lib/retailer-identity-retention';
import { supabaseAdmin as sb } from '@/lib/supabase';

// The reference identity is NOT taken from the payload: it is read from the canonical's own Tesco offer (tesco_offer_id).
type Target = { product_id: string; tesco_offer_id: string; offer_id?: string; sku: string };
const EXCLUDED = /alcohol|beer|wine|spirit|cider|lager|whiskey|vodka|gin\b|tobacco|cigar|vape|clothing|apparel/i;
const APPLY = process.env.APPLY === '1';
const HEADERS = () => ({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'x-site-host': 'https://www.dunnesstoresgrocery.com', 'x-site-location': 'HeadersBuilderInterceptor', 'x-correlation-id': crypto.randomUUID(),
  'x-shopping-mode': '22222222-2222-2222-2222-222222222222' });
const productUrl = (sku: string, name: string) =>
  `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/${normaliseDunnesName(name).replace(/\s+/g, '-')}/${sku}`;
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

async function governedGet(url: string) {
  return withRetailerRequestSlot('dunnes', async () => {
    const res = await fetch(url, { headers: HEADERS(), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status >= 500) throw new Error(`Dunnes HTTP ${res.status}`);
    return { status: res.status, url: res.url || url, contentType: res.headers.get('content-type') ?? '', body };
  });
}

async function main() {
  const raw = JSON.parse(brotliDecompressSync(Buffer.from(process.env.T ?? '', 'base64')).toString('utf8')) as Target[];
  const list = [...new Map(raw.map(t => [t.product_id, t])).values()].slice(0, 50);   // one target per canonical
  if (APPLY && list.some(t => !t.offer_id) && process.env.ALLOW_ATTACH !== '1') throw new Error('attach_not_authorised: set ALLOW_ATTACH=1 for an owner-authorised attach batch');
  let runUuid: string | null = null;
  if (APPLY) {
    const { data: run, error } = await sb.from('scrape_runs').insert({ run_id: `dunnes_barcode_renewal_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
      store: 'dunnes', started_at: new Date().toISOString(), target_count: list.length, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0,
      unchanged_count: 0, failed: 0, retrieval_method: 'dunnes_sku_confirmed_discovery', threshold_pct: 0, status: 'running' }).select('id').single();
    if (error) throw error; runUuid = run.id;
  }
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  for (const t of list) {
    try {
      const attach = !t.offer_id;
      // Reference = the canonical's own Tesco offer (the GTIN origin). Every SuperValu offer on the same canonical must
      // agree with it on brand and pack and must not be own-label, so a mixed canonical is never renewed or attached.
      const { data: tos, error: te } = await sb.from('store_products').select('id,product_id,store,store_product_name,brand').eq('id', t.tesco_offer_id).maybeSingle();
      if (te) throw te;
      const { data: svs, error: se } = await sb.from('store_products').select('store_product_name,is_own_brand').eq('product_id', t.product_id).eq('store', 'supervalu').not('store_sku', 'is', null);
      if (se) throw se;
      const ref = String(tos?.store_product_name ?? ''), brand = String(tos?.brand ?? '');
      const refProblem = !tos || tos.store !== 'tesco' || tos.product_id !== t.product_id || !ref || !brand ? 'tesco_reference_invalid'
        : EXCLUDED.test(ref) ? 'excluded_category'
        : (svs ?? []).some(v => v.is_own_brand === true) ? 'canonical_has_own_label_supervalu'
        : (svs ?? []).some(v => !brandConfirmed(brand, String(v.store_product_name)) || !packCompatible(ref, String(v.store_product_name))) ? 'canonical_supervalu_conflicts' : null;
      if (refProblem) { log({ event: 'skipped', product_id: t.product_id, reason: refProblem }); bump(refProblem); continue; }
      const { data: owners, error: we } = await sb.from('store_products').select('id').eq('store', 'dunnes').eq('store_sku', t.sku);
      if (we) throw we;
      let skip: string | null = null;
      if (attach) {
        // ATTACH: the canonical must have NO SKU-bearing Dunnes offer and the SKU must be unowned (the finaliser then
        // creates the mapping exactly as in SKU-confirmed discovery).
        const { data: d, error: de } = await sb.from('store_products').select('id').eq('product_id', t.product_id).eq('store', 'dunnes').not('store_sku', 'is', null);
        if (de) throw de;
        skip = (d ?? []).length ? 'canonical_has_dunnes_offer' : (owners ?? []).length ? 'sku_owned' : null;
      } else {
        const { data: o, error: oe } = await sb.from('store_products').select('id,product_id,store,store_sku').eq('id', t.offer_id).maybeSingle();
        if (oe) throw oe;
        const { data: lp, error: le } = await sb.from('latest_prices').select('store_product_id').eq('store_product_id', t.offer_id)
          .gte('observed_at', new Date(Date.now() - 7 * 864e5).toISOString());
        if (le) throw le;
        skip = !o ? 'offer_missing' : o.store !== 'dunnes' || String(o.store_sku) !== t.sku || o.product_id !== t.product_id ? 'offer_changed'
          : (lp ?? []).length ? 'already_fresh' : null;
      }
      if (skip) { log({ event: 'skipped', product_id: t.product_id, offer_id: t.offer_id ?? null, reason: skip }); bump(skip); continue; }
      const apiUrl = dunnesProductApiUrl(t.sku);
      const p = await governedGet(apiUrl);
      let resp: DunnesProductResponse | null = null; try { resp = p.status === 200 ? JSON.parse(p.body) : null; } catch { resp = null; }
      const conf = confirmDunnesSku({ canonicalName: ref, canonicalBrand: brand, candidateSku: t.sku, candidateName: String(resp?.name ?? ''),
        httpStatus: p.status, requestedUrl: apiUrl, finalUrl: p.url, response: resp,
        skuOwnedElsewhere: (owners ?? []).some(x => x.id !== t.offer_id), otherCompatibleCandidates: 0 });
      log({ event: conf.ok ? 'confirmed' : 'held', product_id: t.product_id, sku: t.sku, ref, title: resp?.name ?? null, status: p.status,
        reasons: conf.reasons, price: conf.price, pack: conf.structuredPack, apply: APPLY });
      if (!conf.ok) {
        bump('held');
        if (APPLY) await sb.rpc('finalize_dunnes_discovery_product', { p_run_uuid: runUuid, p_product_id: t.product_id, p_outcome: 'rejected',
          p_canonical_name: ref, p_candidate_sku: null, p_candidate_name: null, p_candidate_url: null, p_price: null, p_confidence: null, p_pack_ratio: null,
          p_reason: `SKU-confirmed discovery held: barcode_${attach ? "attach" : "renewal"}:${conf.reasons.join(',')}`.slice(0, 500) });
        continue;
      }
      if (APPLY) {
        const url = productUrl(t.sku, String(resp!.name));
        const { data: written, error: fe } = await sb.rpc('finalize_dunnes_discovery_product', { p_run_uuid: runUuid, p_product_id: t.product_id, p_outcome: 'exact',
          p_canonical_name: ref, p_candidate_sku: t.sku, p_candidate_name: String(resp!.name), p_candidate_url: url, p_price: conf.price,
          p_confidence: 1, p_pack_ratio: 1, p_reason: `sku_confirmed (barcode ${attach ? "attach" : "renewal of existing SKU"}) via ${apiUrl}` });
        if (fe) throw fe;
        if (written === false) { log({ event: 'not_written', product_id: t.product_id, sku: t.sku }); bump('not_written'); continue; }
        let offerId = t.offer_id;
        if (attach) {
          const { data: created, error: ce } = await sb.from('store_products').select('id').eq('product_id', t.product_id).eq('store', 'dunnes').eq('store_sku', t.sku).single();
          if (ce) throw ce; offerId = created.id;
        }
        await retainIdentityResponse(captureIdentityResponse({ store: 'dunnes', sku: t.sku, title: String(resp!.name), productUrl: url, requestedUrl: apiUrl,
          finalUrl: p.url, contentType: p.contentType, body: p.body }), runUuid!, offerId!);
      }
      bump('confirmed');
    } catch (e) {
      bump('error');
      log({ event: 'error', offer_id: t.offer_id, message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
      if (/circuit|blocked|slot/i.test(String(e))) break;
    }
  }
  if (APPLY && runUuid) await sb.from('scrape_runs').update({ status: 'success', finished_at: new Date().toISOString() }).eq('id', runUuid).eq('status', 'running');
  log({ event: 'summary', apply: APPLY, targets: list.length, tally, run: runUuid });
}
main().catch(e => { console.error(e); process.exit(1); });
