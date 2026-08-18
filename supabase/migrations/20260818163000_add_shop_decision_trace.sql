-- Structured provenance for agent-prepared shopping drafts.
-- Kept on saved_lists so My Shop can explain decisions without recomputing
-- historical household state. This also provides a stable base for undo/override.
ALTER TABLE saved_lists
  ADD COLUMN IF NOT EXISTS agent_decision_trace JSONB DEFAULT NULL;

COMMENT ON COLUMN saved_lists.agent_decision_trace IS
  'Compact versioned provenance for agent-prepared shop decisions: reason, signals, confidence and source per item.';

CREATE INDEX IF NOT EXISTS idx_saved_lists_agent_decision_trace
  ON saved_lists USING GIN (agent_decision_trace)
  WHERE agent_decision_trace IS NOT NULL;
