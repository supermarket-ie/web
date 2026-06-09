-- Cache the dashboard refresh computation on the subscribers table
-- so we don't recompute price changes on every dashboard visit.
ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS refresh_cache       jsonb,
  ADD COLUMN IF NOT EXISTS refresh_cache_at    timestamptz;
