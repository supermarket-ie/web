import type { Retailer } from './types';
import { ScrapeError, RETAILER_CONFIGS } from './types';
import { getScraper } from './scrapers';
import { upsertSnapshot, logRunItem } from './db';
import type { UrlRecord } from './db';

export interface BatchInput {
  run_id: string;
  retailer: Retailer;
  scrape_date: string;
}

export interface BatchResult {
  succeeded: number;
  failed: number;
  skipped: number;
}

/** Run tasks with bounded concurrency. */
async function runConcurrently<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= tasks.length) break;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Process a batch of URL records for a given retailer.
 * Scrapes each URL, upserts the snapshot, and logs a run_item.
 */
export async function processBatch(input: BatchInput, urlRecords: UrlRecord[]): Promise<BatchResult> {
  if (!urlRecords.length) return { succeeded: 0, failed: 0, skipped: 0 };

  const { run_id, retailer, scrape_date } = input;
  const config = RETAILER_CONFIGS[retailer];
  const scraper = getScraper(retailer);

  let succeeded = 0;
  let failed = 0;
  const skipped = 0;

  const tasks = urlRecords.map((record) => async () => {
    const startMs = Date.now();

    try {
      const result = await scraper.scrape(record.url, {
        fetch: globalThis.fetch,
        timeoutMs: 12_000,
      });

      await upsertSnapshot({ retailer, url_id: record.id, scrape_date, result });

      await logRunItem({
        run_id,
        url_id: record.id,
        retailer,
        status: 'success',
        attempts: 1,
        duration_ms: Date.now() - startMs,
      });

      succeeded++;
      console.log(`[batch][${retailer}] OK ${record.url} price=${result.price}`);
    } catch (err: unknown) {
      const isScrapeError = err instanceof ScrapeError;
      const errorCode = isScrapeError ? err.errorCode : 'UNKNOWN';
      const httpStatus = isScrapeError ? err.httpStatus : undefined;
      const attempts = isScrapeError ? err.attempts : 1;
      const detail = err instanceof Error ? err.message : String(err);

      await logRunItem({
        run_id,
        url_id: record.id,
        retailer,
        status: 'failed',
        attempts,
        http_status: httpStatus,
        error_code: errorCode,
        error_detail: detail,
        duration_ms: Date.now() - startMs,
      });

      failed++;
      console.error(`[batch][${retailer}] FAIL ${record.url} (${errorCode}) ${detail}`);
    }
  });

  await runConcurrently(tasks, config.concurrency);

  return { succeeded, failed, skipped };
}

/** Chunk an array into sub-arrays of size n. */
export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
  }
  return out;
}
