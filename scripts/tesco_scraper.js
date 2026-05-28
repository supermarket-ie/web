#!/usr/bin/env node
/**
 * Tesco Ireland Scraper
 * Uses Playwright to scrape product prices from tesco.ie.
 * Zero ScrapingBee credits — bypasses Akamai WAF via xvfb + headed Chromium.
 *
 * MUST run under xvfb-run for headed mode:
 *   xvfb-run node scripts/tesco_scraper.js --resolve
 *   xvfb-run node scripts/tesco_scraper.js --refresh
 *   xvfb-run node scripts/tesco_scraper.js --refresh --limit 10
 *
 * Or call from Python pipeline which handles xvfb wrapper.
 *
 * Single-product lookup (stdout JSON, for pipeline integration):
 *   xvfb-run node scripts/tesco_scraper.js --search "Whole Milk 2L"
 *   xvfb-run node scripts/tesco_scraper.js --price "https://www.tesco.ie/shop/en-IE/products/260776455"
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = 'https://www.tesco.ie';

// ============================================================
// Browser setup — Akamai WAF evasion
// ============================================================

async function launchBrowser() {
  const browser = await chromium.launch({
    headless: false, // headed mode required to bypass Akamai
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-IE',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' },
  });

  // Remove automation traces
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IE', 'en'],
    });
  });

  return { browser, context };
}

/**
 * Load Tesco homepage to obtain Akamai clearance cookies.
 * Must be called once per browser session before any other requests.
 */
async function warmUp(page) {
  await page.goto(`${BASE_URL}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  // Wait for Akamai scripts to set cookies
  await page.waitForTimeout(6000);

  const title = await page.title();
  if (title.includes('Access Denied')) {
    throw new Error('Akamai blocked homepage — try again in a few minutes');
  }
}

// ============================================================
// Search — find product SKU + name + price from search results
// ============================================================

async function searchProduct(page, query) {
  const url = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const html = await page.content();

  if (html.includes('Access Denied')) {
    return { error: 'Access Denied on search' };
  }

  // Extract products with prices directly from DOM
  // This is more reliable than text-only parsing as it navigates the tile structure
  const products = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const productLinks = document.querySelectorAll('a[href*="/products/"]');

    productLinks.forEach((a) => {
      const href = a.getAttribute('href');
      const match = href.match(/\/products\/(\d+)/);
      if (!match || seen.has(match[1])) return;
      seen.add(match[1]);

      // Walk up DOM to find the product tile container with name + price
      let container = a;
      let price = null;
      let name = '';
      for (let i = 0; i < 10 && container; i++) {
        container = container.parentElement;
        if (!container) break;
        // Look for price element
        if (!price) {
          const pEl = container.querySelector('[class*="priceText"]');
          if (pEl) {
            const priceMatch = pEl.textContent.match(/(\d+\.\d{2})/);
            if (priceMatch) price = parseFloat(priceMatch[1]);
          }
        }
        // Look for product name
        if (!name) {
          const h = container.querySelector('h2, h3');
          if (h && h.textContent.trim().length > 3) {
            name = h.textContent.trim();
          }
        }
        if (price && name) break;
      }

      if (!name) {
        name = a.textContent?.trim()?.substring(0, 100) || '';
      }

      const cleanHref = href.split('?')[0];
      const fullUrl = cleanHref.startsWith('http')
        ? cleanHref
        : `${location.origin}${cleanHref}`;
      results.push({
        sku: match[1],
        name,
        price,
        url: fullUrl,
      });
    });
    return results;
  });

  return { products };
}

// ============================================================
// Product page — extract price from schema.org JSON-LD
// ============================================================

async function getProductPrice(page, productUrl) {
  // Normalise old URLs
  productUrl = productUrl.replace('/groceries/en-IE/', '/shop/en-IE/');

  await page.goto(productUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(4000);

  const html = await page.content();

  if (html.includes('Access Denied')) {
    return { error: 'Access Denied on product page' };
  }

  // Extract product name from the page (h1 or og:title)
  const pageName = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim().length > 3) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og) return og.getAttribute('content') || '';
    return '';
  }).catch(() => '');

  // 1. Try schema.org JSON-LD — check @graph array for Product type
  const jsonLdMatches = [...html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  )];
  for (const jsonLdMatch of jsonLdMatches) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      // Handle @graph array (Tesco uses this)
      const entries = ld['@graph'] || [ld];
      const product = entries.find(e => e['@type'] === 'Product');
      if (product) {
        const offer = product.offers || {};
        const price = parseFloat(offer.price || product.price || 0);
        if (price > 0) {
          return {
            price,
            name: product.name || pageName || '',
            sku: product.sku || '',
            gtin: product.gtin13 || '',
            url: productUrl,
          };
        }
      }
    } catch {}
  }

  // 2. Fallback — regex for "price":X.XX in any script (covers inline data)
  const pricePatterns = [
    /"price"\s*:\s*"?([\d.]+)"?/g,
    /"priceCurrency"\s*:\s*"(?:EUR|GBP)"\s*,\s*"price"\s*:\s*([\d.]+)/,
  ];
  for (const pattern of pricePatterns) {
    const matches = [...html.matchAll(pattern instanceof RegExp && pattern.global ? pattern : new RegExp(pattern.source, 'g'))];
    for (const m of matches) {
      const p = parseFloat(m[1]);
      if (p > 0 && p < 500) {
        return {
          price: p,
          name: pageName || '',
          url: productUrl,
        };
      }
    }
  }

  // 3. Fallback — euro prices in HTML (skip €0.00)
  const euros = [...html.matchAll(/€(\d+\.\d{2})/g)]
    .map((m) => parseFloat(m[1]))
    .filter((p) => p > 0);
  if (euros.length > 0) {
    return {
      price: euros[0],
      name: pageName || '',
      url: productUrl,
    };
  }

  return { error: 'No price found', url: productUrl };
}

/**
 * Detect promotion / Clubcard / was-price from product page HTML.
 * Call after getProductPrice on the same page.
 */
async function detectPromotion(page) {
  const html = await page.content();

  let wasPrice = null;
  let onPromotion = false;
  let promoLabel = null;

  // Clubcard price
  const clubcard = html.match(
    /[Cc]lubcard\s*[Pp]rice[^€]*€\s*(\d+\.\d{2})/
  );
  if (clubcard) {
    promoLabel = 'Clubcard Price';
    onPromotion = true;
  }

  // "Was €X.XX" or "was €X.XX"
  const wasMatch = html.match(/[Ww]as\s*€\s*(\d+\.\d{2})/);
  if (wasMatch) {
    wasPrice = parseFloat(wasMatch[1]);
    onPromotion = true;
    if (!promoLabel) promoLabel = 'Was Price';
  }

  // Generic offer/promo text
  if (!onPromotion) {
    const offerMatch = html.match(
      /(?:save|offer|deal|reduced|special)[^<]{0,60}€\s*(\d+\.\d{2})/i
    );
    if (offerMatch) {
      onPromotion = true;
      promoLabel = 'Offer';
    }
  }

  return { wasPrice, onPromotion, promoLabel };
}

// ============================================================
// Fuzzy matching — same approach as aldi_scraper.js
// ============================================================

function fuzzyMatch(searchName, candidates) {
  searchName = (searchName || '').toLowerCase();
  if (!searchName) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const c of candidates) {
    const cName = (c.name || c.canonical_name || '').toLowerCase();
    if (!cName) continue;

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

  console.log('=== TESCO RESOLVE MODE (Playwright) ===\n');

  // Get Tesco store_products that need resolving:
  // 1. pending status
  // 2. resolved but still on old /groceries/ search URLs
  // Fetch ALL rows (Supabase default limit is 1000, we need all ~1800+)
  let allTesco = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('store_products')
      .select('id, product_id, store_product_name, store_url, url_status')
      .eq('store', 'tesco')
      .range(from, from + pageSize - 1);
    if (pageErr) {
      console.error('DB error:', pageErr);
      return;
    }
    allTesco = allTesco.concat(page || []);
    if (!page || page.length < pageSize) break;
    from += pageSize;
  }
  const spErr = null;
  if (spErr) {
    console.error('DB error:', spErr);
    return;
  }

  // Filter: pending OR resolved-but-still-on-search-URLs
  let toResolve = allTesco.filter(
    (sp) =>
      sp.url_status === 'pending' ||
      sp.url_status === 'failed' ||
      (sp.url_status === 'resolved' &&
        sp.store_url &&
        (sp.store_url.includes('/search?') || sp.store_url.includes('/groceries/')))
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

  // Launch browser
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  console.log('Warming up (loading homepage for cookies)...');
  await warmUp(page);
  console.log('Ready.\n');

  let resolved = 0;
  let priced = 0;
  let errors = 0;

  for (const sp of toResolve) {
    const name = sp.store_product_name;
    try {
      // Search for the product
      const searchResult = await searchProduct(page, name);

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

      // Get price from the product page
      const priceResult = await getProductPrice(page, picked.url);

      if (priceResult.error) {
        // Still resolve the URL even if price extraction fails
        console.log(
          `  ⚠ ${name.substring(0, 50)} → URL found but no price: ${priceResult.error}`
        );
        await supabase
          .from('store_products')
          .update({
            store_url: picked.url,
            store_sku: picked.sku,
            store_product_name: picked.name || name,
            url_status: 'resolved',
          })
          .eq('id', sp.id);
        resolved++;
        continue;
      }

      // Detect promotions
      const promo = await detectPromotion(page);

      // Update store_product
      await supabase
        .from('store_products')
        .update({
          store_url: picked.url,
          store_sku: picked.sku,
          store_product_name: priceResult.name || picked.name || name,
          url_status: 'resolved',
        })
        .eq('id', sp.id);

      // Insert price observation
      await supabase.from('price_observations').insert({
        store_product_id: sp.id,
        price: priceResult.price,
        was_price: promo.wasPrice,
        on_promotion: promo.onPromotion,
        observed_at: new Date().toISOString(),
      });

      const promoNote = promo.onPromotion
        ? ` 🏷️ ${promo.promoLabel}${promo.wasPrice ? ` (was €${promo.wasPrice})` : ''}`
        : '';
      console.log(
        `  ✓ ${name.substring(0, 45)} → €${priceResult.price.toFixed(2)} ${matchNote}${promoNote}`
      );
      resolved++;
      priced++;

      // Small delay between products
      await page.waitForTimeout(1500);
    } catch (e) {
      console.log(`  ✗ ${name.substring(0, 50)} → Error: ${e.message}`);
      errors++;
      // If we hit Access Denied, wait longer
      if (e.message.includes('Access Denied')) {
        console.log('    ⏳ Waiting 30s after block...');
        await page.waitForTimeout(30000);
        // Retry warmup
        try {
          await warmUp(page);
        } catch {}
      }
    }
  }

  await browser.close();

  console.log(`\n=== Results: ${resolved} resolved, ${priced} priced, ${errors} errors ===`);
}

async function refreshMode({ limit, category, offset = 0 }) {
  if (!SUPABASE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('=== TESCO REFRESH MODE (Playwright) ===\n');

  let query = supabase
    .from('store_products')
    .select(
      'id, product_id, store_product_name, store_url, store_sku, products(canonical_name, category)'
    )
    .eq('store', 'tesco')
    .eq('url_status', 'resolved');

  const { data: storeProducts, error: spErr } = await query;
  if (spErr) {
    console.error('DB error:', spErr);
    return;
  }

  // Skip products with search URLs — they need resolve first
  let filtered = storeProducts.filter(
    (sp) =>
      sp.store_url &&
      !sp.store_url.includes('/search?') &&
      !sp.store_url.includes('/groceries/')
  );

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

  // Process in batches with browser restarts to avoid memory bloat / Akamai expiry
  const BATCH_SIZE = 100;
  let updated = 0;
  let errors = 0;
  let batchNum = 0;

  for (let batchStart = 0; batchStart < filtered.length; batchStart += BATCH_SIZE) {
    const batch = filtered.slice(batchStart, batchStart + BATCH_SIZE);
    batchNum++;
    console.log(`\n--- Batch ${batchNum} (products ${batchStart + 1}–${batchStart + batch.length} of ${filtered.length}) ---`);

    let browser, context, page;
    try {
      ({ browser, context } = await launchBrowser());
      page = await context.newPage();
      console.log('  Warming up...');
      await warmUp(page);
    } catch (e) {
      console.log(`  ✗ Browser launch/warmup failed: ${e.message}`);
      console.log('  ⏳ Waiting 30s before retry...');
      await new Promise((r) => setTimeout(r, 30000));
      try {
        if (browser) await browser.close().catch(() => {});
        ({ browser, context } = await launchBrowser());
        page = await context.newPage();
        await warmUp(page);
      } catch (e2) {
        console.log(`  ✗✗ Retry failed: ${e2.message} — skipping batch`);
        errors += batch.length;
        continue;
      }
    }

    for (const sp of batch) {
      const name = sp.products?.canonical_name || sp.store_product_name;
      try {
        // Search by product name and extract price from search results
        // Product pages no longer contain pricing data (Tesco removed JSON-LD/price elements)
        const searchResult = await searchProduct(page, name);

        if (searchResult.error) {
          console.log(`  ✗ ${name.substring(0, 50)} → ${searchResult.error}`);
          errors++;
          if (searchResult.error.includes('Access Denied')) {
            console.log('    ⏳ Waiting 30s after block...');
            await page.waitForTimeout(30000);
            try { await warmUp(page); } catch {}
          }
          continue;
        }

        const products = searchResult.products || [];
        if (products.length === 0) {
          console.log(`  ✗ ${name.substring(0, 50)} → No search results`);
          errors++;
          continue;
        }

        // Find best match by name
        const match = fuzzyMatch(name, products);
        const picked = match ? match.product : products[0];

        if (!picked.price || picked.price <= 0) {
          console.log(`  ✗ ${name.substring(0, 50)} → No price in search results`);
          errors++;
          continue;
        }

        // Update stored URL/SKU if they've changed (Tesco re-keys product IDs)
        if (picked.sku && picked.url && picked.url !== sp.store_url) {
          await supabase
            .from('store_products')
            .update({
              store_url: picked.url,
              store_sku: picked.sku,
              store_product_name: picked.name || name,
            })
            .eq('id', sp.id);
        }

        // Insert price observation
        await supabase.from('price_observations').insert({
          store_product_id: sp.id,
          price: picked.price,
          was_price: null,
          on_promotion: false,
          observed_at: new Date().toISOString(),
        });

        console.log(
          `  ✓ ${name.substring(0, 50)} → €${picked.price.toFixed(2)}`
        );
        updated++;

        await page.waitForTimeout(1500);
      } catch (e) {
        console.log(`  ✗ ${name.substring(0, 50)} → Error: ${e.message}`);
        errors++;
        // If browser/page crashed, break out of this batch and restart
        if (
          e.message.includes('Target page, context or browser has been closed') ||
          e.message.includes('Target closed') ||
          e.message.includes('Browser closed') ||
          e.message.includes('Navigation failed because page was closed')
        ) {
          console.log('    💥 Browser crashed — ending batch early');
          break;
        }
        if (e.message.includes('Access Denied')) {
          console.log('    ⏳ Waiting 30s after block...');
          try {
            await page.waitForTimeout(30000);
            await warmUp(page);
          } catch {
            console.log('    💥 Recovery failed — ending batch early');
            break;
          }
        }
      }
    }

    // Close browser to free memory before next batch
    try {
      await browser.close();
    } catch {}
    console.log(`  Batch ${batchNum} done. Running total: ${updated} updated, ${errors} errors`);
  }

  console.log(`\n=== Updated ${updated}/${filtered.length} prices, ${errors} errors ===`);
}

// ============================================================
// Single-product modes — for pipeline integration
// ============================================================

async function singleSearch(query) {
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();
  try {
    await warmUp(page);
    const result = await searchProduct(page, query);
    if (result.error) {
      console.log(JSON.stringify({ error: result.error }));
    } else if (!result.products || result.products.length === 0) {
      console.log(JSON.stringify({ error: 'No products found' }));
    } else {
      // Get price for first result
      const product = result.products[0];
      const priceResult = await getProductPrice(page, product.url);
      const promo = await detectPromotion(page);
      console.log(
        JSON.stringify({
          sku: product.sku,
          name: priceResult.name || product.name,
          price: priceResult.price || null,
          url: product.url,
          onPromotion: promo.onPromotion,
          wasPrice: promo.wasPrice,
          promotionLabel: promo.promoLabel,
          error: priceResult.error || null,
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
    await warmUp(page);
    const result = await getProductPrice(page, productUrl);
    const promo = await detectPromotion(page);
    console.log(
      JSON.stringify({
        price: result.price || null,
        name: result.name || '',
        url: productUrl,
        onPromotion: promo.onPromotion,
        wasPrice: promo.wasPrice,
        promotionLabel: promo.promoLabel,
        error: result.error || null,
      })
    );
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
      console.error('Usage: --price "https://www.tesco.ie/shop/en-IE/products/XXX"');
      process.exit(1);
    }
    return singlePrice(url);
  }

  // Batch modes
  const resolve = args.includes('--resolve');
  const refresh = args.includes('--refresh');

  if (!resolve && !refresh) {
    console.log('Tesco Ireland Playwright Scraper');
    console.log('');
    console.log('Batch modes (require SUPABASE_SERVICE_ROLE_KEY):');
    console.log('  xvfb-run node tesco_scraper.js --resolve              Resolve pending/old URLs');
    console.log('  xvfb-run node tesco_scraper.js --refresh              Refresh prices');
    console.log('  xvfb-run node tesco_scraper.js --resolve --limit 10   Limit products');
    console.log('  xvfb-run node tesco_scraper.js --refresh --category "Dairy"');
    console.log('');
    console.log('Single-product modes:');
    console.log('  xvfb-run node tesco_scraper.js --search "Whole Milk 2L"');
    console.log('  xvfb-run node tesco_scraper.js --price "https://www.tesco.ie/shop/en-IE/products/260776455"');
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
