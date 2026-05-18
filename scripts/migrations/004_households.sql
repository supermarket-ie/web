-- Phase 3b: Households table — persistent household profiles
-- Run in Supabase SQL editor.

CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL UNIQUE REFERENCES subscribers(id) ON DELETE CASCADE,
  adults INTEGER NOT NULL DEFAULT 2,
  children INTEGER NOT NULL DEFAULT 0,
  child_ages TEXT[] DEFAULT '{}',
  weekly_budget NUMERIC,
  preferred_stores TEXT[] DEFAULT '{all}',
  dietary TEXT[] DEFAULT '{}',
  dislikes TEXT,
  meals JSONB NOT NULL DEFAULT '{"breakfast":true,"lunch":true,"dinner":true,"snacks":true}'::jsonb,
  batch_cooking BOOLEAN NOT NULL DEFAULT false,
  skip_days TEXT,
  extra_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_households_subscriber ON households(subscriber_id);
