import { supabaseAdmin } from '@/lib/supabase';
import type { Retailer, ScrapeResult } from './types';

/** Returns today's date in Europe/Dublin timezone as YYYY-MM-DD */
export function getDublinDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date());
}

export interface UrlRecord {
  id: string;
  url: string;
}

// ---------------------------------------------------------------------------
// scrape_runs
// ---------------------------------------------------------------------------

export async function createScrapeRun(opts: {
  trigger: 'cron' | 'manual';
  retailer?: string;
  config?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .insert({
      trigger: opts.trigger,
      retailer: opts.retailer ?? null,
      status: 'running',
      config: opts.config ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`createScrapeRun: ${error.message}`);
  return data.id as string;
}

export async function updateScrapeRun(
  runId: string,
  updates: {
    status: 'success' | 'partial' | 'failed';
    total_targets: number;
    succeeded: number;
    failed: number;
    skipped: number;
    notes?: string;
  },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('scrape_runs')
    .update({ ...updates, finished_at: new Date().toISOString() })
    .eq('id', runId);

  if (error) throw new Error(`updateScrapeRun: ${error.message}`);
}

// ---------------------------------------------------------------------------
// scrape_run_items
// ---------------------------------------------------------------------------

export async function logRunItem(item: {
  run_id: string;
  url_id: string;
  retailer: Retailer;
  status: 'success' | 'failed' | 'skipped';
  attempts: number;
  http_status?: number;
  error_code?: string;
  error_detail?: string;
  duration_ms: number;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('scrape_run_items').insert(item);
  if (error) {
    // Non-fatal: log but don't propagate
    console.error(`[logRunItem] ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// retailer_product_urls
// ---------------------------------------------------------------------------

/**
 * Returns active URLs for a retailer that have NOT yet been scraped today.
 * Uses a two-step query to avoid PostgREST join-condition limitations.
 */
export async function getActiveUrlsNotYetScraped(
  retailer: Retailer,
  scrapeDate: string,
  limit = 2000,
): Promise<UrlRecord[]> {
  const { data: allUrls, error: urlsError } = await supabaseAdmin
    .from('retailer_product_urls')
    .select('id, url')
    .eq('retailer', retailer)
    .eq('is_active', true)
    .limit(limit);

  if (urlsError) throw new Error(`getActiveUrls(${retailer}): ${urlsError.message}`);
  if (!allUrls?.length) return [];

  const urlIds = allUrls.map((u) => u.id as string);

  const { data: scraped, error: scrapedError } = await supabaseAdmin
    .from('retailer_price_snapshots')
    .select('url_id')
    .eq('retailer', retailer)
    .eq('scrape_date', scrapeDate)
    .in('url_id', urlIds);

  if (scrapedError) throw new Error(`getScrapedIds(${retailer}): ${scrapedError.message}`);

  const scrapedSet = new Set((scraped ?? []).map((s) => s.url_id as string));
  return (allUrls as UrlRecord[]).filter((u) => !scrapedSet.has(u.id));
}

/**
 * Fetch specific url records by their IDs (used by the HTTP batch endpoint).
 */
export async function getUrlRecordsByIds(
  retailer: Retailer,
  urlIds: string[],
): Promise<UrlRecord[]> {
  if (!urlIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('retailer_product_urls')
    .select('id, url')
    .eq('retailer', retailer)
    .in('id', urlIds);

  if (error) throw new Error(`getUrlRecordsByIds(${retailer}): ${error.message}`);
  return (data ?? []) as UrlRecord[];
}

// ---------------------------------------------------------------------------
// retailer_price_snapshots
// ---------------------------------------------------------------------------

export async function upsertSnapshot(opts: {
  retailer: Retailer;
  url_id: string;
  scrape_date: string;
  result: ScrapeResult;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('retailer_price_snapshots').upsert(
    {
      retailer: opts.retailer,
      url_id: opts.url_id,
      scrape_date: opts.scrape_date,
      scraped_at: new Date().toISOString(),
      currency: opts.result.currency,
      price: opts.result.price ?? null,
      price_per_unit: opts.result.price_per_unit ?? null,
      unit: opts.result.unit ?? null,
      was_price: opts.result.was_price ?? null,
      promo_text: opts.result.promo_text ?? null,
      is_available: opts.result.is_available ?? null,
      product_name: opts.result.product_name ?? null,
      brand: opts.result.brand ?? null,
      size: opts.result.size ?? null,
      image_url: opts.result.image_url ?? null,
      raw: opts.result.raw ?? null,
      parse_version: opts.result.parse_version,
    },
    { onConflict: 'retailer,url_id,scrape_date' },
  );

  if (error) throw new Error(`upsertSnapshot: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

export async function getRunWithItems(runId: string): Promise<{
  run: Record<string, unknown> | null;
  errorBreakdown: Record<string, number>;
}> {
  const { data: run, error: runError } = await supabaseAdmin
    .from('scrape_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (runError) throw new Error(`getRunWithItems: ${runError.message}`);

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('scrape_run_items')
    .select('error_code, status')
    .eq('run_id', runId)
    .eq('status', 'failed');

  if (itemsError) throw new Error(`getRunItems: ${itemsError.message}`);

  const errorBreakdown: Record<string, number> = {};
  for (const item of items ?? []) {
    const code = (item.error_code as string) ?? 'UNKNOWN';
    errorBreakdown[code] = (errorBreakdown[code] ?? 0) + 1;
  }

  return { run: run as Record<string, unknown>, errorBreakdown };
}
