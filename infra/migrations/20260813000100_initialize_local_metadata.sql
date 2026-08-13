-- migrate:up
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_metadata (
  metadata_key text PRIMARY KEY CHECK (metadata_key <> ''),
  metadata_value text NOT NULL,
  updated_at timestamptz NOT NULL
);

COMMENT ON TABLE app_metadata IS
  'Versioned local fixture metadata; business entities are intentionally excluded.';

-- migrate:down
DROP TABLE app_metadata;
DROP EXTENSION pgcrypto;
DROP EXTENSION timescaledb;
