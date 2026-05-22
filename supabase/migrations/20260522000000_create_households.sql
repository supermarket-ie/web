CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  adults INTEGER NOT NULL DEFAULT 2,
  children INTEGER NOT NULL DEFAULT 0,
  child_ages TEXT[] DEFAULT ARRAY[]::TEXT[],
  weekly_budget NUMERIC(10,2),
  preferred_stores TEXT[] DEFAULT ARRAY['tesco', 'dunnes', 'supervalu'],
  dietary TEXT[] DEFAULT ARRAY[]::TEXT[],
  dislikes TEXT,
  meals JSONB DEFAULT '{ "breakfast": true, "lunch": true, "dinner": true, "snacks": false }'::jsonb,
  batch_cooking BOOLEAN DEFAULT false,
  skip_days TEXT,
  extra_context TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subscriber_id)
);

CREATE INDEX idx_households_subscriber ON households(subscriber_id);
