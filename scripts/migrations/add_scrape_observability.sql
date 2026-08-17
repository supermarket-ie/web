-- =============================================================================
-- Migration: scrape_runs and scrape_failures observability upgrade
--
-- TARGET: upgrades the EXISTING production schema, which has:
--
--   scrape_runs:    id, store, started_at, finished_at, total, fetched,
--                   extracted, inserted, failed
--
--   scrape_failures: id, run_id (uuid FK → scrape_runs.id), store_product_id,
--                    store, stage, reason, source_url, created_at
--
-- Both tables are empty in production. Every statement is idempotent.
-- Run in Supabase SQL editor. Review before executing.
-- Do NOT run this until the branch has been reviewed and approved.
-- =============================================================================

-- ===========================================================================
-- SECTION 1: scrape_runs
-- ===========================================================================

-- 1a. Add the text external run key (YYYYMMDD_HHMM, shared across all stores).
--     This is the key used throughout application code. The UUID `id` remains
--     the primary key and is returned by openRun() for use in scrape_failures.
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS run_id text;

-- 1b. Rename existing counter columns to the new names, if the old names exist.
--     Uses DO$$ so we can check existence and avoid errors on re-run.
DO $$
BEGIN
  -- total → target_count
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_runs' AND column_name = 'total'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_runs' AND column_name = 'target_count'
  ) THEN
    ALTER TABLE scrape_runs RENAME COLUMN total TO target_count;
  END IF;
END$$;

-- 1c. Add new columns that did not exist in the old schema.
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS target_count          int  NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS attempted_count       int  NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS unchanged_count       int  NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS silently_skipped_count int NOT NULL DEFAULT 0;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS retrieval_method      text;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS duration_seconds      int;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS status                text NOT NULL DEFAULT 'running';
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS coverage_pct          numeric(5,2);
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS threshold_pct         numeric(5,2);
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS threshold_breached    bool NOT NULL DEFAULT false;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS scrapingbee_requests  int;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS scrapingbee_credits   int;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS error_summary         text;
ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS created_at            timestamptz NOT NULL DEFAULT now();

-- 1d. Ensure the existing counter columns (fetched, extracted, inserted, failed)
--     have NOT NULL DEFAULT 0. ALTER COLUMN SET DEFAULT/NOT NULL is safe even
--     if the column already has the constraint.
ALTER TABLE scrape_runs ALTER COLUMN fetched    SET DEFAULT 0;
ALTER TABLE scrape_runs ALTER COLUMN extracted  SET DEFAULT 0;
ALTER TABLE scrape_runs ALTER COLUMN inserted   SET DEFAULT 0;
ALTER TABLE scrape_runs ALTER COLUMN failed     SET DEFAULT 0;

-- Handle nulls in existing rows before adding NOT NULL (tables are empty in
-- production; this is a safety net for any test data).
UPDATE scrape_runs SET fetched   = 0 WHERE fetched   IS NULL;
UPDATE scrape_runs SET extracted = 0 WHERE extracted IS NULL;
UPDATE scrape_runs SET inserted  = 0 WHERE inserted  IS NULL;
UPDATE scrape_runs SET failed    = 0 WHERE failed    IS NULL;

ALTER TABLE scrape_runs ALTER COLUMN fetched    SET NOT NULL;
ALTER TABLE scrape_runs ALTER COLUMN extracted  SET NOT NULL;
ALTER TABLE scrape_runs ALTER COLUMN inserted   SET NOT NULL;
ALTER TABLE scrape_runs ALTER COLUMN failed     SET NOT NULL;

-- 1e. Backfill retrieval_method for any existing rows.
UPDATE scrape_runs SET retrieval_method = 'unknown' WHERE retrieval_method IS NULL;

-- 1f. Add UNIQUE constraint on (run_id, store) — needed for upsert in openRun().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scrape_runs'
      AND constraint_name = 'scrape_runs_run_id_store_key'
  ) THEN
    ALTER TABLE scrape_runs ADD CONSTRAINT scrape_runs_run_id_store_key
      UNIQUE (run_id, store);
  END IF;
END$$;

-- 1g. Replace the status check constraint idempotently.
DO $$
BEGIN
  ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_status_check;
EXCEPTION WHEN others THEN NULL;
END$$;

ALTER TABLE scrape_runs
  ADD CONSTRAINT scrape_runs_status_check
  CHECK (status IN ('running','success','degraded','failed','timeout'))
  NOT VALID;
-- To validate against existing rows once data is clean:
-- ALTER TABLE scrape_runs VALIDATE CONSTRAINT scrape_runs_status_check;

-- ===========================================================================
-- SECTION 2: scrape_failures
-- ===========================================================================

-- The existing schema has:
--   run_id uuid  FK → scrape_runs.id   (UUID, not text)
--   stage  text
--   reason text
--   source_url text
--
-- Decision: RETAIN the UUID FK approach. Application code (scrape-db.js)
-- returns the scrape_runs.id UUID from openRun() and passes it to
-- recordFailure() as `scrapeRunUuid`. This is more relational than a text key.
--
-- The text `run_id` on scrape_runs is still added (for human-readable grouping
-- and log correlation), but scrape_failures references scrape_runs.id (uuid).

-- 2a. Rename existing columns to the new names where they differ.
DO $$
BEGIN
  -- stage → failure_stage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'stage'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'failure_stage'
  ) THEN
    ALTER TABLE scrape_failures RENAME COLUMN stage TO failure_stage;
  END IF;

  -- reason → failure_reason
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'reason'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'failure_reason'
  ) THEN
    ALTER TABLE scrape_failures RENAME COLUMN reason TO failure_reason;
  END IF;

  -- source_url → store_url
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'source_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scrape_failures' AND column_name = 'store_url'
  ) THEN
    ALTER TABLE scrape_failures RENAME COLUMN source_url TO store_url;
  END IF;
END$$;

-- 2b. Add new columns that did not exist in the old schema.
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS canonical_name      text;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS http_status         int;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS is_retryable        bool NOT NULL DEFAULT true;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS consecutive_failures int  NOT NULL DEFAULT 1;
ALTER TABLE scrape_failures ADD COLUMN IF NOT EXISTS raw_error           text;

-- 2c. The existing run_id is uuid FK → scrape_runs.id. Retain this.
--     Verify the FK exists; add it if somehow missing (tables are empty so safe).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scrape_failures'
      AND constraint_name = 'scrape_failures_run_id_fkey'
  ) THEN
    ALTER TABLE scrape_failures
      ADD CONSTRAINT scrape_failures_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES scrape_runs(id) ON DELETE CASCADE
      NOT VALID;
  END IF;
END$$;

-- 2d. Ensure store_product_id FK to store_products exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scrape_failures'
      AND constraint_name = 'scrape_failures_store_product_id_fkey'
  ) THEN
    ALTER TABLE scrape_failures
      ADD CONSTRAINT scrape_failures_store_product_id_fkey
      FOREIGN KEY (store_product_id) REFERENCES store_products(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END$$;

-- 2e. Uniqueness constraint: one failure record per (run UUID, store_product_id, failure_reason).
--     run_id here is the UUID FK to scrape_runs.id.
--     Tables are empty so no duplicates to clean; constraint can be added directly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'scrape_failures'
      AND constraint_name = 'scrape_failures_run_product_reason_key'
  ) THEN
    ALTER TABLE scrape_failures
      ADD CONSTRAINT scrape_failures_run_product_reason_key
      UNIQUE (run_id, store_product_id, failure_reason);
  END IF;
END$$;

-- ===========================================================================
-- SECTION 3: Row-Level Security
-- These are internal operational tables. Only the service role should access
-- them. anon and authenticated roles have no legitimate reason to read or
-- write scrape run data.
-- ===========================================================================

ALTER TABLE scrape_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_failures ENABLE ROW LEVEL SECURITY;

-- Drop permissive policies if they exist from previous migrations.
DROP POLICY IF EXISTS scrape_runs_open    ON scrape_runs;
DROP POLICY IF EXISTS scrape_failures_open ON scrape_failures;

-- Revoke default privileges from public roles.
-- The service role bypasses RLS and retains full access.
REVOKE ALL ON scrape_runs    FROM anon, authenticated;
REVOKE ALL ON scrape_failures FROM anon, authenticated;

-- No SELECT/INSERT/UPDATE/DELETE policies are created for anon or authenticated.
-- All access goes through the service role (used by scrape-db.js server-side).

-- ===========================================================================
-- SECTION 4: Indexes (all idempotent)
-- ===========================================================================

CREATE INDEX IF NOT EXISTS scrape_runs_store_started
  ON scrape_runs (store, started_at DESC);

CREATE INDEX IF NOT EXISTS scrape_runs_run_id_text
  ON scrape_runs (run_id);

CREATE INDEX IF NOT EXISTS scrape_runs_status_degraded
  ON scrape_runs (status, started_at DESC)
  WHERE status IN ('failed','degraded');

CREATE INDEX IF NOT EXISTS scrape_runs_threshold_breach
  ON scrape_runs (threshold_breached, started_at DESC)
  WHERE threshold_breached = true;

CREATE INDEX IF NOT EXISTS scrape_failures_run_id_uuid
  ON scrape_failures (run_id);

CREATE INDEX IF NOT EXISTS scrape_failures_store_product
  ON scrape_failures (store, store_product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS scrape_failures_created
  ON scrape_failures (created_at DESC);

CREATE INDEX IF NOT EXISTS scrape_failures_permanent
  ON scrape_failures (store, store_product_id, is_retryable)
  WHERE is_retryable = false;
