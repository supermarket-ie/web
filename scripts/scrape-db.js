'use strict';
/**
 * scrape-db.js — Shared observability helper for all store scrapers.
 *
 * Schema alignment:
 *   scrape_runs.id       — uuid PK (returned by openRun, passed to recordFailure)
 *   scrape_runs.run_id   — text external key (YYYYMMDD_HHMM, for human correlation)
 *   scrape_failures.run_id — uuid FK → scrape_runs.id  (NOT the text run_id)
 *
 * openRun() returns the uuid of the inserted/upserted scrape_runs row.
 * Callers MUST pass that uuid as `scrapeRunUuid` to recordFailure().
 *
 * Permanent-failure suppression is keyed by store_product_id (uuid), not
 * canonical_name. Consecutive failures are counted as distinct run_ids, not rows.
 *
 * Coverage accounting:
 *   inserted  = products where a NEW price_observation row was written
 *               (price changed vs. last observation, or no previous observation)
 *   unchanged = products fetched but price identical to last observation
 *   coverage  = (inserted + unchanged) / target_count * 100
 *   closeRun() enforces: inserted + unchanged <= target_count
 *
 * scrape_failures deduplication:
 *   Unique constraint: (run_id uuid, store_product_id, failure_reason).
 *   recordFailure() uses INSERT … ON CONFLICT DO NOTHING via upsert with
 *   ignoreDuplicates: true and explicit onConflict columns.
 *
 * SECURITY:
 *   - API keys, tokens and credentials are never written to DB or logs.
 *   - raw_error is sanitised before storage.
 *   - store_url query params are stripped before storage.
 *   - scrape_runs and scrape_failures have RLS enabled; service role bypasses it.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ytyzwiqnobxehdqrnzhx.supabase.co';

const THRESHOLDS = {
  tesco:     70,
  supervalu: 85,
  dunnes:    75,
  aldi:      60,
};

function classifyStatus(coveragePct, threshold, { timedOut = false, aborted = false } = {}) {
  if (timedOut)                        return 'timeout';
  if (aborted && coveragePct === 0)    return 'failed';
  if (coveragePct >= threshold)        return 'success';
  if (coveragePct >= threshold * 0.5)  return 'degraded';
  return 'failed';
}

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
 * Insert or update a scrape_runs row with status=running.
 *
 * @param {string} store
 * @param {string} runId   — text external key, e.g. '20260818_0507'
 * @param {number} targetCount
 * @param {string} retrievalMethod — playwright | scrapingbee | instacart_api | direct_http
 * @returns {Promise<string|null>} scrape_runs.id (uuid) — pass to recordFailure()
 */
async function openRun(store, runId, targetCount, retrievalMethod = 'unknown') {
  try {
    const supabase = getClient();
    const threshold = THRESHOLDS[store] ?? 70;

    // upsert on (run_id text, store) — idempotent if called twice
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
      }, { onConflict: 'run_id,store', ignoreDuplicates: false })
      .select('id')
      .single();

    if (error) { console.warn(`  [scrape-db] openRun: ${error.message}`); return null; }
    return data?.id ?? null;   // uuid — callers must store this
  } catch (err) {
    console.warn(`  [scrape-db] openRun error: ${err.message}`);
    return null;
  }
}

/**
 * Update a scrape_runs row on completion.
 *
 * @param {string} runId   — text external key (matches scrape_runs.run_id)
 * @param {string} store
 * @param {Object} counts
 *   inserted    {number} — products where a new price_observation was written
 *   unchanged   {number} — fetched but price identical to last observation
 *   attempted   {number}
 *   fetched     {number}
 *   extracted   {number}
 *   failed      {number}
 *   silently_skipped {number}
 *   scrapingbee_requests {number?}
 *   scrapingbee_credits  {number?}
 *   error_summary {string?}
 *   timed_out   {bool?}
 *   aborted     {bool?}
 *
 * Coverage invariant enforced:
 *   inserted + unchanged must not exceed target_count.
 *   If it does, both are capped and a warning is logged.
 *
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

    const targetCount = existing?.target_count ?? counts.target ?? 0;
    let inserted  = counts.inserted  ?? 0;
    let unchanged = counts.unchanged ?? 0;

    // Defensive invariant: successful count cannot exceed target.
    // Independent rounding of both counters can leave their sum > targetCount,
    // so we cap the sum and reduce unchanged (the less significant counter) to make up
    // the exact remainder, keeping inserted intact.
    if (targetCount > 0 && (inserted + unchanged) > targetCount) {
      console.warn(
        `  [scrape-db] closeRun invariant violation: ` +
        `inserted(${inserted}) + unchanged(${unchanged}) = ${inserted + unchanged} > target(${targetCount}) ` +
        `for ${store}/${runId}. Counters are inconsistent — check scraper logic. Capping unchanged.`
      );
      // Cap: preserve inserted (new price points are higher-value), reduce unchanged to fit exactly.
      // If inserted alone already exceeds target, cap inserted too and zero unchanged.
      if (inserted > targetCount) {
        inserted  = targetCount;
        unchanged = 0;
      } else {
        unchanged = targetCount - inserted;
      }
    }

    const priced      = inserted + unchanged;
    const coveragePct = targetCount > 0
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

    // Map to the actual column names (production schema uses fetched/extracted/inserted/failed;
    // attempted_count, unchanged_count etc. are new columns added by this migration)
    const update = {
      finished_at:            new Date().toISOString(),
      duration_seconds:       durationSeconds,
      status,
      // New columns (added by migration):
      attempted_count:         counts.attempted        ?? 0,
      unchanged_count:         unchanged,
      silently_skipped_count:  counts.silently_skipped ?? 0,
      coverage_pct:            coveragePct,
      threshold_breached:      thresholdBreached,
      // Existing columns (renamed/kept by migration):
      fetched:                 counts.fetched          ?? 0,
      extracted:               counts.extracted        ?? 0,
      inserted:                inserted,
      failed:                  counts.failed           ?? 0,
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

    // Structured log line — no credentials
    console.log(JSON.stringify({
      event:                  'scrape_run_complete',
      run_id:                 runId,
      store,
      status,
      coverage_pct:           coveragePct,
      threshold_pct:          threshold,
      threshold_breached:     thresholdBreached,
      duration_seconds:       durationSeconds,
      target_count:           targetCount,
      inserted_count:         inserted,
      unchanged_count:        unchanged,
      failed_count:           counts.failed           ?? 0,
      silently_skipped_count: counts.silently_skipped ?? 0,
      scrapingbee_requests:   counts.scrapingbee_requests ?? null,
    }));

    return { coveragePct, thresholdBreached, threshold, status };
  } catch (err) {
    console.warn(`  [scrape-db] closeRun error: ${err.message}`);
    return null;
  }
}

/**
 * Record a per-product failure.
 *
 * @param {Object} opts  — ALL fields passed as named object (no positional args)
 *   scrapeRunUuid  {string}       — uuid returned by openRun() — FK to scrape_runs.id
 *   store          {string}       — required
 *   canonicalName  {string}       — required
 *   storeProductId {string|null}  — uuid of store_products row
 *   storeUrl       {string|null}  — query params stripped before storage
 *   failureStage   {string}       — 'selected'|'fetching'|'parsing'|'storing'
 *   failureReason  {string}       — required; see migration comment for codes
 *   httpStatus     {number|null}
 *   rawError       {string|null}  — sanitised before storage
 *
 * Deduplication: upsert with onConflict='run_id,store_product_id,failure_reason'
 * and ignoreDuplicates:true. Supabase PostgREST translates this to
 * INSERT … ON CONFLICT DO NOTHING, matching the unique constraint added by
 * the migration.
 */
async function recordFailure({
  scrapeRunUuid,
  store,
  canonicalName,
  storeProductId = null,
  storeUrl       = null,
  failureStage   = 'fetching',
  failureReason,
  httpStatus     = null,
  rawError       = null,
} = {}) {
  if (!scrapeRunUuid || !store || !canonicalName || !failureReason) {
    console.warn(
      `  [scrape-db] recordFailure: missing required field(s) — scrapeRunUuid=${scrapeRunUuid} store=${store} canonicalName=${canonicalName} failureReason=${failureReason}`
    );
    return;
  }
  try {
    const supabase = getClient();

    // Count consecutive failures: distinct run_ids (uuid) in scrape_failures
    // for this store_product_id across the last 3 completed runs.
    let consecutiveFailures = 1;
    if (storeProductId) {
      const { data: recentRuns } = await supabase
        .from('scrape_runs')
        .select('id')
        .eq('store', store)
        .in('status', ['success', 'degraded', 'failed', 'timeout'])
        .order('started_at', { ascending: false })
        .limit(3);

      if (recentRuns && recentRuns.length > 0) {
        const recentUuids = recentRuns.map(r => r.id);
        const { data: prevFailures } = await supabase
          .from('scrape_failures')
          .select('run_id')
          .eq('store_product_id', storeProductId)
          .in('run_id', recentUuids);

        const distinctRuns = new Set((prevFailures ?? []).map(f => f.run_id));
        consecutiveFailures = distinctRuns.size + 1;
      }
    }

    const isRetryable = consecutiveFailures < 3;

    // upsert with ignoreDuplicates:true → INSERT … ON CONFLICT DO NOTHING
    // Conflict target: the unique constraint (run_id, store_product_id, failure_reason)
    // where run_id is the UUID FK.
    await supabase
      .from('scrape_failures')
      .upsert({
        run_id:              scrapeRunUuid,   // uuid FK → scrape_runs.id
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
      }, {
        onConflict:       'run_id,store_product_id,failure_reason',
        ignoreDuplicates: true,
      });

  } catch (err) {
    console.warn(`  [scrape-db] recordFailure error: ${err.message}`);
  }
}

/**
 * Returns a Set of store_product_ids (uuids) that have failed in ALL of the
 * last 3 completed runs for this store, counted by distinct run uuid.
 */
async function getPermanentFailures(store) {
  try {
    const supabase = getClient();

    const { data: recentRuns } = await supabase
      .from('scrape_runs')
      .select('id')
      .eq('store', store)
      .in('status', ['success', 'degraded', 'failed', 'timeout'])
      .order('started_at', { ascending: false })
      .limit(3);

    if (!recentRuns || recentRuns.length < 3) return new Set();

    const recentUuids = recentRuns.map(r => r.id);

    const { data: failures } = await supabase
      .from('scrape_failures')
      .select('store_product_id, run_id')
      .eq('store', store)
      .in('run_id', recentUuids)
      .not('store_product_id', 'is', null);

    if (!failures || failures.length === 0) return new Set();

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
