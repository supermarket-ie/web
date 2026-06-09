-- Performance indexes for dashboard queries
-- saved_lists: subscriber lookups are the primary access pattern
CREATE INDEX IF NOT EXISTS idx_saved_lists_subscriber_created
  ON saved_lists(subscriber_id, created_at DESC);

-- subscribers: indexed for refresh cache lookups
CREATE INDEX IF NOT EXISTS idx_subscribers_id
  ON subscribers(id);
