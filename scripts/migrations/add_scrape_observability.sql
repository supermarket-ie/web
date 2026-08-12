-- =============================================================================
-- Migration: Add scrape observability tables
-- Run in Supabase SQL editor
-- =============================================================================

-- scrape_runs: one row per store per scrape run
CREATE TABLE IF NOT EXISTS scrape_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                text NOT NULL,          -- shared YYYYMMDD_HHMM key across all stores
  store                 text NOT NULL,          -- tesco | supervalu | dunnes | aldi
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  status                text NOT NULL DEFAULT 'running', -- running | success | failed | timeout
  target_count          int NOT NULL DEFAULT 0,  -- products selected for this run
  attempted_count       int NOT NULL DEFAULT 0,  -- products that reached search/fetch stage
  fetched_count         int NOT NULL DEFAULT 0,  -- successful HTTP responses
  extracted_count       int NOT NULL DEFAULT 0,  -- prices parsed from responses
  inserted_count        int NOT NULL DEFAULT 0,  -- new price_observations rows inserted
  unchanged_count       int NOT NULL DEFAULT 0,  -- fetched but price unchanged
  failed_count          int NOT NULL DEFAULT 0,  -- attempted but no usable result
  silently_skipped_count int NOT NULL DEFAULT 0, -- in target but never attempted
  coverage_pct          numeric(5,2),            -- inserted / target * 100
  threshold_pct         numeric(5,2),            -- store-specific threshold for this run
  threshold_breached    bool NOT NULL DEFAULT false,
  scrapingbee_requests  int,                     -- Tesco only
  scrapingbee_credits   int,                     -- Tesco only (25 credits/request)
  error_summary         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, store)
);

-- scrape_failures: one row per failed product per run
CREATE TABLE IF NOT EXISTS scrape_failures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                text NOT NULL,
  store                 text NOT NULL,
  canonical_name        text NOT NULL,
  store_product_id      uuid,
  failure_reason        text NOT NULL, -- no_search_results | no_price_in_results | no_confident_match | timeout | http_error | silently_skipped | aborted
  is_retryable          bool NOT NULL DEFAULT true,  -- false = permanent (3+ consecutive run failures)
  consecutive_failures  int NOT NULL DEFAULT 1,
  raw_error             text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS scrape_runs_store_started ON scrape_runs (store, started_at DESC);
CREATE INDEX IF NOT EXISTS scrape_runs_run_id ON scrape_runs (run_id);
CREATE INDEX IF NOT EXISTS scrape_runs_threshold_breached ON scrape_runs (threshold_breached) WHERE threshold_breached = true;
CREATE INDEX IF NOT EXISTS scrape_failures_run_store ON scrape_failures (run_id, store);
CREATE INDEX IF NOT EXISTS scrape_failures_canonical ON scrape_failures (canonical_name, store);
CREATE INDEX IF NOT EXISTS scrape_failures_created ON scrape_failures (created_at DESC);
