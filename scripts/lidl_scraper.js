#!/usr/bin/env node
/**
 * Lidl Ireland Scraper
 * Uses Playwright to scrape product prices from lidl.ie category pages.
 * Zero cost — no API keys needed.
 * 
 * Usage:
 *   node scripts/lidl_scraper.js [--resolve] [--refresh] [--category "Dairy"]
 * 
 * Modes:
 *   --resolve: Find matching Lidl products for our canonical catalogue
 *   --refresh: Scrape current prices for resolved products
 *   --category: Filter by product category
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Lidl category URLs
const LIDL_CATEGORIES = [
  { name: 'Dairy', url: 'https://www.lidl.ie/h/cheese-dairy/h10071017' },
  { name: 'Fruit', url: 'https://www.lidl.ie/h/fresh-fruit-vegetables/h10071012' },
  { name: 'Bakery', url: 'https://www.lidl.ie/h/bakery-bread-baked-goods/h10071015' },
  { name: 'Meat', url: 'https://www.lidl.ie/h/fresh-meat-poultry/h10071016' },
  { name: 'Fish', url: 'https://www.lidl.ie/h/fish-seafood/h10071050' },
  { name: 'Frozen', url: 'https://www.lidl.ie/h/frozen-food/h10071049' },
  { name: 'Snacks', url: 'https://www.lidl.ie/h/snacks-confectionery-ice-cream/h10071044' },
  { name: 'Beverages', url: 'https://www.lidl.ie/h/drinks/h10071022' },
  { name: 'Ready Meals', url: 'https://www.lidl.ie/h/ready-made-meals/h10071020' },
  { name: 'Eggs & Staples', url: 'https://www.lidl.ie/h/eggs-staple-foods/h10071045' },
  { name: 'Coffee & Tea', url: 'https://www.lidl.ie/h/coffee-tea-hot-chocolate/h10071683' },
  { name: 'Preserves', url: 'https://www.lidl.ie/h/preserves-spreads/h10071684' },
  { name: 'Tinned', url: 'https://www.lidl.ie/h/oils-tinned-food/h10071681' },
  { name: 'Sauces', url: 'https://www.lidl.ie/h/spices-mustard-sauces/h10071682' },
  { name: 'Health', url: 'https://www.lidl.ie/h/health/h10071019' },
  { name: 'Pet', url: 'https://www.lidl.ie/h/pet/h10071025' },
];

// Map Lidl categories to our DB categories
const CATEGORY_MAP = {
  'Dairy': 'Dairy',
  'Fruit': 'Fruit',
  'Bakery': 'Bakery',
  'Meat': 'Meat',
  'Fish': 'Fish',
  'Frozen': 'Frozen',
  'Snacks': 'Snacks',
  'Beverages': 'Beverages',
  'Ready Meals': 'Chilled',
  'Eggs & Staples': 'Breakfast',
  'Coffee & Tea': 'Beverages',
  'Preserves': 'Condiments',
  'Tinned': 'Tinned',
  'Sauces': 'Condiments',
  'Health': 'Personal Care',
  'Pet': 'Pet Care',
};

async function scrapeCategory(page, category) {
  console.log(`  Scraping ${category.name}...`);
  await page.goto(category.url, { waitUntil: 'networkidle', timeout: 30000 });

  const products = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('.product-grid-box__content').forEach(el => {
      const brand = el.querySelector('.product-grid-box__brand')?.textContent?.trim() || '';
      const title = el.querySelector('.product-grid-box__title')?.textContent?.trim() || '';
      const priceEl = el.querySelector('.product-grid-box__price');
      const priceText = priceEl?.textContent?.trim() || '';
      
      // Extract main price
      const priceMatch = priceText.match(/€([\d.]+)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      
      // Extract unit info (e.g. "1kg = 5.18")
      const unitMatch = priceText.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|each)\s*=\s*([\d.]+)/i);
      const pricePerUnit = unitMatch ? parseFloat(unitMatch[3]) : null;
      const unit = unitMatch ? unitMatch[2].toLowerCase() : null;
      
      // Get product URL
      const link = el.closest('a') || el.querySelector('a');
      const url = link?.href || '';
      
      if (title && price) {
        items.push({
          brand,
          title,
          price,
          pricePerUnit,
          unit,
          url,
          fullName: brand ? `${brand} ${title}` : title,
        });
      }
    });
    return items;
  });

  return products.map(p => ({ ...p, category: category.name }));
}

// Fuzzy match a search name against an array of candidates with .canonical_name
// Returns { product, score } or null
function fuzzyMatch(searchProduct, candidates) {
  const searchName = (searchProduct.fullName || searchProduct.title || '').toLowerCase();
  if (!searchName) return null;
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const cp of candidates) {
    const canonName = (cp.canonical_name || '').toLowerCase();
    if (!canonName) continue;
    
    // Exact full match
    if (searchName === canonName || searchName.includes(canonName) || canonName.includes(searchName)) {
      if (1.0 > bestScore) {
        bestScore = 1.0;
        bestMatch = cp;
      }
      continue;
    }
    
    // Word-level matching — both directions
    const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);
    const canonWords = canonName.split(/\s+/).filter(w => w.length > 2);
    
    // How many of the canonical product's words appear in the search name?
    let canonInSearch = 0;
    for (const word of canonWords) {
      if (searchName.includes(word)) canonInSearch++;
    }
    
    // How many of the search name's words appear in the canonical name?
    let searchInCanon = 0;
    for (const word of searchWords) {
      if (canonName.includes(word)) searchInCanon++;
    }
    
    // Use the stricter of the two directions
    const score1 = canonWords.length > 0 ? canonInSearch / canonWords.length : 0;
    const score2 = searchWords.length > 0 ? searchInCanon / searchWords.length : 0;
    const score = Math.min(score1, score2); // Both sides must agree
    
    // Require at least 60% match from both directions
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = cp;
    }
  }
  
  return bestMatch ? { product: bestMatch, score: bestScore } : null;
}

async function resolveMode(categoryFilter) {
  console.log('=== LIDL RESOLVE MODE ===');
  console.log('Finding matching products for our catalogue...\n');
  
  // Get our canonical products
  let query = supabase.from('products').select('id, canonical_name, category');
  if (categoryFilter) {
    query = query.eq('category', categoryFilter);
  }
  const { data: products, error: prodErr } = await query;
  if (prodErr) { console.error('DB error:', prodErr); return; }
  console.log(`Canonical products to match: ${products.length}`);
  
  // Get existing Lidl store_products
  const { data: existing } = await supabase
    .from('store_products')
    .select('product_id')
    .eq('store', 'lidl')
    .eq('url_status', 'resolved');
  const existingIds = new Set((existing || []).map(e => e.product_id));
  
  const toResolve = products.filter(p => !existingIds.has(p.id));
  console.log(`Already resolved: ${existingIds.size}, need to resolve: ${toResolve.length}\n`);
  
  if (toResolve.length === 0) {
    console.log('Nothing to resolve!');
    return;
  }
  
  // Scrape all Lidl categories
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allLidlProducts = [];
  const categoriesToScrape = categoryFilter
    ? LIDL_CATEGORIES.filter(c => CATEGORY_MAP[c.name] === categoryFilter || c.name === categoryFilter)
    : LIDL_CATEGORIES;
  
  for (const cat of categoriesToScrape) {
    try {
      const products = await scrapeCategory(page, cat);
      allLidlProducts = allLidlProducts.concat(products);
    } catch (e) {
      console.error(`  Error scraping ${cat.name}: ${e.message}`);
    }
  }
  await browser.close();
  
  console.log(`\nScraped ${allLidlProducts.length} Lidl products total`);
  console.log('Matching to catalogue...\n');
  
  let matched = 0;
  let created = 0;
  
  // Convert Lidl products to have canonical_name for the matcher
  const lidlAsCandidates = allLidlProducts.map(lp => ({ ...lp, canonical_name: lp.fullName }));
  
  for (const canonical of toResolve) {
    // Find best Lidl match — search for our canonical name among Lidl products
    const match = fuzzyMatch({ title: canonical.canonical_name, fullName: canonical.canonical_name }, lidlAsCandidates);
    
    if (match && match.score >= 0.5) {
      const lidl = match.product;
      console.log(`  ✓ ${canonical.canonical_name} → ${lidl.fullName} (€${lidl.price}, score ${match.score.toFixed(2)})`);
      
      // Create store_product
      const { error: insertErr } = await supabase
        .from('store_products')
        .insert({
          product_id: canonical.id,
          store: 'lidl',
          store_product_name: lidl.fullName,
          brand: lidl.brand || null,
          is_own_brand: ['milbona', 'cien', 'freeway', 'bellarom', 'harvest basket', 'chef select', 'deluxe', 'alesto', 'freshona', 'ocean sea', 'bon gelati', 'italiamo', 'eridanous', 'vitasia', 'sol & mar', 'mcennedy', 'kuljanka', 'glensallagh', 'silvercrest'].includes((lidl.brand || '').toLowerCase()),
          store_url: lidl.url || 'https://www.lidl.ie',
          url_status: 'resolved',
          store_sku: lidl.fullName,
        });
      
      if (insertErr) {
        console.error(`    Insert error: ${insertErr.message}`);
      } else {
        created++;
        // Also insert a price observation
        const { data: sp } = await supabase
          .from('store_products')
          .select('id')
          .eq('product_id', canonical.id)
          .eq('store', 'lidl')
          .single();
        
        if (sp) {
          await supabase.from('price_observations').insert({
            store_product_id: sp.id,
            price: lidl.price,
            price_per_unit: lidl.pricePerUnit,
            unit_for_comparison: lidl.unit === 'kg' ? 'per kg' : lidl.unit === 'l' ? 'per litre' : null,
            on_promotion: false,
            observed_at: new Date().toISOString(),
          });
        }
      }
      matched++;
    }
  }
  
  console.log(`\nResults: ${matched} matched, ${created} created in DB`);
}

async function refreshMode(categoryFilter) {
  console.log('=== LIDL REFRESH MODE ===');
  console.log('Scraping current prices for resolved products...\n');
  
  // Get resolved Lidl store_products
  let query = supabase
    .from('store_products')
    .select('id, product_id, store_sku, products(canonical_name, category)')
    .eq('store', 'lidl')
    .eq('url_status', 'resolved');
  
  const { data: storeProducts, error: spErr } = await query;
  if (spErr) { console.error('DB error:', spErr); return; }
  
  let filtered = storeProducts;
  if (categoryFilter) {
    filtered = storeProducts.filter(sp => sp.products?.category === categoryFilter);
  }
  
  console.log(`Resolved Lidl products to refresh: ${filtered.length}\n`);
  if (filtered.length === 0) return;
  
  // Scrape all categories
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allLidlProducts = [];
  const categoriesToScrape = categoryFilter
    ? LIDL_CATEGORIES.filter(c => CATEGORY_MAP[c.name] === categoryFilter || c.name === categoryFilter)
    : LIDL_CATEGORIES;
  
  for (const cat of categoriesToScrape) {
    try {
      const products = await scrapeCategory(page, cat);
      allLidlProducts = allLidlProducts.concat(products);
    } catch (e) {
      console.error(`  Error scraping ${cat.name}: ${e.message}`);
    }
  }
  await browser.close();
  
  console.log(`Scraped ${allLidlProducts.length} Lidl products`);
  console.log('Matching and updating prices...\n');
  
  let updated = 0;
  for (const sp of filtered) {
    const sku = (sp.store_sku || '').toLowerCase();
    const canonName = sp.products?.canonical_name?.toLowerCase() || '';
    
    // Find matching product in scraped data
    const match = allLidlProducts.find(lp => {
      const lpName = lp.fullName.toLowerCase();
      return lpName === sku || lpName.includes(sku) || sku.includes(lpName)
        || fuzzyMatch({ title: canonName, fullName: canonName }, [{ canonical_name: lp.fullName }])?.score >= 0.5;
    });
    
    if (match) {
      const { error } = await supabase.from('price_observations').insert({
        store_product_id: sp.id,
        price: match.price,
        price_per_unit: match.pricePerUnit,
        unit_for_comparison: match.unit === 'kg' ? 'per kg' : match.unit === 'l' ? 'per litre' : null,
        on_promotion: false,
        observed_at: new Date().toISOString(),
      });
      if (!error) {
        updated++;
        console.log(`  ✓ ${sp.products?.canonical_name} → €${match.price}`);
      }
    }
  }
  
  console.log(`\nUpdated ${updated}/${filtered.length} prices`);
}

async function main() {
  const args = process.argv.slice(2);
  const resolve = args.includes('--resolve');
  const refresh = args.includes('--refresh');
  const catIdx = args.indexOf('--category');
  const categoryFilter = catIdx >= 0 ? args[catIdx + 1] : null;
  
  if (!resolve && !refresh) {
    console.log('Usage: node lidl_scraper.js [--resolve] [--refresh] [--category "Dairy"]');
    console.log('  --resolve  Find and match Lidl products to our catalogue');
    console.log('  --refresh  Update prices for already-matched products');
    process.exit(0);
  }
  
  if (resolve) await resolveMode(categoryFilter);
  if (refresh) await refreshMode(categoryFilter);
}

main().catch(e => { console.error(e); process.exit(1); });
