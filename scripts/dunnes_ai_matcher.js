#!/usr/bin/env node
/**
 * Dunnes AI-Assisted Product Matcher
 * 
 * Takes failed Dunnes store_products and uses:
 * 1. Multiple search strategies (full name, brand+product, generic terms)
 * 2. AI (Claude Haiku) to confirm whether search results match the canonical product
 * 3. Updates store_products with resolved URLs + prices on match
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/dunnes_ai_matcher.js [--limit 50] [--category Dairy] [--dry-run]
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const STORE_ID = 258;
const GATEWAY_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

if (!SUPABASE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// CLI args
// ============================================================
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 50;
const catIdx = args.indexOf('--category');
const CATEGORY = catIdx >= 0 ? args[catIdx + 1] : null;

// ============================================================
// Dunnes search via Instacart Storefront API
// ============================================================

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

let browserContext = null;
let browserPage = null;

async function initBrowser() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-IE,en;q=0.9' }
  });
  const page = await context.newPage();
  
  // Load homepage for CF clearance
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  browserContext = context;
  browserPage = page;
  return { browser, context, page };
}

async function searchDunnes(query, take = 10) {
  const url = `${GATEWAY_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(query)}&take=${take}&page=1&skip=0`;

  const result = await browserPage.evaluate(async ({ url, correlationId, siteUrl }) => {
    const resp = await fetch(url, {
      headers: {
        'x-site-host': siteUrl,
        'x-site-location': 'HeadersBuilderInterceptor',
        'x-correlation-id': correlationId,
        'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
        'Accept': 'application/json, text/plain, */*',
      },
      credentials: 'include'
    });
    const data = await resp.json();
    return { status: resp.status, data };
  }, { url, correlationId: generateUUID(), siteUrl: SITE_URL });

  if (!result.data || !result.data.items || result.data.items.length === 0) {
    return [];
  }

  return result.data.items.map(item => {
    const activeTpr = (item.tprPrice || []).find(t => t.active === true);
    const wasPriceNumeric = item.wasPriceNumeric || item.wasWholePrice || null;
    const wasPrice = wasPriceNumeric && wasPriceNumeric > (item.priceNumeric || 0) ? wasPriceNumeric : null;
    const onPromotion = !!(activeTpr || wasPrice);

    return {
      sku: item.sku,
      name: item.name,
      brand: item.brand || '',
      price: item.price,
      priceNumeric: item.priceNumeric,
      pricePerUnit: item.pricePerUnit || '',
      available: item.available,
      onPromotion,
      wasPrice,
      url: `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent((item.name || '').toLowerCase().replace(/\s+/g, '-'))}/${item.sku}`,
    };
  });
}

// ============================================================
// Generate search queries — multiple strategies
// ============================================================

function generateSearchQueries(canonicalName, brand) {
  const queries = [];
  
  // Strategy 1: Full canonical name
  queries.push(canonicalName);
  
  // Strategy 2: Remove brand from name if it's at the start (Dunnes might have own-brand version)
  if (brand && canonicalName.toLowerCase().startsWith(brand.toLowerCase())) {
    const withoutBrand = canonicalName.slice(brand.length).trim();
    if (withoutBrand.length > 3) queries.push(withoutBrand);
  }
  
  // Strategy 3: Strip size/weight info for broader match
  const noSize = canonicalName
    .replace(/\d+\s*(ml|l|g|kg|cl|oz|pk|pack|pck|sheets|rolls|capsules|tablets|wipes)\b/gi, '')
    .replace(/\d+\s*x\s*\d+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (noSize !== canonicalName && noSize.length > 3) queries.push(noSize);
  
  // Strategy 4: Just brand + core product type (e.g. "Brady Family Ham")
  if (brand) {
    const coreWords = canonicalName
      .replace(new RegExp(brand, 'i'), '')
      .replace(/\d+\s*(ml|l|g|kg|cl|oz|pk|pack|pck)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 3)
      .join(' ');
    if (coreWords.length > 2) queries.push(`${brand} ${coreWords}`);
  }

  // Deduplicate
  return [...new Set(queries)];
}

// ============================================================
// AI matching — Claude Haiku confirms match
// ============================================================

async function askAIMatch(canonicalName, category, candidates) {
  const candidateList = candidates.map((c, i) => 
    `${i + 1}. "${c.name}" by ${c.brand || 'unknown brand'} — ${c.price} (${c.available ? 'available' : 'unavailable'})`
  ).join('\n');

  const prompt = `You are matching grocery products across stores. Given a canonical product name, determine which (if any) of the search results from Dunnes Stores is the SAME product.

CANONICAL PRODUCT: "${canonicalName}"
CATEGORY: ${category}

DUNNES SEARCH RESULTS:
${candidateList}

Rules:
- Match must be the SAME product (same brand if branded, same size/weight, same variant)
- Own-brand equivalents are NOT matches (e.g. "Tesco Milk 2L" ≠ "Dunnes Milk 2L")
- Generic/unbranded products CAN match if category, size, and type are identical
- Size/weight must match (500ml ≠ 1L, 4-pack ≠ 6-pack)
- If the canonical name has no brand, it's likely an own-brand product — match to Dunnes own-brand equivalent if size matches

Respond with ONLY a JSON object: {"match": <number 1-${candidates.length}>, "confidence": <0.0-1.0>} or {"match": null, "reason": "<brief reason>"}`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            resolve({ match: null, reason: `API error: ${parsed.error.message}` });
            return;
          }
          const text = parsed.content?.[0]?.text || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve({ match: null, reason: 'Could not parse AI response' });
          }
        } catch (e) {
          resolve({ match: null, reason: `Parse error: ${e.message}` });
        }
      });
    });
    req.on('error', (e) => resolve({ match: null, reason: `Request error: ${e.message}` }));
    req.write(body);
    req.end();
  });
}

// ============================================================
// Main pipeline
// ============================================================

async function main() {
  console.log('=== DUNNES AI-ASSISTED MATCHER ===');
  console.log(`Options: limit=${LIMIT}, category=${CATEGORY || 'all'}, dry-run=${DRY_RUN}\n`);

  // Fetch failed Dunnes store_products
  let query = supabase
    .from('store_products')
    .select('id, product_id, store_product_name, brand, products(canonical_name, category)')
    .eq('store', 'dunnes')
    .eq('url_status', 'failed')
    .limit(LIMIT);

  if (CATEGORY) {
    // Filter by category via inner join
    const { data: catProducts } = await supabase
      .from('products')
      .select('id')
      .eq('category', CATEGORY);
    if (catProducts && catProducts.length > 0) {
      query = query.in('product_id', catProducts.map(p => p.id));
    }
  }

  const { data: failedProducts, error: dbErr } = await query;
  if (dbErr) { console.error('DB error:', dbErr); process.exit(1); }
  
  console.log(`Found ${failedProducts.length} failed Dunnes products to retry\n`);
  if (failedProducts.length === 0) return;

  // Init browser
  const { browser } = await initBrowser();
  console.log('Browser ready, CF clearance obtained\n');

  let matched = 0, noMatch = 0, errors = 0;
  const results = [];

  for (let i = 0; i < failedProducts.length; i++) {
    const sp = failedProducts[i];
    const canonicalName = sp.products?.canonical_name || sp.store_product_name;
    const category = sp.products?.category || 'unknown';
    const brand = sp.brand || '';

    process.stdout.write(`[${i + 1}/${failedProducts.length}] "${canonicalName}" ... `);

    try {
      // Generate multiple search queries
      const queries = generateSearchQueries(canonicalName, brand);
      let allCandidates = [];

      // Try each query, collect unique results
      const seenSkus = new Set();
      for (const q of queries) {
        const results = await searchDunnes(q, 5);
        if (results.length > 0 && DRY_RUN) {
          console.log(`\n    Query "${q}" → ${results.length} results: ${results.slice(0,3).map(r=>r.name).join(', ')}`);
        }
        for (const r of results) {
          if (!seenSkus.has(r.sku)) {
            seenSkus.add(r.sku);
            allCandidates.push(r);
          }
        }
        await new Promise(r => setTimeout(r, 500)); // Rate limit
      }

      if (allCandidates.length === 0) {
        console.log('❌ No search results');
        noMatch++;
        results.push({ id: sp.id, name: canonicalName, status: 'no_results' });
        continue;
      }

      // Ask AI to confirm match
      const aiResult = await askAIMatch(canonicalName, category, allCandidates.slice(0, 8));

      if (aiResult.match && aiResult.confidence >= 0.7) {
        const matchedProduct = allCandidates[aiResult.match - 1];
        console.log(`✅ → "${matchedProduct.name}" (conf: ${aiResult.confidence})`);
        matched++;

        if (!DRY_RUN) {
          // Update store_product with resolved URL + price
          const { error: updateErr } = await supabase
            .from('store_products')
            .update({
              url_status: 'resolved',
              store_url: matchedProduct.url,
              store_sku: String(matchedProduct.sku),
              store_product_name: matchedProduct.name,
              brand: matchedProduct.brand || brand,
            })
            .eq('id', sp.id);

          if (updateErr) {
            console.log(`    ⚠ DB update error: ${updateErr.message}`);
          }

          // Insert price observation
          if (matchedProduct.priceNumeric && matchedProduct.priceNumeric > 0) {
            const priceRow = {
              store_product_id: sp.id,
              price: matchedProduct.priceNumeric,
              was_price: matchedProduct.wasPrice || null,
              on_promotion: matchedProduct.onPromotion || false,
            };
            // Add unit price if available (e.g. "€2.00/l")
            if (matchedProduct.pricePerUnit) {
              const unitMatch = matchedProduct.pricePerUnit.match(/€?([\d.]+)\s*\/?\s*(\w+)/);
              if (unitMatch) {
                priceRow.price_per_unit = parseFloat(unitMatch[1]);
                priceRow.unit_for_comparison = unitMatch[2];
              }
            }
            const { error: priceErr } = await supabase
              .from('price_observations')
              .insert(priceRow);
            if (priceErr) {
              console.log(`    ⚠ Price insert error: ${priceErr.message}`);
            }
          }
        }

        results.push({ id: sp.id, name: canonicalName, status: 'matched', matchedTo: matchedProduct.name, confidence: aiResult.confidence });
      } else {
        const reason = aiResult.reason || `low confidence (${aiResult.confidence})`;
        console.log(`❌ No match: ${reason}`);
        noMatch++;
        results.push({ id: sp.id, name: canonicalName, status: 'no_match', reason });
      }

    } catch (err) {
      console.log(`⚠ Error: ${err.message}`);
      errors++;
      results.push({ id: sp.id, name: canonicalName, status: 'error', error: err.message });
    }

    // Rate limit between products
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${failedProducts.length}`);
  console.log(`✅ Matched: ${matched}`);
  console.log(`❌ No match: ${noMatch}`);
  console.log(`⚠  Errors: ${errors}`);
  console.log(`Match rate: ${((matched / failedProducts.length) * 100).toFixed(1)}%`);
  if (DRY_RUN) console.log('\n⚠ DRY RUN — no DB changes made');

  // Save results to file
  const outPath = `/tmp/dunnes_ai_match_${new Date().toISOString().slice(0, 10)}.json`;
  require('fs').writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
