-- =============================================================================
-- Migration: Scrape observability tables
-- Safe to run on a fresh DB (CREATE TABLE) or against existing tables (ALTER TABLE).
-- Every statement is idempotent.
-- Run in Supabase SQL editor. Review before executing.
-- =============================================================================

-- ---- scrape_runs ----

CREATE TABLE IF NOT EXISTS scrape_runs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 text        NOT NULL,
  store                  text        NOT NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  finished_at            timestamptz,
  status                 text        NOT NULL DEFAULT 'running',
  target_count           int         NOT NULL DEFAULT 0,
  attempted_count        int         NOT NULL DEFAULT 0,
  inserted_count         int         NOT NULL DEFAULT 0,
  failed_count           int         NOT NULL DEFAULT 0,
  coverage_pct           numeric(5,2),
  threshold_pct          numeric(5,2),
  threshold_breached     bool        NOT NULL DEFAULT false,
  error_summary          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, store)
);

-- Add new columns if they don't already exist (safe to re-run)
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS retrieval_method      text;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS duration_seconds      int;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS fetched_count         int NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS extracted_count       int NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS unchanged_count       int NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS silently_skipped_count int NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS scrapingbee_requests  int;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS scrapingbee_credits   int;

-- Backfill retrieval_method for existing rows so NOT NULL constraint can be applied later if desired
UPDATE scrape_runs SET retrieval_method = 'unknown' WHERE retrieval_method IS NULL;

-- Replace the status check constraint idempotently:
--   DROP old constraint if present, then add the updated one.
DO $$
BEGIN
  -- Remove any existing status check constraint (name may vary; try common names)
  ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_status_check;
  ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_status_fkey;
EXCEPTION WHEN others THEN NULL;
END$$;

ALTER TABLE scrape_runs
  ADD CONSTRAINT scrape_runs_status_check
  CHECK (status IN ('running','success','degraded','failed','timeout'))
  NOT VALID;   -- NOT VALID skips locking table on backfill; validate separately if needed

-- Validate the constraint against existing rows (will fail if any row has a bad value — fix data first)
-- ALTER TABLE scrape_runs VALIDATE CONSTRAINT scrape_runs_status_check;

-- ---- scrape_failures ----

CREATE TABLE IF NOT EXISTS scrape_failures (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               text        NOT NULL,
  store                text        NOT NULL,
  canonical_name       text        NOT NULL,
  store_product_id     uuid,
  failure_reason       text        NOT NULL,
  is_retryable         bool        NOT NULL DEFAULT true,
  consecutive_failures int         NOT NULL DEFAULT 1,
  raw_error            text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Add new columns if they don't already exist
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS store_url      text;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS failure_stage  text;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS http_status    int;

-- Foreign key to store_products (add only if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scrape_failures_store_product_id_fkey'
      AND table_name = 'scrape_failures'
  ) THEN
    ALTER TABLE scrape_failures
      ADD CONSTRAINT scrape_failures_store_product_id_fkey
      FOREIGN KEY (store_product_id) REFERENCES store_products(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END$$;

-- Uniqueness: one failure record per run + product + reason.
-- Prevents duplicate rows if a scraper retries or runs twice.
-- Use ON CONFLICT DO NOTHING in application code (scrape-db.js already does this).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'scrape_failures_run_product_reason_key'
      AND table_name = 'scrape_failures'
  ) THEN
    -- Only safe to add if no existing duplicates; the application will deduplicate going forward.
    -- If this statement fails due to existing duplicates, clean them first:
    --   DELETE FROM scrape_failures a USING scrape_failures b
    --   WHERE a.id > b.id AND a.run_id = b.run_id
    --     AND a.store_product_id IS NOT DISTINCT FROM b.store_product_id
    --     AND a.failure_reason = b.failure_reason;
    ALTER TABLE scrape_failures
      ADD CONSTRAINT scrape_failures_run_product_reason_key
      UNIQUE (run_id, store_product_id, failure_reason);
  END IF;
END$$;

-- ---- Indexes (all idempotent via IF NOT EXISTS) ----

CREATE INDEX IF NOT EXISTS scrape_runs_store_started
  ON scrape_runs (store, started_at DESC);

CREATE INDEX IF NOT EXISTS scrape_runs_run_id
  ON scrape_runs (run_id);

CREATE INDEX IF NOT EXISTS scrape_runs_status_degraded
  ON scrape_runs (status, started_at DESC)
  WHERE status IN ('failed','degraded');

CREATE INDEX IF NOT EXISTS scrape_runs_threshold_breach
  ON scrape_runs (threshold_breached, started_at DESC)
  WHERE threshold_breached = true;

CREATE INDEX IF NOT EXISTS scrape_failures_run_store
  ON scrape_failures (run_id, store);

CREATE INDEX IF NOT EXISTS scrape_failures_store_product
  ON scrape_failures (store, store_product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS scrape_failures_created
  ON scrape_failures (created_at DESC);

CREATE INDEX IF NOT EXISTS scrape_failures_permanent
  ON scrape_failures (store, store_product_id, is_retryable)
  WHERE is_retryable = false;
