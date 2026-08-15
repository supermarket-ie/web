import { supabaseAdmin } from '@/lib/supabase';
import {
  TransientTescoError,
  type TescoBatchMessage,
  type TescoQueueProduct,
} from '@/lib/tesco-queue-worker';

const BASE_URL = 'https://www.tesco.ie';
const DEFAULT_FETCH_RETRIES = 2;

type FetchFailureReason =
  | 'blocked_challenge'
  | 'rate_limited'
  | 'timeout'
  | 'http_transient'
  | 'http_permanent'
  | 'network_error';

type DirectFetchResult =
  | { ok: true; html: string }
  | { ok: false; reason: FetchFailureReason; error: string };

type Candidate = {
  sku: string | null;
  url: string | null;
  name: string;
  price: number | null;
};

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

function looksBlocked(html: string) {
  const lower = html.toLowerCase();
  return lower.includes('access denied') ||
    lower.includes('security checks') ||
    lower.includes('captcha') ||
    lower.includes('akamai') ||
    (lower.includes('not right') && lower.includes('security'));
}

async function directFetch(url: string): Promise<DirectFetchResult> {
  for (let attempt = 1; attempt <= DEFAULT_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-IE,en;q=0.9',
          'cache-control': 'no-cache',
          pragma: 'no-cache',
        },
      });
      const html = await response.text();

      if (response.status === 200 && !looksBlocked(html)) {
        return { ok: true, html };
      }
      if (looksBlocked(html)) {
        if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(2_000); continue; }
        return { ok: false, reason: 'blocked_challenge', error: 'Tesco challenge page returned to direct Vercel request' };
      }
      if (response.status === 429) {
        if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(4_000); continue; }
        return { ok: false, reason: 'rate_limited', error: 'Tesco returned HTTP 429' };
      }

      const transient = response.status === 408 || response.status === 425 || response.status >= 500;
      if (transient && attempt < DEFAULT_FETCH_RETRIES) { await sleep(2_000); continue; }
      return {
        ok: false,
        reason: transient ? 'http_transient' : 'http_permanent',
        error: `Tesco returned HTTP ${response.status}: ${html.slice(0, 120)}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      if (attempt < DEFAULT_FETCH_RETRIES) { await sleep(2_000); continue; }
      return { ok: false, reason: timedOut ? 'timeout' : 'network_error', error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, reason: 'network_error', error: 'Maximum direct Tesco attempts exceeded' };
}

function isTransient(reason: string) {
  return ['blocked_challenge', 'rate_limited', 'timeout', 'http_transient', 'network_error'].includes(reason);
}

async function finalizeSuccess(
  message: TescoBatchMessage,
  product: TescoQueueProduct,
  price: number,
  resolved: { url: string; sku: string | null; name: string },
  fetched: number,
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
    p_extracted: 1,
    p_scrapingbee_requests: 0,
    p_scrapingbee_credits: 0,
    p_failure_stage: null,
    p_failure_reason: null,
    p_canonical_name: product.canonicalName,
    p_raw_error: null,
  });
  if (error) throw new Error(`Supabase finalization failed: ${error.message}`);
}

async function finalizeFailure(
  message: TescoBatchMessage,
  product: TescoQueueProduct,
  reason: string,
  rawError: string | null,
  fetched: number,
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
    p_scrapingbee_requests: 0,
    p_scrapingbee_credits: 0,
    p_failure_stage: stage,
    p_failure_reason: reason,
    p_canonical_name: product.canonicalName,
    p_raw_error: rawError?.slice(0, 500) ?? null,
  });
  if (error) throw new Error(`Supabase failure finalization failed: ${error.message}`);
}

export async function processTescoProductDirect(message: TescoBatchMessage, product: TescoQueueProduct) {
  let fetched = 0;

  const productResult = await directFetch(product.storeUrl);
  if (productResult.ok) {
    fetched = 1;
    const parsed = parseProductPage(productResult.html);
    if (parsed?.price) {
      const match = fuzzyMatch(product.canonicalName, [{ ...parsed, sku: product.storeSku, url: product.storeUrl }]);
      if (match) {
        await finalizeSuccess(
          message,
          product,
          parsed.price,
          { url: product.storeUrl, sku: product.storeSku, name: parsed.name },
          fetched,
        );
        return;
      }
      console.warn(`[tesco-direct] direct_name_mismatch ${product.storeProductId}; using guarded search fallback`);
    }
  }

  const searchUrl = `${BASE_URL}/groceries/en-IE/search?query=${encodeURIComponent(product.canonicalName)}`;
  const searchResult = await directFetch(searchUrl);
  if (!searchResult.ok) {
    if (isTransient(searchResult.reason)) {
      throw new TransientTescoError(searchResult.error, product, searchResult.reason, 0, 0);
    }
    await finalizeFailure(message, product, searchResult.reason, searchResult.error, fetched);
    return;
  }

  fetched = 1;
  const candidates = parseSearchResults(searchResult.html);
  if (candidates.length === 0) {
    await finalizeFailure(message, product, 'no_search_results', null, fetched, 'parsing');
    return;
  }

  const match = fuzzyMatch(product.canonicalName, candidates);
  if (!match) {
    await finalizeFailure(message, product, 'no_confident_match', null, fetched, 'parsing');
    return;
  }
  if (!match.product.price || match.product.price <= 0 || !match.product.url) {
    await finalizeFailure(message, product, 'no_price_in_results', null, fetched, 'parsing');
    return;
  }

  await finalizeSuccess(
    message,
    product,
    match.product.price,
    { url: match.product.url, sku: match.product.sku, name: match.product.name },
    fetched,
  );
}
