import { NextRequest } from 'next/server';
import { RETAILERS, RETAILER_CONFIGS } from '@/lib/scraper/types';
import type { Retailer } from '@/lib/scraper/types';
import {
  getDublinDate,
  createScrapeRun,
  updateScrapeRun,
  getActiveUrlsNotYetScraped,
} from '@/lib/scraper/db';
import { processBatch, chunk } from '@/lib/scraper/process-batch';

export const maxDuration = 300;

interface RunPayload {
  retailer?: Retailer;
  limit?: number;
  scrape_date?: string;
}

export async function POST(request: NextRequest) {
  // --- Auth ---
  const adminSecret = process.env.ADMIN_SECRET;
  const provided = request.headers.get('x-admin-secret');
  if (!adminSecret || provided !== adminSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RunPayload = {};
  try {
    body = (await request.json()) as RunPayload;
  } catch {
    // empty body is fine
  }

  const scrapeDate = body.scrape_date ?? getDublinDate();
  const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 500;
  const targetRetailers: Retailer[] = body.retailer ? [body.retailer] : [...RETAILERS];

  if (body.retailer && !(RETAILERS as string[]).includes(body.retailer)) {
    return Response.json({ error: `Invalid retailer: ${body.retailer}` }, { status: 400 });
  }

  const run_id = await createScrapeRun({
    trigger: 'manual',
    retailer: body.retailer ?? undefined,
    config: { scrapeDate, limit, retailers: targetRetailers },
  });

  console.log(`[manual-run] run_id=${run_id} retailers=${targetRetailers.join(',')} date=${scrapeDate} limit=${limit}`);

  let totalTargets = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const retailer of targetRetailers) {
    const retailerConfig = RETAILER_CONFIGS[retailer];

    let urls;
    try {
      urls = await getActiveUrlsNotYetScraped(retailer, scrapeDate, limit);
    } catch (err) {
      console.error(`[manual-run][${retailer}] Failed to fetch URLs:`, err);
      continue;
    }

    totalTargets += urls.length;
    const batches = chunk(urls, retailerConfig.batchSize);

    for (const batch of batches) {
      const result = await processBatch({ run_id, retailer, scrape_date: scrapeDate }, batch);
      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
    }
  }

  const finalStatus =
    totalFailed === 0 ? 'success' : totalSucceeded === 0 ? 'failed' : 'partial';

  await updateScrapeRun(run_id, {
    status: finalStatus,
    total_targets: totalTargets,
    succeeded: totalSucceeded,
    failed: totalFailed,
    skipped: totalSkipped,
  });

  return Response.json({
    run_id,
    scrape_date: scrapeDate,
    status: finalStatus,
    total_targets: totalTargets,
    succeeded: totalSucceeded,
    failed: totalFailed,
    skipped: totalSkipped,
  });
}
