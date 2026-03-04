import { NextRequest } from 'next/server';
import { RETAILERS } from '@/lib/scraper/types';
import type { Retailer } from '@/lib/scraper/types';
import { getUrlRecordsByIds } from '@/lib/scraper/db';
import { processBatch } from '@/lib/scraper/process-batch';

export const maxDuration = 300;

interface BatchPayload {
  run_id: string;
  retailer: Retailer;
  url_ids: string[];
  scrape_date: string;
}

function validatePayload(
  body: unknown,
): { valid: true; payload: BatchPayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj.run_id !== 'string' || !obj.run_id) {
    return { valid: false, error: 'run_id is required' };
  }
  if (typeof obj.retailer !== 'string' || !(RETAILERS as string[]).includes(obj.retailer)) {
    return { valid: false, error: `retailer must be one of: ${RETAILERS.join(', ')}` };
  }
  if (!Array.isArray(obj.url_ids) || !obj.url_ids.every((id) => typeof id === 'string')) {
    return { valid: false, error: 'url_ids must be an array of strings' };
  }
  if (typeof obj.scrape_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.scrape_date)) {
    return { valid: false, error: 'scrape_date must be YYYY-MM-DD' };
  }

  return {
    valid: true,
    payload: {
      run_id: obj.run_id as string,
      retailer: obj.retailer as Retailer,
      url_ids: obj.url_ids as string[],
      scrape_date: obj.scrape_date as string,
    },
  };
}

export async function POST(request: NextRequest) {
  // --- Auth ---
  const workerSecret = process.env.WORKER_SECRET;
  const provided = request.headers.get('x-worker-secret');
  if (!workerSecret || provided !== workerSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validation = validatePayload(body);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { run_id, retailer, url_ids, scrape_date } = validation.payload;

  let urlRecords;
  try {
    urlRecords = await getUrlRecordsByIds(retailer, url_ids);
  } catch (err) {
    return Response.json({ error: `DB error: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  if (!urlRecords.length) {
    return Response.json({ succeeded: 0, failed: 0, skipped: url_ids.length });
  }

  const result = await processBatch({ run_id, retailer, scrape_date }, urlRecords);

  return Response.json(result);
}
