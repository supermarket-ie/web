-- Multi-retailer price scraper tables
-- Run this migration in your Supabase SQL editor

-- -------------------------------------------------------------------------
-- retailer_product_urls
-- Input table: deterministic product URLs refreshed daily by existing pipeline
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retailer_product_urls (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer             text        NOT NULL CHECK (retailer IN ('tesco', 'dunnes', 'supervalu', 'lidl', 'aldi')),
  url                  text        NOT NULL,
  canonical_product_id text,
  is_active            boolean     NOT NULL DEFAULT true,
  last_seen_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retailer_product_urls_retailer_url_key UNIQUE (retailer, url)
);

CREATE INDEX IF NOT EXISTS retailer_product_urls_retailer_active_idx
  ON retailer_product_urls (retailer, is_active);

-- -------------------------------------------------------------------------
-- retailer_price_snapshots
-- One row per product per scrape date; idempotent via UPSERT
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retailer_price_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer        text        NOT NULL CHECK (retailer IN ('tesco', 'dunnes', 'supervalu', 'lidl', 'aldi')),
  url_id          uuid        NOT NULL REFERENCES retailer_product_urls (id),
  scrape_date     date        NOT NULL,
  scraped_at      timestamptz NOT NULL DEFAULT now(),
  currency        text        NOT NULL DEFAULT 'EUR',
  price           numeric,
  price_per_unit  numeric,
  unit            text,
  was_price       numeric,
  promo_text      text,
  is_available    boolean,
  product_name    text,
  brand           text,
  size            text,
  image_url       text,
  raw             jsonb,
  parse_version   text,
  CONSTRAINT retailer_price_snapshots_unique UNIQUE (retailer, url_id, scrape_date)
);

CREATE INDEX IF NOT EXISTS retailer_price_snapshots_date_retailer_idx
  ON retailer_price_snapshots (scrape_date, retailer);

CREATE INDEX IF NOT EXISTS retailer_price_snapshots_url_date_idx
  ON retailer_price_snapshots (url_id, scrape_date DESC);

-- -------------------------------------------------------------------------
-- scrape_runs
-- One row per orchestrator run (cron or manual)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  trigger        text        NOT NULL CHECK (trigger IN ('cron', 'manual')),
  retailer       text,
  status         text        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'success', 'partial', 'failed')),
  total_targets  int         NOT NULL DEFAULT 0,
  succeeded      int         NOT NULL DEFAULT 0,
  failed         int         NOT NULL DEFAULT 0,
  skipped        int         NOT NULL DEFAULT 0,
  notes          text,
  config         jsonb
);

-- -------------------------------------------------------------------------
-- scrape_run_items
-- Per-URL result within a run for debugging and alerting
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_run_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid        NOT NULL REFERENCES scrape_runs (id),
  url_id       uuid        NOT NULL REFERENCES retailer_product_urls (id),
  retailer     text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  attempts     int         NOT NULL DEFAULT 1,
  http_status  int,
  error_code   text,
  error_detail text,
  duration_ms  int,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scrape_run_items_run_id_idx
  ON scrape_run_items (run_id);
