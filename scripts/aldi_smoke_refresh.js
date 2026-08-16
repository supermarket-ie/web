#!/usr/bin/env node
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CATEGORY_URL = process.env.ALDI_SMOKE_CATEGORY_URL || 'https://www.aldi.ie/products/chilled-food/dairy/k/1588161416978076002';
const LIMIT = Math.max(1, Math.min(Number(process.env.ALDI_SMOKE_LIMIT || 10), 25));

if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

function normalise(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function latestPrice(storeProductId) {
  const { data, error } = await supabase.from('price_observations')
    .select('price').eq('store_product_id', storeProductId)
    .order('observed_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Previous-price lookup failed: ${error.message}`);
  return data?.price ?? null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let scraped;
  try {
    const page = await browser.newPage({ locale: 'en-IE' });
    const response = await page.goto(CATEGORY_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!response || response.status() !== 200) throw new Error(`Aldi category returned HTTP ${response?.status() ?? 0}`);
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText().catch(() => '');
    if (/Access Denied|don't have permission/i.test(body)) throw new Error('Aldi returned Access Denied');

    scraped = await page.evaluate(() => Array.from(document.querySelectorAll('.product-tile')).map((el) => {
      const brand = el.querySelector('.product-tile__brandname')?.textContent?.trim() || '';
      const name = el.querySelector('.product-tile__name')?.textContent?.trim() || '';
      const priceText = el.querySelector('.base-price__regular')?.textContent?.trim() || '';
      const wasText = el.querySelector('.base-price__was-price')?.textContent?.trim() || '';
      const link = el.querySelector('a.product-tile__link')?.href || '';
      const price = Number(priceText.match(/€([\d.]+)/)?.[1] || 0);
      const wasPrice = Number(wasText.match(/€([\d.]+)/)?.[1] || 0) || null;
      return { fullName: brand ? `${brand} ${name}` : name, price, wasPrice, url: link };
    })).then((rows) => rows.filter((row) => row.fullName && row.price > 0));
  } finally {
    await browser.close();
  }

  if (!scraped.length) throw new Error('Aldi smoke page returned no product tiles');

  const { data: mappings, error: mappingError } = await supabase.from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', 'aldi').eq('url_status', 'resolved');
  if (mappingError) throw new Error(`Aldi mappings lookup failed: ${mappingError.message}`);

  const byExactName = new Map((mappings || []).map((row) => [normalise(row.store_product_name), row]));
  const selected = [];
  for (const product of scraped) {
    const mapping = byExactName.get(normalise(product.fullName));
    if (!mapping) continue;
    selected.push({ product, mapping });
    if (selected.length >= LIMIT) break;
  }
  if (!selected.length) throw new Error('No exact stored-name matches found on Aldi smoke page');

  const runId = process.env.SCRAPE_RUN_ID || `gha_aldi_smoke_${Date.now()}`;
  const { data: run, error: runError } = await supabase.from('scrape_runs').insert({
    run_id: runId,
    store: 'aldi',
    started_at: new Date().toISOString(),
    target_count: selected.length,
    retrieval_method: 'github_playwright_exact_name_smoke',
    threshold_pct: 100,
    status: 'running',
  }).select('id').single();
  if (runError) throw new Error(`Failed opening Aldi smoke run: ${runError.message}`);

  for (const { product, mapping } of selected) {
    const canonicalName = mapping.products?.canonical_name || mapping.store_product_name;
    const previousPrice = await latestPrice(mapping.id);
    const { error } = await supabase.rpc('finalize_store_scrape_product', {
      p_run_uuid: run.id,
      p_store: 'aldi',
      p_store_product_id: mapping.id,
      p_success: true,
      p_price: product.price,
      p_previous_price: previousPrice,
      p_was_price: product.wasPrice,
      p_on_promotion: Boolean(product.wasPrice && product.wasPrice > product.price),
      p_store_url: mapping.store_url,
      p_store_sku: mapping.store_sku,
      p_store_product_name: mapping.store_product_name,
      p_fetched: 1,
      p_extracted: 1,
      p_failure_stage: null,
      p_failure_reason: null,
      p_canonical_name: canonicalName,
      p_raw_error: null,
      p_is_retryable: false,
    });
    if (error) throw new Error(`Failed finalising ${mapping.store_product_name}: ${error.message}`);
    console.log(`✓ ${mapping.store_product_name}: €${product.price.toFixed(2)}`);
  }

  console.log(`Aldi smoke complete: ${selected.length}/${selected.length} exact-name products finalised.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
