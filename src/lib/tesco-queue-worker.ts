import { supabaseAdmin } from '@/lib/supabase';

const BASE_URL = 'https://www.tesco.ie';
const SCRAPINGBEE_ENDPOINT = 'https://app.scrapingbee.com/api/v1';
const DEFAULT_FETCH_RETRIES = 2;

export type TescoQueueProduct = {
  storeProductId: string;
  canonicalName: string;
  storeProductName: string;
  storeUrl: string;
  storeSku: string | null;
  previousPrice: number | null;
};

export type TescoBatchMessage = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  products: TescoQueueProduct[];
};

type ScrapingBeeResult =
  | { ok: true; html: string; creditCost: number }
  | { ok: false; reason: 'blocked_challenge' | 'rate_limited' | 'timeout' | 'http_error' | 'network_error'; error: string; creditCost: number };

type Candidate = {
  sku: string | null;
  url: string | null;
  name: string;
  price: number | null;
};

export class TransientTescoError extends Error {
  constructor(
    message: string,
    public readonly product: TescoQueueProduct,
    public readonly reason: string,
    public readonly scrapingbeeRequests: number,
    public readonly scrapingbeeCredits: number,
  ) {
    super(message);
    this.name = 'TransientTescoError';
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseName(value: string) {
  return value
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

const SPREAD_WORDS = ['peanut', 'almond', 'cashew', 'hazelnut', 'sunflower', 'spread', 'margarine'];

function hasProductTypeConflict(canonical: string, candidate: string) {
  const cn = normaliseName(canonical);
  const ca = normaliseName(candidate);
  const canonicalButter = cn.includes('butter') && !SPREAD_WORDS.some((word) => cn.includes(word));
  const candidateSpread = SPREAD_WORDS.some((word) => ca.includes(word));
  if (canonicalButter && candidateSpread) return true;
  const candidateButter = ca.includes('butter') && !SPREAD_WORDS.some((word) => ca.includes(word));
  const canonicalSpread = SPREAD_WORDS.some((word) => cn.includes(word));
  return canonicalSpread && candidateButter;
}

function isSizeCompatible(canonical: string, candidate: string) {
  const a = extractSize(canonical);
  const b = extractSize(candidate);
  if (!a || !b) return true;
  if (a.unit !== b.unit || a.isMultipack !== b.isMultipack) return false;
  return Math.max(a.qty, b.qty) / Math.min(a.qty, b.qty) <= 1.1;
}

function fuzzyMatch(searchName: string, candidates: Candidate[]) {
  const normSearch = normaliseName(searchName);
  let best: { product: Candidate; score: number } | null = null;

  for (const candidate of candidates) {
    const normCandidate = normaliseName(candidate.name);
    if (!normCandidate) continue;
    if (hasProductTypeConflict(searchName, candidate.name)) continue;
    if (!isSizeCompatible(searchName, candidate.name)) continue;

    if (normSearch === normCandidate) {
      if (!best || best.score < 1) best = { product: candidate, score: 1 };
      continue;
    }

    const sizeRe = /\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|ea)?\b/gi;
    const searchKeywords = normSearch.replace(sizeRe, '').replace(/\s+/g, ' ').trim();
    const candidateKeywords = normCandidate.replace(sizeRe, '').replace(/\s+/g, ' ').trim();
    const searchWords = searchKeywords.split(/\s+/).filter((word) => word.length > 2);
    const candidateWords = candidateKeywords.split(/\s+/).filter((word) => word.length > 2);
    const searchCoverage = searchWords.length
      ? searchWords.filter((word) => candidateKeywords.includes(word)).length / searchWords.length
      : 0;
    const candidateCoverage = candidateWords.length
      ? candidateWords.filter((word) => searchKeywords.includes(word)).length / candidateWords.length
      : 0;
    const score = searchCoverage * 0.7 + candidateCoverage * 0.3;

    if (score >= 0.45 && searchCoverage > 0.5 && candidateCoverage > 0.5 && (!best || score > best.score)) {
      best = { product: candidate, score };
    }
  }

  return best;
}

function parseSearchResults(html: string): Candidate[] {
  const seen = new Set<string>();
  const tiles: Array<{ sku: string; name: string; pos: number }> = [];
  const tileRegex = /<h2[^>]*product-heading[^>]*>.*?<a[^>]*href="[^"]*\/products\/(\d+)"[^>]*>([^<]+)<\/a><\/h2>/g;
  let match: RegExpExecArray | null;
  while ((match = tileRegex.exec(html)) !== null) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    tiles.push({ sku: match[1], name: match[2].trim(), pos: match.index });
  }

  const prices: Array<{ price: number; pos: number }> = [];
  const priceRegex = /priceText[^>]*>€(\d+\.\d{2})<\/p>/g;
  while ((match = priceRegex.exec(html)) !== null) {
    prices.push({ price: Number(match[1]), pos: match.index });
  }

  return tiles.map((tile, index) => {
    const next = index + 1 < tiles.length ? tiles[index + 1].pos : Number.POSITIVE_INFINITY;
    const price = prices.find((item) => item.pos > tile.pos && item.pos < next)?.price ?? null;
    return {
      sku: tile.sku,
      url: `${BASE_URL}/shop/en-IE/products/${tile.sku}`,
      name: tile.name,
      price,
    };
  });
}

function parseProductPage(html: string): Candidate | null {
  const name = html.match(/<h1[^>]*>\s*([^<]{3,120})\s*<\/h1>/i)?.[1]?.trim() ?? null;
  const price = Number(html.match(/priceText[^>]*>€?(\d+\.\d{2})<\/p>/)?.[1] ?? 0);
  if (!name || !price || price <= 0) return null;
  return { sku: null, url: null, name, price };
}

async function scrapingBeeFetch(url: string): Promise<ScrapingBeeResult> {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error('SCRAPINGBEE_API_KEY is not configured');

  const params = new URLSearchParams({
    api_key: key,
    url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'ie',
    wait: '7000',
  });

  let credits = 0;
  for (let attempt = 1; attempt <= DEFAULT_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(`${SCRAPINGBEE_ENDPOINT}?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const cost = Number(response.headers.get('Spb-Cost') || 25);
      credits += Number.isFinite(cost) ? cost : 25;

      if (response.status === 200) {
        const html = await response.text();
        const blocked = html.includes('Access Denied') || html.includes('security checks') ||
          (html.includes('not right') && html.includes('security'));
        if (blocked) {
          if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(3_000); continue; }
          return { ok: false, reason: 'blocked_challenge', error: 'Tesco challenge page returned', creditCost: credits };
        }
        return { ok: true, html, creditCost: credits };
      }

      if (response.status === 429) {
        if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(5_000); continue; }
        return { ok: false, reason: 'rate_limited', error: 'ScrapingBee returned HTTP 429', creditCost: credits };
      }

      const body = (await response.text().catch(() => '')).slice(0, 120);
      if (response.status >= 500 && attempt < DEFAULT_FETCH_RETRIES) { await sleep(3_000); continue; }
      return { ok: false, reason: response.status >= 500 ? 'http_error' : 'http_error', error: `HTTP ${response.status}: ${body}`, creditCost: credits };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(3_000); continue; }
      return { ok: false, reason: timedOut ? 'timeout' : 'network_error', error: message, creditCost: credits };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, reason: 'network_error', error: 'Maximum attempts exceeded', creditCost: credits };
}

function isTransientFetchFailure(reason: ScrapingBeeResult extends infer _T ? string : never) {
  return ['blocked_challenge', 'rate_limited', 'timeout', 'http_error', 'network_error'].includes(reason);
}

async function finalizeSuccess(
  message: TescoBatchMessage,
  product: TescoQueueProduct,
  price: number,
  resolved: { url: string; sku: string | null; name: string },
  fetched: number,
  extracted: number,
  requests: number,
  credits: number,
) {
  const { error } = await supabaseAdmin.rpc('finalize_tesco_scrape_product', {
    p_run_uuid: message.runUuid,
    p_store_product_id: product.storeProductId,
    p_success: true,
    p_price: price,
    p_previous_price: product.previousPrice,
    p_store_url: resolved.url,
    p_store_sku: resolved.sku,
    p_store_product_name: resolved.name,
    p_fetched: fetched,
    p_extracted: extracted,
    p_scrapingbee_requests: requests,
    p_scrapingbee_credits: credits,
    p_failure_stage: null,
    p_failure_reason: null,
    p_canonical_name: product.canonicalName,
    p_raw_error: null,
  });
  if (error) throw new Error(`Supabase finalization failed: ${error.message}`);
}

export async function finalizePermanentFailure(
  message: TescoBatchMessage,
  product: TescoQueueProduct,
  reason: string,
  rawError: string | null,
  fetched: number,
  requests: number,
  credits: number,
  stage: 'fetching' | 'parsing' = 'fetching',
) {
  const { error } = await supabaseAdmin.rpc('finalize_tesco_scrape_product', {
    p_run_uuid: message.runUuid,
    p_store_product_id: product.storeProductId,
    p_success: false,
    p_price: null,
    p_previous_price: product.previousPrice,
    p_store_url: product.storeUrl,
    p_store_sku: product.storeSku,
    p_store_product_name: product.storeProductName,
    p_fetched: fetched,
    p_extracted: 0,
    p_scrapingbee_requests: requests,
    p_scrapingbee_credits: credits,
    p_failure_stage: stage,
    p_failure_reason: reason,
    p_canonical_name: product.canonicalName,
    p_raw_error: rawError?.slice(0, 500) ?? null,
  });
  if (error) throw new Error(`Supabase failure finalization failed: ${error.message}`);
}

export async function processTescoProduct(message: TescoBatchMessage, product: TescoQueueProduct) {
  let requests = 0;
  let credits = 0;
  let fetched = 0;

  const directResult = await scrapingBeeFetch(product.storeUrl);
  requests += 1;
  credits += directResult.creditCost;

  if (directResult.ok) {
    fetched = 1;
    const parsed = parseProductPage(directResult.html);
    if (parsed?.price) {
      const directMatch = fuzzyMatch(product.canonicalName, [{ ...parsed, sku: product.storeSku, url: product.storeUrl }]);
      if (directMatch) {
        await finalizeSuccess(
          message,
          product,
          parsed.price,
          { url: product.storeUrl, sku: product.storeSku, name: parsed.name },
          fetched,
          1,
          requests,
          credits,
        );
        return;
      }
      console.warn(`[tesco-queue] direct_name_mismatch ${product.storeProductId}; using guarded search fallback`);
    }
  } else if (!isTransientFetchFailure(directResult.reason)) {
    await finalizePermanentFailure(message, product, directResult.reason, directResult.error, fetched, requests, credits);
    return;
  }

  const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(product.canonicalName)}`;
  const searchResult = await scrapingBeeFetch(searchUrl);
  requests += 1;
  credits += searchResult.creditCost;

  if (!searchResult.ok) {
    if (isTransientFetchFailure(searchResult.reason)) {
      throw new TransientTescoError(searchResult.error, product, searchResult.reason, requests, credits);
    }
    await finalizePermanentFailure(message, product, searchResult.reason, searchResult.error, fetched, requests, credits);
    return;
  }

  fetched = 1;
  const candidates = parseSearchResults(searchResult.html);
  if (candidates.length === 0) {
    await finalizePermanentFailure(message, product, 'no_search_results', null, fetched, requests, credits, 'parsing');
    return;
  }

  const match = fuzzyMatch(product.canonicalName, candidates);
  if (!match) {
    await finalizePermanentFailure(message, product, 'no_confident_match', null, fetched, requests, credits, 'parsing');
    return;
  }
  if (!match.product.price || match.product.price <= 0 || !match.product.url) {
    await finalizePermanentFailure(message, product, 'no_price_in_results', null, fetched, requests, credits, 'parsing');
    return;
  }

  await finalizeSuccess(
    message,
    product,
    match.product.price,
    {
      url: match.product.url,
      sku: match.product.sku,
      name: match.product.name,
    },
    fetched,
    1,
    requests,
    credits,
  );
}

export async function selectTescoProducts(limit: number, query?: string) {
  const { data: products, error } = await supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products(canonical_name)')
    .eq('store', 'tesco')
    .eq('url_status', 'resolved')
    .not('store_url', 'is', null);
  if (error) throw new Error(`Failed loading Tesco products: ${error.message}`);

  const usable = (products ?? []).filter((row: any) =>
    typeof row.store_url === 'string' && /\/products\/\d+/.test(row.store_url),
  );
  const q = query?.trim().toLowerCase();
  const filtered = q
    ? usable.filter((row: any) => String(row.products?.canonical_name || row.store_product_name).toLowerCase().includes(q))
    : usable;

  const ids = filtered.map((row: any) => row.id);
  const latest = new Map<string, { price: number; observedAt: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data: observations, error: obsError } = await supabaseAdmin
      .from('price_observations')
      .select('store_product_id, price, observed_at')
      .in('store_product_id', chunk)
      .order('observed_at', { ascending: false });
    if (obsError) throw new Error(`Failed loading Tesco observation history: ${obsError.message}`);
    for (const observation of observations ?? []) {
      if (!latest.has(observation.store_product_id)) {
        latest.set(observation.store_product_id, {
          price: Number(observation.price),
          observedAt: observation.observed_at || '1970-01-01',
        });
      }
    }
  }

  filtered.sort((a: any, b: any) =>
    (latest.get(a.id)?.observedAt || '1970-01-01').localeCompare(latest.get(b.id)?.observedAt || '1970-01-01'),
  );

  return filtered.slice(0, limit).map((row: any): TescoQueueProduct => ({
    storeProductId: row.id,
    canonicalName: row.products?.canonical_name || row.store_product_name,
    storeProductName: row.store_product_name,
    storeUrl: row.store_url,
    storeSku: row.store_sku,
    previousPrice: latest.get(row.id)?.price ?? null,
  }));
}

export async function createTescoScrapeRun(runId: string, targetCount: number) {
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .insert({
      run_id: runId,
      store: 'tesco',
      retrieval_method: 'vercel_queue_scrapingbee',
      started_at: new Date().toISOString(),
      status: 'running',
      target_count: targetCount,
      threshold_pct: 70,
      attempted_count: 0,
      fetched: 0,
      extracted: 0,
      inserted: 0,
      unchanged_count: 0,
      failed: 0,
      silently_skipped_count: 0,
      threshold_breached: false,
      scrapingbee_requests: 0,
      scrapingbee_credits: 0,
    })
    .select('id')
    .single();
  if (error || !data?.id) throw new Error(`Failed opening Tesco queue run: ${error?.message || 'missing id'}`);
  return data.id as string;
}
