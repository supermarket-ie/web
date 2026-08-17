#!/usr/bin/env node
/**
 * Tesco Ireland Scraper (ScrapingBee edition)
 * Uses ScrapingBee API with premium proxies to bypass Akamai WAF.
 * No local browser needed — all rendering done server-side.
 *
 * Usage:
 *   node scripts/tesco_scraper.js --refresh --limit 200
 *   node scripts/tesco_scraper.js --resolve --limit 50
 *   node scripts/tesco_scraper.js --search "Frozen Peas"
 *
 * Requires:
 *   - .env.local with SUPABASE_SERVICE_ROLE_KEY and SCRAPINGBEE_API_KEY
 *
 * Credit cost: 25 credits per request (render_js + premium_proxy)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const scrapeDb = require('./scrape-db');

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (err) => {
  console.error(`  ⚠ Unhandled rejection: ${err.message || err}`);
});

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;
const BASE_URL = 'https://www.tesco.ie';

// Lockfile — prevent concurrent Tesco scrape runs
const LOCKFILE = path.join(os.tmpdir(), 'tesco_scraper.lock');

function acquireLock() {
  if (fs.existsSync(LOCKFILE)) {
    const age = Date.now() - fs.statSync(LOCKFILE).mtimeMs;
    if (age < 4 * 60 * 60 * 1000) {
      console.error(`[lock] Another Tesco scrape is running (lock age: ${Math.round(age/60000)}min). Exiting.`);
      process.exit(0);
    }
    console.log('[lock] Stale lockfile found — removing.');
  }
  fs.writeFileSync(LOCKFILE, String(process.pid));
}

function releaseLock() {
  try { fs.unlinkSync(LOCKFILE); } catch {}
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// ScrapingBee fetch — handles Tesco with JS rendering + premium proxy
// ============================================================

async function scrapingBeeFetch(url, opts = {}) {
  const { wait = 7000, retries = 2 } = opts;

  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY,
    url: url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'ie',
    wait: String(wait),
  });

  // Accumulate credits across all attempts (including retries) — each attempt
  // consumes credits whether it succeeds or not.
  let totalCreditCost = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const res = await fetch('https://app.scrapingbee.com/api/v1?' + params.toString(), {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Credit cost is per-request; accumulate across retries
      const attemptCost = parseInt(res.headers.get('Spb-Cost') || '25', 10);
      totalCreditCost += isNaN(attemptCost) ? 25 : attemptCost;

      if (res.status === 200) {
        const html = await res.text();
        const blocked = html.includes('Access Denied') || html.includes('security checks') ||
          (html.includes('not right') && html.includes('security'));
        if (blocked) {
          if (attempt < retries) {
            console.log(`    ⚠ Akamai block detected (attempt ${attempt}/${retries}), retrying...`);
            await sleep(5000);
            continue;
          }
          return { ok: false, error: 'blocked_challenge', creditCost: totalCreditCost };
        }
        return { ok: true, html, creditCost: totalCreditCost };
      } else if (res.status === 429) {
        console.log(`    ⚠ ScrapingBee rate limit (attempt ${attempt}/${retries}), waiting 10s...`);
        await sleep(10000);
        continue;
      } else {
        const body = await res.text().catch(() => '');
        if (attempt < retries) {
          await sleep(3000);
          continue;
        }
        return { ok: false, error: `HTTP ${res.status}: ${body.substring(0, 100)}`, creditCost: totalCreditCost };
      }
    } catch (e) {
      if (attempt < retries) {
        await sleep(3000);
        continue;
      }
      return { ok: false, error: e.message, creditCost: totalCreditCost };
    }
  }
  return { ok: false, error: 'Max retries exceeded', creditCost: totalCreditCost };
}

// ============================================================
// Search — parse product results from Tesco search HTML
// ============================================================

function parseSearchResults(html) {
  const products = [];
  const seen = new Set();

  // Step 1: Find all product tile headings with positions
  const tileRegex = /<h2[^>]*product-heading[^>]*>.*?<a[^>]*href="[^"]*\/products\/(\d+)"[^>]*>([^<]+)<\/a><\/h2>/g;
  const tiles = [];
  let match;
  while ((match = tileRegex.exec(html)) !== null) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    tiles.push({ sku: match[1], name: match[2].trim(), pos: match.index });
  }

  // Step 2: Find all price positions (priceText class elements)
  const priceRegex = /priceText[^>]*>€(\d+\.\d{2})<\/p>/g;
  const prices = [];
  while ((match = priceRegex.exec(html)) !== null) {
    prices.push({ price: parseFloat(match[1]), pos: match.index });
  }

  // Step 3: For each tile, find the first price AFTER it but BEFORE the next tile
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    const nextTilePos = i + 1 < tiles.length ? tiles[i + 1].pos : Infinity;
    const tilePrice = prices.find(p => p.pos > tile.pos && p.pos < nextTilePos);

    // Detect promotions in the region between this tile and next
    const tileHtml = html.substring(tile.pos, Math.min(html.length, nextTilePos));
    let onPromotion = false;
    let wasPrice = null;
    let promoLabel = null;

    if (/Clubcard Price/i.test(tileHtml)) {
      onPromotion = true;
      promoLabel = 'Clubcard Price';
    }
    const wasMatch = tileHtml.match(/was\s*€(\d+\.\d{2})/i);
    if (wasMatch) {
      wasPrice = parseFloat(wasMatch[1]);
      onPromotion = true;
      if (!promoLabel) promoLabel = 'Was Price';
    }

    products.push({
      sku: tile.sku,
      url: `${BASE_URL}/shop/en-IE/products/${tile.sku}`,
      name: tile.name,
      price: tilePrice ? tilePrice.price : null,
      onPromotion,
      wasPrice,
      promoLabel,
    });
  }

  return products;
}

// ============================================================
// Text normalisation helpers
// ============================================================

/**
 * Normalise a product name for matching:
 *  - Unicode accent decomposition (é → e, ü → u)
 *  - Lowercase
 *  - Punctuation collapsed to space
 *  - Multiple spaces collapsed
 */
function normaliseName(s) {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')       // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a weight/volume/pack size from a name, e.g.:
 *   "Butter Salted 250g"  → { qty: 250, unit: 'g' }
 *   "Free Range Eggs 12"  → { qty: 12,  unit: 'ea' }
 *   "Milk 2L"             → { qty: 2,   unit: 'l' }
 * Returns null if no size token found.
 */
/**
 * Extract the primary weight/volume/count token from a product name.
 *
 * Returns { qty: number, unit: string, isMultipack: boolean } or null.
 *
 * isMultipack is true when the size token is a count multiplied by a weight
 * (e.g. "4x105g", "6 Pack") — used to reject single-unit vs multipack mismatches.
 *
 * Unit normalisation:
 *   kg  → g  (×1000)
 *   l   → ml (×1000)
 *   cl  → ml (×10)
 *   pack / pk / x with no following unit → count of units (unit='ea')
 */
function extractSize(name) {
  const n = normaliseName(name);

  // Multipack pattern: "4x105g", "4 x 105g", "6 pack" (no unit = count)
  const multiMatch = n.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)?/i);
  if (multiMatch) {
    const count = parseFloat(multiMatch[1]);
    const each  = parseFloat(multiMatch[2]);
    let unit = (multiMatch[3] || 'ea').toLowerCase();
    let qty  = count * each;
    if (unit === 'kg') { qty *= 1000; unit = 'g'; }
    if (unit === 'l')  { qty *= 1000; unit = 'ml'; }
    if (unit === 'cl') { qty *= 10;   unit = 'ml'; }
    return { qty, unit, isMultipack: true };
  }

  // "N pack" / "N pk" with no weight — treat as a count
  const packMatch = n.match(/(\d+)\s*(?:pack|pk)\b/i);
  if (packMatch) {
    return { qty: parseFloat(packMatch[1]), unit: 'ea', isMultipack: true };
  }

  // Single weight/volume: "250g", "2l", "500ml"
  const singleMatch = n.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (singleMatch) {
    const qty0 = parseFloat(singleMatch[1]);
    let unit = singleMatch[2].toLowerCase();
    if (unit === 'kg') return { qty: qty0 * 1000, unit: 'g',  isMultipack: false };
    if (unit === 'l')  return { qty: qty0 * 1000, unit: 'ml', isMultipack: false };
    if (unit === 'cl') return { qty: qty0 * 10,   unit: 'ml', isMultipack: false };
    return { qty: qty0, unit, isMultipack: false };
  }

  return null;
}

/**
 * Product-type conflict detection.
 * Returns true if canonical and candidate are clearly incompatible product types.
 *
 * Covered cases:
 *   dairy butter vs nut butter / spread / margarine (and reverse)
 */
const SPREAD_WORDS = ['peanut', 'almond', 'cashew', 'hazelnut', 'sunflower', 'spread', 'margarine'];
const DAIRY_BUTTER_WORDS = ['butter'];

function hasProductTypeConflict(canonical, candidateName) {
  const cn = normaliseName(canonical);
  const ca = normaliseName(candidateName);

  const isDairyButter = DAIRY_BUTTER_WORDS.some(w => cn.includes(w)) &&
                        !SPREAD_WORDS.some(w => cn.includes(w));
  const isSpread      = SPREAD_WORDS.some(w => ca.includes(w));
  if (isDairyButter && isSpread) return true;

  const isDairyButterCandidate = DAIRY_BUTTER_WORDS.some(w => ca.includes(w)) &&
                                 !SPREAD_WORDS.some(w => ca.includes(w));
  const isSpreadCanonical      = SPREAD_WORDS.some(w => cn.includes(w));
  if (isSpreadCanonical && isDairyButterCandidate) return true;

  return false;
}

/**
 * Check pack-size compatibility between canonical name and candidate name.
 *
 * Rules (applied in order):
 *  1. If either name has no size token → cannot compare, allow.
 *  2. If units differ after normalisation (g vs ml, ea vs g) → incompatible, reject.
 *  3. Multipack mismatch: one isMultipack and the other is not → reject.
 *     (Prevents "Philadelphia Mini Tubs 4 Pack" matching a single 165g tub.)
 *  4. Size tolerance: ±10% (ratio ≤ 1.10).
 *     454g vs 500g → 500/454 = 1.10 → accept (exactly at boundary).
 *     400g vs 500g → 500/400 = 1.25 → reject.
 *     250g vs 500g → 500/250 = 2.00 → reject.
 *     227g vs 500g → 500/227 = 2.20 → reject.
 *
 * Returns { ok: boolean, reason: string|null }
 * (reason is used in test output; callers that only need the boolean use .ok)
 */
function isSizeCompatible(canonical, candidateName) {
  const cs = extractSize(canonical);
  const ca = extractSize(candidateName);

  if (!cs || !ca) return { ok: true,  reason: null };           // can't compare — allow
  if (cs.unit !== ca.unit) return { ok: false, reason: `unit_mismatch(${cs.unit}≠${ca.unit})` };
  if (cs.isMultipack !== ca.isMultipack) {
    return { ok: false, reason: `multipack_mismatch(${cs.isMultipack}≠${ca.isMultipack})` };
  }

  const ratio = Math.max(cs.qty, ca.qty) / Math.min(cs.qty, ca.qty);
  if (ratio > 1.10) return { ok: false, reason: `size_ratio_${ratio.toFixed(2)}` };
  return { ok: true, reason: null };
}

// ============================================================
// Fuzzy matching — stricter, with conflict detection
// ============================================================

/**
 * Match a canonical product name against a list of Tesco search result candidates.
 *
 * Improvements over previous version:
 *  1. Accent / punctuation normalisation before comparison
 *  2. Product-type conflict rejection (butter vs peanut butter/spread)
 *  3. Pack-size compatibility check when both names have a size token
 *  4. Returns match score AND rejection reason for logging
 */
function fuzzyMatch(searchName, candidates) {
  const normSearch = normaliseName(searchName);
  if (!normSearch) return null;

  let bestMatch = null;
  let bestScore = 0;
  let bestRejection = null;  // for debug logging of close-but-rejected candidates

  for (const c of candidates) {
    const normC = normaliseName(c.name || '');
    if (!normC) continue;

    // Hard reject: product type conflict
    if (hasProductTypeConflict(searchName, c.name)) {
      if (!bestRejection) bestRejection = { reason: 'type_conflict', name: c.name };
      continue;
    }

    // Hard reject: incompatible pack size (±10% tolerance)
    const sizeCheck = isSizeCompatible(searchName, c.name);
    if (!sizeCheck.ok) {
      if (!bestRejection) bestRejection = { reason: sizeCheck.reason, name: c.name };
      continue;
    }

    // Exact normalised match
    if (normSearch === normC) {
      if (1.0 > bestScore) { bestScore = 1.0; bestMatch = c; }
      continue;
    }

    // Size tokens (digits + optional unit) are matched separately by isSizeCompatible.
    // Strip them from both sides before computing keyword coverage so "500g" doesn't
    // dominate the score for short names like "Butter Salted 500g".
    const SIZE_RE = /\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|ea)?\b/gi;
    const normSearchKw = normSearch.replace(SIZE_RE, '').replace(/\s+/g, ' ').trim();
    const normCKw      = normC.replace(SIZE_RE, '').replace(/\s+/g, ' ').trim();

    const searchWords = normSearchKw.split(/\s+/).filter(w => w.length > 2);
    const cWords      = normCKw.split(/\s+/).filter(w => w.length > 2);

    // searchCoverage: how many canonical keywords appear in the candidate (brand/detail words)
    let searchInC = 0;
    for (const w of searchWords) { if (normCKw.includes(w)) searchInC++; }

    // candidateCoverage: how many candidate keywords appear in the canonical name.
    // This catches "Butter Me Up" — "me" and "up" don't appear in "butter salted"
    // so candidateCoverage drops and the score falls below threshold.
    let cInSearch = 0;
    for (const w of cWords) { if (normSearchKw.includes(w)) cInSearch++; }

    const searchCoverage    = searchWords.length > 0 ? searchInC / searchWords.length : 0;
    const candidateCoverage = cWords.length > 0     ? cInSearch / cWords.length       : 0;
    const score = searchCoverage * 0.7 + candidateCoverage * 0.3;

    // Minimum thresholds (all three must pass):
    //   searchCoverage > 0.50: more than half of canonical keywords present in candidate
    //   candidateCoverage > 0.50: more than half of candidate keywords present in canonical
    //   combined score >= 0.45
    // Both thresholds are STRICT (> not >=) to eliminate edge cases where a candidate
    // matches exactly half its words (e.g. "Tesco Butter Me Up 500g" has 2 post-strip words:
    // "tesco" and "butter"; only "butter" appears in canonical → 1/2 = 0.50, rejected).
    if (score >= 0.45 && searchCoverage > 0.50 && candidateCoverage > 0.50 && score > bestScore) {
      bestScore = score;
      bestMatch = c;
    }
  }

  return bestMatch ? { product: bestMatch, score: bestScore } : null;
}

// ============================================================
// Direct product page parser
// ============================================================

/**
 * Parse a Tesco direct product page (e.g. /shop/en-IE/products/123456).
 * Returns { name, price, onPromotion, wasPrice, promoLabel } or null if parse fails.
 *
 * We look for:
 *  - h1 with data-auto="product-title" or class containing "product-info-title"
 *  - priceText class for current price
 *  - "was €X.XX" for was-price / promo detection
 */
function parseProductPage(html) {
  if (!html) return null;

  // Product name from h1 (two common patterns in Tesco product pages)
  let name = null;
  const h1Match = html.match(/<h1[^>]*>\s*([^<]{3,120})\s*<\/h1>/i);
  if (h1Match) name = h1Match[1].trim();

  // Price — priceText class
  const priceMatch = html.match(/priceText[^>]*>€?(\d+\.\d{2})<\/p>/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : null;

  if (!price || price <= 0) return null;  // no price = can't use this page

  // Was-price / promo
  let wasPrice = null, onPromotion = false, promoLabel = null;
  if (/Clubcard Price/i.test(html)) { onPromotion = true; promoLabel = 'Clubcard Price'; }
  const wasMatch = html.match(/was\s*€(\d+\.\d{2})/i);
  if (wasMatch) { wasPrice = parseFloat(wasMatch[1]); onPromotion = true; promoLabel = promoLabel || 'Was Price'; }

  return { name, price, onPromotion, wasPrice, promoLabel };
}

// ============================================================
// DB modes — resolve + refresh
// ============================================================

async function resolveMode({ limit, category }) {
  if (!SUPABASE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
  if (!SCRAPINGBEE_KEY) { console.error('ERROR: SCRAPINGBEE_API_KEY not set'); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('=== TESCO RESOLVE MODE (ScrapingBee) ===\n');

  // Fetch all Tesco store products
  let allTesco = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('store_products')
      .select('id, product_id, store_product_name, store_url, url_status')
      .eq('store', 'tesco')
      .range(from, from + pageSize - 1);
    if (pageErr) { console.error('DB error:', pageErr); return; }
    allTesco = allTesco.concat(page || []);
    if (!page || page.length < pageSize) break;
    from += pageSize;
  }

  // Filter: pending/failed or resolved-but-stale URLs
  let toResolve = allTesco.filter(sp =>
    sp.url_status === 'pending' ||
    sp.url_status === 'failed' ||
    (sp.url_status === 'resolved' && sp.store_url &&
      (sp.store_url.includes('/search?') || sp.store_url.includes('/groceries/')))
  );

  if (category) {
    const { data: catProducts } = await supabase.from('products').select('id').eq('category', category);
    const catIds = new Set((catProducts || []).map(p => p.id));
    toResolve = toResolve.filter(sp => catIds.has(sp.product_id));
  }

  if (limit > 0) toResolve = toResolve.slice(0, limit);

  console.log(`Products to resolve: ${toResolve.length}`);
  if (toResolve.length === 0) { console.log('Nothing to resolve!'); return; }

  let resolved = 0, priced = 0, errors = 0;
  let totalCredits = 0;

  for (let i = 0; i < toResolve.length; i++) {
    const sp = toResolve[i];
    const name = sp.store_product_name;

    const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
    const result = await scrapingBeeFetch(searchUrl);
    totalCredits += parseInt(result.creditCost) || 0;

    if (!result.ok) {
      console.log(`  ✗ ${name.substring(0, 50)} → ${result.error}`);
      await supabase.from('store_products').update({ url_status: 'failed' }).eq('id', sp.id);
      errors++;
      continue;
    }

    const products = parseSearchResults(result.html);
    if (products.length === 0) {
      console.log(`  ✗ ${name.substring(0, 50)} → No products found`);
      await supabase.from('store_products').update({ url_status: 'failed' }).eq('id', sp.id);
      errors++;
      continue;
    }

    const match = fuzzyMatch(name, products);
    if (!match) {
      console.log(`  ✗ ${name.substring(0, 50)} → No confident match (best < 0.6)`);
      await supabase.from('store_products').update({ url_status: 'failed' }).eq('id', sp.id);
      errors++;
      continue;
    }

    const picked = match.product;

    // Update store_product
    await supabase.from('store_products').update({
      store_url: picked.url,
      store_sku: picked.sku,
      store_product_name: picked.name || name,
      url_status: 'resolved',
    }).eq('id', sp.id);
    resolved++;

    // Insert price if available
    if (picked.price && picked.price > 0) {
      await supabase.from('price_observations').insert({
        store_product_id: sp.id,
        price: picked.price,
        was_price: null,
        on_promotion: false,
        observed_at: new Date().toISOString(),
      });
      priced++;
      console.log(`  ✓ ${name.substring(0, 45)} → €${picked.price.toFixed(2)} (score ${match.score.toFixed(2)})`);
    } else {
      console.log(`  ⚠ ${name.substring(0, 45)} → resolved but no price`);
    }

    // Delay between requests — 2-4s (be respectful of ScrapingBee rate limits)
    await sleep(2000 + Math.floor(Math.random() * 2000));
  }

  console.log(`\n=== Results: ${resolved} resolved, ${priced} priced, ${errors} errors ===`);
  console.log(`  Credits used: ~${totalCredits}`);
}

async function refreshMode({ limit, category, offset = 0 }) {
  if (!SUPABASE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
  if (!SCRAPINGBEE_KEY) { console.error('ERROR: SCRAPINGBEE_API_KEY not set'); process.exit(1); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // RUN_ID: text external key (YYYYMMDD_HHMM), set by scrape_all.sh via SCRAPE_RUN_ID env var
  const RUN_ID = process.env.SCRAPE_RUN_ID || new Date().toISOString().replace(/[-:T]/g, '').substring(0, 12);

  console.log('=== TESCO REFRESH MODE (ScrapingBee) ===\n');

  const { data: storeProducts, error: spErr } = await supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, store_sku, products(canonical_name, category)')
    .eq('store', 'tesco')
    .eq('url_status', 'resolved');

  if (spErr) { console.error('DB error:', spErr); return; }

  // Skip products with search/old URLs
  let filtered = storeProducts.filter(sp =>
    sp.store_url && !sp.store_url.includes('/search?') && !sp.store_url.includes('/groceries/')
  );

  if (category) {
    filtered = filtered.filter(sp => sp.products?.category === category);
  }

  // Order by stalest first
  const CHUNK = 200;
  const lastObsMap = new Map();
  for (let i = 0; i < filtered.length; i += CHUNK) {
    const chunk = filtered.slice(i, i + CHUNK);
    const ids = chunk.map(sp => sp.id);
    const { data: obs } = await supabase
      .from('price_observations')
      .select('store_product_id, observed_at')
      .in('store_product_id', ids)
      .order('observed_at', { ascending: false });
    if (obs) {
      for (const o of obs) {
        if (!lastObsMap.has(o.store_product_id)) lastObsMap.set(o.store_product_id, o.observed_at);
      }
    }
  }

  filtered.sort((a, b) => {
    const aObs = lastObsMap.get(a.id) || '1970-01-01';
    const bObs = lastObsMap.get(b.id) || '1970-01-01';
    return aObs.localeCompare(bObs);
  });
  console.log(`  Sorted by stalest-first (${lastObsMap.size} products have price history)`);

  if (offset > 0) filtered = filtered.slice(offset);

  // Suppress permanent failures — keyed by store_product_id (uuid)
  const permanentFailureIds = await scrapeDb.getPermanentFailures('tesco');
  const beforeSuppression = filtered.length;
  if (permanentFailureIds.size > 0) {
    filtered = filtered.filter(sp => !permanentFailureIds.has(sp.id));
    const suppressed = beforeSuppression - filtered.length;
    if (suppressed > 0) console.log(`  Suppressed ${suppressed} permanent failures from target list`);
  }

  if (limit > 0) filtered = filtered.slice(0, limit);

  const targetCount = filtered.length;
  console.log(`Products to refresh: ${targetCount} (of ${storeProducts.length} total resolved)`);
  if (targetCount === 0) { console.log('Nothing to refresh!'); return; }

  // Open observability row — store the returned UUID for use in recordFailure()
  const scrapeRunUuid = await scrapeDb.openRun('tesco', RUN_ID, targetCount, 'scrapingbee');

  let attempted = 0, fetched = 0, extracted = 0;
  // inserted: products where price changed (or no prior observation) — new price_observation row
  // unchanged: products fetched where price is identical to latest observation
  // Both still write a price_observation row (freshness tracking), but only
  // inserted counts as a "new price point" for coverage.
  let inserted = 0, unchanged = 0, failed = 0;
  let sbRequests = 0, totalCredits = 0;
  let consecutiveErrors = 0;
  const ABORT_THRESHOLD = 15;
  let aborted = false;

  // Latest price cache for unchanged detection
  const latestPriceMap = new Map();
  {
    const ids = filtered.map(sp => sp.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data: latest } = await supabase
        .from('price_observations')
        .select('store_product_id, price')
        .in('store_product_id', chunk)
        .order('observed_at', { ascending: false });
      if (latest) {
        for (const row of latest) {
          if (!latestPriceMap.has(row.store_product_id)) latestPriceMap.set(row.store_product_id, row.price);
        }
      }
    }
  }

  for (let i = 0; i < filtered.length; i++) {
    const sp = filtered[i];
    const name = sp.products?.canonical_name || sp.store_product_name;
    attempted++;

    // ------------------------------------------------------------------
    // Step 1: Try the stored direct product URL (if resolved + valid SKU)
    // ------------------------------------------------------------------
    const hasDirectUrl = sp.store_url &&
      !sp.store_url.includes('/search?') &&
      !sp.store_url.includes('/groceries/') &&
      /\/products\/\d+/.test(sp.store_url);

    let pickedPrice = null;
    let pickedName  = sp.store_product_name || name;
    let pickedSku   = sp.store_sku || null;
    let pickedUrl   = sp.store_url || null;
    let retrievalPath = 'unknown';
    let fetchedThisProduct = false;

    if (hasDirectUrl) {
      const directResult = await scrapingBeeFetch(sp.store_url);
      sbRequests++;
      totalCredits += directResult.creditCost || 0;

      if (directResult.ok) {
        // Count a product as fetched once when either the direct page or search
        // successfully returns a response. A later fallback must not double-count.
        fetchedThisProduct = true;
        fetched++;

        const parsed = parseProductPage(directResult.html);
        if (parsed && parsed.price > 0) {
          // Existing direct URLs are not inherently trusted: historic mappings
          // can point at a different product. Validate the parsed page title with
          // the same type, size and keyword guards used by search matching.
          const directMatch = parsed.name
            ? fuzzyMatch(name, [{
                name: parsed.name,
                price: parsed.price,
                sku: pickedSku,
                url: pickedUrl,
              }])
            : null;

          if (directMatch) {
            pickedPrice    = parsed.price;
            pickedName     = parsed.name;
            retrievalPath  = 'direct';
            extracted++;
            consecutiveErrors = 0;
            console.log(
              `  ✓ ${name.substring(0, 38)} → €${parsed.price.toFixed(2)}` +
              `  [direct, sku=${pickedSku}, tesco="${parsed.name.substring(0, 35)}"]`
            );
          } else {
            // Do not accept a price from a stale or incorrect stored mapping.
            // Keep the existing URL unchanged unless guarded search finds a
            // valid replacement below.
            retrievalPath = 'direct_name_mismatch';
            console.log(
              `  ⚠ ${name.substring(0, 38)} → direct title mismatch` +
              `  [sku=${pickedSku}, tesco="${(parsed.name || '').substring(0, 35)}"], trying search…`
            );
            await scrapeDb.recordFailure({
              scrapeRunUuid,
              store:          'tesco',
              canonicalName:  name,
              storeProductId: sp.id,
              storeUrl:       sp.store_url,
              failureStage:   'parsing',
              failureReason:  'direct_name_mismatch',
            });
          }
        } else {
          // Page loaded but no price — product may be delisted; fall through to search
          console.log(`  ⚠ ${name.substring(0, 44)} → direct page has no price, trying search…`);
          retrievalPath = 'direct_no_price';
        }
      } else {
        // Direct URL failed (4xx/block/timeout) — fall through to search
        const dReason = directResult.error === 'blocked_challenge' ? 'blocked_challenge'
          : directResult.error?.includes('timeout') ? 'timeout' : 'http_error';
        console.log(`  ⚠ ${name.substring(0, 44)} → direct ${dReason}, trying search…`);
        retrievalPath = 'direct_failed';
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Search fallback — used when:
    //   (a) no valid direct URL stored, OR
    //   (b) direct page returned no price, OR
    //   (c) direct URL fetch failed (4xx/block/timeout)
    // ------------------------------------------------------------------
    if (pickedPrice === null) {
      const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
      const searchResult = await scrapingBeeFetch(searchUrl);
      sbRequests++;
      totalCredits += searchResult.creditCost || 0;

      if (!searchResult.ok) {
        const reason = searchResult.error === 'blocked_challenge' ? 'blocked_challenge'
          : searchResult.error?.includes('timeout') ? 'timeout' : 'http_error';
        console.log(`  ✗ ${name.substring(0, 50)} → search ${reason}`);
        failed++;
        consecutiveErrors++;
        await scrapeDb.recordFailure({
          scrapeRunUuid,
          store:          'tesco',
          canonicalName:  name,
          storeProductId: sp.id,
          storeUrl:        sp.store_url,
          failureStage:    'fetching',
          failureReason:   reason,
          rawError:        searchResult.error,
        });
        if (consecutiveErrors >= ABORT_THRESHOLD) {
          console.log(`\n  🛑 ${consecutiveErrors} consecutive errors — aborting run.`);
          aborted = true;
          break;
        }
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }
      if (!fetchedThisProduct) {
        fetchedThisProduct = true;
        fetched++;
      }

      const candidates = parseSearchResults(searchResult.html);
      if (candidates.length === 0) {
        console.log(`  ✗ ${name.substring(0, 50)} → no search results`);
        failed++;
        consecutiveErrors++;
        await scrapeDb.recordFailure({
          scrapeRunUuid,
          store:          'tesco',
          canonicalName:  name,
          storeProductId: sp.id,
          storeUrl:        sp.store_url,
          failureStage:    'fetching',
          failureReason:   'no_search_results',
        });
        if (consecutiveErrors >= ABORT_THRESHOLD) {
          console.log(`\n  🛑 ${consecutiveErrors} consecutive empty results — aborting run.`);
          aborted = true;
          break;
        }
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }
      consecutiveErrors = 0;

      // Stricter fuzzy match with type-conflict + size-compatibility guards
      const match = fuzzyMatch(name, candidates);
      if (!match) {
        console.log(`  ✗ ${name.substring(0, 50)} → no confident match (search)`);
        failed++;
        await scrapeDb.recordFailure({
          scrapeRunUuid,
          store:          'tesco',
          canonicalName:  name,
          storeProductId: sp.id,
          storeUrl:        sp.store_url,
          failureStage:    'parsing',
          failureReason:   'no_confident_match',
        });
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }

      if (!match.product.price || match.product.price <= 0) {
        console.log(`  ✗ ${name.substring(0, 50)} → no price in search results`);
        failed++;
        await scrapeDb.recordFailure({
          scrapeRunUuid,
          store:          'tesco',
          canonicalName:  name,
          storeProductId: sp.id,
          storeUrl:        sp.store_url,
          failureStage:    'parsing',
          failureReason:   'no_price_in_results',
        });
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }

      extracted++;
      pickedPrice = match.product.price;
      pickedName  = match.product.name;
      pickedSku   = match.product.sku;
      pickedUrl   = match.product.url;
      retrievalPath = hasDirectUrl ? 'search_fallback' : 'search';

      console.log(
        `  ✓ ${name.substring(0, 38)} → €${pickedPrice.toFixed(2)}` +
        `  [${retrievalPath}, sku=${pickedSku}, score=${match.score.toFixed(2)}` +
        `, tesco="${(pickedName || '').substring(0, 35)}"]`
      );

      // Update stored URL/SKU only if the match passes stricter validation
      // (we already passed type-conflict + size-compat checks to get here)
      if (pickedSku && pickedUrl && pickedUrl !== sp.store_url) {
        await supabase.from('store_products').update({
          store_url:          pickedUrl,
          store_sku:          pickedSku,
          store_product_name: pickedName || name,
        }).eq('id', sp.id);
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Write price observation — only after we have a confirmed price
    // ------------------------------------------------------------------
    const prevPrice   = latestPriceMap.get(sp.id);
    const isUnchanged = prevPrice != null && Math.abs(prevPrice - pickedPrice) < 0.001;

    const { error: insertErr } = await supabase.from('price_observations').insert({
      store_product_id: sp.id,
      price:            pickedPrice,
      was_price:        null,
      on_promotion:     false,
      observed_at:      new Date().toISOString(),
    });

    if (insertErr) {
      console.log(`  ✗ ${name.substring(0, 50)} → DB error: ${insertErr.message}`);
      failed++;
      await scrapeDb.recordFailure({
        scrapeRunUuid,
        store:          'tesco',
        canonicalName:  name,
        storeProductId: sp.id,
        storeUrl:        sp.store_url,
        failureStage:    'storing',
        failureReason:   'db_error',
        rawError:        insertErr.message,
      });
      await sleep(2000 + Math.floor(Math.random() * 2000));
      continue;
    }

    if (isUnchanged) { unchanged++; } else { inserted++; }
    await sleep(2000 + Math.floor(Math.random() * 2000));
  }

  // Silently skipped: in target list but never reached the fetch loop
  const silentlySkipped = targetCount - attempted;
  if (silentlySkipped > 0 && !aborted && scrapeRunUuid) {
    // Record each silently-skipped product; use a set of attempted ids to identify which ones
    const attemptedIds = new Set(filtered.slice(0, attempted).map(sp => sp.id));
    for (const sp of filtered) {
      if (!attemptedIds.has(sp.id)) {
        const name = sp.products?.canonical_name || sp.store_product_name;
        await scrapeDb.recordFailure({
          scrapeRunUuid,
          store:          'tesco',
          canonicalName:  name,
          storeProductId: sp.id,
          storeUrl:        sp.store_url,
          failureStage:    'selected',
          failureReason:   'silently_skipped',
        });
      }
    }
  }

  console.log(`\n=== Updated ${inserted + unchanged}/${targetCount} prices (${inserted} new, ${unchanged} unchanged), ${failed} errors ===`);
  console.log(`  ScrapingBee: ${sbRequests} requests, ~${totalCredits} credits used`);
  if (silentlySkipped > 0) console.log(`  ⚠ Silently skipped: ${silentlySkipped} products never attempted`);

  // Coverage: inserted (new price points) + unchanged (confirmed fresh) / target
  // unchanged IS included in coverage — the product was reached and confirmed.
  // inserted and unchanged are passed separately; closeRun adds them internally.
  const runResult = await scrapeDb.closeRun(RUN_ID, 'tesco', {
    attempted,
    fetched,
    extracted,
    inserted,    // genuinely new price points
    unchanged,   // confirmed same price — closeRun sums these for coverage
    failed,
    silently_skipped: silentlySkipped,
    scrapingbee_requests: sbRequests,
    scrapingbee_credits:  totalCredits,
    error_summary: aborted ? `Aborted after ${ABORT_THRESHOLD} consecutive errors` : null,
    aborted,
  });

  if (runResult?.thresholdBreached) {
    console.log(`  ⚠ Coverage ${runResult.coveragePct}% is below threshold ${runResult.threshold}%`);
  }
}

// ============================================================
// Single-product mode
// ============================================================

async function singleSearch(query) {
  if (!SCRAPINGBEE_KEY) { console.error('ERROR: SCRAPINGBEE_API_KEY not set'); process.exit(1); }

  const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(query)}`;
  const result = await scrapingBeeFetch(searchUrl);

  if (!result.ok) {
    console.log(JSON.stringify({ error: result.error }));
    return;
  }

  const products = parseSearchResults(result.html);
  if (products.length === 0) {
    console.log(JSON.stringify({ error: 'No products found' }));
    return;
  }

  console.log(JSON.stringify({ products: products.slice(0, 10), credits: result.creditCost }));
}

// ============================================================
// CLI
// ============================================================

// ============================================================
// Match tester — validates matching logic against live Tesco search
// without writing any DB rows.
//
// Usage:
//   node tesco_scraper.js --test --products "Butter Unsalted 250g,Butter Salted 500g,Galtee Cheese 200g"
//
// For each name, runs a Tesco search and reports:
//   - Retrieval path (search only — no direct URL in test mode)
//   - All candidates with pass/fail per check
//   - Selected match, score, SKU, price
//   - Any rejection reasons (type_conflict, size_mismatch, no_confident_match)
// ============================================================

async function testMatchMode(names) {
  if (!SCRAPINGBEE_KEY) { console.error('ERROR: SCRAPINGBEE_API_KEY not set'); process.exit(1); }

  console.log('=== TESCO MATCH TESTER (no DB writes) ===\n');

  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;

    console.log(`--- ${name} ---`);
    const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
    const result = await scrapingBeeFetch(searchUrl);

    if (!result.ok) {
      console.log(`  fetch failed: ${result.error}  (credits: ${result.creditCost})`);
      console.log('');
      continue;
    }

    const candidates = parseSearchResults(result.html);
    if (candidates.length === 0) {
      console.log(`  no candidates returned from search  (credits: ${result.creditCost})`);
      console.log('');
      continue;
    }

    console.log(`  ${candidates.length} candidates (credits: ${result.creditCost}):`);

    // Per-candidate evaluation
    for (const c of candidates.slice(0, 8)) {
      const typeOk  = !hasProductTypeConflict(name, c.name);
      const sizeChk = isSizeCompatible(name, c.name);

      // Compute score (same logic as fuzzyMatch, minus the hard guards)
      const normSearch = normaliseName(name);
      const normC      = normaliseName(c.name);
      let scoreStr = '-';
      if (normSearch === normC) {
        scoreStr = '1.00 (exact)';
      } else {
        const SIZE_RE_T = /\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|ea)?\b/gi;
        const nsKw = normSearch.replace(SIZE_RE_T, '').replace(/\s+/g, ' ').trim();
        const ncKw = normC.replace(SIZE_RE_T, '').replace(/\s+/g, ' ').trim();
        const sw = nsKw.split(/\s+/).filter(w => w.length > 2);
        const cw = ncKw.split(/\s+/).filter(w => w.length > 2);
        let sic = 0; for (const w of sw) { if (ncKw.includes(w)) sic++; }
        let cis = 0; for (const w of cw) { if (nsKw.includes(w)) cis++; }
        const sc = sw.length > 0 ? sic / sw.length : 0;
        const cc = cw.length > 0 ? cis / cw.length : 0;
        const rawScore = sc * 0.7 + cc * 0.3;
        const passes = rawScore >= 0.45 && sc > 0.50 && cc > 0.50;
        scoreStr = passes ? rawScore.toFixed(2) : `${rawScore.toFixed(2)}(rej:sc=${sc.toFixed(2)},cc=${cc.toFixed(2)})`;
      }

      // Size flag: show rejection reason when incompatible
      const sizeFlag = sizeChk.ok ? 'size✓' : `SIZE✗(${sizeChk.reason})`;
      const flags = [typeOk ? 'type✓' : 'TYPE✗', sizeFlag].join(' ');
      const price = c.price ? `€${c.price.toFixed(2)}` : '(no price)';
      console.log(`    [${flags} score=${scoreStr}] ${price}  sku=${c.sku}  "${(c.name || '').substring(0, 60)}"`);
    }

    // Final match decision
    const match = fuzzyMatch(name, candidates);
    if (match) {
      console.log(`  ✓ SELECTED: "${match.product.name}" sku=${match.product.sku} €${(match.product.price||0).toFixed(2)} score=${match.score.toFixed(2)} path=search`);
    } else {
      console.log(`  ✗ NO MATCH (all candidates rejected or score < 0.45)`);
    }
    console.log('');

    await sleep(2000 + Math.floor(Math.random() * 1000));
  }

  console.log('=== Done — no DB rows written ===');
}

async function main() {
  const args = process.argv.slice(2);

  const searchIdx = args.indexOf('--search');
  if (searchIdx >= 0) {
    const query = args[searchIdx + 1];
    if (!query) { console.error('Usage: --search "product name"'); process.exit(1); }
    return singleSearch(query);
  }

  const testIdx = args.indexOf('--test');
  if (testIdx >= 0) {
    const productsIdx = args.indexOf('--products');
    if (productsIdx < 0 || !args[productsIdx + 1]) {
      console.error('Usage: --test --products "Name One,Name Two,Name Three"');
      process.exit(1);
    }
    const names = args[productsIdx + 1].split(',');
    return testMatchMode(names);
  }

  const resolve = args.includes('--resolve');
  const refresh = args.includes('--refresh');

  if (!resolve && !refresh) {
    console.log('Tesco Ireland Scraper (ScrapingBee)');
    console.log('');
    console.log('Batch modes (require SUPABASE_SERVICE_ROLE_KEY + SCRAPINGBEE_API_KEY):');
    console.log('  node tesco_scraper.js --resolve              Resolve pending/old URLs');
    console.log('  node tesco_scraper.js --refresh              Refresh prices');
    console.log('  node tesco_scraper.js --resolve --limit 50   Limit products');
    console.log('  node tesco_scraper.js --refresh --limit 200');
    console.log('  node tesco_scraper.js --refresh --category "Dairy"');
    console.log('');
    console.log('Match tester (no DB writes):');
    console.log('  node tesco_scraper.js --test --products "Butter Unsalted 250g,Butter Salted 250g"');
    console.log('');
    console.log('Single-product mode:');
    console.log('  node tesco_scraper.js --search "Frozen Peas"');
    console.log('');
    console.log('Credit cost: 25 per search (render_js + premium_proxy)');
    process.exit(0);
  }

  acquireLock();
  process.on('exit', releaseLock);
  process.on('SIGINT', () => { releaseLock(); process.exit(130); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;

  const catIdx = args.indexOf('--category');
  const category = catIdx >= 0 ? args[catIdx + 1] : null;

  if (resolve) await resolveMode({ limit, category });
  if (refresh) await refreshMode({ limit, category, offset });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
