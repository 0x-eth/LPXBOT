-- migrate:up
CREATE TABLE users (
  id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('user', 'pro', 'admin')),
  tier text NOT NULL CHECK (tier IN ('normal', 'pro')),
  status text NOT NULL CHECK (status IN ('active', 'pending', 'rejected', 'banned')),
  allowed_chain_ids integer[] NOT NULL DEFAULT '{}',
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_active_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE access_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('session.access', 'session.logout')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  request_id text NOT NULL CHECK (request_id <> ''),
  created_at timestamptz NOT NULL
);

CREATE INDEX access_audit_events_user_created_idx
  ON access_audit_events (user_id, created_at DESC);

COMMENT ON COLUMN sessions.token_hash IS
  'SHA-256 digest of the opaque session credential; plaintext credentials are never persisted.';
COMMENT ON TABLE access_audit_events IS
  'Minimal access decisions without credentials, network identifiers, or personal profile data.';

-- migrate:down
DROP TABLE access_audit_events;
DROP TABLE sessions;
DROP TABLE users;
