'use strict';
/**
 * scrape-db.js — Shared observability helper for all store scrapers.
 *
 * Provides openRun / closeRun / recordFailure / getPermamentFailures.
 * All DB writes are fire-and-forget-safe: errors are logged but never thrown,
 * so a DB outage never breaks a scrape run.
 *
 * Usage (CommonJS):
 *   const scrapeDb = require('./scrape-db');
 *   const runDbId = await scrapeDb.openRun('tesco', '20260810_0507', 500);
 *   await scrapeDb.recordFailure('20260810_0507', 'tesco', 'Frozen Peas', spId, 'no_confident_match');
 *   await scrapeDb.closeRun('20260810_0507', 'tesco', { attempted:415, fetched:380, ... });
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';

// Store-specific coverage thresholds (%)
const THRESHOLDS = {
  tesco:     70,
  supervalu: 85,
  dunnes:    75,
  aldi:      60,
};

function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false },
  });
}

/**
 * Insert a scrape_runs row with status=running.
 * @returns {Promise<string|null>} The uuid of the inserted row, or null on error.
 */
async function openRun(store, runId, targetCount) {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;
    const { data, error } = await supabase
      .from('scrape_runs')
      .insert({
        run_id: runId,
        store,
        started_at: new Date().toISOString(),
        status: 'running',
        target_count: targetCount,
        threshold_pct: threshold,
      })
      .select('id')
      .single();

    if (error) {
      console.warn(`  [scrape-db] openRun warning: ${error.message}`);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.warn(`  [scrape-db] openRun error: ${err.message}`);
    return null;
  }
}

/**
 * Update a scrape_runs row on completion.
 * @param {string} runId
 * @param {string} store
 * @param {Object} counts
 *   attempted, fetched, extracted, inserted, unchanged, failed, silently_skipped,
 *   scrapingbee_requests (optional), scrapingbee_credits (optional),
 *   error_summary (optional), timed_out (optional bool)
 */
async function closeRun(runId, store, counts = {}) {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;

    // Fetch target_count from the existing row
    const { data: existing } = await supabase
      .from('scrape_runs')
      .select('target_count')
      .eq('run_id', runId)
      .eq('store', store)
      .single();

    const targetCount = existing?.target_count ?? counts.target ?? 0;
    const inserted = counts.inserted ?? 0;
    const coveragePct = targetCount > 0
      ? parseFloat(((inserted / targetCount) * 100).toFixed(2))
      : 0;
    const thresholdBreached = coveragePct < threshold;

    const status = counts.timed_out ? 'timeout'
      : (counts.error_summary && inserted === 0) ? 'failed'
      : 'success';

    const update = {
      finished_at: new Date().toISOString(),
      status,
      attempted_count:       counts.attempted        ?? 0,
      fetched_count:         counts.fetched          ?? 0,
      extracted_count:       counts.extracted        ?? 0,
      inserted_count:        inserted,
      unchanged_count:       counts.unchanged        ?? 0,
      failed_count:          counts.failed           ?? 0,
      silently_skipped_count: counts.silently_skipped ?? 0,
      coverage_pct:          coveragePct,
      threshold_breached:    thresholdBreached,
    };

    if (counts.scrapingbee_requests != null) update.scrapingbee_requests = counts.scrapingbee_requests;
    if (counts.scrapingbee_credits  != null) update.scrapingbee_credits  = counts.scrapingbee_credits;
    if (counts.error_summary        != null) update.error_summary        = counts.error_summary;

    const { error } = await supabase
      .from('scrape_runs')
      .update(update)
      .eq('run_id', runId)
      .eq('store', store);

    if (error) console.warn(`  [scrape-db] closeRun warning: ${error.message}`);
    return { coveragePct, thresholdBreached, threshold };
  } catch (err) {
    console.warn(`  [scrape-db] closeRun error: ${err.message}`);
    return null;
  }
}

/**
 * Record a per-product failure.
 * @param {string} runId
 * @param {string} store
 * @param {string} canonicalName
 * @param {string|null} storeProductId  uuid
 * @param {string} failureReason  no_search_results|no_price_in_results|no_confident_match|timeout|http_error|silently_skipped|aborted
 * @param {string|null} rawError  optional error message
 */
async function recordFailure(runId, store, canonicalName, storeProductId, failureReason, rawError = null) {
  try {
    const supabase = getClient();

    // Count consecutive failures for this product to determine is_retryable
    const { data: recent } = await supabase
      .from('scrape_failures')
      .select('run_id')
      .eq('store', store)
      .eq('canonical_name', canonicalName)
      .order('created_at', { ascending: false })
      .limit(3);

    const consecutiveFailures = (recent?.length ?? 0) + 1;
    const isRetryable = consecutiveFailures < 3;

    const { error } = await supabase
      .from('scrape_failures')
      .insert({
        run_id: runId,
        store,
        canonical_name: canonicalName,
        store_product_id: storeProductId || null,
        failure_reason: failureReason,
        is_retryable: isRetryable,
        consecutive_failures: consecutiveFailures,
        raw_error: rawError ? String(rawError).substring(0, 500) : null,
      });

    if (error) console.warn(`  [scrape-db] recordFailure warning: ${error.message}`);
  } catch (err) {
    console.warn(`  [scrape-db] recordFailure error: ${err.message}`);
  }
}

/**
 * Returns a Set of canonical_names that have failed in ALL of the last 3 runs for this store.
 * These are permanent failures and should be suppressed from the target list.
 */
async function getPermanentFailures(store) {
  try {
    const supabase = getClient();

    // Get the last 3 distinct run_ids for this store
    const { data: recentRuns } = await supabase
      .from('scrape_runs')
      .select('run_id')
      .eq('store', store)
      .in('status', ['success', 'failed', 'timeout'])
      .order('started_at', { ascending: false })
      .limit(3);

    if (!recentRuns || recentRuns.length < 3) {
      // Not enough history yet — don't suppress anything
      return new Set();
    }

    const runIds = recentRuns.map(r => r.run_id);

    // Find canonical_names that appear in failures for ALL 3 run_ids
    const { data: failures } = await supabase
      .from('scrape_failures')
      .select('canonical_name, run_id')
      .eq('store', store)
      .in('run_id', runIds);

    if (!failures || failures.length === 0) return new Set();

    // Group by canonical_name, count distinct run_ids
    const runCounts = new Map();
    for (const f of failures) {
      if (!runCounts.has(f.canonical_name)) runCounts.set(f.canonical_name, new Set());
      runCounts.get(f.canonical_name).add(f.run_id);
    }

    const permanent = new Set();
    for (const [name, runs] of runCounts.entries()) {
      if (runs.size >= 3) permanent.add(name);
    }

    return permanent;
  } catch (err) {
    console.warn(`  [scrape-db] getPermanentFailures error: ${err.message}`);
    return new Set();
  }
}

module.exports = { openRun, closeRun, recordFailure, getPermanentFailures, THRESHOLDS };
