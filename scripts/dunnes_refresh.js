#!/usr/bin/env node
/**
 * Dunnes Stores Refresh - Batch price refresh for all resolved Dunnes products
 * 
 * Uses dunnes_scraper.js for individual lookups via Instacart Storefront API.
 * No ScrapingBee needed — Playwright handles Cloudflare directly.
 *
 * Usage:
 *   node scripts/dunnes_refresh.js                # Refresh all
 *   node scripts/dunnes_refresh.js --limit 100    # Limit products
 */

const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const DUNNES_SCRAPER = path.join(__dirname, 'dunnes_scraper.js');

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

function dunnesSearch(productName) {
  try {
    const result = execSync(
      `node "${DUNNES_SCRAPER}" "${productName.replace(/"/g, '\\"')}"`,
      { timeout: 45000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(result.trim());
    if (data.error) return { data: null, err: data.error };
    return { data, err: null };
  } catch (e) {
    return { data: null, err: e.message.substring(0, 100) };
  }
}

async function main() {
  console.log('=== DUNNES REFRESH MODE ===\n');

  // Fetch all resolved Dunnes store_products
  let query = supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, products(canonical_name)')
    .eq('store', 'dunnes')
    .eq('url_status', 'resolved');

  if (limit > 0) query = query.limit(limit);
  else query = query.limit(2000);

  const { data: storeProducts, error: err } = await query;
  if (err) {
    console.error('DB error:', err);
    process.exit(1);
  }

  console.log(`Products to refresh: ${storeProducts.length}\n`);

  let updated = 0;
  let errors = 0;
  let promotions = 0;

  for (let i = 0; i < storeProducts.length; i++) {
    const sp = storeProducts[i];
    const name = sp.products?.canonical_name || sp.store_product_name;

    const { data, err: searchErr } = dunnesSearch(name);

    if (searchErr || !data) {
      console.log(`  ✗ ${name.substring(0, 50)} → ${searchErr || 'No results'}`);
      errors++;
      continue;
    }

    const price = data.priceNumeric;
    if (!price || price <= 0) {
      console.log(`  ✗ ${name.substring(0, 50)} → No price`);
      errors++;
      continue;
    }

    // Insert price observation
    const { error: insertErr } = await supabase.from('price_observations').insert({
      store_product_id: sp.id,
      price: price,
      was_price: data.wasPrice || null,
      on_promotion: data.onPromotion || false,
      promotion_label: data.promotionLabel || null,
      observed_at: new Date().toISOString(),
    });

    if (insertErr) {
      console.log(`  ✗ ${name.substring(0, 50)} → DB error: ${insertErr.message}`);
      errors++;
      continue;
    }

    const promoTag = data.onPromotion ? ' 🏷️' : '';
    console.log(`  ✓ ${name.substring(0, 50)} → €${price.toFixed(2)}${promoTag}`);
    updated++;
    if (data.onPromotion) promotions++;

    // Update store_url if changed
    if (data.url && data.url !== sp.store_url) {
      await supabase
        .from('store_products')
        .update({ store_url: data.url, store_product_name: data.name || name })
        .eq('id', sp.id);
    }

    // Small delay to be polite to Instacart API
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Updated ${updated}/${storeProducts.length} prices (${promotions} offers), ${errors} errors ===`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
