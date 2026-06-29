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

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const res = await fetch('https://app.scrapingbee.com/api/v1?' + params.toString(), {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const creditCost = res.headers.get('Spb-Cost') || '?';

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
          return { ok: false, error: 'Akamai blocked', creditCost };
        }
        return { ok: true, html, creditCost };
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
        return { ok: false, error: `HTTP ${res.status}: ${body.substring(0, 100)}`, creditCost };
      }
    } catch (e) {
      if (attempt < retries) {
        await sleep(3000);
        continue;
      }
      return { ok: false, error: e.message, creditCost: '0' };
    }
  }
  return { ok: false, error: 'Max retries exceeded', creditCost: '0' };
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
// Fuzzy matching — optimised for generic canonical names vs branded store names
// ============================================================

function fuzzyMatch(searchName, candidates) {
  searchName = (searchName || '').toLowerCase();
  if (!searchName) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const c of candidates) {
    const cName = (c.name || '').toLowerCase();
    if (!cName) continue;

    // Exact or substring match
    if (searchName === cName || searchName.includes(cName) || cName.includes(searchName)) {
      if (1.0 > bestScore) { bestScore = 1.0; bestMatch = c; }
      continue;
    }

    const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);
    const cWords = cName.split(/\s+/).filter(w => w.length > 2);

    // How many of our search words appear in the candidate?
    let searchInC = 0;
    for (const w of searchWords) {
      if (cName.includes(w)) searchInC++;
    }
    // How many candidate words appear in our search?
    let cInSearch = 0;
    for (const w of cWords) {
      if (searchName.includes(w)) cInSearch++;
    }

    // Key insight: if ALL our search words appear in the candidate, it's a good match
    // even if the candidate has extra brand/size words we don't have.
    // Use the proportion of search words found in candidate as primary score.
    const searchCoverage = searchWords.length > 0 ? searchInC / searchWords.length : 0;
    
    // Secondary: what fraction of candidate words are in our search (penalises wild mismatches)
    const candidateCoverage = cWords.length > 0 ? cInSearch / cWords.length : 0;
    
    // Score: primarily reward coverage of our search terms, with some weight on candidate coverage
    const score = searchCoverage * 0.7 + candidateCoverage * 0.3;

    if (score > bestScore && score >= 0.45) {
      bestScore = score;
      bestMatch = c;
    }
  }

  return bestMatch ? { product: bestMatch, score: bestScore } : null;
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
        if (!lastObsMap.has(o.store_product_id)) {
          lastObsMap.set(o.store_product_id, o.observed_at);
        }
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
  if (limit > 0) filtered = filtered.slice(0, limit);

  console.log(`Products to refresh: ${filtered.length} (of ${storeProducts.length} total resolved)`);
  if (filtered.length === 0) { console.log('Nothing to refresh!'); return; }

  let updated = 0, errors = 0;
  let totalCredits = 0;
  let consecutiveErrors = 0;
  const ABORT_THRESHOLD = 15;

  for (let i = 0; i < filtered.length; i++) {
    const sp = filtered[i];
    const name = sp.products?.canonical_name || sp.store_product_name;

    const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
    const result = await scrapingBeeFetch(searchUrl);
    totalCredits += parseInt(result.creditCost) || 0;

    if (!result.ok) {
      console.log(`  ✗ ${name.substring(0, 50)} → ${result.error}`);
      errors++;
      consecutiveErrors++;
      if (consecutiveErrors >= ABORT_THRESHOLD) {
        console.log(`\n  🛑 ${consecutiveErrors} consecutive errors — aborting run.`);
        break;
      }
      continue;
    }

    const products = parseSearchResults(result.html);
    if (products.length === 0) {
      console.log(`  ✗ ${name.substring(0, 50)} → No search results`);
      errors++;
      consecutiveErrors++;
      if (consecutiveErrors >= ABORT_THRESHOLD) {
        console.log(`\n  🛑 ${consecutiveErrors} consecutive empty results — aborting run.`);
        break;
      }
      continue;
    }
    consecutiveErrors = 0;

    // Find best match
    const match = fuzzyMatch(name, products);
    if (!match) {
      console.log(`  ✗ ${name.substring(0, 50)} → No confident match, skipping`);
      errors++;
      continue;
    }

    const picked = match.product;

    if (!picked.price || picked.price <= 0) {
      console.log(`  ✗ ${name.substring(0, 50)} → No price in results`);
      errors++;
      continue;
    }

    // Update stored URL/SKU if changed
    if (picked.sku && picked.url && picked.url !== sp.store_url) {
      await supabase.from('store_products').update({
        store_url: picked.url,
        store_sku: picked.sku,
        store_product_name: picked.name || name,
      }).eq('id', sp.id);
    }

    // Insert price observation
    await supabase.from('price_observations').insert({
      store_product_id: sp.id,
      price: picked.price,
      was_price: null,
      on_promotion: false,
      observed_at: new Date().toISOString(),
    });

    console.log(`  ✓ ${name.substring(0, 50)} → €${picked.price.toFixed(2)}`);
    updated++;

    // Delay 2-4s between requests
    await sleep(2000 + Math.floor(Math.random() * 2000));
  }

  console.log(`\n=== Updated ${updated}/${filtered.length} prices, ${errors} errors ===`);
  console.log(`  Credits used: ~${totalCredits}`);
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

async function main() {
  const args = process.argv.slice(2);

  const searchIdx = args.indexOf('--search');
  if (searchIdx >= 0) {
    const query = args[searchIdx + 1];
    if (!query) { console.error('Usage: --search "product name"'); process.exit(1); }
    return singleSearch(query);
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
