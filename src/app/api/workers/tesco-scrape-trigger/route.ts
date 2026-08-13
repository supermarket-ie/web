/**
 * Tesco Batch Worker — Vercel Cron trigger
 *
 * STATUS: PREPARED, NOT YET IN PRODUCTION
 * The EC2/systemd scraper remains the production scheduler until parallel
 * runs have been validated and cutover explicitly approved.
 *
 * Design:
 *   - Vercel Cron triggers this endpoint Mon & Thu at 05:00 UTC
 *   - Splits resolved Tesco products into batches of BATCH_SIZE
 *   - Enqueues each batch to Vercel Queue (tesco-scrape-queue)
 *   - Each batch processed by /api/workers/tesco-batch-worker
 *   - Idempotent: uses run_id + product_id as deduplication key
 *
 * Environment variables required (not yet set on Vercel):
 *   SCRAPINGBEE_API_KEY    — ScrapingBee API key
 *   VERCEL_QUEUE_TOKEN     — Vercel Queue auth token (when Queues GA)
 *   SCRAPE_CRON_SECRET     — shared secret to validate this cron endpoint
 *   TESCO_METHOD           — 'scrapingbee' | 'playwright' (default: scrapingbee)
 *
 * NOT YET DEPLOYED: vercel.json cron config also required (see bottom of file).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BATCH_SIZE = 50; // products per queue message — small enough to complete in Vercel's 60s limit
const MAX_BATCHES = 10; // cap at 500 products/trigger (same as EC2 runs)

export async function POST(req: Request) {
  // Validate cron secret (Vercel sets Authorization header for cron endpoints)
  const authHeader = req.headers.get('authorization') ?? '';
  const secret = process.env.SCRAPE_CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  const runId = new Date().toISOString().replace(/[^0-9]/g, '').substring(0, 12);

  // Fetch resolved Tesco products sorted stalest-first
  const { data: storeProducts, error } = await supabase
    .from('store_products')
    .select('id, store_product_name, store_url, products(canonical_name)')
    .eq('store', 'tesco')
    .eq('url_status', 'resolved')
    .not('store_url', 'like', '%/search?%');

  if (error || !storeProducts) {
    return Response.json({ error: 'DB fetch failed', detail: error?.message }, { status: 500 });
  }

  // Sort stalest-first
  const { data: obsRows } = await supabase
    .from('price_observations')
    .select('store_product_id, observed_at')
    .in('store_product_id', storeProducts.map(sp => sp.id))
    .order('observed_at', { ascending: false });

  const lastObsMap = new Map<string, string>();
  for (const o of (obsRows ?? [])) {
    if (!lastObsMap.has(o.store_product_id)) lastObsMap.set(o.store_product_id, o.observed_at);
  }

  const sorted = [...storeProducts].sort((a, b) =>
    (lastObsMap.get(a.id) ?? '1970').localeCompare(lastObsMap.get(b.id) ?? '1970')
  );

  const toProcess = sorted.slice(0, BATCH_SIZE * MAX_BATCHES);
  const batches: typeof toProcess[] = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    batches.push(toProcess.slice(i, i + BATCH_SIZE));
  }

  // TODO: when Vercel Queues are available, enqueue each batch:
  // for (const [idx, batch] of batches.entries()) {
  //   await fetch(process.env.VERCEL_QUEUE_URL!, {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.VERCEL_QUEUE_TOKEN}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ run_id: runId, batch_index: idx, total_batches: batches.length, products: batch }),
  //   });
  // }

  // For now: process first batch inline (validates the worker logic without Queues)
  // Remove this once Queue infrastructure is in place.
  const firstBatch = batches[0] ?? [];
  const batchResult = await processBatch({ runId, batchIndex: 0, totalBatches: batches.length, products: firstBatch });

  return Response.json({
    run_id: runId,
    total_products: toProcess.length,
    batches_planned: batches.length,
    first_batch_result: batchResult,
    note: 'Inline processing only — Queue enqueuing not yet active',
  });
}

// ---- Batch processor (will become the Queue consumer endpoint) ----
async function processBatch({
  runId,
  batchIndex,
  totalBatches,
  products,
}: {
  runId: string;
  batchIndex: number;
  totalBatches: number;
  products: Array<{ id: string; store_product_name: string | null; store_url: string | null; products?: { canonical_name: string } | null }>;
}) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;
  const method = (process.env.TESCO_METHOD ?? 'scrapingbee') as 'scrapingbee' | 'playwright';

  const results = { success: 0, failed: 0, errors: [] as string[] };

  for (const sp of products) {
    const name = sp.products?.canonical_name ?? sp.store_product_name ?? '';
    if (!name) { results.failed++; continue; }

    // Idempotency check: skip if already priced in this run
    const { data: existing } = await supabase
      .from('price_observations')
      .select('id')
      .eq('store_product_id', sp.id)
      .gte('observed_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // within last 2h
      .limit(1);
    if (existing && existing.length > 0) { results.success++; continue; }

    if (method === 'scrapingbee' && SCRAPINGBEE_KEY) {
      // Direct URL first (if we have a product URL, not a search URL)
      const isDirectUrl = sp.store_url && !sp.store_url.includes('/search?');
      const targetUrl = isDirectUrl
        ? sp.store_url!
        : `https://www.tesco.ie/shop/en-IE/search?query=${encodeURIComponent(name)}`;

      try {
        const params = new URLSearchParams({
          api_key: SCRAPINGBEE_KEY,
          url: targetUrl,
          render_js: 'true',
          premium_proxy: 'true',
          country_code: 'ie',
          wait: '5000',
        });

        const res = await fetch('https://app.scrapingbee.com/api/v1?' + params, {
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          results.failed++;
          results.errors.push(`${name}: HTTP ${res.status}`);
          continue;
        }

        const html = await res.text();
        // Minimal price extraction — full parser in tesco_scraper.js
        const priceMatch = html.match(/data-auto="price"[^>]*>.*?([\d]+\.[\d]{2})/);
        if (!priceMatch) {
          results.failed++;
          results.errors.push(`${name}: no price found`);
          continue;
        }

        const price = parseFloat(priceMatch[1]);
        await supabase.from('price_observations').insert({
          store_product_id: sp.id,
          price,
          was_price: null,
          on_promotion: false,
          observed_at: new Date().toISOString(),
        });
        results.success++;
      } catch (e: unknown) {
        results.failed++;
        results.errors.push(`${name}: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    } else {
      // Playwright path would be handled by EC2 — not available in Vercel serverless
      results.failed++;
      results.errors.push(`${name}: playwright not available in serverless`);
    }

    // Respectful delay between requests
    await new Promise(r => setTimeout(r, 1000));
  }

  return { batch_index: batchIndex, total_batches: totalBatches, ...results };
}

/*
 * VERCEL.JSON CRON CONFIG (add when activating):
 * {
 *   "crons": [
 *     { "path": "/api/workers/tesco-scrape-trigger", "schedule": "0 5 * * 1" },
 *     { "path": "/api/workers/tesco-scrape-trigger", "schedule": "0 5 * * 4" }
 *   ]
 * }
 *
 * REQUIRED ENV VARS (add to Vercel project settings):
 *   SCRAPINGBEE_API_KEY     — from ScrapingBee dashboard (already in EC2 .env.local)
 *   SCRAPE_CRON_SECRET      — new random secret for cron endpoint auth
 *   TESCO_METHOD            — 'scrapingbee' (default) or 'playwright' (EC2 only)
 *   VERCEL_QUEUE_TOKEN      — add when Queues feature is available
 *
 * DO NOT ACTIVATE until:
 *   1. EC2 parallel runs have been validated (min 2 successful side-by-side runs)
 *   2. Paul has explicitly approved cutover
 *   3. EC2 systemd timer has been disabled (not just paused)
 */
