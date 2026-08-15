#!/usr/bin/env node
/**
 * tesco_diagnosis.js — Phase 2 Tesco diagnostic run
 *
 * Classifies all (up to --limit) products into one of:
 *   success_direct        - product URL scraped directly without a search (no search)
 *   success_search        - search returned a confident match with price
 *   no_search_results     - search returned empty
 *   no_confident_match    - results found but best score below threshold
 *   ambiguous_match       - two close matches, cannot confidently pick one
 *   blocked_challenge     - 403 / Akamai / CAPTCHA / empty body on 200
 *   timeout               - request timed out
 *   page_loaded_no_price  - direct product page loaded but price element absent
 *   no_price_in_results   - search matched a product but price field empty/zero
 *   permanent_failure     - excluded: store_product_id in known permanent-failure set
 *   duplicate_sku         - same Tesco SKU maps to multiple canonical products
 *   other                 - catch-all
 *
 * This script is DIAGNOSTIC ONLY:
 *   - It does NOT insert price_observations rows.
 *   - It does NOT record scrape_failures rows (would pollute consecutive-failure counts).
 *   - It writes one scrape_runs row with retrieval_method='scrapingbee_diagnosis'.
 *   - It writes a JSON report to /tmp/scrape_logs/tesco_diagnosis_TIMESTAMP.json.
 *
 * Direct URL vs. search:
 *   If a resolved product has a known direct product URL (not a /search? URL),
 *   it is attempted first via ScrapingBee. Only products without a direct URL
 *   fall back to search.
 *
 * ScrapingBee credit cost:
 *   Credits are read from the Spb-Cost response header and accumulated across
 *   all attempts including retries. The report shows actual credits consumed.
 *
 * Usage:
 *   node scripts/tesco_diagnosis.js [--limit 500]
 *
 * Requires:
 *   .env.local with SUPABASE_SERVICE_ROLE_KEY and SCRAPINGBEE_API_KEY
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

// ---- ScrapingBee fetch (credits accumulated across retries) ----
async function sbFetch(url, { wait = 7000, retries = 2 } = {}) {
  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_KEY,
    url,
    render_js: 'true',
    premium_proxy: 'true',
    country_code: 'ie',
    wait: String(wait),
  });

  let totalCredits = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 60000);
      const res = await fetch('https://app.scrapingbee.com/api/v1?' + params, { signal: controller.signal });
      clearTimeout(tid);

      const attemptCost = parseInt(res.headers.get('Spb-Cost') || '25', 10);
      totalCredits += isNaN(attemptCost) ? 25 : attemptCost;

      if (res.status === 429) {
        if (attempt < retries) { await sleep(10000); continue; }
        return { ok: false, error: 'rate_limited_429', status: 429, creditCost: totalCredits };
      }
      if (!res.ok) {
        if (attempt < retries) { await sleep(3000); continue; }
        return { ok: false, error: `http_${res.status}`, status: res.status, creditCost: totalCredits };
      }

      const html = await res.text();
      if (html.length < 500 || /access denied|akamai|captcha|security check/i.test(html.substring(0, 2000))) {
        if (attempt < retries) { await sleep(5000); continue; }
        return { ok: false, error: 'blocked_challenge', status: res.status, creditCost: totalCredits };
      }

      return { ok: true, html, status: 200, creditCost: totalCredits };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, error: 'timeout', status: null, creditCost: totalCredits };
      if (attempt < retries) { await sleep(2000); continue; }
      return { ok: false, error: e.message, status: null, creditCost: totalCredits };
    }
  }
  return { ok: false, error: 'max_retries', status: null, creditCost: totalCredits };
}

// ---- Minimal price extractor for direct product page ----
function extractDirectPrice(html) {
  if (!html) return null;
  // Tesco product page price patterns
  const patterns = [
    /data-auto="price"[^>]*>.*?([\d]+\.[\d]{2})/,
    /"price"\s*:\s*([\d]+\.[\d]{2})/,
    /class="[^"]*price[^"]*"[^>]*>.*?€\s*([\d]+\.[\d]{2})/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// ---- Minimal search result extractor ----
function extractSearchResults(html) {
  if (!html) return [];
  const results = [];
  const cardRe = /<li[^>]*data-auto="product-card"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const card = m[1];
    const nameMatch  = card.match(/data-auto="product-title"[^>]*>([^<]+)</);
    const priceMatch = card.match(/data-auto="price"[^>]*>.*?([\d]+\.[\d]{2})/);
    const skuMatch   = card.match(/\/products\/(\d+)\b/);
    const urlMatch   = card.match(/href="(\/shop\/en-IE\/product\/[^"]+)"/);
    if (nameMatch && priceMatch) {
      results.push({
        name:  nameMatch[1].trim(),
        price: parseFloat(priceMatch[1]),
        sku:   skuMatch ? skuMatch[1] : null,
        url:   urlMatch ? BASE_URL + urlMatch[1] : null,
      });
    }
  }
  return results;
}

function fuzzyScore(a, b) {
  a = a.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  b = b.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (a === b) return 1;
  const aWords = new Set(a.split(' ').filter(Boolean));
  const bWords = b.split(' ').filter(Boolean);
  const overlap = bWords.filter(w => aWords.has(w)).length;
  return overlap / Math.max(aWords.size, bWords.length);
}

// ---- Main ----
async function runDiagnosis({ limit = 500 }) {
  console.log(`=== TESCO DIAGNOSIS (run_id=${RUN_ID}) — diagnostic only, no DB writes ===\n`);

  // Permanent failures (by store_product_id)
  const permanentFailureIds = await scrapeDb.getPermanentFailures('tesco');
  console.log(`Known permanent failures (by store_product_id): ${permanentFailureIds.size}\n`);

  // Fetch all resolved Tesco store_products
  const { data: storeProducts, error: spErr } = await supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, store_sku, products(canonical_name, category)')
    .eq('store', 'tesco')
    .eq('url_status', 'resolved');

  if (spErr) { console.error('DB error:', spErr); process.exit(1); }

  // Filter out old search/legacy URLs
  let filtered = storeProducts.filter(sp =>
    sp.store_url && !sp.store_url.includes('/search?') && !sp.store_url.includes('/groceries/')
  );

  // Detect duplicate SKU mappings (report only — not recorded as scrape failures)
  const skuToProducts = new Map();
  for (const sp of filtered) {
    if (sp.store_sku) {
      if (!skuToProducts.has(sp.store_sku)) skuToProducts.set(sp.store_sku, []);
      skuToProducts.get(sp.store_sku).push({ id: sp.id, name: sp.products?.canonical_name || sp.store_product_name });
    }
  }
  const duplicateSkus = new Map([...skuToProducts.entries()].filter(([, v]) => v.length > 1));
  const duplicateProductIds = new Set();
  for (const products of duplicateSkus.values()) {
    for (const p of products) duplicateProductIds.add(p.id);
  }

  if (duplicateSkus.size > 0) {
    console.log(`⚠ Duplicate SKU mappings: ${duplicateSkus.size} SKUs mapped to multiple products (${duplicateProductIds.size} products affected)`);
    for (const [sku, products] of [...duplicateSkus.entries()].slice(0, 5)) {
      console.log(`  SKU ${sku}: ${products.map(p => p.name).join(' / ')}`);
    }
    console.log('');
  }

  // Sort stalest-first
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

  // Open a diagnostic scrape_runs row (status will be set on close)
  await scrapeDb.openRun('tesco', RUN_ID, targetCount, 'scrapingbee_diagnosis');

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

  const outcomes = [];
  let sbRequests = 0, sbCredits = 0;

  for (let i = 0; i < filtered.length; i++) {
    const sp = filtered[i];
    const name = sp.products?.canonical_name || sp.store_product_name;

    // Pre-classify permanent failures without making any API call
    if (permanentFailureIds.has(sp.id)) {
      counts.permanent_failure++;
      outcomes.push({ name, classification: 'permanent_failure', price: null, apiCalls: 0, note: '3+ consecutive run failures' });
      console.log(`  [permanent       ] ${name.substring(0, 60)}`);
      continue;
    }

    let classification, price = null, note = '', apiCalls = 0;

    // -----------------------------------------------------------------
    // Step 1: Try direct product URL first (if available and not a search URL)
    // A "direct URL" is a product page URL like /shop/en-IE/product/XXXX
    // -----------------------------------------------------------------
    const isDirectUrl = sp.store_url &&
      !sp.store_url.includes('/search?') &&
      sp.store_url.includes('/product/');

    if (isDirectUrl) {
      const result = await sbFetch(sp.store_url);
      sbRequests++;
      sbCredits += result.creditCost;
      apiCalls++;

      if (!result.ok) {
        if (result.error === 'blocked_challenge') {
          classification = 'blocked_challenge';
          note = `direct_url status=${result.status}`;
        } else if (result.error === 'timeout') {
          classification = 'timeout';
          note = 'direct_url';
        } else {
          // Direct URL failed — fall through to search below
          classification = null;
          note = `direct_url_failed:${result.error}`;
        }
      } else {
        const directPrice = extractDirectPrice(result.html);
        if (directPrice && directPrice > 0) {
          // NOTE: diagnostic only — we do NOT insert a price_observation here
          classification = duplicateProductIds.has(sp.id) ? 'duplicate_sku' : 'success_direct';
          price = directPrice;
          note = duplicateProductIds.has(sp.id) ? `sku=${sp.store_sku} (duplicate)` : '';
        } else {
          classification = 'page_loaded_no_price';
          note = 'direct_url loaded but price absent';
        }
      }
    }

    // -----------------------------------------------------------------
    // Step 2: Fall back to search if direct URL unavailable or failed
    // -----------------------------------------------------------------
    if (!classification) {
      const searchUrl = `${BASE_URL}/shop/en-IE/search?query=${encodeURIComponent(name)}`;
      const result = await sbFetch(searchUrl);
      sbRequests++;
      sbCredits += result.creditCost;
      apiCalls++;

      if (!result.ok) {
        if (result.error === 'blocked_challenge') {
          classification = 'blocked_challenge';
          note = `search status=${result.status}`;
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
          const scored = products
            .map(p => ({ ...p, score: fuzzyScore(name, p.name) }))
            .sort((a, b) => b.score - a.score);
          const best   = scored[0];
          const second = scored[1];

          if (best.score < 0.4) {
            classification = 'no_confident_match';
            note = `best="${best.name.substring(0,40)}" score=${best.score.toFixed(2)}`;
          } else if (second && (best.score - second.score) < 0.1 && best.score < 0.7) {
            classification = 'ambiguous_match';
            note = `"${best.name.substring(0,30)}" (${best.score.toFixed(2)}) vs "${second.name.substring(0,30)}" (${second.score.toFixed(2)})`;
          } else if (!best.price || best.price <= 0) {
            classification = 'no_price_in_results';
            note = `matched="${best.name.substring(0,40)}"`;
          } else {
            // NOTE: diagnostic only — no price_observation inserted
            classification = duplicateProductIds.has(sp.id) ? 'duplicate_sku' : 'success_search';
            price = best.price;
            if (duplicateProductIds.has(sp.id)) note = `sku=${sp.store_sku} (duplicate)`;
          }
        }
      }
    }

    counts[classification] = (counts[classification] || 0) + 1;
    outcomes.push({ name, classification, price, apiCalls, note });

    const icon = price ? '✓' : '✗';
    console.log(`  ${icon} [${classification.padEnd(20)}] ${name.substring(0, 50)}${price ? ` → €${price}` : ''}${note ? ` (${note})` : ''}`);

    await sleep(1500 + Math.floor(Math.random() * 1000));
  }

  // ---- Summary ----
  const successTotal = counts.success_direct + counts.success_search;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TESCO DIAGNOSIS SUMMARY — ${new Date().toISOString()}`);
  console.log(`run_id: ${RUN_ID}   target: ${targetCount}   api_calls: ${sbRequests}   credits: ${sbCredits}`);
  console.log(`${'='.repeat(70)}`);
  for (const [cls, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      const pct = ((count / targetCount) * 100).toFixed(1);
      console.log(`  ${cls.padEnd(26)} ${String(count).padStart(4)}  (${pct}%)`);
    }
  }
  console.log('');
  console.log(`Success rate:        ${successTotal}/${targetCount} = ${((successTotal / targetCount) * 100).toFixed(1)}%`);
  console.log(`  of which direct URL: ${counts.success_direct}`);
  console.log(`  of which search:     ${counts.success_search}`);
  console.log(`Permanent failures:  ${counts.permanent_failure} (excluded from normal runs)`);
  console.log(`Duplicate SKUs:      ${duplicateSkus.size} SKUs → ${duplicateProductIds.size} products`);

  console.log('\nRecommendations:');
  if (counts.permanent_failure > 0)
    console.log(`  • ${counts.permanent_failure} products are permanently failing — review in store_products and consider delisting or adding aliases`);
  if (counts.no_confident_match + counts.ambiguous_match > 20)
    console.log(`  • ${counts.no_confident_match + counts.ambiguous_match} match failures — consider adding Tesco-specific store_product_name overrides`);
  if (counts.blocked_challenge > 5)
    console.log(`  • ${counts.blocked_challenge} blocked — check ScrapingBee premium proxy settings; consider longer wait times`);
  if (duplicateSkus.size > 0)
    console.log(`  • ${duplicateSkus.size} duplicate SKU mappings — clean up store_products to avoid wasted requests and ambiguous data`);
  if (counts.success_direct > 0)
    console.log(`  • ${counts.success_direct} products have working direct URLs — direct-URL-first in production would save those search credits`);

  // ---- Write JSON report (no credentials) ----
  const reportPath = path.join(LOG_DIR, `tesco_diagnosis_${TIMESTAMP}.json`);
  const report = {
    run_id:                    RUN_ID,
    generated_at:              new Date().toISOString(),
    target_count:              targetCount,
    scrapingbee_requests:      sbRequests,
    scrapingbee_credits_used:  sbCredits,
    duplicate_skus_count:      duplicateSkus.size,
    duplicate_products_count:  duplicateProductIds.size,
    success_rate_pct:          parseFloat(((successTotal / targetCount) * 100).toFixed(1)),
    counts,
    outcomes: outcomes.map(o => ({
      name:           o.name,
      classification: o.classification,
      price:          o.price,
      api_calls:      o.apiCalls,
      note:           o.note,
    })),
  };
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report: ${reportPath}`);

  // ---- Close diagnostic run record ----
  await scrapeDb.closeRun(RUN_ID, 'tesco', {
    attempted:            sbRequests,
    fetched:              outcomes.filter(o => ['success_direct','success_search','page_loaded_no_price','no_price_in_results','ambiguous_match','no_confident_match'].includes(o.classification)).length,
    extracted:            successTotal,
    inserted:             0,   // diagnostic: nothing inserted
    unchanged:            0,
    failed:               targetCount - successTotal - counts.permanent_failure,
    silently_skipped:     0,
    scrapingbee_requests: sbRequests,
    scrapingbee_credits:  sbCredits,
    error_summary:        counts.blocked_challenge > 10 ? `${counts.blocked_challenge} blocked responses` : null,
  });
}

// ---- CLI ----
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 500;

runDiagnosis({ limit }).catch(e => { console.error('Fatal:', e); process.exit(1); });
