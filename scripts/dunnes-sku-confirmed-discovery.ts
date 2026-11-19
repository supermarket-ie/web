// Dunnes SKU-confirmed discovery (owner-approved smallest safe extension, Nov 2026). Runs as a one-off ECS task
// on the worker image. For each branded canonical WITHOUT a SKU-bearing Dunnes offer: governed search ->
// the ONE compatible candidate -> governed product-by-SKU API -> confirmDunnesSku (SKU, title, structured brand,
// structured pack, own-label, ambiguity, SKU ownership) -> only then the existing finaliser writes the mapping
// and the SKU-bound price; the product response body is retained as evidence. Dry run unless APPLY=1.
// Env: LIMIT (<=50), OFFSET. The August search-only acceptance pipeline is NOT used.
import { confirmDunnesSku, dunnesProductApiUrl, titleWordProblems, brandConfirmed, type DunnesProductResponse } from '../src/lib/dunnes-sku-confirmation';
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

async function main() {
  const { data: targets, error } = await sb.rpc('select_dunnes_discovery_targets', { p_limit: LIMIT, p_offset: OFFSET });
  if (error) throw error;
  const eligible = (targets ?? []).filter((t: { category?: string; canonical_name: string }) => !EXCLUDED.test(`${t.category ?? ''} ${t.canonical_name}`));
  let runUuid: string | null = null;
  if (APPLY) {
    const { data: run, error: e } = await sb.from('scrape_runs').insert({ run_id: `dunnes_sku_confirmed_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
      store: 'dunnes', started_at: new Date().toISOString(), target_count: eligible.length, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0,
      unchanged_count: 0, failed: 0, retrieval_method: 'dunnes_sku_confirmed_discovery', threshold_pct: 0, status: 'running' }).select('id').single();
    if (e) throw e; runUuid = run.id;
  }
  const tally: Record<string, number> = {};
  for (const t of eligible as Array<{ product_id: string; canonical_name: string; brand: string }>) {
    let outcome = 'rejected', reason = '';
    try {
      // Query variants (each one governed request): name without pack, brand + key words, full name. Candidates are
      // pooled by SKU so ambiguity is judged across all variants; confirmation rules are unchanged.
      const named = normaliseDunnesName(t.canonical_name).includes(normaliseDunnesName(t.brand)) ? t.canonical_name : `${t.brand} ${t.canonical_name}`;
      const noPack = named.replace(/\b\d+(?:\.\d+)?\s*(?:x\s*\d+(?:\.\d+)?\s*)?(?:kg|g|ml|l|ltr|litres?|cl|pack|pk)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const key = [t.brand, ...noPack.split(' ').filter(w => !normaliseDunnesName(t.brand).split(' ').includes(normaliseDunnesName(w))).slice(0, 3)].join(' ');
      const variants = [...new Set([noPack, key, named].map(v => v.split(' ').slice(0, 8).join(' ')))];
      const seen = new Map<string, { sku?: unknown; name?: unknown }>();
      let q = '';
      for (const v of variants) {
        const s = await governedGet(`https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=${encodeURIComponent(v)}&take=12&page=1&skip=0`);
        const found = s.status === 200 ? ((JSON.parse(s.body).items ?? []) as Array<{ sku?: unknown; name?: unknown }>) : [];
        for (const it of found) if (it.sku != null && !seen.has(String(it.sku))) seen.set(String(it.sku), it);
        q = v;
        if (found.length) break;
      }
      const items = [...seen.values()];
      const compatible = items.filter(it => it.sku != null && typeof it.name === 'string' && brandConfirmed(t.brand, it.name)
        && isDunnesPackCompatible(t.canonical_name, it.name as string) && titleWordProblems(t.canonical_name, it.name as string).length === 0);
      if (process.env.DEBUG === '1') log({ event: 'debug', canonical: t.canonical_name, brand: t.brand, q, top: items.slice(0, 4).map(it => ({ name: it.name,
        brand: brandConfirmed(t.brand, it.name), pack: typeof it.name === 'string' && isDunnesPackCompatible(t.canonical_name, it.name),
        title: typeof it.name === 'string' ? titleWordProblems(t.canonical_name, it.name) : null })) });
      if (!compatible.length) { reason = 'no_compatible_candidate'; }
      else {
        const c = compatible[0], sku = String(c.sku);
        const { data: owners } = await sb.from('store_products').select('id').eq('store', 'dunnes').eq('store_sku', sku);
        const apiUrl = dunnesProductApiUrl(sku);
        const p = await governedGet(apiUrl);
        let resp: DunnesProductResponse | null = null; try { resp = p.status === 200 ? JSON.parse(p.body) : null; } catch { resp = null; }
        const conf = confirmDunnesSku({ canonicalName: t.canonical_name, canonicalBrand: t.brand, candidateSku: sku, candidateName: String(c.name),
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
