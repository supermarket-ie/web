import { NextRequest } from 'next/server';
import { RETAILERS, RETAILER_CONFIGS } from '@/lib/scraper/types';
import {
  getDublinDate,
  createScrapeRun,
  updateScrapeRun,
  getActiveUrlsNotYetScraped,
} from '@/lib/scraper/db';
import { processBatch, chunk } from '@/lib/scraper/process-batch';

export const maxDuration = 300; // Vercel Pro: up to 5 min for cron functions

export async function GET(request: NextRequest) {
  // --- Auth ---
  const cronSecret = process.env.CRON_SECRET;
  const provided =
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    request.nextUrl.searchParams.get('secret');

  if (!cronSecret || provided !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scrapeDate = getDublinDate();
  console.log(`[cron] Starting daily scrape for ${scrapeDate}`);

  const config = Object.fromEntries(
    RETAILERS.map((r) => [r, { batchSize: RETAILER_CONFIGS[r].batchSize, concurrency: RETAILER_CONFIGS[r].concurrency }]),
  );

  const run_id = await createScrapeRun({
    trigger: 'cron',
    config: { scrapeDate, retailers: config },
  });

  console.log(`[cron] run_id=${run_id}`);

  let totalTargets = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const retailer of RETAILERS) {
    const retailerConfig = RETAILER_CONFIGS[retailer];

    let urls;
    try {
      urls = await getActiveUrlsNotYetScraped(retailer, scrapeDate);
    } catch (err) {
      console.error(`[cron][${retailer}] Failed to fetch URLs:`, err);
      continue;
    }

    console.log(`[cron][${retailer}] ${urls.length} URLs to scrape`);
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

  try {
    await updateScrapeRun(run_id, {
      status: finalStatus,
      total_targets: totalTargets,
      succeeded: totalSucceeded,
      failed: totalFailed,
      skipped: totalSkipped,
    });
  } catch (err) {
    console.error(`[cron] Failed to update run:`, err);
  }

  console.log(
    `[cron] Done run_id=${run_id} status=${finalStatus} targets=${totalTargets} succeeded=${totalSucceeded} failed=${totalFailed}`,
  );

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
