-- migrate:up
CREATE TABLE user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL CHECK (schema_version > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  preferences jsonb NOT NULL CHECK (jsonb_typeof(preferences) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

COMMENT ON TABLE user_preferences IS
  'Versioned, user-owned shell preferences with optimistic concurrency revisions.';
COMMENT ON COLUMN user_preferences.preferences IS
  'Server-normalized non-secret UI preferences; identity is always derived from the session.';

-- migrate:down
DROP TABLE user_preferences;
