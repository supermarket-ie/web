import { supabaseAdmin } from '@/lib/supabase';

const STORE = 'aldi';

type Candidate = { name: string; price: number; wasPrice: number | null; onPromotion: boolean };

export type AldiQueueProduct = {
  storeProductId: string;
  canonicalName: string;
  storeProductName: string;
  storeUrl: string;
  storeSku: string | null;
  previousPrice: number | null;
};

export type AldiBatchMessage = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  products: AldiQueueProduct[];
};

export class TransientAldiError extends Error {
  constructor(message: string, public readonly product: AldiQueueProduct, public readonly reason: string) {
    super(message);
    this.name = 'TransientAldiError';
  }
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function normalise(value: string) {
  return decodeHtml(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractSize(name: string): { qty: number; unit: string; multi: boolean } | null {
  const n = normalise(name);
  const multi = n.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)?/i);
  if (multi) {
    let qty = Number(multi[1]) * Number(multi[2]);
    let unit = (multi[3] || 'ea').toLowerCase();
    if (unit === 'kg') { qty *= 1000; unit = 'g'; }
    if (unit === 'l') { qty *= 1000; unit = 'ml'; }
    if (unit === 'cl') { qty *= 10; unit = 'ml'; }
    return { qty, unit, multi: true };
  }
  const pack = n.match(/(\d+)\s*(?:pack|pk)\b/i);
  if (pack) return { qty: Number(pack[1]), unit: 'ea', multi: true };
  const single = n.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (!single) return null;
  let qty = Number(single[1]);
  let unit = single[2].toLowerCase();
  if (unit === 'kg') { qty *= 1000; unit = 'g'; }
  if (unit === 'l') { qty *= 1000; unit = 'ml'; }
  if (unit === 'cl') { qty *= 10; unit = 'ml'; }
  return { qty, unit, multi: false };
}

function sizeCompatible(a: string, b: string) {
  const sa = extractSize(a);
  const sb = extractSize(b);
  if (!sa || !sb) return true;
  if (sa.unit !== sb.unit || sa.multi !== sb.multi) return false;
  return Math.max(sa.qty, sb.qty) / Math.min(sa.qty, sb.qty) <= 1.1;
}

function nameCompatible(canonical: string, stored: string, fetched: string) {
  if (!sizeCompatible(canonical, fetched)) return false;
  const target = normalise(stored || canonical);
  const actual = normalise(fetched);
  if (target === actual || target.includes(actual) || actual.includes(target)) return true;
  const targetWords = target.split(/\s+/).filter((w) => w.length > 2);
  const actualWords = actual.split(/\s+/).filter((w) => w.length > 2);
  const targetCoverage = targetWords.length ? targetWords.filter((w) => actual.includes(w)).length / targetWords.length : 0;
  const actualCoverage = actualWords.length ? actualWords.filter((w) => target.includes(w)).length / actualWords.length : 0;
  return targetCoverage >= 0.6 && actualCoverage >= 0.45;
}

function numericPrice(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1000 ? parsed : null;
}

function findProduct(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) { const found = findProduct(item); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record;
  return record['@graph'] ? findProduct(record['@graph']) : null;
}

function parseProductPage(html: string): Candidate | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const product = findProduct(JSON.parse(decodeHtml(match[1]).trim()));
      if (!product) continue;
      const name = typeof product.name === 'string' ? product.name.trim() : '';
      const offersRaw = product.offers;
      const offerRaw = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      const offer = offerRaw && typeof offerRaw === 'object' ? offerRaw as Record<string, unknown> : null;
      const price = numericPrice(offer?.price ?? offer?.lowPrice);
      if (name && price) return { name, price, wasPrice: null, onPromotion: false };
    } catch { /* try fallbacks */ }
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const priceMatch = html.match(/(?:itemprop=["']price["'][^>]*(?:content|value)=["']|"price"\s*:\s*["']?)(\d+(?:\.\d{1,2})?)/i)
    ?? html.match(/€\s*(\d+\.\d{2})/);
  const price = numericPrice(priceMatch?.[1]);
  return h1 && price ? { name: decodeHtml(h1), price, wasPrice: null, onPromotion: false } : null;
}

async function fetchProduct(product: AldiQueueProduct) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(product.storeUrl, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-IE,en;q=0.9',
      },
    });
    if (response.status === 429 || response.status >= 500) {
      throw new TransientAldiError(`Aldi returned HTTP ${response.status}`, product, `http_${response.status}`);
    }
    if (!response.ok) return null;
    return parseProductPage(await response.text());
  } catch (error) {
    if (error instanceof TransientAldiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error';
    throw new TransientAldiError(message, product, reason);
  } finally { clearTimeout(timeout); }
}

export async function selectAldiProducts(limit: number, query?: string): Promise<AldiQueueProduct[]> {
  let builder = supabaseAdmin.from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', STORE).eq('url_status', 'resolved').like('store_url', '%/product/%').limit(limit);
  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);
  const { data, error } = await builder;
  if (error) throw new Error(`Failed selecting Aldi products: ${error.message}`);
  if (!data?.length) return [];
  const ids = data.map((row) => row.id);
  const { data: observations, error: obsError } = await supabaseAdmin.from('price_observations')
    .select('store_product_id, price, observed_at').in('store_product_id', ids).order('observed_at', { ascending: false });
  if (obsError) throw new Error(`Failed loading Aldi previous prices: ${obsError.message}`);
  const latest = new Map<string, number>();
  for (const observation of observations ?? []) if (!latest.has(observation.store_product_id)) latest.set(observation.store_product_id, observation.price);
  return data.filter((row) => typeof row.store_url === 'string' && row.store_url.includes('/product/')).map((row) => {
    const product = row.products as unknown as { canonical_name: string };
    return {
      storeProductId: row.id,
      canonicalName: product.canonical_name,
      storeProductName: row.store_product_name,
      storeUrl: row.store_url as string,
      storeSku: row.store_sku,
      previousPrice: latest.get(row.id) ?? null,
    };
  });
}

export async function createAldiScrapeRun(runId: string, targetCount: number) {
  const { data, error } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId, store: STORE, started_at: new Date().toISOString(), target_count: targetCount,
    retrieval_method: 'vercel_direct_product_page', threshold_pct: 60, status: 'running',
  }).select('id').single();
  if (error) throw new Error(`Failed creating Aldi scrape run: ${error.message}`);
  return data.id as string;
}

async function finalize(message: AldiBatchMessage, product: AldiQueueProduct, params: {
  success: boolean; candidate?: Candidate; fetched: number; extracted: number;
  failureStage?: string; failureReason?: string; rawError?: string | null;
}) {
  const candidate = params.candidate;
  const { error } = await supabaseAdmin.rpc('finalize_store_scrape_product', {
    p_run_uuid: message.runUuid, p_store: STORE, p_store_product_id: product.storeProductId,
    p_success: params.success, p_price: candidate?.price ?? null, p_previous_price: product.previousPrice,
    p_was_price: candidate?.wasPrice ?? null, p_on_promotion: candidate?.onPromotion ?? false,
    p_store_url: product.storeUrl, p_store_sku: product.storeSku,
    p_store_product_name: candidate?.name ?? product.storeProductName,
    p_fetched: params.fetched, p_extracted: params.extracted,
    p_failure_stage: params.failureStage ?? null, p_failure_reason: params.failureReason ?? null,
    p_canonical_name: product.canonicalName, p_raw_error: params.rawError?.slice(0, 500) ?? null,
    p_is_retryable: false,
  });
  if (error) throw new Error(`Failed finalizing Aldi product: ${error.message}`);
}

export async function finalizeAldiPermanentFailure(message: AldiBatchMessage, product: AldiQueueProduct, reason: string, rawError: string | null) {
  await finalize(message, product, { success: false, fetched: 0, extracted: 0, failureStage: 'fetching', failureReason: reason, rawError });
}

export async function processAldiProduct(message: AldiBatchMessage, product: AldiQueueProduct) {
  const candidate = await fetchProduct(product);
  if (!candidate) {
    await finalize(message, product, { success: false, fetched: 1, extracted: 0, failureStage: 'parsing', failureReason: 'no_product_data' });
    return;
  }
  if (!nameCompatible(product.canonicalName, product.storeProductName, candidate.name)) {
    await finalize(message, product, {
      success: false, candidate, fetched: 1, extracted: 1, failureStage: 'matching', failureReason: 'direct_name_mismatch',
      rawError: `canonical=${product.canonicalName}; stored=${product.storeProductName}; fetched=${candidate.name}`,
    });
    return;
  }
  await finalize(message, product, { success: true, candidate, fetched: 1, extracted: 1 });
}
