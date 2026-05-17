-- Phase 3a: Conversations table + saved_lists linkage
-- Run against Supabase SQL editor. DO NOT run automatically.

-- New table: conversations
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  title TEXT NOT NULL DEFAULT 'New conversation',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile JSONB,
  list_id UUID REFERENCES saved_lists(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_subscriber ON conversations(subscriber_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- Link saved_lists back to conversations
ALTER TABLE saved_lists ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
