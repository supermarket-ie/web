// STRICTLY DIAGNOSTIC (owner-authorised 17 Nov 2026): exactly ONE SuperValu and ONE Dunnes product-page GET,
// each through the production request governor (withRetailerRequestSlot: rate limit, breaker, denial
// accounting). Run inside the existing worker image as a one-off ECS task (AWS egress) by writing this file to
// /tmp and running `node --conditions=react-server --import tsx /tmp/d.mjs` (imports use absolute /app paths).
// It writes NOTHING except the governor's own slot bookkeeping: no price, receipt, mapping or
// retailer_identity_responses row. No retries, no cookies, no challenge solving or other access workaround.
const PILOT = {
  supervalu: { sku: '1020898000', title: 'Schwartz Chilli Powder Mild  (38 g)',
    url: 'https://shop.supervalu.ie/sm/delivery/rsid/5550/product/schwartz-chilli-powder-mild-38-g-id-1020898000' },
  dunnes: { sku: '100111838', title: 'Schwartz Mild Chilli Powder 38g',
    url: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/schwartz-mild-chilli-powder-38g/100111838' },
};
const log = (o) => console.log('[diag] ' + JSON.stringify(o));
const ROOT = process.env.DIAG_APP_ROOT ?? '/app';
const gov = await import(`${ROOT}/src/lib/retailer-request-governor.ts`);
const sv = await import(`${ROOT}/src/lib/supervalu-direct-worker-base.ts`);
const idr = await import(`${ROOT}/src/lib/retailer-identity-response.ts`);
const bpi = await import(`${ROOT}/src/lib/branded-product-identity.ts`);
if (process.env.DIAG_DRY === '1') {
  log({ event: 'dry_run', modulesLoaded: [typeof gov.withRetailerRequestSlot, typeof sv.classifySupervaluProductPage, typeof idr.captureIdentityResponse, typeof bpi.safeProductUrl], requests: 0 });
  process.exit(0);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
class Denied extends Error { constructor(status, retryAfter) { super(`HTTP ${status}`); this.status = status; this.retryAfter = retryAfter; } }
const classifyError = (e) => (e instanceof Denied ? { reason: `http_${e.status}`, retryAfterMs: gov.parseRetryAfterMs?.(e.retryAfter ?? null) ?? null }
  : e?.name === 'AbortError' ? { reason: 'timeout' } : /fetch failed|network/i.test(String(e?.message)) ? { reason: 'network_error' } : null);

async function governedGet(store, url, accept) {
  return gov.withRetailerRequestSlot(store, async () => {
    const controller = new AbortController(); const t = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: 'no-store', redirect: 'follow',
        headers: { 'user-agent': UA, accept, 'accept-language': 'en-IE,en;q=0.9' } });
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => '');
        log({ store, event: 'denied', status: res.status, finalUrl: res.url, server: res.headers.get('server'), cfMitigated: res.headers.get('cf-mitigated'),
          cfRay: Boolean(res.headers.get('cf-ray')), challengeMarkers: /just a moment|challenge-platform|cf-chl|attention required/i.test(body), bytes: body.length });
        throw new Denied(res.status, res.headers.get('retry-after'));
      }
      return { res, body: await res.text() };
    } finally { clearTimeout(t); }
  }, { classifyError });
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function findSkuNodes(value, sku, path = '$', out = [], depth = 0) {
  if (depth > 30 || out.length > 5) return out;
  if (Array.isArray(value)) { value.forEach((v, i) => findSkuNodes(v, sku, `${path}[${i}]`, out, depth + 1)); return out; }
  if (value && typeof value === 'object') {
    const id = value.sku ?? value.productId;
    if (id != null && String(id) === sku) out.push({ path, skuType: typeof value.sku, productIdType: typeof value.productId, nameType: typeof value.name, name: typeof value.name === 'string' ? value.name.slice(0, 120) : null });
    for (const [k, v] of Object.entries(value)) if (typeof v === 'object') findSkuNodes(v, sku, `${path}.${k}`, out, depth + 1);
  }
  return out;
}

// ---- SuperValu: why does the production direct product-page path never retain captured_product? ----
try {
  const p = PILOT.supervalu;
  const { res, body } = await governedGet('supervalu', p.url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const finalUrl = res.url || p.url;
  const result = sv.classifySupervaluProductPage(body);
  const c = result.candidate;
  // Exactly the production call (supervalu-direct-worker-base.ts fetchSupervaluProduct):
  const prod = c ? idr.captureIdentityResponse({ store: 'supervalu', sku: c.sku, title: c.name, productUrl: c.url ?? p.url, requestedUrl: p.url, finalUrl,
    contentType: res.headers.get('content-type') ?? '', body }) : null;
  // Same evidence checks, but asking the body to prove the MAPPED sku (the body must still contain it with a matching title):
  const mapped = c ? idr.captureIdentityResponse({ store: 'supervalu', sku: p.sku, title: c.name, productUrl: p.url, requestedUrl: p.url, finalUrl,
    contentType: res.headers.get('content-type') ?? '', body }) : null;
  const ld = [...body.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m, i) => {
    let raw = null, dec = null; try { raw = JSON.parse(m[1]); } catch {} try { dec = JSON.parse(decode(m[1]).trim()); } catch {}
    const v = dec ?? raw; const type = v?.['@type'] ?? (Array.isArray(v?.['@graph']) ? 'graph' : null);
    return { i, rawParses: raw !== null, decodedParses: dec !== null, type, skuNodesRaw: raw ? findSkuNodes(raw, p.sku) : [], skuNodesDecoded: dec ? findSkuNodes(dec, p.sku) : [],
      productSku: v?.sku ?? null, productSkuType: typeof v?.sku, gtin: v?.gtin13 ?? v?.gtin ?? null };
  });
  const scripts = [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  const pre = scripts.findIndex(m => m[1].includes('__PRELOADED_STATE__'));
  let preParse = null, preNodes = [];
  if (pre >= 0) { const raw = scripts[pre][1].trim(); try { const v = JSON.parse(raw.slice(raw.indexOf('{', raw.indexOf('__PRELOADED_STATE__')), raw.lastIndexOf('}') + 1)); preParse = true; preNodes = findSkuNodes(v, p.sku); } catch { preParse = false; } }
  log({ store: 'supervalu', status: res.status, redirected: res.redirected, finalUrlEqualsStoreUrl: finalUrl === p.url, finalUrl, contentType: res.headers.get('content-type'),
    bytes: Buffer.byteLength(body, 'utf8'), over4MiB: Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024,
    safeProductUrl: bpi.safeProductUrl({ store: 'supervalu', sku: p.sku, url: p.url }),
    candidate: c ? { name: c.name, sku: c.sku, skuType: typeof c.sku, price: c.price, url: c.url ?? null } : null, failureReason: result.failureReason,
    productionCapture: prod ? { source_kind: prod.source_kind, source_path: prod.source_path, gtin: prod.identity?.gtin ?? null } : null,
    captureWithMappedSku: mapped ? { source_kind: mapped.source_kind, source_path: mapped.source_path, gtin: mapped.identity?.gtin ?? null,
      hasIngredients: Boolean(mapped.identity?.ingredients), manufacturer: mapped.identity?.manufacturer ?? null } : null,
    jsonLd: ld, scriptCount: scripts.length, preloadedScriptIndex: pre, preloadedParses: preParse, preloadedSkuNodes: preNodes });
} catch (e) { log({ store: 'supervalu', error: e?.name, message: String(e?.message ?? e).slice(0, 300) }); }

// ---- Dunnes: is the existing product URL retrievable through our infrastructure and request controls? ----
try {
  const p = PILOT.dunnes;
  const { res, body } = await governedGet('dunnes', p.url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const finalUrl = res.url || p.url;
  const nodes = []; for (const m of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) { try { findSkuNodes(JSON.parse(m[1]), p.sku, '$', nodes); } catch {} }
  const cap = idr.captureIdentityResponse({ store: 'dunnes', sku: p.sku, title: p.title, productUrl: p.url, requestedUrl: p.url, finalUrl, contentType: res.headers.get('content-type') ?? '', body });
  log({ store: 'dunnes', status: res.status, redirected: res.redirected, finalUrlEqualsStoreUrl: finalUrl === p.url, finalUrl, contentType: res.headers.get('content-type'),
    server: res.headers.get('server'), cfRay: Boolean(res.headers.get('cf-ray')), bytes: Buffer.byteLength(body, 'utf8'),
    challengeMarkers: /just a moment|challenge-platform|cf-chl|attention required/i.test(body),
    bodyMentionsSku: body.includes(p.sku), bodyMentionsTitle: body.toLowerCase().includes('schwartz mild chilli'),
    preloadedState: body.includes('__PRELOADED_STATE__'), jsonLdCount: (body.match(/application\/ld\+json/g) ?? []).length,
    skuNodesInParsableScripts: nodes, capture: cap ? { source_kind: cap.source_kind, source_path: cap.source_path, gtin: cap.identity?.gtin ?? null } : null,
    titleSnippet: (body.match(/<title[^>]*>([\s\S]{0,140})/i)?.[1] ?? '').replace(/\s+/g, ' ').trim() });
} catch (e) { log({ store: 'dunnes', error: e?.name, message: String(e?.message ?? e).slice(0, 300) }); }
log({ event: 'done', requests: 2 });
