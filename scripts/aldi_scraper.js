#!/usr/bin/env node
/**
 * Aldi Ireland Scraper
 * Uses Playwright to scrape product prices from aldi.ie.
 * Zero cost — no API keys needed.
 * 
 * Usage:
 *   node scripts/aldi_scraper.js [--resolve] [--refresh] [--category "Dairy"]
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

// Aldi category URLs — full grocery range
const ALDI_CATEGORIES = [
  // Fresh Food
  { name: 'Fruit', dbCat: 'Fruit', url: 'https://www.aldi.ie/products/fresh-food/fruit/k/1588161416978075001' },
  { name: 'Vegetables', dbCat: 'Vegetables', url: 'https://www.aldi.ie/products/fresh-food/vegetables/k/1588161416978075002' },
  { name: 'Poultry', dbCat: 'Meat', url: 'https://www.aldi.ie/products/fresh-food/poultry/k/1588161416978075004' },
  { name: 'Beef', dbCat: 'Meat', url: 'https://www.aldi.ie/products/fresh-food/beef/k/1588161416978075005' },
  { name: 'Pork & Ham', dbCat: 'Meat', url: 'https://www.aldi.ie/products/fresh-food/pork-ham/k/1588161416978075006' },
  { name: 'Bacon & Sausages', dbCat: 'Meat', url: 'https://www.aldi.ie/products/fresh-food/bacon-sausages/k/1588161416978075007' },
  { name: 'Lamb', dbCat: 'Meat', url: 'https://www.aldi.ie/products/fresh-food/lamb/k/1588161416978075008' },
  { name: 'Fish', dbCat: 'Fish', url: 'https://www.aldi.ie/products/fresh-food/fish/k/1588161416978075011' },
  { name: 'Seafood', dbCat: 'Fish', url: 'https://www.aldi.ie/products/fresh-food/seafood-prawns/k/1588161416978075012' },
  { name: 'Breaded Fish', dbCat: 'Fish', url: 'https://www.aldi.ie/products/fresh-food/breaded-fish-fishcakes/k/1588161416978075013' },
  // Chilled
  { name: 'Milk', dbCat: 'Dairy', url: 'https://www.aldi.ie/products/chilled-food/milk/k/1588161416978076001' },
  { name: 'Dairy', dbCat: 'Dairy', url: 'https://www.aldi.ie/products/chilled-food/dairy/k/1588161416978076002' },
  { name: 'Cheese', dbCat: 'Dairy', url: 'https://www.aldi.ie/products/chilled-food/cheese/k/1588161416978076003' },
  { name: 'Yogurts', dbCat: 'Dairy', url: 'https://www.aldi.ie/products/chilled-food/yogurts/k/1588161416978076004' },
  { name: 'Chilled Ready Meals', dbCat: 'Chilled', url: 'https://www.aldi.ie/products/chilled-food/chilled-ready-meals/k/1588161416978076006' },
  { name: 'Cooked Meats', dbCat: 'Meat', url: 'https://www.aldi.ie/products/chilled-food/cooked-meats/k/1588161416978076005' },
  // Food Cupboard
  { name: 'Cereals', dbCat: 'Breakfast', url: 'https://www.aldi.ie/products/food-cupboard/cereals-snack-bars/k/1588161416978078002' },
  { name: 'Rice & Pasta', dbCat: 'Pasta & Rice', url: 'https://www.aldi.ie/products/food-cupboard/rice-pasta-noodles/k/1588161416978078008' },
  { name: 'Tins & Cans', dbCat: 'Tinned', url: 'https://www.aldi.ie/products/food-cupboard/tins-cans-packets/k/1588161416978078012' },
  { name: 'Sauces & Oils', dbCat: 'Condiments', url: 'https://www.aldi.ie/products/food-cupboard/sauces-oils-dressings/k/1588161416978078010' },
  { name: 'Baking', dbCat: 'Baking', url: 'https://www.aldi.ie/products/food-cupboard/sugar-home-baking/k/1588161416978078011' },
  { name: 'Jams & Spreads', dbCat: 'Condiments', url: 'https://www.aldi.ie/products/food-cupboard/jams-spreads-syrups/k/1588161416978078006' },
  { name: 'Crisps & Snacks', dbCat: 'Snacks', url: 'https://www.aldi.ie/products/food-cupboard/crisps-snacks/k/1588161416978078004' },
  { name: 'Chocolate', dbCat: 'Snacks', url: 'https://www.aldi.ie/products/food-cupboard/chocolate-sweets/k/1588161416978078003' },
  { name: 'Biscuits', dbCat: 'Snacks', url: 'https://www.aldi.ie/products/food-cupboard/biscuits-crackers/k/1588161416978078001' },
  // Bakery
  { name: 'Bakery', dbCat: 'Bakery', url: 'https://www.aldi.ie/products/bakery/k/1588161416978079' },
  // Frozen
  { name: 'Frozen', dbCat: 'Frozen', url: 'https://www.aldi.ie/products/frozen-food/k/1588161416978077' },
  // Drinks
  { name: 'Soft Drinks', dbCat: 'Beverages', url: 'https://www.aldi.ie/products/drinks/soft-drinks/k/1588161416978080001' },
  { name: 'Water', dbCat: 'Beverages', url: 'https://www.aldi.ie/products/drinks/water/k/1588161416978080003' },
  { name: 'Tea & Coffee', dbCat: 'Beverages', url: 'https://www.aldi.ie/products/drinks/tea-coffee/k/1588161416978080004' },
  // Household
  { name: 'Laundry', dbCat: 'Household', url: 'https://www.aldi.ie/products/household/laundry/k/1588161416978082001' },
  { name: 'Cleaning', dbCat: 'Household', url: 'https://www.aldi.ie/products/household/cleaning/k/1588161416978082002' },
  { name: 'Kitchen', dbCat: 'Household', url: 'https://www.aldi.ie/products/household/kitchen/k/1588161416978082003' },
  // Baby
  { name: 'Baby', dbCat: 'Baby', url: 'https://www.aldi.ie/products/baby/k/1588161416978081' },
  // Pet
  { name: 'Pet', dbCat: 'Pet Care', url: 'https://www.aldi.ie/products/pet-food/k/1588161416978083' },
];

// Aldi own brands
const ALDI_OWN_BRANDS = [
  "nature's pick", 'butchers selection', 'specially selected', 'kilkeely gold',
  'clonbawn', 'harvest morn', 'village bakery', 'skellig bay', 'actileaf',
  'brannans', 'moser roth', 'alcafe', 'brooklea', 'lacura', 'mamia',
  'almat', 'magnum', 'earths choice', 'cowbelle', 'dermot & daisy',
];

async function scrapeAldiCategory(page, category) {
  const products = [];
  let pageNum = 1;
  
  while (true) {
    const url = pageNum === 1 ? category.url : `${category.url}?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    const pageProducts = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('.product-tile').forEach(el => {
        const brand = el.querySelector('.product-tile__brandname')?.textContent?.trim() || '';
        const name = el.querySelector('.product-tile__name')?.textContent?.trim() || '';
        const currentPrice = el.querySelector('.base-price__regular')?.textContent?.trim() || '';
        const wasPrice = el.querySelector('.base-price__was-price')?.textContent?.trim() || '';
        const unitInfo = el.querySelector('.product-tile__unit-of-measurement')?.textContent?.trim() || '';
        const compPrice = el.querySelector('.product-tile__comparison-price')?.textContent?.trim() || '';
        const link = el.querySelector('a.product-tile__link');
        const url = link?.href || '';
        
        const priceMatch = currentPrice.match(/€([\d.]+)/);
        const wasMatch = wasPrice.match(/€([\d.]+)/);
        const compMatch = compPrice.match(/€([\d.]+)\/([\w\s]+)/);
        
        if (name && priceMatch) {
          items.push({
            brand,
            name,
            price: parseFloat(priceMatch[1]),
            wasPrice: wasMatch ? parseFloat(wasMatch[1]) : null,
            onPromotion: !!wasMatch,
            unitInfo,
            pricePerUnit: compMatch ? parseFloat(compMatch[1]) : null,
            unitForComparison: compMatch ? compMatch[2].trim() : null,
            url,
            fullName: brand ? `${brand} ${name}` : name,
          });
        }
      });
      return items;
    });
    
    if (pageProducts.length === 0) break;
    products.push(...pageProducts);
    
    // Check if there's a next page
    const hasNext = await page.evaluate((pn) => {
      const links = document.querySelectorAll('a[href*="page="]');
      for (const l of links) {
        if (l.href.includes(`page=${pn + 1}`)) return true;
      }
      return false;
    }, pageNum);
    
    if (!hasNext) break;
    pageNum++;
  }
  
  return products.map(p => ({ ...p, category: category.name, dbCat: category.dbCat }));
}

// Fuzzy match — bidirectional word matching
function fuzzyMatch(searchName, candidates) {
  searchName = (searchName || '').toLowerCase();
  if (!searchName) return null;
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const cp of candidates) {
    const canonName = (cp.canonical_name || cp.fullName || '').toLowerCase();
    if (!canonName) continue;
    
    // Exact or containment match
    if (searchName === canonName || searchName.includes(canonName) || canonName.includes(searchName)) {
      if (1.0 > bestScore) {
        bestScore = 1.0;
        bestMatch = cp;
      }
      continue;
    }
    
    const searchWords = searchName.split(/\s+/).filter(w => w.length > 2);
    const canonWords = canonName.split(/\s+/).filter(w => w.length > 2);
    
    let canonInSearch = 0;
    for (const word of canonWords) {
      if (searchName.includes(word)) canonInSearch++;
    }
    
    let searchInCanon = 0;
    for (const word of searchWords) {
      if (canonName.includes(word)) searchInCanon++;
    }
    
    const score1 = canonWords.length > 0 ? canonInSearch / canonWords.length : 0;
    const score2 = searchWords.length > 0 ? searchInCanon / searchWords.length : 0;
    const score = Math.min(score1, score2);
    
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = cp;
    }
  }
  
  return bestMatch ? { product: bestMatch, score: bestScore } : null;
}

async function resolveMode(categoryFilter) {
  console.log('=== ALDI RESOLVE MODE ===');
  console.log('Finding matching products for our catalogue...\n');
  
  // Get canonical products
  let query = supabase.from('products').select('id, canonical_name, category');
  if (categoryFilter) query = query.eq('category', categoryFilter);
  const { data: products, error: prodErr } = await query;
  if (prodErr) { console.error('DB error:', prodErr); return; }
  console.log(`Canonical products to match: ${products.length}`);
  
  // Get existing Aldi store_products
  const { data: existing } = await supabase
    .from('store_products')
    .select('product_id')
    .eq('store', 'aldi')
    .in('url_status', ['resolved', 'pending']);
  const existingIds = new Set((existing || []).map(e => e.product_id));
  
  const toResolve = products.filter(p => !existingIds.has(p.id));
  console.log(`Already in DB: ${existingIds.size}, need to resolve: ${toResolve.length}\n`);
  
  if (toResolve.length === 0) {
    console.log('Nothing to resolve!');
    return;
  }
  
  // Scrape Aldi categories
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allAldiProducts = [];
  const categoriesToScrape = categoryFilter
    ? ALDI_CATEGORIES.filter(c => c.dbCat === categoryFilter)
    : ALDI_CATEGORIES;
  
  for (const cat of categoriesToScrape) {
    try {
      console.log(`  Scraping ${cat.name}...`);
      const products = await scrapeAldiCategory(page, cat);
      console.log(`    → ${products.length} products`);
      allAldiProducts = allAldiProducts.concat(products);
    } catch (e) {
      console.error(`  Error scraping ${cat.name}: ${e.message}`);
    }
  }
  await browser.close();
  
  console.log(`\nTotal scraped: ${allAldiProducts.length} Aldi products`);
  console.log('Matching to catalogue...\n');
  
  // Dedupe Aldi products by name
  const seen = new Set();
  const uniqueAldi = allAldiProducts.filter(p => {
    const key = p.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`Unique products: ${uniqueAldi.length}\n`);
  
  // Convert for matcher
  const aldiAsCandidates = uniqueAldi.map(p => ({ ...p, canonical_name: p.fullName }));
  
  let matched = 0;
  let created = 0;
  
  for (const canonical of toResolve) {
    const match = fuzzyMatch(canonical.canonical_name, aldiAsCandidates);
    
    if (match && match.score >= 0.6) {
      const aldi = match.product;
      const isOwnBrand = ALDI_OWN_BRANDS.some(b => (aldi.brand || '').toLowerCase().includes(b));
      
      console.log(`  ✓ ${canonical.canonical_name} → ${aldi.fullName} (€${aldi.price}, score ${match.score.toFixed(2)})`);
      
      const { error: insertErr } = await supabase
        .from('store_products')
        .insert({
          product_id: canonical.id,
          store: 'aldi',
          store_product_name: aldi.fullName,
          brand: aldi.brand || null,
          is_own_brand: isOwnBrand,
          store_url: aldi.url || 'https://www.aldi.ie',
          url_status: 'resolved',
          store_sku: aldi.fullName,
        });
      
      if (insertErr) {
        console.error(`    Insert error: ${insertErr.message}`);
      } else {
        created++;
        // Insert price observation
        const { data: sp } = await supabase
          .from('store_products')
          .select('id')
          .eq('product_id', canonical.id)
          .eq('store', 'aldi')
          .single();
        
        if (sp) {
          await supabase.from('price_observations').insert({
            store_product_id: sp.id,
            price: aldi.price,
            was_price: aldi.wasPrice,
            on_promotion: aldi.onPromotion,
            price_per_unit: aldi.pricePerUnit,
            unit_for_comparison: aldi.unitForComparison ? `per ${aldi.unitForComparison}` : null,
            observed_at: new Date().toISOString(),
          });
        }
      }
      matched++;
    }
  }
  
  console.log(`\n=== Results: ${matched} matched, ${created} created in DB ===`);
}

async function refreshMode(categoryFilter) {
  console.log('=== ALDI REFRESH MODE ===');
  console.log('Scraping current prices for resolved products...\n');
  
  let query = supabase
    .from('store_products')
    .select('id, product_id, store_sku, store_product_name, products(canonical_name, category)')
    .eq('store', 'aldi')
    .eq('url_status', 'resolved');
  
  const { data: storeProducts, error: spErr } = await query;
  if (spErr) { console.error('DB error:', spErr); return; }
  
  let filtered = storeProducts;
  if (categoryFilter) {
    filtered = storeProducts.filter(sp => sp.products?.category === categoryFilter);
  }
  
  console.log(`Resolved Aldi products to refresh: ${filtered.length}\n`);
  if (filtered.length === 0) return;
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allAldiProducts = [];
  const categoriesToScrape = categoryFilter
    ? ALDI_CATEGORIES.filter(c => c.dbCat === categoryFilter)
    : ALDI_CATEGORIES;
  
  for (const cat of categoriesToScrape) {
    try {
      console.log(`  Scraping ${cat.name}...`);
      const products = await scrapeAldiCategory(page, cat);
      console.log(`    → ${products.length} products`);
      allAldiProducts = allAldiProducts.concat(products);
    } catch (e) {
      console.error(`  Error scraping ${cat.name}: ${e.message}`);
    }
  }
  await browser.close();
  
  console.log(`\nScraped ${allAldiProducts.length} Aldi products`);
  console.log('Matching and updating prices...\n');
  
  let updated = 0;
  for (const sp of filtered) {
    const spName = (sp.store_product_name || sp.store_sku || '').toLowerCase();
    
    // Direct name match first
    let match = allAldiProducts.find(ap => ap.fullName.toLowerCase() === spName);
    
    // Fuzzy fallback
    if (!match) {
      const result = fuzzyMatch(spName, allAldiProducts.map(p => ({ ...p, canonical_name: p.fullName })));
      if (result && result.score >= 0.6) match = result.product;
    }
    
    if (match) {
      const { error } = await supabase.from('price_observations').insert({
        store_product_id: sp.id,
        price: match.price,
        was_price: match.wasPrice,
        on_promotion: match.onPromotion,
        price_per_unit: match.pricePerUnit,
        unit_for_comparison: match.unitForComparison ? `per ${match.unitForComparison}` : null,
        observed_at: new Date().toISOString(),
      });
      if (!error) {
        updated++;
        console.log(`  ✓ ${sp.products?.canonical_name} → €${match.price}${match.onPromotion ? ' (on offer)' : ''}`);
      }
    }
  }
  
  console.log(`\n=== Updated ${updated}/${filtered.length} prices ===`);
}

async function main() {
  const args = process.argv.slice(2);
  const resolve = args.includes('--resolve');
  const refresh = args.includes('--refresh');
  const catIdx = args.indexOf('--category');
  const categoryFilter = catIdx >= 0 ? args[catIdx + 1] : null;
  
  if (!resolve && !refresh) {
    console.log('Usage: node aldi_scraper.js [--resolve] [--refresh] [--category "Dairy"]');
    console.log('  --resolve  Find and match Aldi products to our catalogue');
    console.log('  --refresh  Update prices for already-matched products');
    process.exit(0);
  }
  
  if (resolve) await resolveMode(categoryFilter);
  if (refresh) await refreshMode(categoryFilter);
}

main().catch(e => { console.error(e); process.exit(1); });
