-- Shopping mode: per-user checked state for list items
-- Keyed on (subscriber_id, list_id, canonical_name) so it survives
-- list re-pricing and doesn't depend on item row order.
CREATE TABLE IF NOT EXISTS list_item_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id    uuid NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  list_id          uuid NOT NULL REFERENCES saved_lists(id) ON DELETE CASCADE,
  canonical_name   text NOT NULL,
  checked          boolean NOT NULL DEFAULT true,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscriber_id, list_id, canonical_name)
);

CREATE INDEX idx_list_item_checks_list ON list_item_checks(subscriber_id, list_id);
