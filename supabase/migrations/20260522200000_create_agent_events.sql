CREATE TABLE IF NOT EXISTS agent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  subscriber_id UUID REFERENCES subscribers(id),
  session_id TEXT,  -- anonymous session tracking (client-generated UUID)
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_events_type ON agent_events(event_type);
CREATE INDEX idx_agent_events_created ON agent_events(created_at DESC);
CREATE INDEX idx_agent_events_subscriber ON agent_events(subscriber_id) WHERE subscriber_id IS NOT NULL;
CREATE INDEX idx_agent_events_session ON agent_events(session_id) WHERE session_id IS NOT NULL;

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
-- Service role can do everything, anon/authenticated cannot read events
CREATE POLICY "Service role full access" ON agent_events FOR ALL TO service_role USING (true);
