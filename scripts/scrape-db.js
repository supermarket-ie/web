'use strict';
/**
 * scrape-db.js — Shared observability helper for all store scrapers.
 *
 * Provides openRun / closeRun / recordFailure / getPermanentFailures.
 * All DB operations are fail-safe: errors are logged to stderr but never thrown,
 * so a DB outage never breaks a scrape run.
 *
 * SECURITY:
 *   - API keys, tokens, cookies and credentials are never written to logs or DB.
 *   - raw_error is sanitised before storage (credential patterns stripped).
 *   - store_url has query params stripped before storage.
 *
 * Permanent-failure suppression is based on store_product_id (not canonical_name)
 * and counts distinct failed run_ids, not failure rows.
 *
 * The scrape_failures unique constraint (run_id, store_product_id, failure_reason)
 * prevents duplicate rows. recordFailure uses ON CONFLICT DO NOTHING.
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

// Status by coverage %:
//   >= threshold          → success
//   >= threshold * 0.5    → degraded  (significant failures, still usable)
//   < threshold * 0.5     → failed
function classifyStatus(coveragePct, threshold, { timedOut = false, aborted = false } = {}) {
  if (timedOut)                          return 'timeout';
  if (aborted && coveragePct === 0)      return 'failed';
  if (coveragePct >= threshold)          return 'success';
  if (coveragePct >= threshold * 0.5)   return 'degraded';
  return 'failed';
}

// Strip credential-like patterns from error strings before storing
const CREDENTIAL_PATTERNS = [
  /api[_-]?key[=:\s]+\S+/gi,
  /token[=:\s]+\S+/gi,
  /bearer\s+\S+/gi,
  /authorization[=:\s]+\S+/gi,
  /password[=:\s]+\S+/gi,
  /cookie[:=]\s*\S+/gi,
  /set-cookie[:=]\s*\S+/gi,
];

function sanitiseError(raw) {
  if (!raw) return null;
  let s = String(raw).substring(0, 1000);
  for (const pat of CREDENTIAL_PATTERNS) s = s.replace(pat, '[REDACTED]');
  return s.substring(0, 500);
}

// Strip query parameters from URLs before storing — they may contain API keys or session tokens
function sanitiseUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url.split('?')[0];
  }
}

function getClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

/**
 * Insert a scrape_runs row with status=running.
 * Uses UPSERT so re-running a failed run is safe.
 *
 * @param {string} store
 * @param {string} runId  — YYYYMMDD_HHMM
 * @param {number} targetCount
 * @param {string} retrievalMethod — playwright | scrapingbee | instacart_api | direct_http
 * @returns {Promise<string|null>} uuid of row, or null on error
 */
async function openRun(store, runId, targetCount, retrievalMethod = 'unknown') {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;
    const { data, error } = await supabase
      .from('scrape_runs')
      .upsert({
        run_id:           runId,
        store,
        retrieval_method: retrievalMethod,
        started_at:       new Date().toISOString(),
        status:           'running',
        target_count:     targetCount,
        threshold_pct:    threshold,
      }, { onConflict: 'run_id,store' })
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
 *
 * @param {string} runId
 * @param {string} store
 * @param {Object} counts
 *   attempted, fetched, extracted, inserted, unchanged, failed, silently_skipped,
 *   scrapingbee_requests, scrapingbee_credits, error_summary,
 *   timed_out {bool}, aborted {bool}
 * @returns {Promise<{coveragePct, thresholdBreached, threshold, status}|null>}
 */
async function closeRun(runId, store, counts = {}) {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;

    const { data: existing } = await supabase
      .from('scrape_runs')
      .select('target_count, started_at')
      .eq('run_id', runId)
      .eq('store', store)
      .single();

    const targetCount  = existing?.target_count ?? counts.target ?? 0;
    const inserted     = counts.inserted  ?? 0;
    const unchanged    = counts.unchanged ?? 0;
    const priced       = inserted + unchanged;
    const coveragePct  = targetCount > 0
      ? parseFloat(((priced / targetCount) * 100).toFixed(2))
      : 0;
    const thresholdBreached = coveragePct < threshold;
    const status = classifyStatus(coveragePct, threshold, {
      timedOut: !!counts.timed_out,
      aborted:  !!counts.aborted,
    });

    let durationSeconds = null;
    if (existing?.started_at) {
      durationSeconds = Math.round((Date.now() - new Date(existing.started_at).getTime()) / 1000);
    }

    const update = {
      finished_at:            new Date().toISOString(),
      duration_seconds:       durationSeconds,
      status,
      attempted_count:         counts.attempted         ?? 0,
      fetched_count:           counts.fetched           ?? 0,
      extracted_count:         counts.extracted         ?? 0,
      inserted_count:          inserted,
      unchanged_count:         unchanged,
      failed_count:            counts.failed            ?? 0,
      silently_skipped_count:  counts.silently_skipped  ?? 0,
      coverage_pct:            coveragePct,
      threshold_breached:      thresholdBreached,
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

    // Structured log line for external processors (no credentials)
    console.log(JSON.stringify({
      event:                   'scrape_run_complete',
      run_id:                  runId,
      store,
      status,
      coverage_pct:            coveragePct,
      threshold_pct:           threshold,
      threshold_breached:      thresholdBreached,
      duration_seconds:        durationSeconds,
      target_count:            targetCount,
      inserted_count:          inserted,
      unchanged_count:         unchanged,
      failed_count:            counts.failed           ?? 0,
      silently_skipped_count:  counts.silently_skipped ?? 0,
      scrapingbee_requests:    counts.scrapingbee_requests ?? null,
    }));

    return { coveragePct, thresholdBreached, threshold, status };
  } catch (err) {
    console.warn(`  [scrape-db] closeRun error: ${err.message}`);
    return null;
  }
}

/**
 * Record a per-product failure.
 * Uses ON CONFLICT DO NOTHING against the unique constraint
 * (run_id, store_product_id, failure_reason), so calling this multiple times
 * for the same product in the same run is safe.
 *
 * @param {Object} opts
 *   runId, store, canonicalName (required)
 *   storeProductId  uuid|null
 *   storeUrl        string|null  — query params stripped before storage
 *   failureStage    'selected'|'fetching'|'parsing'|'storing'
 *   failureReason   see migration comment for full list
 *   httpStatus      int|null
 *   rawError        string|null  — sanitised before storage
 */
async function recordFailure({
  runId,
  store,
  canonicalName,
  storeProductId = null,
  storeUrl       = null,
  failureStage   = 'fetching',
  failureReason,
  httpStatus     = null,
  rawError       = null,
} = {}) {
  if (!runId || !store || !canonicalName || !failureReason) {
    console.warn('  [scrape-db] recordFailure: missing required fields');
    return;
  }
  try {
    const supabase = getClient();

    // Consecutive-failure count: count distinct run_ids in which this store_product_id
    // has a failure record. Falls back to canonical_name if store_product_id is null.
    let consecutiveFailures = 1;
    if (storeProductId) {
      const { data: recentRuns } = await supabase
        .from('scrape_runs')
        .select('run_id')
        .eq('store', store)
        .in('status', ['success', 'degraded', 'failed', 'timeout'])
        .order('started_at', { ascending: false })
        .limit(3);

      if (recentRuns && recentRuns.length > 0) {
        const recentRunIds = recentRuns.map(r => r.run_id);
        // Count how many of those runs contain a failure for this product
        const { data: prevFailures } = await supabase
          .from('scrape_failures')
          .select('run_id')
          .eq('store_product_id', storeProductId)
          .in('run_id', recentRunIds);

        // Distinct run_ids (not row count)
        const distinctRuns = new Set((prevFailures ?? []).map(f => f.run_id));
        consecutiveFailures = distinctRuns.size + 1;
      }
    }

    const isRetryable = consecutiveFailures < 3;

    // ON CONFLICT DO NOTHING: unique constraint is (run_id, store_product_id, failure_reason)
    // When store_product_id is null the constraint won't fire, but that's an edge case
    // (products without a resolved store_product_id are rare).
    const { error } = await supabase
      .from('scrape_failures')
      .insert({
        run_id:              runId,
        store,
        canonical_name:      canonicalName,
        store_product_id:    storeProductId || null,
        store_url:           sanitiseUrl(storeUrl),
        failure_stage:       failureStage,
        failure_reason:      failureReason,
        http_status:         httpStatus,
        is_retryable:        isRetryable,
        consecutive_failures: consecutiveFailures,
        raw_error:           sanitiseError(rawError),
      }, { ignoreDuplicates: true });   // maps to ON CONFLICT DO NOTHING in PostgREST

    if (error) console.warn(`  [scrape-db] recordFailure: ${error.message}`);
  } catch (err) {
    console.warn(`  [scrape-db] recordFailure error: ${err.message}`);
  }
}

/**
 * Returns a Set of store_product_ids that have failed in all of the last 3
 * completed runs for this store (counted by distinct run_id, not row count).
 * These should be excluded from the target list.
 */
async function getPermanentFailures(store) {
  try {
    const supabase = getClient();

    const { data: recentRuns } = await supabase
      .from('scrape_runs')
      .select('run_id')
      .eq('store', store)
      .in('status', ['success', 'degraded', 'failed', 'timeout'])
      .order('started_at', { ascending: false })
      .limit(3);

    if (!recentRuns || recentRuns.length < 3) return new Set();

    const runIds = recentRuns.map(r => r.run_id);

    const { data: failures } = await supabase
      .from('scrape_failures')
      .select('store_product_id, run_id')
      .eq('store', store)
      .in('run_id', runIds)
      .not('store_product_id', 'is', null);

    if (!failures || failures.length === 0) return new Set();

    // Group by store_product_id, count distinct run_ids
    const runSets = new Map();
    for (const f of failures) {
      if (!runSets.has(f.store_product_id)) runSets.set(f.store_product_id, new Set());
      runSets.get(f.store_product_id).add(f.run_id);
    }

    const permanent = new Set();
    for (const [id, runs] of runSets.entries()) {
      if (runs.size >= 3) permanent.add(id);
    }
    return permanent;
  } catch (err) {
    console.warn(`  [scrape-db] getPermanentFailures error: ${err.message}`);
    return new Set();
  }
}

module.exports = { openRun, closeRun, recordFailure, getPermanentFailures, THRESHOLDS, classifyStatus };
