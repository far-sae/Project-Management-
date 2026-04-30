-- Mind-map cloud persistence
-- Replaces localStorage-based extras storage with a server-side table
-- so mind maps sync across devices and team members.

CREATE TABLE IF NOT EXISTS mind_map_state (
  project_id UUID NOT NULL,
  user_id    UUID NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}',
  version    INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mind_map_state_project ON mind_map_state(project_id);
CREATE INDEX IF NOT EXISTS idx_mind_map_state_user    ON mind_map_state(user_id);

-- Row-level security
ALTER TABLE mind_map_state ENABLE ROW LEVEL SECURITY;

-- Users can read mind-map state for projects they belong to
CREATE POLICY "Users can read their own mind map state"
  ON mind_map_state FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert/update their own mind-map state
CREATE POLICY "Users can upsert their own mind map state"
  ON mind_map_state FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mind map state"
  ON mind_map_state FOR UPDATE
  USING (auth.uid() = user_id);

-- Grant access
GRANT SELECT, INSERT, UPDATE ON mind_map_state TO anon, authenticated;
