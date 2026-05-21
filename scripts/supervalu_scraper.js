#!/usr/bin/env node
/**
 * SuperValu Ireland Scraper
 * Uses Playwright to scrape product prices from shop.supervalu.ie.
 * Zero ScrapingBee credits — headless Chromium works fine (no WAF issues).
 *
 * Usage:
 *   node scripts/supervalu_scraper.js --resolve              Resolve pending products
 *   node scripts/supervalu_scraper.js --refresh              Refresh prices for resolved products
 *   node scripts/supervalu_scraper.js --refresh --limit 10   Limit products
 *   node scripts/supervalu_scraper.js --refresh --category "Dairy"
 *   node scripts/supervalu_scraper.js --search "Whole Milk 2L"
 *   node scripts/supervalu_scraper.js --price "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/..."
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = 'https://shop.supervalu.ie';
const STORE_PATH = '/sm/delivery/rsid/5550';

// ============================================================
// Browser setup
// ============================================================

async function launchBrowser() {
  const browser = await chromium.launch({
    headless: true, // No WAF — headless works fine
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-IE',
    viewport: { width: 1920, height: 1080 },
  });

  return { browser, context };
}

// ============================================================
// Extract data from __PRELOADED_STATE__ (extract in-browser to avoid serialising 600KB)
// ============================================================

/**
 * Extract search results from __PRELOADED_STATE__.search.productCardDictionary.
 * Runs inside the page to avoid serialising the full 600KB state.
 */
async function extractSearchProducts(page) {
  return page.evaluate(() => {
    const state = window.__PRELOADED_STATE__;
    if (!state || !state.search) return null;

    const dict = state.search.productCardDictionary || {};
    return Object.values(dict).map((p) => ({
      name: p.name || '',
      sku: p.sku || '',
      brand: p.brand || '',
      price: p.price || '',
      wasPrice: p.wasPrice || '',
      isDiscounted: p.isDiscounted || false,
      unitPrice: p.unitPrice || '',
      available: p.available !== false,
      promotions: (p.promotions || []).map((pr) => ({
        description: pr.description || '',
        name: pr.name || '',
      })),
    }));
  });
}

/**
 * Extract product detail from __PRELOADED_STATE__.product (product pages).
 */
async function extractProductDetail(page) {
  return page.evaluate(() => {
    const state = window.__PRELOADED_STATE__;
    if (!state) return null;

    // Product pages use state.product
    const p = state.product;
    if (p && p.price) {
      return {
        source: 'product',
        name: p.name || '',
        sku: p.sku || '',
        brand: p.brand || '',
        price: p.price || '',
        wasPrice: p.wasPrice || '',
        isDiscounted: p.isDiscounted || false,
        unitPrice: p.unitPrice || '',
        available: p.available !== false,
        promotions: (p.promotions || []).map((pr) => ({
          description: pr.description || '',
          name: pr.name || '',
        })),
      };
    }

    // Fallback: check productCardDictionary
    const dict = state.search?.productCardDictionary || {};
    const items = Object.values(dict);
    if (items.length > 0) {
      const first = items[0];
      return {
        source: 'dict',
        name: first.name || '',
        sku: first.sku || '',
        brand: first.brand || '',
        price: first.price || '',
        wasPrice: first.wasPrice || '',
        isDiscounted: first.isDiscounted || false,
        unitPrice: first.unitPrice || '',
        available: first.available !== false,
        promotions: (first.promotions || []).map((pr) => ({
          description: pr.description || '',
          name: pr.name || '',
        })),
      };
    }

    return null;
  });
}

// ============================================================
// Parse price string "€X.XX" → number
// ============================================================

function parsePrice(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return null;
  const match = priceStr.match(/€?\s*(\d+\.?\d*)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return val > 0 && val < 1000 ? val : null;
}

// ============================================================
// Search — find products by name from search results page
// ============================================================

async function searchProducts(page, query) {
  // SuperValu search chokes on volume specs like "2L", "500g" — strip them
  const cleanQuery = query
    .toLowerCase()
    .replace(/\d+\s*(ml|l|g|kg|cl|oz|pk|pack)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const url = `${BASE_URL}${STORE_PATH}/results?q=${encodeURIComponent(cleanQuery)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  
  // Wait for productCardDictionary to populate (client-side hydration)
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() =>
      Object.keys(window.__PRELOADED_STATE__?.search?.productCardDictionary || {}).length
    );
    if (count > 0) break;
  }

  const items = await extractSearchProducts(page);
  if (!items) {
    return { error: 'No search state found' };
  }

  const products = items.map((p) => ({
    name: p.name,
    sku: p.sku,
    brand: p.brand,
    price: parsePrice(p.price),
    priceStr: p.price,
    wasPrice: parsePrice(p.wasPrice),
    wasPriceStr: p.wasPrice,
    isDiscounted: p.isDiscounted,
    unitPrice: p.unitPrice,
    available: p.available,
    url: `${BASE_URL}${STORE_PATH}/product/${slugFromProduct(p)}`,
    promotions: p.promotions,
  }));

  return { products };
}

/**
 * Build a URL slug from product data.
 * SuperValu URL pattern: /product/{name-slug}-id-{sku}
 */
function slugFromProduct(p) {
  const name = (p.name || '')
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${name}-id-${p.sku}`;
}

// ============================================================
// Product page — extract price from __PRELOADED_STATE__
// ============================================================

async function getProductPrice(page, productUrl) {
  await page.goto(productUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await page.waitForTimeout(3000);

  const detail = await extractProductDetail(page);
  if (detail) {
    const price = parsePrice(detail.price);
    if (price) {
      return {
        price,
        name: detail.name,
        sku: detail.sku,
        brand: detail.brand,
        wasPrice: parsePrice(detail.wasPrice),
        isDiscounted: detail.isDiscounted,
        unitPrice: detail.unitPrice,
        promotions: detail.promotions,
        available: detail.available,
        url: productUrl,
      };
    }
  }

  // Last resort: regex price from HTML
  const html = await page.content();
  const euroMatch = html.match(/€(\d+\.\d{2})/);
  if (euroMatch) {
    const price = parseFloat(euroMatch[1]);
    if (price > 0 && price < 1000) {
      return { price, url: productUrl, name: '', sku: '' };
    }
  }

  return { error: 'No price found', url: productUrl };
}

// ============================================================
// Promotion detection
// ============================================================

function detectPromotion(productData) {
  let wasPrice = productData.wasPrice || null;
  let onPromotion = productData.isDiscounted || false;
  let promoLabel = null;

  // wasPrice is set and different from current price → on promotion
  if (wasPrice && wasPrice > 0 && productData.price && wasPrice !== productData.price) {
    onPromotion = true;
    promoLabel = `Was €${wasPrice.toFixed(2)}`;
  }

  // Check promotions array
  if (productData.promotions && productData.promotions.length > 0) {
    onPromotion = true;
    const promo = productData.promotions[0];
    promoLabel = promo.description || promo.name || promoLabel || 'Offer';
  }

  // If wasPrice equals current price or is 0, it's not a real promotion
  if (wasPrice && productData.price && wasPrice === productData.price) {
    wasPrice = null;
    if (!productData.promotions?.length) {
      onPromotion = false;
    }
  }

  return { wasPrice, onPromotion, promoLabel };
}

// ============================================================
// Fuzzy matching
// ============================================================

function fuzzyMatch(searchName, candidates) {
  searchName = (searchName || '').toLowerCase();
  if (!searchName) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const c of candidates) {
    const cName = (c.name || c.canonical_name || '').toLowerCase();
    if (!cName) continue;

    // Exact or substring match
    if (
      searchName === cName ||
      searchName.includes(cName) ||
      cName.includes(searchName)
    ) {
      if (1.0 > bestScore) {
        bestScore = 1.0;
        bestMatch = c;
      }
      continue;
    }

    // Word overlap
    const searchWords = searchName.split(/\s+/).filter((w) => w.length > 2);
    const cWords = cName.split(/\s+/).filter((w) => w.length > 2);

    let cInSearch = 0;
    for (const w of cWords) {
      if (searchName.includes(w)) cInSearch++;
    }
    let searchInC = 0;
    for (const w of searchWords) {
      if (cName.includes(w)) searchInC++;
    }

    const s1 = cWords.length > 0 ? cInSearch / cWords.length : 0;
    const s2 = searchWords.length > 0 ? searchInC / searchWords.length : 0;
    const score = Math.min(s1, s2);

    if (score > bestScore && score >= 0.5) {
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
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('=== SUPERVALU RESOLVE MODE (Playwright) ===\n');

  // Get pending + failed SuperValu store_products
  const { data: allSV, error: spErr } = await supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, url_status')
    .eq('store', 'supervalu');

  if (spErr) {
    console.error('DB error:', spErr);
    return;
  }

  let toResolve = allSV.filter(
    (sp) => sp.url_status === 'pending' || sp.url_status === 'failed'
  );

  if (category) {
    const { data: catProducts } = await supabase
      .from('products')
      .select('id')
      .eq('category', category);
    const catIds = new Set((catProducts || []).map((p) => p.id));
    toResolve = toResolve.filter((sp) => catIds.has(sp.product_id));
  }

  if (limit > 0) toResolve = toResolve.slice(0, limit);

  console.log(`Products to resolve: ${toResolve.length}`);
  if (toResolve.length === 0) {
    console.log('Nothing to resolve!');
    return;
  }

  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  let resolved = 0;
  let priced = 0;
  let errors = 0;

  for (const sp of toResolve) {
    const name = sp.store_product_name;
    try {
      const searchResult = await searchProducts(page, name);

      if (searchResult.error) {
        console.log(`  ✗ ${name.substring(0, 50)} → ${searchResult.error}`);
        errors++;
        await supabase
          .from('store_products')
          .update({ url_status: 'failed' })
          .eq('id', sp.id);
        continue;
      }

      const products = searchResult.products || [];
      if (products.length === 0) {
        console.log(`  ✗ ${name.substring(0, 50)} → No products found`);
        errors++;
        await supabase
          .from('store_products')
          .update({ url_status: 'failed' })
          .eq('id', sp.id);
        continue;
      }

      // Find best fuzzy match
      const match = fuzzyMatch(name, products);
      const picked = match ? match.product : products[0];
      const matchNote = match
        ? `(score ${match.score.toFixed(2)})`
        : '(first result)';

      const promo = detectPromotion(picked);

      // Update store_product
      await supabase
        .from('store_products')
        .update({
          store_url: picked.url,
          store_sku: picked.sku,
          store_product_name: picked.name || name,
          url_status: 'resolved',
        })
        .eq('id', sp.id);

      // Insert price observation if we have a price
      if (picked.price) {
        await supabase.from('price_observations').insert({
          store_product_id: sp.id,
          price: picked.price,
          was_price: promo.wasPrice,
          on_promotion: promo.onPromotion,
          observed_at: new Date().toISOString(),
        });
        priced++;
      }

      const promoNote = promo.onPromotion
        ? ` 🏷️ ${promo.promoLabel || 'Offer'}`
        : '';
      console.log(
        `  ✓ ${name.substring(0, 45)} → €${picked.price ? picked.price.toFixed(2) : '?'} ${matchNote}${promoNote}`
      );
      resolved++;

      // Small delay between searches
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  ✗ ${name.substring(0, 50)} → Error: ${e.message}`);
      errors++;
    }
  }

  await browser.close();

  console.log(
    `\n=== Results: ${resolved} resolved, ${priced} priced, ${errors} errors ===`
  );
}

async function refreshMode({ limit, category, offset = 0 }) {
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('=== SUPERVALU REFRESH MODE (Playwright) ===\n');

  const { data: storeProducts, error: spErr } = await supabase
    .from('store_products')
    .select(
      'id, product_id, store_product_name, store_url, store_sku, products(canonical_name, category)'
    )
    .eq('store', 'supervalu')
    .eq('url_status', 'resolved');

  if (spErr) {
    console.error('DB error:', spErr);
    return;
  }

  let filtered = storeProducts.filter((sp) => sp.store_url);

  if (category) {
    filtered = filtered.filter((sp) => sp.products?.category === category);
  }
  if (offset > 0) filtered = filtered.slice(offset);
  if (limit > 0) filtered = filtered.slice(0, limit);

  console.log(
    `Products to refresh: ${filtered.length} (of ${storeProducts.length} total resolved)`
  );
  if (filtered.length === 0) {
    console.log('Nothing to refresh!');
    return;
  }

  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  let updated = 0;
  let errors = 0;
  let offers = 0;

  for (const sp of filtered) {
    const name = sp.products?.canonical_name || sp.store_product_name;
    try {
      const result = await getProductPrice(page, sp.store_url);

      if (result.error) {
        console.log(`  ✗ ${name.substring(0, 50)} → ${result.error}`);
        errors++;
        continue;
      }

      const promo = detectPromotion(result);

      await supabase.from('price_observations').insert({
        store_product_id: sp.id,
        price: result.price,
        was_price: promo.wasPrice,
        on_promotion: promo.onPromotion,
        observed_at: new Date().toISOString(),
      });

      if (promo.onPromotion) offers++;

      const promoNote = promo.onPromotion
        ? ` 🏷️ ${promo.promoLabel || 'Offer'}`
        : '';
      console.log(
        `  ✓ ${name.substring(0, 50)} → €${result.price.toFixed(2)}${promoNote}`
      );
      updated++;

      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  ✗ ${name.substring(0, 50)} → Error: ${e.message}`);
      errors++;
    }
  }

  await browser.close();

  console.log(
    `\n=== Updated ${updated}/${filtered.length} prices (${offers} offers), ${errors} errors ===`
  );
}

// ============================================================
// Single-product modes
// ============================================================

async function singleSearch(query) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  try {
    const result = await searchProducts(page, query);
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }));
    } else if (!result.products || result.products.length === 0) {
      console.log(JSON.stringify({ error: 'No products found' }));
    } else {
      const p = result.products[0];
      const promo = detectPromotion(p);
      console.log(
        JSON.stringify({
          sku: p.sku,
          name: p.name,
          brand: p.brand,
          price: p.price,
          url: p.url,
          onPromotion: promo.onPromotion,
          wasPrice: promo.wasPrice,
          promotionLabel: promo.promoLabel,
        })
      );
    }
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
  } finally {
    await browser.close();
  }
}

async function singlePrice(productUrl) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  try {
    const result = await getProductPrice(page, productUrl);
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      const promo = detectPromotion(result);
      console.log(
        JSON.stringify({
          price: result.price,
          name: result.name,
          sku: result.sku,
          brand: result.brand,
          url: productUrl,
          onPromotion: promo.onPromotion,
          wasPrice: promo.wasPrice,
          promotionLabel: promo.promoLabel,
        })
      );
    }
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
  } finally {
    await browser.close();
  }
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  // Single-product modes
  const searchIdx = args.indexOf('--search');
  if (searchIdx >= 0) {
    const query = args[searchIdx + 1];
    if (!query) {
      console.error('Usage: --search "product name"');
      process.exit(1);
    }
    return singleSearch(query);
  }

  const priceIdx = args.indexOf('--price');
  if (priceIdx >= 0) {
    const url = args[priceIdx + 1];
    if (!url) {
      console.error('Usage: --price "https://shop.supervalu.ie/..."');
      process.exit(1);
    }
    return singlePrice(url);
  }

  // Batch modes
  const resolve = args.includes('--resolve');
  const refresh = args.includes('--refresh');

  if (!resolve && !refresh) {
    console.log('SuperValu Ireland Playwright Scraper');
    console.log('');
    console.log('Batch modes (require SUPABASE_SERVICE_ROLE_KEY):');
    console.log(
      '  node supervalu_scraper.js --resolve              Resolve pending products'
    );
    console.log(
      '  node supervalu_scraper.js --refresh              Refresh all prices'
    );
    console.log(
      '  node supervalu_scraper.js --resolve --limit 10   Limit products'
    );
    console.log(
      '  node supervalu_scraper.js --refresh --category "Dairy"'
    );
    console.log('');
    console.log('Single-product modes:');
    console.log('  node supervalu_scraper.js --search "Whole Milk 2L"');
    console.log(
      '  node supervalu_scraper.js --price "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/..."'
    );
    process.exit(0);
  }

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;

  const catIdx = args.indexOf('--category');
  const category = catIdx >= 0 ? args[catIdx + 1] : null;

  if (resolve) await resolveMode({ limit, category, offset });
  if (refresh) await refreshMode({ limit, category, offset });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
