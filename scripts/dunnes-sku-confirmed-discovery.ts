// Dunnes SKU-confirmed discovery (owner-approved smallest safe extension, Nov 2026). Runs as a one-off ECS task
// on the worker image. For each branded canonical WITHOUT a SKU-bearing Dunnes offer: governed search ->
// the ONE compatible candidate -> governed product-by-SKU API -> confirmDunnesSku (SKU, title, structured brand,
// structured pack, own-label, ambiguity, SKU ownership) -> only then the existing finaliser writes the mapping
// and the SKU-bound price; the product response body is retained as evidence. Dry run unless APPLY=1.
// Env: LIMIT (<=50), OFFSET. The August search-only acceptance pipeline is NOT used.
import { confirmDunnesSku, dunnesProductApiUrl, titleWordProblems, brandConfirmed, multipackOf, type DunnesProductResponse } from '../src/lib/dunnes-sku-confirmation';
import { isDunnesPackCompatible, normaliseDunnesName } from '@/lib/dunnes-discovery';
import { withRetailerRequestSlot } from '@/lib/retailer-request-governor';
import { captureIdentityResponse } from '@/lib/retailer-identity-response';
import { retainIdentityResponse } from '@/lib/retailer-identity-retention';
import { supabaseAdmin as sb } from '@/lib/supabase';

const APPLY = process.env.APPLY === '1';
const LIMIT = Math.min(50, Math.max(1, Number(process.env.LIMIT ?? 25)));
const OFFSET = Math.max(0, Number(process.env.OFFSET ?? 0));
const EXCLUDED = /alcohol|beer|wine|spirit|cider|lager|whiskey|vodka|gin\b|tobacco|cigar|vape|clothing|apparel/i;
const HEADERS = () => ({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'x-site-host': 'https://www.dunnesstoresgrocery.com', 'x-site-location': 'HeadersBuilderInterceptor', 'x-correlation-id': crypto.randomUUID(),
  'x-shopping-mode': '22222222-2222-2222-2222-222222222222' });
const slug = (s: string) => normaliseDunnesName(s).replace(/\s+/g, '-');
const productUrl = (sku: string, name: string) => `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/${slug(name)}/${sku}`;

async function governedGet(url: string) {
  return withRetailerRequestSlot('dunnes', async () => {
    const res = await fetch(url, { headers: HEADERS(), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status >= 500) throw new Error(`Dunnes HTTP ${res.status}`);
    return { status: res.status, url: res.url || url, contentType: res.headers.get('content-type') ?? '', body };
  });
}
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
// Pre-filter mirrors confirmDunnesSku: the same multipack (count + per-unit size) or a compatible single pack.
const packCompatible = (ref: string, title: string) => {
  const a = multipackOf(ref), b = multipackOf(title);
  if (a || b) return !!a && !!b && a.count === b.count && a.unit === b.unit && a.unitAmount === b.unitAmount;
  return isDunnesPackCompatible(ref, title);
};

async function main() {
  // SV_LED=1: SuperValu-led discovery. Reference identity = the SuperValu offer's OWN title + brand (a real retailer
  // title); only canonicals with NO SKU-bearing Dunnes offer (an existing Dunnes mapping is never overwritten).
  let targets: Array<{ product_id: string; canonical_name: string; brand: string; category?: string; alt?: string }> | null;
  if (process.env.SV_LED === '1') {
    const { data: sv, error: se } = await sb.from('store_products').select('product_id,store_product_name,brand,is_own_brand')
      .eq('store', 'supervalu').not('store_sku', 'is', null).not('brand', 'is', null).not('product_id', 'is', null)
      .order('id').range(OFFSET, OFFSET + (process.env.FOCUS === 'need_dunnes' ? 999 : LIMIT * 3 - 1));
    if (se) throw se;
    const ids = (sv ?? []).map(r => r.product_id as string);
    const has = new Set<string>();
    for (const c of chunks(ids)) {
      const { data: owned, error: oe } = await sb.from('store_products').select('product_id').eq('store', 'dunnes').not('store_sku', 'is', null).in('product_id', c);
      if (oe) throw oe;
      for (const o of owned ?? []) has.add(o.product_id as string);
    }
    // Records already decided by THIS process in the last 7 days are not re-requested (no repeat spend on the same miss).
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    for (const c of chunks(ids)) {
      const { data: rec, error: re } = await sb.from('dunnes_discovery_receipts').select('product_id,reason').in('product_id', c).gte('created_at', since);
      if (re) throw re;
      for (const r of rec ?? []) if (String(r.reason ?? '').startsWith('SKU-confirmed discovery held')) has.add(r.product_id as string);
    }
    targets = (sv ?? []).filter(r => !has.has(r.product_id) && r.is_own_brand !== true && !/^\s*(supervalu|signature tastes|daily basics)\b/i.test(String(r.store_product_name))
      && /\b\d+(?:\.\d+)?\s*(?:kg|g|ml|l|cl)\b/i.test(String(r.store_product_name)))
      .slice(0, process.env.FOCUS === 'need_dunnes' ? undefined : LIMIT).map(r => ({ product_id: r.product_id as string, canonical_name: String(r.store_product_name).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(), brand: String(r.brand) }));
    if (process.env.FOCUS === 'need_dunnes') {
      // Only records whose Tesco offer has a FRESH price and whose SuperValu and Tesco titles are identity-consistent
      // (same brand, same pack, every word of each title present in the other, no one-sided qualifier). Sharing a
      // canonical record is not proof; the two retailer titles must agree before either is used as a Dunnes reference.
      const tesco = new Map<string, string>();
      for (const c of chunks(targets.map(x => x.product_id))) {
        const { data: tp, error: te } = await sb.from('latest_prices').select('canonical_product_id,store_product_name').eq('store', 'tesco').in('canonical_product_id', c);
        if (te) throw te;
        for (const r of tp ?? []) tesco.set(r.canonical_product_id as string, String(r.store_product_name));
      }
      targets = targets.flatMap(x => {
        const tt = tesco.get(x.product_id);
        if (!tt) return [];
        const consistent = brandConfirmed(x.brand, tt) && packCompatible(x.canonical_name, tt)
          && titleWordProblems(x.canonical_name, tt).length === 0 && titleWordProblems(tt, x.canonical_name).length === 0;
        if (!consistent) { log({ event: 'sv_tesco_inconsistent', product_id: x.product_id, sv: x.canonical_name, tesco: tt }); return []; }
        return [{ ...x, alt: tt }];
      }).slice(0, LIMIT);
    }
  } else {
    const { data, error } = await sb.rpc('select_dunnes_discovery_targets', { p_limit: LIMIT, p_offset: OFFSET });
    if (error) throw error;
    targets = data;
  }
  const eligible = (targets ?? []).filter((t: { category?: string; canonical_name: string }) => !EXCLUDED.test(`${t.category ?? ''} ${t.canonical_name}`));
  let runUuid: string | null = null;
  if (APPLY) {
    const { data: run, error: e } = await sb.from('scrape_runs').insert({ run_id: `dunnes_sku_confirmed_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
      store: 'dunnes', started_at: new Date().toISOString(), target_count: eligible.length, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0,
      unchanged_count: 0, failed: 0, retrieval_method: 'dunnes_sku_confirmed_discovery', threshold_pct: 0, status: 'running' }).select('id').single();
    if (e) throw e; runUuid = run.id;
  }
  const tally: Record<string, number> = {};
  for (const t of eligible as Array<{ product_id: string; canonical_name: string; brand: string; alt?: string }>) {
    let outcome = 'rejected', reason = '';
    try {
      // Query variants (each one governed request): name without pack, brand + key words, full name. Candidates are
      // pooled by SKU so ambiguity is judged across all variants; confirmation rules are unchanged.
      const named = normaliseDunnesName(t.canonical_name).includes(normaliseDunnesName(t.brand)) ? t.canonical_name : `${t.brand} ${t.canonical_name}`;
      const noPack = named.replace(/\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|ltr|litres?|cl|pack|pk)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const key = [t.brand, ...noPack.split(' ').filter(w => !normaliseDunnesName(t.brand).split(' ').includes(normaliseDunnesName(w))).slice(0, 3)].join(' ');
      const altNoPack = t.alt ? t.alt.replace(/\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|ltr|litres?|cl|pack|pk)\b/gi, ' ').replace(/\s+/g, ' ').trim() : null;
      const variants = [...new Set([noPack, key, named, ...(altNoPack ? [altNoPack] : [])].map(v => v.split(' ').slice(0, 8).join(' ')))];
      const seen = new Map<string, { sku?: unknown; name?: unknown }>();
      for (const v of variants) {
        const s = await governedGet(`https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=${encodeURIComponent(v)}&take=12&page=1&skip=0`);
        const found = s.status === 200 ? ((JSON.parse(s.body).items ?? []) as Array<{ sku?: unknown; name?: unknown }>) : [];
        for (const it of found) if (it.sku != null && !seen.has(String(it.sku))) seen.set(String(it.sku), it);
        if (found.length) break;
      }
      const items = [...seen.values()];
      const fits = (ref: string, name: string) => brandConfirmed(t.brand, name) && packCompatible(ref, name) && titleWordProblems(ref, name).length === 0;
      // The reference the candidate fits (SuperValu title first, then the identity-consistent Tesco title).
      const refFor = (name: string) => fits(t.canonical_name, name) ? t.canonical_name : t.alt && fits(t.alt, name) ? t.alt : null;
      const compatible = items.filter(it => it.sku != null && typeof it.name === 'string' && refFor(it.name) !== null);
      if (process.env.TRACE === '1') log({ event: 'trace', ref: t.canonical_name, variants, items: items.slice(0, 3).map(it => String(it.name)) });
      if (!compatible.length) { reason = 'no_compatible_candidate'; }
      else {
        const c = compatible[0], sku = String(c.sku);
        const { data: owners } = await sb.from('store_products').select('id').eq('store', 'dunnes').eq('store_sku', sku);
        const apiUrl = dunnesProductApiUrl(sku);
        const p = await governedGet(apiUrl);
        let resp: DunnesProductResponse | null = null; try { resp = p.status === 200 ? JSON.parse(p.body) : null; } catch { resp = null; }
        const conf = confirmDunnesSku({ canonicalName: refFor(String(c.name)) ?? t.canonical_name, canonicalBrand: t.brand, candidateSku: sku, candidateName: String(c.name),
          httpStatus: p.status, requestedUrl: apiUrl, finalUrl: p.url, response: resp, skuOwnedElsewhere: (owners ?? []).length > 0,
          otherCompatibleCandidates: compatible.length - 1 });
        if (!conf.ok) reason = conf.reasons.join(',');
        else {
          outcome = 'exact';
          const url = productUrl(sku, String(resp!.name));
          log({ event: 'confirmed', product_id: t.product_id, canonical: t.canonical_name, sku, title: resp!.name, brand: resp!.brand, pack: conf.structuredPack, price: conf.price, apply: APPLY });
          if (APPLY) {
            const { error: fe } = await sb.rpc('finalize_dunnes_discovery_product', { p_run_uuid: runUuid, p_product_id: t.product_id, p_outcome: 'exact',
              p_canonical_name: t.canonical_name, p_candidate_sku: sku, p_candidate_name: String(resp!.name), p_candidate_url: url, p_price: conf.price,
              p_confidence: 1, p_pack_ratio: 1, p_reason: `sku_confirmed via ${apiUrl}` });
            if (fe) throw fe;
            const { data: offer } = await sb.from('store_products').select('id').eq('product_id', t.product_id).eq('store', 'dunnes').eq('store_sku', sku).single();
            await retainIdentityResponse(captureIdentityResponse({ store: 'dunnes', sku, title: String(resp!.name), productUrl: url, requestedUrl: apiUrl,
              finalUrl: p.url, contentType: p.contentType, body: p.body }), runUuid!, offer!.id);
          }
        }
      }
    } catch (e) { reason = `error:${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`; log({ event: "error", canonical: t.canonical_name, message: reason }); }
    if (outcome === 'rejected') {
      tally[reason.split(',')[0].split(':')[0]] = (tally[reason.split(',')[0].split(':')[0]] ?? 0) + 1;
      if (APPLY && !reason.startsWith('error:')) await sb.rpc('finalize_dunnes_discovery_product', { p_run_uuid: runUuid, p_product_id: t.product_id, p_outcome: 'rejected',
        p_canonical_name: t.canonical_name, p_candidate_sku: null, p_candidate_name: null, p_candidate_url: null, p_price: null, p_confidence: null, p_pack_ratio: null,
        p_reason: `SKU-confirmed discovery held: ${reason}`.slice(0, 500) });
    } else tally.confirmed = (tally.confirmed ?? 0) + 1;
  }
  if (APPLY && runUuid) await sb.from('scrape_runs').update({ status: 'success', finished_at: new Date().toISOString() }).eq('id', runUuid).eq('status', 'running');
  log({ event: 'summary', apply: APPLY, targets: (targets ?? []).length, eligible: eligible.length, tally, run: runUuid });
}
main().catch(e => { console.error(e); process.exit(1); });
