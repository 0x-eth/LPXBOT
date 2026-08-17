-- migrate:up

CREATE TABLE user_pool_blocklist_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  revision bigint NOT NULL CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  CONSTRAINT user_pool_blocklist_state_revision_time_valid CHECK (
    (revision = 0 AND updated_at IS NULL)
    OR (revision > 0 AND updated_at IS NOT NULL AND updated_at >= created_at)
  )
);

CREATE TABLE user_pool_blocklist_entries (
  user_id uuid NOT NULL REFERENCES user_pool_blocklist_state(user_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  scope text NOT NULL CHECK (scope IN ('pool', 'token')),
  identity text NOT NULL,
  label text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT user_pool_blocklist_entries_identity_key
    UNIQUE (user_id, scope, chain_id, identity),
  CONSTRAINT user_pool_blocklist_entries_identity_valid CHECK (
    (scope = 'token' AND identity ~ '^0x[0-9a-f]{40}$')
    OR (scope = 'pool' AND identity ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$')
  ),
  CONSTRAINT user_pool_blocklist_entries_label_valid CHECK (
    label IS NULL
    OR (
      label = btrim(label)
      AND char_length(label) BETWEEN 1 AND 64
      AND label !~ '[[:cntrl:]]'
    )
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX user_pool_blocklist_entries_user_scope_idx
  ON user_pool_blocklist_entries (user_id, scope, identity);

COMMENT ON TABLE user_pool_blocklist_state IS
  'Per-user optimistic concurrency authority for BSC pool and Token blocking.';
COMMENT ON TABLE user_pool_blocklist_entries IS
  'Canonical user-owned BSC poolKey or Token identities; labels are non-authoritative display hints.';

-- migrate:down

DROP TABLE user_pool_blocklist_entries;
DROP TABLE user_pool_blocklist_state;
