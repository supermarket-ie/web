#!/usr/bin/env node
/**
 * Dunnes Stores Batch Refresh
 * 
 * Directly calls the Instacart Storefront API via HTTP (no browser needed).
 * The API doesn't require Cloudflare clearance — curl/fetch works directly.
 *
 * Usage:
 *   node scripts/dunnes_refresh.js                # Refresh all
 *   node scripts/dunnes_refresh.js --limit 100    # Limit products
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STORE_ID = 258;
const GATEWAY_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

// Parse args
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function searchProduct(query) {
  const url = `${GATEWAY_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(query)}&take=5&page=1&skip=0`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'x-site-host': SITE_URL,
        'x-site-location': 'HeadersBuilderInterceptor',
        'x-correlation-id': generateUUID(),
        'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
      },
    });

    if (!resp.ok) return { data: null, err: `HTTP ${resp.status}` };

    const json = await resp.json();
    if (!json.items || json.items.length === 0) {
      return { data: null, err: 'No results' };
    }

    const item = json.items.find(i => i.available !== false) || json.items[0];

    const activeTpr = (item.tprPrice || []).find(t => t.active === true);
    const wasPriceNumeric = item.wasPriceNumeric || item.wasWholePrice || null;
    const wasPrice = wasPriceNumeric && wasPriceNumeric > (item.priceNumeric || 0) ? wasPriceNumeric : null;
    const onPromotion = !!(activeTpr || wasPrice);

    return {
      data: {
        sku: item.sku,
        name: item.name,
        priceNumeric: item.priceNumeric,
        available: item.available,
        onPromotion,
        wasPrice,
        promotionLabel: activeTpr ? activeTpr.label : null,
        url: `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent((item.name || '').toLowerCase().replace(/\s+/g, '-'))}/${item.sku}`,
      },
      err: null,
    };
  } catch (e) {
    return { data: null, err: e.message };
  }
}

async function main() {
  console.log('=== DUNNES REFRESH MODE (direct API) ===\n');

  // Fetch all resolved Dunnes store_products
  let query = supabase
    .from('store_products')
    .select('id, product_id, store_product_name, store_url, products(canonical_name)')
    .eq('store', 'dunnes')
    .eq('url_status', 'resolved');

  if (limit > 0) query = query.limit(limit);
  else query = query.limit(2000);

  const { data: storeProducts, error: dbErr } = await query;
  if (dbErr) {
    console.error('DB error:', dbErr);
    process.exit(1);
  }

  console.log(`Products to refresh: ${storeProducts.length}\n`);
  if (storeProducts.length === 0) return;

  let updated = 0;
  let errors = 0;
  let promotions = 0;

  for (let i = 0; i < storeProducts.length; i++) {
    const sp = storeProducts[i];
    const name = sp.products?.canonical_name || sp.store_product_name;

    const { data, err } = await searchProduct(name);

    if (err || !data) {
      console.log(`  ✗ ${name.substring(0, 50)} → ${err || 'No results'}`);
      errors++;
      // Back off on HTTP errors
      if (err && err.startsWith('HTTP')) {
        await new Promise(r => setTimeout(r, 2000));
      }
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

    // Small delay between requests
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== Updated ${updated}/${storeProducts.length} prices (${promotions} offers), ${errors} errors ===`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
