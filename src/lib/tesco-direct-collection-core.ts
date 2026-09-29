import { classifyTescoMapping, classifyTescoReplacement, type TescoMappingEvidence } from './tesco-mapping-audit';

export type TescoCollectedProduct = {
  sku: string;
  url: string;
  name: string;
  brand: string | null;
  gtin: string | null;
  price: number | null;
  currency: 'EUR';
  available: boolean;
  quantity: { grams?: number; millilitres?: number; pieces?: number } | null;
};
export type TescoCollectedPage = {
  products: TescoCollectedProduct[];
  listing: { query: string; page: number; pageSize: number; total: number; nextUrl: string | null } | null;
};
export type TescoFetchOutcome = 'ok' | 'access_block' | 'rate_limited' | 'http_error' | 'network_error' | 'unsafe_redirect';
export type TescoPageResponse = {
  outcome: TescoFetchOutcome;
  status: number | null;
  finalUrl: string;
  redirectUrl?: string;
  html: string;
  retryAfter: string | null;
  elapsedMs: number;
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }

export function tescoProductUrl(sku: string): string {
  if (!/^\d{6,12}$/.test(sku)) throw new Error('Invalid Tesco SKU');
  return `https://www.tesco.ie/shop/en-IE/products/${sku}`;
}
export function tescoListingUrl(query: string, page = 1): string {
  if (!query.trim() || query.length > 120 || !Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid Tesco listing');
  return `https://www.tesco.ie/shop/en-IE/search?${new URLSearchParams({ query: query.trim(), page: String(page), count: '24', sortBy: 'relevance' })}`;
}
export function isTescoCollectionUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.origin === 'https://www.tesco.ie' && !u.username && !u.password
      && (/^\/shop\/en-IE\/products\/\d{6,12}$/.test(u.pathname) || u.pathname === '/shop/en-IE/search');
  } catch { return false; }
}

function productFromCache(value: unknown): TescoCollectedProduct | null {
  const p = object(value);
  const sku = string(p.tpnc);
  if (!/^\d{6,12}$/.test(sku) || string(p.id) !== sku || !string(p.title)) return null;
  const price = object(p.price).actual;
  const packs = object(p.details).packSize;
  const pack = object(Array.isArray(packs) && packs.length === 1 ? packs[0] : null);
  const amount = Number(pack.value);
  const unit = string(pack.units).toLowerCase();
  let quantity: TescoCollectedProduct['quantity'] = null;
  if (Number.isFinite(amount) && amount > 0) {
    if (unit === 'g' || unit === 'kg') quantity = { grams: amount * (unit === 'kg' ? 1000 : 1) };
    if (['ml', 'cl', 'l'].includes(unit)) quantity = { millilitres: amount * (unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1) };
    if (['each', 'ea', 'pieces'].includes(unit)) quantity = { pieces: amount };
  }
  return {
    sku, url: tescoProductUrl(sku), name: string(p.title), brand: string(p.brandName) || null,
    gtin: string(p.gtin) || null,
    price: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null,
    currency: 'EUR', available: p.isForSale === true && p.status === 'AvailableForSale', quantity,
  };
}

// Read only products referenced by this page's ROOT_QUERY. Other cache entries
// can be recommendations, substitutions, or prefetched pages.
export function parseTescoCollectedPage(html: string, finalUrl: string): TescoCollectedPage {
  if (!isTescoCollectionUrl(finalUrl)) throw new Error('Not an Irish Tesco collection URL');
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/discover\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const props = scripts.map(match => {
    try { return object(object(JSON.parse(match[1]))['mfe-orchestrator']).props; } catch { return null; }
  }).map(object).find(p => p.apolloCache);
  if (!props || object(object(props.config).global).locale !== 'en-IE' || !/(?:€|&euro;|&#8364;)/i.test(html)) {
    throw new Error('Irish locale and visible euro evidence required');
  }
  // JSON-LD on Irish pages can incorrectly label GBP. Never use its price or
  // currency, nor promotion.afterDiscount (which can be future/conditional).
  const cache = object(props.apolloCache);
  const root = object(cache.ROOT_QUERY);
  const url = new URL(finalUrl);
  const sku = url.pathname.match(/\/products\/(\d+)$/)?.[1];
  if (sku) {
    const ref = object(root[`product(${JSON.stringify({ tpnc: sku })})`]).__ref;
    const p = productFromCache(cache[string(ref)]);
    if (!p || p.sku !== sku) throw new Error('Product root, URL and structured SKU do not agree');
    return { products: [p], listing: null };
  }
  const query = url.searchParams.get('query') ?? '';
  const page = Number(url.searchParams.get('page') || 1);
  const lists = Object.entries(root).filter(([key]) => {
    if (!key.startsWith('search(')) return false;
    try {
      const args = object(JSON.parse(key.slice(7, key.lastIndexOf(')'))));
      return args.query === query && Number(args.page || 1) === page;
    } catch { return false; }
  });
  if (lists.length !== 1) throw new Error('Exactly one matching listing root required');
  const list = object(lists[0][1]);
  const info = object(list.info);
  const pageSize = Number(info.pageSize);
  const total = Number(info.total);
  if (Number(info.page) !== page || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(total) || total < 0 || !Array.isArray(list.results)) {
    throw new Error('Invalid listing pagination evidence');
  }
  const products = list.results.map(result => productFromCache(cache[string(object(object(result).node).__ref)]));
  if (products.some(p => !p)) throw new Error('Listing contains an unresolvable product');
  const unique = [...new Map((products as TescoCollectedProduct[]).map(p => [p.sku, p])).values()];
  if (unique.length !== products.length || (total > (page - 1) * pageSize && unique.length === 0)) throw new Error('Incomplete or duplicate listing');
  return { products: unique, listing: { query, page, pageSize, total, nextUrl: page * pageSize < total && page < 100 ? tescoListingUrl(query, page + 1) : null } };
}

export function validateTescoCollectedIdentity(mapping: TescoMappingEvidence, p: TescoCollectedProduct): string[] {
  if (mapping.storeSku !== p.sku) return ['different_sku_requires_mapping_review'];
  if (!p.available || p.price === null) return ['unavailable_or_no_regular_price'];
  const canonical = mapping.canonicalName.toLowerCase();
  const candidate = p.name.toLowerCase();
  if (/\b(?:minced? beef|beef mince|chicken breast|chicken fillet)\b/.test(canonical)
    && !/\b(?:pasta|bolognese|sauce|ready meal|pie|lasagne|lasagna|curry|sandwich|pizza)\b/.test(canonical)
    && /\b(?:pasta|bolognese|sauce|ready meal|pie|lasagne|lasagna|curry|sandwich|pizza)\b/.test(candidate)) {
    return ['raw_ingredient_prepared_meal_conflict'];
  }
  const strict = classifyTescoReplacement(mapping, { sku: p.sku, url: p.url, name: p.name, structuredQuantity: p.quantity, evidenceSource: 'tesco_direct_structured' });
  if (strict.classification !== 'exact_replacement_candidate') return strict.reasons;
  // Preserve the duplicate-canonical guard separately from live title/brand
  // validation. Existing metadata alone is not evidence of canonical identity.
  const peers = classifyTescoMapping({ ...mapping, storeProductName: p.name, storeBrand: p.brand, isOwnBrand: /^tesco\b/i.test(p.name) });
  if (peers.classification === 'ambiguous' || peers.classification === 'material_mismatch' || peers.classification === 'insufficient_evidence') return peers.reasons;
  return [];
}

export function tescoPauseUntil(outcome: TescoFetchOutcome, retryAfter: string | null, now = Date.now()): string | null {
  if (outcome === 'ok') return null;
  const baseline = outcome === 'access_block' ? 48 * 3600_000 : 15 * 60_000;
  let retryAt = 0;
  if (retryAfter) {
    retryAt = /^\d+$/.test(retryAfter.trim()) ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
  }
  return new Date(Math.max(now + baseline, Number.isFinite(retryAt) ? retryAt : 0)).toISOString();
}

// A missing resource is not an egress denial. Never follow an out-of-scope
// redirect; only a permanent redirect to the public Irish homepage is skippable.
// Unknown redirects (including login/challenge paths) still stop collection.
export function tescoResourceUnavailable(response: TescoPageResponse): boolean {
  if (response.retryAfter) return false;
  if (response.outcome === 'http_error' && [404, 410].includes(response.status ?? 0)) return true;
  if (response.outcome !== 'unsafe_redirect' || ![301, 308].includes(response.status ?? 0)) return false;
  return ['https://www.tesco.ie/', 'https://www.tesco.ie/shop/en-IE', 'https://www.tesco.ie/shop/en-IE/'].includes(response.redirectUrl ?? '');
}

// One attempt only, with no cookies, login, browser impersonation or proxy
// rotation. A challenge stops the caller's entire collection, including listings.
export async function fetchTescoCollectedPage(url: string, fetcher: typeof fetch = fetch): Promise<TescoPageResponse> {
  if (!isTescoCollectionUrl(url)) throw new Error('Unsafe Tesco collection URL');
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let current = url;
  try {
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      const response = await fetcher(current, { signal: controller.signal, redirect: 'manual', cache: 'no-store', headers: {
        'User-Agent': 'Supermarket.ie/1.0 (+https://www.supermarket.ie)', Accept: 'text/html', 'Accept-Language': 'en-IE,en;q=0.9',
      } });
      const retryAfter = response.headers.get('retry-after');
      const result = { status: response.status, finalUrl: current, retryAfter, elapsedMs: Date.now() - start };
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        const next = location ? new URL(location, current).href : '';
        if (redirects === 2 || !isTescoCollectionUrl(next)) return { ...result, redirectUrl: next, outcome: 'unsafe_redirect', html: '' };
        current = next;
        continue;
      }
      const html = await response.text();
      const challenge = /<title[^>]*>\s*Access Denied|(?:complete|pass|failed|perform) (?:the )?security checks|not (?:quite )?right[\s\S]{0,150}security/i.test(html)
        || (!html.includes('application/discover+json') && /captcha|verify (?:that )?you are human/i.test(html));
      const outcome: TescoFetchOutcome = response.status === 401 || response.status === 403 || challenge ? 'access_block'
        : response.status === 429 ? 'rate_limited' : response.status === 200 ? 'ok' : 'http_error';
      return { ...result, html, outcome, elapsedMs: Date.now() - start };
    }
    throw new Error('Redirect limit exceeded');
  } catch {
    return { outcome: 'network_error', status: null, finalUrl: current, html: '', retryAfter: null, elapsedMs: Date.now() - start };
  } finally { clearTimeout(timer); }
}
