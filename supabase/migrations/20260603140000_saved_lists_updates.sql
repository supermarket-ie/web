-- Add recommended_store column to saved_lists
ALTER TABLE saved_lists ADD COLUMN IF NOT EXISTS recommended_store TEXT;

-- Add list_id FK to list_items for structured history tracking
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES saved_lists(id) ON DELETE CASCADE;
