-- Add memory JSONB column to households table for AI planner memory
ALTER TABLE households ADD COLUMN memory JSONB DEFAULT NULL;

-- Add index for memory queries (optional but helpful for performance)
CREATE INDEX idx_households_memory ON households USING GIN (memory) WHERE memory IS NOT NULL;