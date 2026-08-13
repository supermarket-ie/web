-- =============================================================================
-- Migration: Add scrape observability tables
-- Run in Supabase SQL editor (safe to re-run — uses IF NOT EXISTS / IF NOT EXISTS)
-- =============================================================================

-- scrape_runs: one row per store per scrape run
CREATE TABLE IF NOT EXISTS scrape_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                text NOT NULL,          -- shared YYYYMMDD_HHMM key across all stores in one run
  store                 text NOT NULL CHECK (store IN ('tesco','supervalu','dunnes','aldi')),
  retrieval_method      text NOT NULL DEFAULT 'unknown', -- playwright | scrapingbee | instacart_api | direct_http
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  duration_seconds      int,                   -- derived: EXTRACT(EPOCH FROM finished_at - started_at)
  status                text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','degraded','failed','timeout')),
  target_count          int NOT NULL DEFAULT 0,  -- products selected (after permanent-failure suppression)
  attempted_count       int NOT NULL DEFAULT 0,  -- products that reached the fetch stage
  fetched_count         int NOT NULL DEFAULT 0,  -- successful HTTP/API responses
  extracted_count       int NOT NULL DEFAULT 0,  -- prices successfully parsed from responses
  inserted_count        int NOT NULL DEFAULT 0,  -- new price_observations rows inserted
  unchanged_count       int NOT NULL DEFAULT 0,  -- fetched but price identical to last observation
  failed_count          int NOT NULL DEFAULT 0,  -- attempted but produced no usable price
  silently_skipped_count int NOT NULL DEFAULT 0, -- in target list but never reached the fetch loop
  coverage_pct          numeric(5,2),            -- (inserted+unchanged) / target * 100
  threshold_pct         numeric(5,2),            -- store-specific success threshold
  threshold_breached    bool NOT NULL DEFAULT false,
  scrapingbee_requests  int,                     -- Tesco ScrapingBee only
  scrapingbee_credits   int,                     -- estimated: requests * 25
  error_summary         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, store)
);

-- scrape_failures: one row per unsuccessful product per run
CREATE TABLE IF NOT EXISTS scrape_failures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                text NOT NULL,
  store                 text NOT NULL,
  canonical_name        text NOT NULL,
  store_product_id      uuid REFERENCES store_products(id) ON DELETE SET NULL,
  store_url             text,                  -- product URL attempted, if known (no credentials)
  failure_stage         text NOT NULL,         -- selected | fetching | parsing | storing
  failure_reason        text NOT NULL,         -- see codes below
  -- Reason codes:
  --   no_search_results       search returned empty
  --   no_price_in_results     matched product but price missing
  --   no_confident_match      fuzzy match score below threshold
  --   blocked_challenge       403/Akamai/CAPTCHA response
  --   http_error              non-200 HTTP status (http_status field)
  --   timeout                 request or page load timed out
  --   db_error                Supabase insert/update failed
  --   page_loaded_no_price    page OK but price element absent
  --   discontinued            product page shows out-of-stock/removed
  --   silently_skipped        in target but never attempted (gap between selected→attempted)
  --   aborted                 run aborted before reaching this product
  --   permanent_suppressed    excluded due to 3+ consecutive failures
  --   other                   catch-all
  http_status           int,                   -- HTTP status code if applicable (never auth headers)
  is_retryable          bool NOT NULL DEFAULT true,
  consecutive_failures  int NOT NULL DEFAULT 1,
  raw_error             text,                  -- error message, truncated to 500 chars, no credentials
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS scrape_runs_store_started     ON scrape_runs (store, started_at DESC);
CREATE INDEX IF NOT EXISTS scrape_runs_run_id            ON scrape_runs (run_id);
CREATE INDEX IF NOT EXISTS scrape_runs_status            ON scrape_runs (status) WHERE status IN ('failed','degraded');
CREATE INDEX IF NOT EXISTS scrape_runs_threshold_breach  ON scrape_runs (threshold_breached, started_at DESC) WHERE threshold_breached = true;
CREATE INDEX IF NOT EXISTS scrape_failures_run_store     ON scrape_failures (run_id, store);
CREATE INDEX IF NOT EXISTS scrape_failures_canonical     ON scrape_failures (canonical_name, store);
CREATE INDEX IF NOT EXISTS scrape_failures_created       ON scrape_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS scrape_failures_permanent     ON scrape_failures (store, canonical_name, is_retryable) WHERE is_retryable = false;
