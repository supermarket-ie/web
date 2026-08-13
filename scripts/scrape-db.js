'use strict';
/**
 * scrape-db.js — Shared observability helper for all store scrapers.
 *
 * Provides openRun / closeRun / recordFailure / getPermanentFailures.
 * All DB operations are fail-safe: errors are logged to stderr but never thrown,
 * so a DB outage or misconfiguration never breaks a scrape run.
 *
 * SECURITY: never log API keys, tokens, cookies or credentials.
 * raw_error is truncated to 500 chars and sanitised before storage.
 *
 * Usage (CommonJS):
 *   const scrapeDb = require('./scrape-db');
 *   await scrapeDb.openRun('tesco', '20260810_0507', 500, 'scrapingbee');
 *   await scrapeDb.recordFailure({ runId, store, canonicalName, storeProductId,
 *     storeUrl, failureStage, failureReason, httpStatus, rawError });
 *   await scrapeDb.closeRun('20260810_0507', 'tesco', counts);
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';

// Store-specific success thresholds (coverage_pct must meet or exceed these)
const THRESHOLDS = {
  tesco:     70,
  supervalu: 85,
  dunnes:    75,
  aldi:      60,
};

// Status classification by coverage %:
//   >= threshold   → success
//   >= threshold/2 → degraded
//   < threshold/2  → failed
function classifyStatus(coveragePct, threshold, timedOut, aborted) {
  if (timedOut)       return 'timeout';
  if (aborted && coveragePct === 0) return 'failed';
  if (coveragePct >= threshold)     return 'success';
  if (coveragePct >= threshold / 2) return 'degraded';
  return 'failed';
}

// Sanitise error strings — strip anything that looks like a credential
const CREDENTIAL_PATTERNS = [
  /api[_-]?key[=:\s]+\S+/gi,
  /token[=:\s]+\S+/gi,
  /bearer\s+\S+/gi,
  /authorization[=:\s]+\S+/gi,
  /password[=:\s]+\S+/gi,
  /cookie[=:\s]+\S+/gi,
  /set-cookie[=:\s]+\S+/gi,
];

function sanitiseError(raw) {
  if (!raw) return null;
  let s = String(raw).substring(0, 1000);
  for (const pat of CREDENTIAL_PATTERNS) s = s.replace(pat, '[REDACTED]');
  return s.substring(0, 500);
}

function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

/**
 * Insert a scrape_runs row with status=running.
 * @param {string} store
 * @param {string} runId  - YYYYMMDD_HHMM format
 * @param {number} targetCount
 * @param {string} retrievalMethod - playwright | scrapingbee | instacart_api | direct_http
 * @returns {Promise<string|null>} uuid of inserted row, or null on error
 */
async function openRun(store, runId, targetCount, retrievalMethod = 'unknown') {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;
    const { data, error } = await supabase
      .from('scrape_runs')
      .upsert({
        run_id: runId,
        store,
        retrieval_method: retrievalMethod,
        started_at: new Date().toISOString(),
        status: 'running',
        target_count: targetCount,
        threshold_pct: threshold,
      }, { onConflict: 'run_id,store', ignoreDuplicates: false })
      .select('id')
      .single();

    if (error) { console.warn(`  [scrape-db] openRun: ${error.message}`); return null; }
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
 *   - attempted, fetched, extracted, inserted, unchanged, failed, silently_skipped
 *   - scrapingbee_requests (optional), scrapingbee_credits (optional)
 *   - error_summary (optional string)
 *   - timed_out (optional bool)
 *   - aborted (optional bool)
 * @returns {Promise<{coveragePct, thresholdBreached, threshold, status}|null>}
 */
async function closeRun(runId, store, counts = {}) {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;

    // Fetch stored target_count
    const { data: existing } = await supabase
      .from('scrape_runs')
      .select('target_count, started_at')
      .eq('run_id', runId)
      .eq('store', store)
      .single();

    const targetCount = existing?.target_count ?? counts.target ?? 0;
    const inserted   = counts.inserted  ?? 0;
    const unchanged  = counts.unchanged ?? 0;
    const priced     = inserted + unchanged;
    const coveragePct = targetCount > 0
      ? parseFloat(((priced / targetCount) * 100).toFixed(2))
      : 0;
    const thresholdBreached = coveragePct < threshold;
    const status = classifyStatus(coveragePct, threshold, counts.timed_out, counts.aborted);

    // Duration
    let durationSeconds = null;
    if (existing?.started_at) {
      durationSeconds = Math.round((Date.now() - new Date(existing.started_at).getTime()) / 1000);
    }

    const update = {
      finished_at:           new Date().toISOString(),
      duration_seconds:      durationSeconds,
      status,
      attempted_count:        counts.attempted        ?? 0,
      fetched_count:          counts.fetched          ?? 0,
      extracted_count:        counts.extracted        ?? 0,
      inserted_count:         inserted,
      unchanged_count:        unchanged,
      failed_count:           counts.failed           ?? 0,
      silently_skipped_count: counts.silently_skipped ?? 0,
      coverage_pct:           coveragePct,
      threshold_breached:     thresholdBreached,
    };

    if (counts.scrapingbee_requests != null) update.scrapingbee_requests = counts.scrapingbee_requests;
    if (counts.scrapingbee_credits  != null) update.scrapingbee_credits  = counts.scrapingbee_credits;
    if (counts.error_summary        != null) update.error_summary        = sanitiseError(counts.error_summary);

    const { error } = await supabase
      .from('scrape_runs')
      .update(update)
      .eq('run_id', runId)
      .eq('store', store);

    if (error) console.warn(`  [scrape-db] closeRun: ${error.message}`);

    // Emit structured JSON log line for external log processors
    console.log(JSON.stringify({
      event: 'scrape_run_complete',
      run_id: runId,
      store,
      status,
      coverage_pct: coveragePct,
      threshold_pct: threshold,
      threshold_breached: thresholdBreached,
      duration_seconds: durationSeconds,
      target_count:   targetCount,
      inserted_count: inserted,
      unchanged_count: unchanged,
      failed_count:   counts.failed ?? 0,
      silently_skipped_count: counts.silently_skipped ?? 0,
      scrapingbee_requests: counts.scrapingbee_requests ?? null,
    }));

    return { coveragePct, thresholdBreached, threshold, status };
  } catch (err) {
    console.warn(`  [scrape-db] closeRun error: ${err.message}`);
    return null;
  }
}

/**
 * Record a per-product failure.
 * @param {Object} opts
 *   - runId, store, canonicalName (required)
 *   - storeProductId (uuid|null)
 *   - storeUrl (string|null) — URL only, no credentials
 *   - failureStage: 'selected'|'fetching'|'parsing'|'storing'
 *   - failureReason: see schema comment for full list
 *   - httpStatus (int|null)
 *   - rawError (string|null) — sanitised before storage
 */
async function recordFailure({
  runId, store, canonicalName,
  storeProductId = null,
  storeUrl = null,
  failureStage = 'fetching',
  failureReason,
  httpStatus = null,
  rawError = null,
} = {}) {
  if (!runId || !store || !canonicalName || !failureReason) {
    console.warn('  [scrape-db] recordFailure: missing required fields');
    return;
  }
  try {
    const supabase = getClient();

    // Count consecutive failures for this product (last 3 runs for this store)
    const { data: recentRuns } = await supabase
      .from('scrape_runs')
      .select('run_id')
      .eq('store', store)
      .in('status', ['success','degraded','failed','timeout'])
      .order('started_at', { ascending: false })
      .limit(3);

    let consecutiveFailures = 1;
    if (recentRuns && recentRuns.length > 0) {
      const recentRunIds = recentRuns.map(r => r.run_id);
      const { data: prevFailures } = await supabase
        .from('scrape_failures')
        .select('run_id')
        .eq('store', store)
        .eq('canonical_name', canonicalName)
        .in('run_id', recentRunIds);

      consecutiveFailures = (prevFailures?.length ?? 0) + 1;
    }

    const isRetryable = consecutiveFailures < 3;

    // Strip URL query params that might contain tokens
    let safeUrl = null;
    if (storeUrl) {
      try {
        const u = new URL(storeUrl);
        u.search = '';  // remove all query params (may contain API keys)
        safeUrl = u.toString();
      } catch { safeUrl = storeUrl.split('?')[0]; }
    }

    await supabase.from('scrape_failures').insert({
      run_id:              runId,
      store,
      canonical_name:      canonicalName,
      store_product_id:    storeProductId || null,
      store_url:           safeUrl,
      failure_stage:       failureStage,
      failure_reason:      failureReason,
      http_status:         httpStatus,
      is_retryable:        isRetryable,
      consecutive_failures: consecutiveFailures,
      raw_error:           sanitiseError(rawError),
    });
  } catch (err) {
    console.warn(`  [scrape-db] recordFailure error: ${err.message}`);
  }
}

/**
 * Returns a Set of canonical_names that have failed in ALL of the last 3 completed
 * runs for this store — these are permanent failures to suppress from the target list.
 */
async function getPermanentFailures(store) {
  try {
    const supabase = getClient();
    const { data: recentRuns } = await supabase
      .from('scrape_runs')
      .select('run_id')
      .eq('store', store)
      .in('status', ['success','degraded','failed','timeout'])
      .order('started_at', { ascending: false })
      .limit(3);

    if (!recentRuns || recentRuns.length < 3) return new Set();

    const runIds = recentRuns.map(r => r.run_id);
    const { data: failures } = await supabase
      .from('scrape_failures')
      .select('canonical_name, run_id')
      .eq('store', store)
      .in('run_id', runIds);

    if (!failures || failures.length === 0) return new Set();

    const runSets = new Map();
    for (const f of failures) {
      if (!runSets.has(f.canonical_name)) runSets.set(f.canonical_name, new Set());
      runSets.get(f.canonical_name).add(f.run_id);
    }

    const permanent = new Set();
    for (const [name, runs] of runSets.entries()) {
      if (runs.size >= 3) permanent.add(name);
    }
    return permanent;
  } catch (err) {
    console.warn(`  [scrape-db] getPermanentFailures error: ${err.message}`);
    return new Set();
  }
}

module.exports = { openRun, closeRun, recordFailure, getPermanentFailures, THRESHOLDS, classifyStatus };
