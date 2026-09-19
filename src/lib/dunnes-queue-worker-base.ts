import { supabaseAdmin } from '@/lib/supabase';
import { dunnesPackSignature, hasDunnesVariantConflict } from '@/lib/dunnes-discovery';

const STORE = 'dunnes';
const STORE_ID = 258;
const GATEWAY_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

export type DunnesQueueProduct = {
  storeProductId: string;
  canonicalName: string;
  storeProductName: string;
  storeUrl: string | null;
  storeSku: string | null;
  previousPrice: number | null;
};

export type DunnesBatchMessage = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  products: DunnesQueueProduct[];
};

type DunnesApiItem = {
  sku?: string | number | null;
  name?: string | null;
  priceNumeric?: number | null;
  available?: boolean | null;
  wasPriceNumeric?: number | null;
  wasWholePrice?: number | null;
  tprPrice?: Array<{ active?: boolean; label?: string | null }> | null;
};

type DunnesApiResponse = { items?: DunnesApiItem[] };

type Candidate = {
  sku: string | null;
  name: string;
  price: number | null;
  wasPrice: number | null;
  onPromotion: boolean;
  url: string | null;
};

export class TransientDunnesError extends Error {
  constructor(
    message: string,
    public readonly product: DunnesQueueProduct,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'TransientDunnesError';
  }
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

function isSizeCompatible(canonical: string, candidate: string) {
  const a = extractSize(canonical);
  const b = extractSize(candidate);
  if (!a || !b) return true;
  if (a.unit === b.unit && a.isMultipack === b.isMultipack) {
    return Math.max(a.qty, b.qty) / Math.min(a.qty, b.qty) <= 1.1;
  }

  // Retailer titles often state a total weight instead of repeating "N pack".
  // Accept that representation only when the richer pack parser finds the
  // same explicit item count on both sides. This covers "4 Pack" versus
  // "4 x 90g" while single-versus-multipack size changes (for example 18g
  // versus 4x18g) remain rejected because the single item has no pack count.
  const expectedPack = dunnesPackSignature(canonical);
  const candidatePack = dunnesPackSignature(candidate);
  return Boolean(
    expectedPack.count
    && candidatePack.count
    && expectedPack.count === candidatePack.count
  );
}

const NON_FOOD_WORDS = [
  'utensil', 'skillet', 'pot', 'duvet', 'pillow', 'towel', 'mug', 'plate',
  'bowl', 'glass', 'cutlery', 'knife', 'fork', 'spoon', 'tray', 'storage', 'candle',
];

function hasObviousTypeConflict(canonical: string, candidate: string) {
  const cn = normaliseName(canonical);
  const ca = normaliseName(candidate);
  const canonicalLooksFood = !NON_FOOD_WORDS.some((word) => cn.includes(word));
  const candidateLooksNonFood = NON_FOOD_WORDS.some((word) => ca.includes(word));
  return canonicalLooksFood && candidateLooksNonFood;
}

const GENERIC_WORDS = new Set([
  'standard', 'fresh', 'irish', 'large', 'small', 'medium', 'premium', 'original',
  'pack', 'value', 'family', 'style', 'selected', 'selection', 'the', 'and', 'with',
  'dunnes', 'store',
]);

function normaliseWord(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ches|shes|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function significantWords(value: string) {
  return normaliseName(value)
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|ea)?\b/gi, ' ')
    .split(/\s+/)
    .map(normaliseWord)
    .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word));
}

const DISCOVERY_FILLER_WORDS = new Set([
  'bottle', 'liquid', 'month', 'professional', 'protection', 'reseal',
  'sachet', 'strained', 'tub',
]);

function compactDunnesDiscoveryQuery(value: string) {
  return significantWords(value)
    .filter((word) => !DISCOVERY_FILLER_WORDS.has(word))
    .slice(0, 5)
    .join(' ');
}

function retailerNameCompatible(expected: string, candidate: string) {
  const expectedWords = significantWords(expected);
  const candidateWords = significantWords(candidate);
  if (!expectedWords.length || !candidateWords.length) return false;
  const expectedNorm = normaliseName(expected);
  const candidateNorm = normaliseName(candidate);
  if (expectedNorm === candidateNorm) return true;
  const expectedCoverage = expectedWords.filter((word) => candidateWords.includes(word)).length / expectedWords.length;
  const candidateCoverage = candidateWords.filter((word) => expectedWords.includes(word)).length / candidateWords.length;
  return expectedCoverage >= 0.6 && candidateCoverage >= 0.5;
}

function hasCanonicalSignal(canonical: string, candidate: string) {
  const words = significantWords(canonical);
  if (!words.length) return true;
  const candidateWords = significantWords(candidate);
  return words.some((word) => candidateWords.includes(word));
}

function hasCompleteCanonicalSignal(canonical: string, candidate: string) {
  const words = significantWords(canonical);
  if (!words.length) return false;
  const candidateWords = significantWords(candidate);
  return words.every((word) => candidateWords.includes(word));
}

export function extractDunnesUrlSku(storeUrl: string | null) {
  if (!storeUrl) return null;
  const match = storeUrl.match(/\/([^/?#]+)(?:[?#]|$)/);
  return match?.[1] && /^\d+$/.test(match[1]) ? match[1] : null;
}

export function extractDunnesUrlName(storeUrl: string | null) {
  if (!storeUrl) return null;
  const match = storeUrl.match(/\/product\/details\/([^/?#]+)\/\d+(?:[?#]|$)/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
  } catch {
    return match[1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
  }
}

export function buildDunnesSearchQueries(product: DunnesQueueProduct) {
  const seen = new Set<string>();
  return [
    product.storeProductName,
    extractDunnesUrlName(product.storeUrl),
    product.canonicalName,
    compactDunnesDiscoveryQuery(product.canonicalName),
  ]
    .map((query) => query?.trim())
    .filter((query): query is string => {
      if (!query) return false;
      const key = normaliseName(query);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function directResolvedCandidate(product: DunnesQueueProduct, candidates: Candidate[]) {
  const identitySafe = candidates.filter((candidate) =>
    Boolean(candidate.name && candidate.price && candidate.price > 0)
    && isSizeCompatible(product.canonicalName, candidate.name)
    && !hasObviousTypeConflict(product.canonicalName, candidate.name)
    && !hasDunnesVariantConflict(product.canonicalName, candidate.name)
    && hasCanonicalSignal(product.canonicalName, candidate.name)
  );

  const knownSkus = new Set([product.storeSku, extractDunnesUrlSku(product.storeUrl)].filter(Boolean).map(String));
  if (knownSkus.size) {
    const exactSku = identitySafe.find((candidate) =>
      candidate.sku
      && knownSkus.has(candidate.sku)
      && hasCompleteCanonicalSignal(product.canonicalName, candidate.name)
    );
    if (exactSku) return exactSku;
  }

  const usable = identitySafe.filter((candidate) => retailerNameCompatible(product.storeProductName, candidate.name));
  return usable.length === 1 ? usable[0] : null;
}

function matchCandidate(canonical: string, candidates: Candidate[]) {
  const normCanonical = normaliseName(canonical);
  const canonicalWords = significantWords(canonical);
  let best: { candidate: Candidate; score: number } | null = null;

  for (const candidate of candidates) {
    if (!candidate.name || !candidate.price || candidate.price <= 0) continue;
    if (!isSizeCompatible(canonical, candidate.name)) continue;
    if (hasObviousTypeConflict(canonical, candidate.name)) continue;
    if (hasDunnesVariantConflict(canonical, candidate.name)) continue;

    const normCandidate = normaliseName(candidate.name);
    if (normCandidate === normCanonical) return { candidate, score: 1 };

    const candidateWords = significantWords(candidate.name);
    const canonicalCoverage = canonicalWords.length
      ? canonicalWords.filter((word) => candidateWords.includes(word)).length / canonicalWords.length
      : 0;
    const candidateCoverage = candidateWords.length
      ? candidateWords.filter((word) => canonicalWords.includes(word)).length / candidateWords.length
      : 0;
    const score = canonicalCoverage * 0.7 + candidateCoverage * 0.3;

    if (
      score >= 0.55 &&
      canonicalCoverage >= 0.6 &&
      candidateCoverage >= 0.5 &&
      (!best || score > best.score)
    ) {
      best = { candidate, score };
    }
  }

  return best;
}

function generateCorrelationId() {
  return crypto.randomUUID();
}

function makeProductUrl(item: DunnesApiItem) {
  if (!item.sku || !item.name) return null;
  const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent(slug)}/${item.sku}`;
}

async function fetchCandidates(queryName: string, product: DunnesQueueProduct): Promise<Candidate[]> {
  const trimmedQuery = queryName.split(/\s+/).slice(0, 8).join(' ').slice(0, 90);
  const url = `${GATEWAY_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(trimmedQuery)}&take=8&page=1&skip=0`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'x-site-host': SITE_URL,
        'x-site-location': 'HeadersBuilderInterceptor',
        'x-correlation-id': generateCorrelationId(),
        'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
      },
    });

    if (response.status === 429 || response.status >= 500) {
      throw new TransientDunnesError(`Dunnes API returned HTTP ${response.status}`, product, `http_${response.status}`);
    }
    if (!response.ok) return [];

    const body = await response.json() as DunnesApiResponse;
    return (body.items ?? []).map((item) => {
      const activeTpr = (item.tprPrice ?? []).find((entry) => entry.active === true);
      const price = typeof item.priceNumeric === 'number' ? item.priceNumeric : null;
      const rawWas = item.wasPriceNumeric ?? item.wasWholePrice ?? null;
      const wasPrice = typeof rawWas === 'number' && price && rawWas > price ? rawWas : null;
      return {
        sku: item.sku == null ? null : String(item.sku),
        name: item.name ?? '',
        price,
        wasPrice,
        onPromotion: Boolean(activeTpr || wasPrice),
        url: makeProductUrl(item),
      };
    });
  } catch (error) {
    if (error instanceof TransientDunnesError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error';
    throw new TransientDunnesError(message, product, reason);
  } finally {
    clearTimeout(timeout);
  }
}

export async function selectDunnesProducts(limit: number, query?: string): Promise<DunnesQueueProduct[]> {
  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', STORE)
    .eq('url_status', 'resolved')
    .limit(limit);

  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);

  const { data, error } = await builder;
  if (error) throw new Error(`Failed selecting Dunnes products: ${error.message}`);
  if (!data || data.length === 0) return [];

  const ids = data.map((row) => row.id);
  const { data: observations, error: obsError } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, price, observed_at')
    .in('store_product_id', ids)
    .order('observed_at', { ascending: false });
  if (obsError) throw new Error(`Failed loading Dunnes previous prices: ${obsError.message}`);

  const latest = new Map<string, number>();
  for (const observation of observations ?? []) {
    if (!latest.has(observation.store_product_id)) latest.set(observation.store_product_id, observation.price);
  }

  return data.map((row) => {
    const product = row.products as unknown as { canonical_name: string };
    return {
      storeProductId: row.id,
      canonicalName: product.canonical_name,
      storeProductName: row.store_product_name,
      storeUrl: row.store_url,
      storeSku: row.store_sku,
      previousPrice: latest.get(row.id) ?? null,
    };
  });
}

export async function createDunnesScrapeRun(runId: string, targetCount: number, runScope: string) {
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .insert({
      run_id: runId,
      store: STORE,
      started_at: new Date().toISOString(),
      target_count: targetCount,
      retrieval_method: 'vercel_queue_dunnes_api_resolved_first',
      run_scope: runScope,
      threshold_pct: 75,
      status: 'running',
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed creating Dunnes scrape run: ${error.message}`);
  return data.id as string;
}

async function finalize(
  message: DunnesBatchMessage,
  product: DunnesQueueProduct,
  params: {
    success: boolean;
    candidate?: Candidate;
    fetched: number;
    extracted: number;
    failureStage?: string;
    failureReason?: string;
    rawError?: string | null;
    retryable?: boolean;
  },
) {
  const candidate = params.candidate;
  const verifiedPriceDrop = Boolean(
    candidate?.price
    && product.previousPrice
    && product.previousPrice - candidate.price >= 0.05
    && candidate.price / product.previousPrice >= 0.4,
  );
  const wasPrice = candidate?.wasPrice ?? (verifiedPriceDrop ? product.previousPrice : null);
  const onPromotion = Boolean(candidate?.onPromotion || verifiedPriceDrop);
  const { error } = await supabaseAdmin.rpc('finalize_store_scrape_product', {
    p_run_uuid: message.runUuid,
    p_store: STORE,
    p_store_product_id: product.storeProductId,
    p_success: params.success,
    p_price: candidate?.price ?? null,
    p_previous_price: product.previousPrice,
    p_was_price: wasPrice,
    p_on_promotion: onPromotion,
    p_store_url: candidate?.url ?? product.storeUrl,
    p_store_sku: candidate?.sku ?? product.storeSku,
    p_store_product_name: candidate?.name ?? product.storeProductName,
    p_fetched: params.fetched,
    p_extracted: params.extracted,
    p_failure_stage: params.failureStage ?? null,
    p_failure_reason: params.failureReason ?? null,
    p_canonical_name: product.canonicalName,
    p_raw_error: params.rawError?.slice(0, 500) ?? null,
    p_is_retryable: params.retryable ?? false,
  });
  if (error) throw new Error(`Failed finalizing Dunnes product: ${error.message}`);
}

export async function finalizeDunnesPermanentFailure(
  message: DunnesBatchMessage,
  product: DunnesQueueProduct,
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
    retryable: false,
  });
}

export async function processDunnesProduct(message: DunnesBatchMessage, product: DunnesQueueProduct) {
  // Try the stored retailer title, the product title encoded in the resolved
  // URL, and the canonical title. URL-derived titles recover catalogue renames
  // without trusting the URL identity by itself: every candidate still passes
  // SKU, name, size and product-type safeguards.
  const queries = buildDunnesSearchQueries(product);
  const candidates: Candidate[] = [];
  const candidateKeys = new Set<string>();
  let fetched = 0;

  for (const query of queries) {
    const queryCandidates = await fetchCandidates(query, product);
    fetched += 1;

    const direct = directResolvedCandidate(product, queryCandidates);
    if (direct) {
      await finalize(message, product, {
        success: true,
        candidate: direct,
        fetched,
        extracted: 1,
      });
      return;
    }

    for (const candidate of queryCandidates) {
      const key = candidate.sku ?? `${normaliseName(candidate.name)}:${candidate.price ?? 'none'}`;
      if (!candidateKeys.has(key)) {
        candidateKeys.add(key);
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    await finalize(message, product, {
      success: false,
      fetched,
      extracted: 0,
      failureStage: 'parsing',
      failureReason: 'no_search_results',
      rawError: `queries=${queries.join(' | ')}`,
    });
    return;
  }

  const match = matchCandidate(product.canonicalName, candidates);
  if (!match) {
    const sample = candidates
      .slice(0, 5)
      .map((candidate) => `${candidate.sku ?? 'no-sku'}:${candidate.name}:€${candidate.price ?? 'none'}`)
      .join(' | ');
    await finalize(message, product, {
      success: false,
      fetched,
      extracted: 0,
      failureStage: 'matching',
      failureReason: 'no_confident_match',
      rawError: `stored=${product.storeProductName}; sku=${product.storeSku ?? 'none'}; canonical=${product.canonicalName}; candidates=${sample}`,
    });
    return;
  }

  await finalize(message, product, {
    success: true,
    candidate: match.candidate,
    fetched,
    extracted: 1,
  });
}
