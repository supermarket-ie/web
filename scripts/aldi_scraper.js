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

// Aldi own brands — used for brand stripping in matching
const ALDI_OWN_BRANDS = [
  "nature's pick", 'butchers selection', 'specially selected', 'kilkeely gold',
  'clonbawn', 'harvest morn', 'village bakery', 'skellig bay', 'actileaf',
  'brannans', 'moser roth', 'alcafe', 'brooklea', 'lacura', 'mamia',
  'almat', 'magnum', 'earths choice', 'cowbelle', 'dermot & daisy',
  "healy's farm", 'oakhurst', 'ardagh', 'emporium', 'cleaver and blade',
  'ballymore crust', 'organic',
];

async function scrapeAldiCategory(page, category) {
  const products = [];
  let pageNum = 1;
  
  while (true) {
    const url = pageNum === 1 ? category.url : `${category.url}?page=${pageNum}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // Allow product tiles to render
    
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

/**
 * Strip Aldi brand prefix to get a generic product name for matching.
 * E.g. "NATURE'S PICK Brown Onions" → "Brown Onions"
 */
function stripBrand(fullName) {
  let name = fullName;
  for (const brand of ALDI_OWN_BRANDS) {
    const escaped = brand.replace(/[.*+?${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped + '\\s*', 'i');
    if (re.test(name)) {
      name = name.replace(re, '').trim();
      return name || fullName;
    }
  }
  // Also try removing all-caps prefix (generic brand pattern: "BRAND NAME Product")
  const capsStripped = fullName.replace(/^[A-Z][A-Z'\s]+\s+/, '').trim();
  if (capsStripped && capsStripped !== fullName && capsStripped.length > 3) {
    return capsStripped;
  }
  return fullName;
}

/**
 * Clean a product name into a suitable canonical name.
 * Removes "Irish" qualifier, excessive size info, etc.
 */
function toCanonicalName(aldiFullName) {
  let name = stripBrand(aldiFullName);
  // Remove "Irish " prefix (too specific for canonical)
  name = name.replace(/^Irish\s+/i, '');
  // Keep size/pack info as it's useful for matching
  return name.trim();
}

async function resolveMode(categoryFilter) {
  console.log('=== ALDI RESOLVE MODE ===');
  console.log('Finding matching products for our catalogue...\n');
  
  // Get ALL canonical products (paginate past 1000 limit)
  let products = [];
  let from = 0;
  while (true) {
    let q = supabase.from('products').select('id, canonical_name, category').range(from, from + 999);
    if (categoryFilter) q = q.eq('category', categoryFilter);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    products = products.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Canonical products to match against: ${products.length}`);
  
  // Get existing Aldi store_products
  const { data: existing } = await supabase
    .from('store_products')
    .select('product_id, store_product_name')
    .eq('store', 'aldi')
    .in('url_status', ['resolved', 'pending']);
  const existingIds = new Set((existing || []).map(e => e.product_id));
  const existingNames = new Set((existing || []).map(e => e.store_product_name?.toLowerCase()));
  
  console.log(`Already in DB: ${existingIds.size}\n`);
  
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
      const catProducts = await scrapeAldiCategory(page, cat);
      console.log(`    → ${catProducts.length} products`);
      allAldiProducts = allAldiProducts.concat(catProducts);
    } catch (e) {
      console.error(`  Error scraping ${cat.name}: ${e.message}`);
    }
  }
  await browser.close();
  
  // Dedupe Aldi products by name
  const seen = new Set();
  const uniqueAldi = allAldiProducts.filter(p => {
    const key = p.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`\nTotal scraped: ${allAldiProducts.length}, unique: ${uniqueAldi.length}`);
  
  // Filter out items already in DB
  const toProcess = uniqueAldi.filter(p => !existingNames.has(p.fullName.toLowerCase()));
  console.log(`New items to process: ${toProcess.length}\n`);
  
  let matched = 0;
  let created = 0;
  let newCanonicals = 0;
  
  for (const aldi of toProcess) {
    // Try matching with brand stripped first, then with full name
    const stripped = stripBrand(aldi.fullName);
    const matchStripped = fuzzyMatch(stripped, products);
    const matchFull = fuzzyMatch(aldi.fullName, products);
    
    // Pick best match
    let best = null;
    if (matchStripped && matchFull) {
      best = matchStripped.score >= matchFull.score ? matchStripped : matchFull;
    } else {
      best = matchStripped || matchFull;
    }
    
    let productId;
    
    if (best && best.score >= 0.6) {
      // Matched to existing canonical product
      productId = best.product.id;
      
      // Skip if this canonical already has an Aldi entry
      if (existingIds.has(productId)) continue;
      
      console.log(`  ✓ ${aldi.fullName} → ${best.product.canonical_name} (score ${best.score.toFixed(2)})`);
      matched++;
    } else {
      // No match — create a new canonical product
      const canonicalName = toCanonicalName(aldi.fullName);
      const { data: newProduct, error: insertErr } = await supabase
        .from('products')
        .insert({
          canonical_name: canonicalName,
          category: aldi.dbCat,
        })
        .select('id')
        .single();
      
      if (insertErr) {
        // Might be duplicate — try to find existing
        const { data: existingProduct } = await supabase
          .from('products')
          .select('id')
          .eq('canonical_name', canonicalName)
          .single();
        if (existingProduct) {
          productId = existingProduct.id;
        } else {
          console.log(`  ⚠ Failed to create canonical: ${canonicalName} — ${insertErr.message}`);
          continue;
        }
      } else {
        productId = newProduct.id;
        newCanonicals++;
        // Add to local array so future iterations can match against it
        products.push({ id: productId, canonical_name: canonicalName, category: aldi.dbCat });
      }
      
      if (existingIds.has(productId)) continue;
      console.log(`  + ${aldi.fullName} → NEW: "${canonicalName}" [${aldi.dbCat}]`);
    }
    
    // Insert store_product + price observation
    const isOwnBrand = ALDI_OWN_BRANDS.some(b => (aldi.brand || '').toLowerCase().includes(b));
    
    const { error: spErr } = await supabase
      .from('store_products')
      .insert({
        product_id: productId,
        store: 'aldi',
        store_product_name: aldi.fullName,
        brand: aldi.brand || null,
        is_own_brand: isOwnBrand,
        store_url: aldi.url || 'https://www.aldi.ie',
        url_status: 'resolved',
        store_sku: aldi.fullName,
      });
    
    if (spErr) {
      console.log(`    ⚠ store_product insert error: ${spErr.message}`);
      continue;
    }
    
    created++;
    existingIds.add(productId);
    existingNames.add(aldi.fullName.toLowerCase());
    
    // Get the store_product ID for price observation
    const { data: sp } = await supabase
      .from('store_products')
      .select('id')
      .eq('product_id', productId)
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
  
  console.log(`\n=== Results: ${matched} matched existing, ${newCanonicals} new canonicals created, ${created} store_products added ===`);
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
  
  // Build a lookup map by lowercase fullName for fast exact matching
  const aldiByName = new Map();
  for (const ap of allAldiProducts) {
    aldiByName.set(ap.fullName.toLowerCase(), ap);
  }
  // Also build by stripped name for fallback
  const aldiByStripped = new Map();
  for (const ap of allAldiProducts) {
    const stripped = stripBrand(ap.fullName).toLowerCase();
    if (!aldiByStripped.has(stripped)) {
      aldiByStripped.set(stripped, ap);
    }
  }
  
  let updated = 0;
  let notFound = 0;
  
  for (const sp of filtered) {
    const spName = (sp.store_product_name || sp.store_sku || '');
    const spNameLower = spName.toLowerCase();
    
    // 1. Exact name match (fastest)
    let match = aldiByName.get(spNameLower);
    
    // 2. Try matching by stripped canonical name
    if (!match) {
      const canonName = (sp.products?.canonical_name || '').toLowerCase();
      match = aldiByStripped.get(canonName);
    }
    
    // 3. Fuzzy fallback against all Aldi products
    if (!match) {
      const stripped = stripBrand(spName).toLowerCase();
      // Try stripped name in map
      match = aldiByStripped.get(stripped);
    }
    
    if (!match) {
      // Full fuzzy match as last resort
      const candidates = allAldiProducts.map(p => ({ ...p, canonical_name: p.fullName }));
      const result = fuzzyMatch(spName, candidates);
      if (result && result.score >= 0.6) match = result.product;
      
      if (!match) {
        // Try with stripped brand
        const stripped = stripBrand(spName);
        const result2 = fuzzyMatch(stripped, candidates);
        if (result2 && result2.score >= 0.6) match = result2.product;
      }
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
        console.log(`  ✓ ${sp.products?.canonical_name || spName} → €${match.price}${match.onPromotion ? ' (on offer)' : ''}`);
      }
    } else {
      notFound++;
      if (notFound <= 10) {
        console.log(`  ✗ ${sp.products?.canonical_name || spName} → not found on Aldi site`);
      }
    }
  }
  
  if (notFound > 10) console.log(`  ... and ${notFound - 10} more not found`);
  console.log(`\n=== Updated ${updated}/${filtered.length} prices, ${notFound} not found ===`);
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
