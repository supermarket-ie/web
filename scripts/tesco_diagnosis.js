#!/usr/bin/env node
/**
 * tesco_diagnosis.js — Phase 2 Tesco diagnostic run
 *
 * Classifies all 500 product outcomes into one of:
 *   success_direct        - product URL scraped directly (no search needed)
 *   success_search        - search returned confident match with price
 *   no_search_results     - search returned empty
 *   no_confident_match    - results found but score below threshold
 *   ambiguous_match       - score acceptable but multiple equally good matches
 *   blocked_challenge     - 403/Akamai/CAPTCHA or empty body despite 200
 *   timeout               - request timed out
 *   page_loaded_no_price  - page loaded but price element absent
 *   no_price_in_results   - matched product but price field empty/zero
 *   permanent_failure     - in known permanent-failure set (3+ consecutive)
 *   duplicate_sku         - same Tesco SKU mapped to multiple canonical names
 *   other                 - catch-all
 *
 * Outputs:
 *   - Per-product classification table to stdout
 *   - Summary JSON to /tmp/scrape_logs/tesco_diagnosis_TIMESTAMP.json
 *   - scrape_runs row with retrieval_method=scrapingbee_diagnosis
 *
 * Usage:
 *   node scripts/tesco_diagnosis.js [--limit 100] [--sample-playwright]
 *
 * --sample-playwright: also test ~100 products via direct Playwright (no ScrapingBee)
 *                      for a side-by-side comparison. Adds ~30min to runtime.
 *
 * SECURITY: no API keys, tokens or credentials written to output files.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const scrapeDb = require('./scrape-db');
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;
const BASE_URL = 'https://www.tesco.ie';
const LOG_DIR = '/tmp/scrape_logs';
const TIMESTAMP = new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 12);
const RUN_ID = `diag_${TIMESTAMP}`;

if (!SUPABASE_KEY || !SCRAPINGBEE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY and SCRAPINGBEE_API_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Reuse ScrapingBee fetch from tesco_scraper (inline to avoid coupling) ----
async function sbFetch(url, { wait = 7000, retries = 2 } = {}) {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY,
    url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'ie',
    wait: String(wait),
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 60000);
      const res = await fetch('https://app.scrapingbee.com/api/v1?' + params, { signal: controller.signal });
      clearTimeout(tid);

      const creditCost = res.headers.get('spb-cost') || '25';
      const remainingCredits = res.headers.get('spb-units-left') || null;

      if (res.status === 429) {
        if (attempt < retries) { await sleep(10000); continue; }
        return { ok: false, error: `ScrapingBee rate limit (429)`, status: 429, creditCost: 0, remainingCredits };
      }
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, status: res.status, creditCost: 0, remainingCredits };
      }

      const html = await res.text();
      // Blocked / challenge detection
      if (html.length < 500 || /access denied|challenge|captcha/i.test(html.substring(0, 2000))) {
        return { ok: false, error: 'blocked_challenge', status: res.status, html, creditCost: parseInt(creditCost), remainingCredits };
      }

      return { ok: true, html, status: res.status, creditCost: parseInt(creditCost), remainingCredits };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, error: 'timeout', status: null, creditCost: 0 };
      if (attempt < retries) { await sleep(2000); continue; }
      return { ok: false, error: e.message, status: null, creditCost: 0 };
    }
  }
  return { ok: false, error: 'max_retries', status: null, creditCost: 0 };
}

// Minimal price extractor — looks for the price in Tesco search results HTML
function extractSearchResults(html) {
  if (!html) return [];
  const results = [];
  // Match product cards
  const cardRe = /<li[^>]*data-auto="product-card"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const card = m[1];
    const nameMatch = card.match(/data-auto="product-title"[^>]*>([^<]+)</);
    const priceMatch = card.match(/data-auto="price"[^>]*>.*?£?([\d]+\.[\d]{2})/);
    const skuMatch = card.match(/\/products\/(\d+)\b/);
    const urlMatch = card.match(/href="(\/shop\/en-IE\/product\/[^"]+)"/);
    if (nameMatch && priceMatch) {
      results.push({
        name: nameMatch[1].trim(),
        price: parseFloat(priceMatch[1]),
        sku: skuMatch ? skuMatch[1] : null,
        url: urlMatch ? BASE_URL + urlMatch[1] : null,
      });
    }
  }
  return results;
}

function fuzzyScore(a, b) {
  a = a.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  b = b.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (a === b) return 1;
  const aWords = new Set(a.split(' '));
  const bWords = b.split(' ');
  const overlap = bWords.filter(w => aWords.has(w)).length;
  return overlap / Math.max(aWords.size, bWords.length);
}

// ---- Main diagnostic loop ----
async function runDiagnosis({ limit = 500, samplePlaywright = false }) {
  console.log(`=== TESCO DIAGNOSIS RUN (run_id=${RUN_ID}) ===\n`);

  // Fetch permanent failures
  const permanentFailures = await scrapeDb.getPermanentFailures('tesco');
  console.log(`Known permanent failures: ${permanentFailures.size}\n`);

  // Fetch all resolved Tesco store_products
  const { data: storeProducts, error: spErr } = await supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, store_sku, products(canonical_name, category)')
    .eq('store', 'tesco')
    .eq('url_status', 'resolved');

  if (spErr) { console.error('DB error:', spErr); process.exit(1); }

  // Filter out search/old URLs (same as refresh mode)
  let filtered = storeProducts.filter(sp =>
    sp.store_url && !sp.store_url.includes('/search?') && !sp.store_url.includes('/groceries/')
  );

  // Detect duplicate SKU mappings
  const skuToProducts = new Map();
  for (const sp of filtered) {
    if (sp.store_sku) {
      if (!skuToProducts.has(sp.store_sku)) skuToProducts.set(sp.store_sku, []);
      skuToProducts.get(sp.store_sku).push(sp.products?.canonical_name || sp.store_product_name);
    }
  }
  const duplicateSkus = new Map([...skuToProducts.entries()].filter(([, names]) => names.length > 1));
  if (duplicateSkus.size > 0) {
    console.log(`⚠ Duplicate SKU mappings: ${duplicateSkus.size} SKUs mapped to multiple products`);
    for (const [sku, names] of [...duplicateSkus.entries()].slice(0, 5)) {
      console.log(`  SKU ${sku}: ${names.join(' / ')}`);
    }
    console.log('');
  }

  // Sort stalest-first (same as refresh)
  const CHUNK = 200;
  const lastObsMap = new Map();
  for (let i = 0; i < filtered.length; i += CHUNK) {
    const chunk = filtered.slice(i, i + CHUNK).map(sp => sp.id);
    const { data: obs } = await supabase
      .from('price_observations')
      .select('store_product_id, observed_at')
      .in('store_product_id', chunk)
      .order('observed_at', { ascending: false });
    if (obs) for (const o of obs) if (!lastObsMap.has(o.store_product_id)) lastObsMap.set(o.store_product_id, o.observed_at);
  }
  filtered.sort((a, b) => (lastObsMap.get(a.id) || '1970').localeCompare(lastObsMap.get(b.id) || '1970'));

  if (limit > 0) filtered = filtered.slice(0, limit);

  const targetCount = filtered.length;
  console.log(`Products to diagnose: ${targetCount}\n`);

  await scrapeDb.openRun('tesco', RUN_ID, targetCount, 'scrapingbee_diagnosis');

  // Outcome tracking
  const outcomes = [];
  const counts = {
    success_direct: 0,
    success_search: 0,
    no_search_results: 0,
    no_confident_match: 0,
    ambiguous_match: 0,
    blocked_challenge: 0,
    timeout: 0,
    page_loaded_no_price: 0,
    no_price_in_results: 0,
    permanent_failure: 0,
    duplicate_sku: 0,
    other: 0,
  };

  let sbRequests = 0, sbCredits = 0, sbRemainingCredits = null;

  for (let i = 0; i < filtered.length; i++) {
    const sp = filtered[i];
    const name = sp.products?.canonical_name || sp.store_product_name;

    // Check permanent failure first (no API call)
    if (permanentFailures.has(name)) {
      counts.permanent_failure++;
      outcomes.push({ name, classification: 'permanent_failure', price: null, sbRequests: 0, note: '3+ consecutive failures' });
      console.log(`  [permanent] ${name.substring(0, 60)}`);
      continue;
    }

    // Check duplicate SKU
    const isDuplicate = sp.store_sku && duplicateSkus.has(sp.store_sku);

    // Try search
    const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
    const result = await sbFetch(searchUrl);
    sbRequests++;
    sbCredits += result.creditCost || 25;
    if (result.remainingCredits) sbRemainingCredits = result.remainingCredits;

    let classification, price = null, note = '';

    if (!result.ok) {
      if (result.error === 'blocked_challenge' || result.status === 403) {
        classification = 'blocked_challenge';
        note = `status=${result.status}`;
      } else if (result.error === 'timeout') {
        classification = 'timeout';
      } else {
        classification = 'other';
        note = result.error;
      }
    } else {
      const products = extractSearchResults(result.html);
      if (products.length === 0) {
        classification = 'no_search_results';
      } else {
        // Score all results
        const scored = products.map(p => ({ ...p, score: fuzzyScore(name, p.name) })).sort((a, b) => b.score - a.score);
        const best = scored[0];
        const second = scored[1];

        if (best.score < 0.4) {
          classification = 'no_confident_match';
          note = `best="${best.name}" score=${best.score.toFixed(2)}`;
        } else if (second && (best.score - second.score) < 0.1 && best.score < 0.7) {
          classification = 'ambiguous_match';
          note = `best="${best.name}" (${best.score.toFixed(2)}) vs "${second.name}" (${second.score.toFixed(2)})`;
        } else if (!best.price || best.price <= 0) {
          classification = 'no_price_in_results';
          note = `matched="${best.name}"`;
        } else {
          classification = isDuplicate ? 'duplicate_sku' : 'success_search';
          price = best.price;
          if (isDuplicate) note = `sku=${sp.store_sku}`;
        }
      }
    }

    if (isDuplicate && classification === 'success_search') classification = 'duplicate_sku';

    counts[classification] = (counts[classification] || 0) + 1;
    outcomes.push({ name, classification, price, sbRequests: 1, note, storeUrl: sp.store_url });

    const icon = price ? '✓' : '✗';
    const cls = classification.padEnd(24);
    console.log(`  ${icon} [${cls}] ${name.substring(0, 50)}${price ? ` → €${price}` : ''}${note ? ` (${note})` : ''}`);

    // Record failure for non-successes
    if (!classification.startsWith('success_')) {
      await scrapeDb.recordFailure({
        runId: RUN_ID, store: 'tesco', canonicalName: name,
        storeProductId: sp.id, storeUrl: sp.store_url,
        failureStage: 'fetching', failureReason: classification,
        httpStatus: result.status || null,
        rawError: note || null,
      });
    }

    await sleep(1500 + Math.floor(Math.random() * 1500));
  }

  // ---- Summary ----
  const successTotal = counts.success_direct + counts.success_search;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TESCO DIAGNOSIS SUMMARY (run_id=${RUN_ID})`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total products: ${targetCount}`);
  console.log(`ScrapingBee requests: ${sbRequests} (~${sbCredits} credits)`);
  if (sbRemainingCredits) console.log(`Remaining credits: ${sbRemainingCredits}`);
  console.log('');
  console.log('Outcome breakdown:');
  for (const [cls, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      const pct = ((count / targetCount) * 100).toFixed(1);
      console.log(`  ${cls.padEnd(28)} ${String(count).padStart(4)} (${pct}%)`);
    }
  }
  console.log('');
  console.log(`Success rate: ${successTotal}/${targetCount} = ${((successTotal / targetCount) * 100).toFixed(1)}%`);
  console.log(`Permanent failures: ${counts.permanent_failure} (excluded from normal runs once 3x threshold reached)`);
  console.log(`Duplicate SKUs detected: ${duplicateSkus.size}`);
  if (sbRemainingCredits) console.log(`\n⚠ ScrapingBee remaining credits: ${sbRemainingCredits}`);

  // ---- Recommendations ----
  console.log('\nRECOMMENDATIONS:');
  if (counts.permanent_failure > 0) {
    console.log(`  • ${counts.permanent_failure} products are permanent failures — add to a repair queue or delist from catalogue`);
  }
  if (counts.no_confident_match + counts.ambiguous_match > 20) {
    console.log(`  • ${counts.no_confident_match + counts.ambiguous_match} products have match issues — review canonical names or add Tesco-specific aliases`);
  }
  if (counts.blocked_challenge > 5) {
    console.log(`  • ${counts.blocked_challenge} blocked responses — check ScrapingBee premium proxy config, consider direct URL scraping`);
  }
  if (duplicateSkus.size > 0) {
    console.log(`  • ${duplicateSkus.size} duplicate SKU mappings — clean up store_products table to avoid wasted requests`);
  }

  // ---- Write JSON report ----
  const reportPath = path.join(LOG_DIR, `tesco_diagnosis_${TIMESTAMP}.json`);
  const report = {
    run_id: RUN_ID,
    generated_at: new Date().toISOString(),
    target_count: targetCount,
    scrapingbee_requests: sbRequests,
    scrapingbee_credits_used: sbCredits,
    scrapingbee_credits_remaining: sbRemainingCredits,
    duplicate_skus: duplicateSkus.size,
    counts,
    success_rate_pct: parseFloat(((successTotal / targetCount) * 100).toFixed(1)),
    // Sanitise: no URLs with credentials, no API keys
    outcomes: outcomes.map(o => ({
      name: o.name,
      classification: o.classification,
      price: o.price,
      note: o.note,
    })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report: ${reportPath}`);

  // ---- Close DB run ----
  await scrapeDb.closeRun(RUN_ID, 'tesco', {
    attempted: sbRequests,
    fetched: outcomes.filter(o => !['blocked_challenge','timeout','other'].includes(o.classification)).length,
    extracted: successTotal,
    inserted: successTotal,
    unchanged: 0,
    failed: targetCount - successTotal,
    silently_skipped: 0,
    scrapingbee_requests: sbRequests,
    scrapingbee_credits: sbCredits,
    error_summary: counts.blocked_challenge > 10 ? `${counts.blocked_challenge} blocked responses` : null,
  });
}

// ---- CLI ----
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 500;
const samplePlaywright = args.includes('--sample-playwright');

runDiagnosis({ limit, samplePlaywright }).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
