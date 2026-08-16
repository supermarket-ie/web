import { supabaseAdmin } from '@/lib/supabase';

const STORE = 'supervalu';

type Candidate = {
  name: string;
  price: number;
  wasPrice: number | null;
  onPromotion: boolean;
};

export type SupervaluQueueProduct = {
  storeProductId: string;
  canonicalName: string;
  storeProductName: string;
  storeUrl: string;
  storeSku: string | null;
  previousPrice: number | null;
};

export type SupervaluBatchMessage = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  products: SupervaluQueueProduct[];
};

export class TransientSupervaluError extends Error {
  constructor(
    message: string,
    public readonly product: SupervaluQueueProduct,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'TransientSupervaluError';
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normaliseName(value: string) {
  return decodeHtml(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSize(name: string): { qty: number; unit: string; isMultipack: boolean } | null {
  const n = normaliseName(name);
  const multi = n.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)?/i);
  if (multi) {
    const count = Number(multi[1]);
    const each = Number(multi[2]);
    let unit = (multi[3] || 'ea').toLowerCase();
    let qty = count * each;
    if (unit === 'kg') { qty *= 1000; unit = 'g'; }
    if (unit === 'l') { qty *= 1000; unit = 'ml'; }
    if (unit === 'cl') { qty *= 10; unit = 'ml'; }
    return { qty, unit, isMultipack: true };
  }
  const pack = n.match(/(\d+)\s*(?:pack|pk)\b/i);
  if (pack) return { qty: Number(pack[1]), unit: 'ea', isMultipack: true };
  const single = n.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (!single) return null;
  const qty = Number(single[1]);
  const unit = single[2].toLowerCase();
  if (unit === 'kg') return { qty: qty * 1000, unit: 'g', isMultipack: false };
  if (unit === 'l') return { qty: qty * 1000, unit: 'ml', isMultipack: false };
  if (unit === 'cl') return { qty: qty * 10, unit: 'ml', isMultipack: false };
  return { qty, unit, isMultipack: false };
}

function isSizeCompatible(canonical: string, candidate: string) {
  const a = extractSize(canonical);
  const b = extractSize(candidate);
  if (!a || !b) return true;
  if (a.unit !== b.unit || a.isMultipack !== b.isMultipack) return false;
  return Math.max(a.qty, b.qty) / Math.min(a.qty, b.qty) <= 1.1;
}

function isNameCompatible(canonical: string, candidate: string) {
  if (!isSizeCompatible(canonical, candidate)) return false;
  const cn = normaliseName(canonical);
  const ca = normaliseName(candidate);
  if (cn === ca) return true;

  const sizeRe = /\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|ea)?\b/gi;
  const a = cn.replace(sizeRe, '').replace(/\s+/g, ' ').trim();
  const b = ca.replace(sizeRe, '').replace(/\s+/g, ' ').trim();
  const aWords = a.split(/\s+/).filter((word) => word.length > 2);
  const bWords = b.split(/\s+/).filter((word) => word.length > 2);
  const aCoverage = aWords.length ? aWords.filter((word) => b.includes(word)).length / aWords.length : 0;
  const bCoverage = bWords.length ? bWords.filter((word) => a.includes(word)).length / bWords.length : 0;
  return aCoverage >= 0.65 && bCoverage >= 0.5;
}

function findProductJsonLd(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return record;
  if (record['@graph']) return findProductJsonLd(record['@graph']);
  return null;
}

function numericPrice(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1000 ? parsed : null;
}

function parseProductPage(html: string): Candidate | null {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(decodeHtml(scriptMatch[1]).trim());
      const product = findProductJsonLd(json);
      if (!product) continue;
      const name = typeof product.name === 'string' ? product.name.trim() : '';
      const offersRaw = product.offers;
      const offers = Array.isArray(offersRaw) ? offersRaw[0] : offersRaw;
      const offer = offers && typeof offers === 'object' ? offers as Record<string, unknown> : null;
      const price = numericPrice(offer?.price ?? offer?.lowPrice);
      if (name && price) return { name, price, wasPrice: null, onPromotion: false };
    } catch {
      // Continue to other JSON-LD blocks and HTML fallbacks.
    }
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const priceMatch = html.match(/(?:itemprop=["']price["'][^>]*(?:content|value)=["']|"price"\s*:\s*["']?)(\d+(?:\.\d{1,2})?)/i)
    ?? html.match(/€\s*(\d+\.\d{2})/);
  const price = numericPrice(priceMatch?.[1]);
  if (!h1 || !price) return null;
  return { name: decodeHtml(h1), price, wasPrice: null, onPromotion: false };
}

async function fetchProduct(product: SupervaluQueueProduct): Promise<Candidate | null> {
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
      throw new TransientSupervaluError(`SuperValu returned HTTP ${response.status}`, product, `http_${response.status}`);
    }
    if (!response.ok) return null;
    return parseProductPage(await response.text());
  } catch (error) {
    if (error instanceof TransientSupervaluError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error';
    throw new TransientSupervaluError(message, product, reason);
  } finally {
    clearTimeout(timeout);
  }
}

export async function selectSupervaluProducts(limit: number, query?: string): Promise<SupervaluQueueProduct[]> {
  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', STORE)
    .eq('url_status', 'resolved')
    .like('store_url', '%/product/%')
    .limit(limit);
  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);

  const { data, error } = await builder;
  if (error) throw new Error(`Failed selecting SuperValu products: ${error.message}`);
  if (!data || data.length === 0) return [];

  const ids = data.map((row) => row.id);
  const { data: observations, error: obsError } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, price, observed_at')
    .in('store_product_id', ids)
    .order('observed_at', { ascending: false });
  if (obsError) throw new Error(`Failed loading SuperValu previous prices: ${obsError.message}`);

  const latest = new Map<string, number>();
  for (const observation of observations ?? []) {
    if (!latest.has(observation.store_product_id)) latest.set(observation.store_product_id, observation.price);
  }

  return data
    .filter((row) => typeof row.store_url === 'string' && row.store_url.includes('/product/'))
    .map((row) => {
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

export async function createSupervaluScrapeRun(runId: string, targetCount: number) {
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .insert({
      run_id: runId,
      store: STORE,
      started_at: new Date().toISOString(),
      target_count: targetCount,
      retrieval_method: 'vercel_direct_product_page',
      threshold_pct: 85,
      status: 'running',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed creating SuperValu scrape run: ${error.message}`);
  return data.id as string;
}

async function finalize(
  message: SupervaluBatchMessage,
  product: SupervaluQueueProduct,
  params: {
    success: boolean;
    candidate?: Candidate;
    fetched: number;
    extracted: number;
    failureStage?: string;
    failureReason?: string;
    rawError?: string | null;
  },
) {
  const candidate = params.candidate;
  const { error } = await supabaseAdmin.rpc('finalize_store_scrape_product', {
    p_run_uuid: message.runUuid,
    p_store: STORE,
    p_store_product_id: product.storeProductId,
    p_success: params.success,
    p_price: candidate?.price ?? null,
    p_previous_price: product.previousPrice,
    p_was_price: candidate?.wasPrice ?? null,
    p_on_promotion: candidate?.onPromotion ?? false,
    p_store_url: product.storeUrl,
    p_store_sku: product.storeSku,
    p_store_product_name: candidate?.name ?? product.storeProductName,
    p_fetched: params.fetched,
    p_extracted: params.extracted,
    p_failure_stage: params.failureStage ?? null,
    p_failure_reason: params.failureReason ?? null,
    p_canonical_name: product.canonicalName,
    p_raw_error: params.rawError?.slice(0, 500) ?? null,
    p_is_retryable: false,
  });
  if (error) throw new Error(`Failed finalizing SuperValu product: ${error.message}`);
}

export async function finalizeSupervaluPermanentFailure(
  message: SupervaluBatchMessage,
  product: SupervaluQueueProduct,
  reason: string,
  rawError: string | null,
) {
  await finalize(message, product, {
    success: false,
    fetched: 0,
    extracted: 0,
    failureStage: 'fetching',
    failureReason: reason,
    rawError,
  });
}

export async function processSupervaluProduct(message: SupervaluBatchMessage, product: SupervaluQueueProduct) {
  if (!product.storeUrl.includes('/product/')) {
    await finalize(message, product, {
      success: false,
      fetched: 0,
      extracted: 0,
      failureStage: 'validation',
      failureReason: 'invalid_search_url_mapping',
    });
    return;
  }

  const candidate = await fetchProduct(product);
  if (!candidate) {
    await finalize(message, product, {
      success: false,
      fetched: 1,
      extracted: 0,
      failureStage: 'parsing',
      failureReason: 'no_product_data',
    });
    return;
  }
  if (!isNameCompatible(product.canonicalName, candidate.name)) {
    await finalize(message, product, {
      success: false,
      candidate,
      fetched: 1,
      extracted: 1,
      failureStage: 'matching',
      failureReason: 'direct_name_mismatch',
      rawError: `canonical=${product.canonicalName}; fetched=${candidate.name}`,
    });
    return;
  }

  await finalize(message, product, { success: true, candidate, fetched: 1, extracted: 1 });
}
