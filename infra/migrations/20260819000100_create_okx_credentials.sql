-- migrate:up

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lpbot_okx_connector') THEN
    CREATE ROLE lpbot_okx_connector NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END;
$$;

CREATE TABLE okx_credential_heads (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_id uuid NOT NULL,
  active_version bigint NOT NULL CHECK (active_version > 0),
  configured boolean NOT NULL,
  status text NOT NULL CHECK (status IN (
    'unconfigured', 'staged', 'testing', 'usable', 'invalid', 'revoked',
    'insufficient-permission', 'unknown', 'deleting'
  )),
  capability_epoch bigint NOT NULL CHECK (capability_epoch >= 0),
  rotation_due_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (configured OR status IN ('unconfigured', 'staged')),
  CHECK ((configured AND rotation_due_at IS NOT NULL) OR (NOT configured AND rotation_due_at IS NULL)),
  UNIQUE (user_id, credential_id)
);

CREATE TABLE okx_credential_versions (
  user_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  active boolean NOT NULL,
  status text NOT NULL CHECK (status IN (
    'staged', 'testing', 'usable', 'invalid', 'revoked',
    'insufficient-permission', 'unknown', 'deleting'
  )),
  algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0 AND octet_length(ciphertext) <= 2048),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  wrapped_dek bytea,
  aad_version integer NOT NULL CHECK (aad_version = 1),
  environment text NOT NULL CHECK (
    char_length(environment) BETWEEN 1 AND 32 AND environment ~ '^[a-z0-9-]+$'
  ),
  kek_id text NOT NULL CHECK (
    char_length(kek_id) BETWEEN 1 AND 128 AND kek_id ~ '^[a-z0-9._:-]+$'
  ),
  kek_version text NOT NULL CHECK (
    char_length(kek_version) BETWEEN 1 AND 128 AND kek_version ~ '^[a-z0-9._:-]+$'
  ),
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  destroyed_at timestamptz,
  PRIMARY KEY (user_id, version),
  FOREIGN KEY (user_id, credential_id)
    REFERENCES okx_credential_heads(user_id, credential_id)
    ON DELETE CASCADE,
  CHECK ((destroyed_at IS NULL) = (wrapped_dek IS NOT NULL)),
  CHECK (NOT active OR (activated_at IS NOT NULL AND destroyed_at IS NULL)),
  CHECK (destroyed_at IS NULL OR destroyed_at >= created_at)
);

CREATE UNIQUE INDEX okx_credential_versions_one_active_per_user
  ON okx_credential_versions (user_id)
  WHERE active;
CREATE INDEX okx_credential_versions_staged_recovery
  ON okx_credential_versions (created_at, user_id, version)
  WHERE status = 'staged' AND NOT active AND destroyed_at IS NULL;

CREATE TABLE okx_credential_tombstones (
  credential_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  final_version bigint NOT NULL CHECK (final_version > 0),
  final_status text NOT NULL CHECK (final_status = 'revoked'),
  deleted_at timestamptz NOT NULL
);

CREATE TABLE okx_credential_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  action text NOT NULL CHECK (
    action IN ('save', 'replace', 'delete', 'test', 'status-change', 'egress-denied')
  ),
  status text NOT NULL CHECK (status IN (
    'unconfigured', 'staged', 'testing', 'usable', 'invalid', 'revoked',
    'insufficient-permission', 'unknown', 'deleting'
  )),
  changed boolean NOT NULL,
  request_id text NOT NULL CHECK (
    char_length(request_id) BETWEEN 1 AND 160 AND request_id !~ '[[:cntrl:]]'
  ),
  actor text NOT NULL CHECK (
    char_length(actor) BETWEEN 1 AND 160 AND actor !~ '[[:cntrl:]]'
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX okx_credential_audit_user_created_idx
  ON okx_credential_audit_events (user_id, created_at DESC, audit_id DESC);

CREATE FUNCTION reject_okx_credential_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'OKX credential audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER okx_credential_audit_append_only
BEFORE UPDATE OR DELETE ON okx_credential_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_okx_credential_audit_mutation();

COMMENT ON TABLE okx_credential_heads IS
  'Non-secret connector-owned lifecycle metadata; API reads status through the connector boundary.';
COMMENT ON TABLE okx_credential_versions IS
  'Connector-only AES-256-GCM envelopes. AAD is fixed from domain, user, credential, version, and environment.';
COMMENT ON COLUMN okx_credential_versions.wrapped_dek IS
  'Opaque dedicated-KMS ciphertext; NULL is cryptographic erasure and permanently disables the version.';
COMMENT ON TABLE okx_credential_audit_events IS
  'Append-only non-secret lifecycle audit. Provider payloads, headers, signatures, and credential derivatives are forbidden.';

REVOKE ALL ON okx_credential_heads FROM PUBLIC;
REVOKE ALL ON okx_credential_versions FROM PUBLIC;
REVOKE ALL ON okx_credential_tombstones FROM PUBLIC;
REVOKE ALL ON okx_credential_audit_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE okx_credential_audit_events_audit_id_seq FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON okx_credential_heads TO lpbot_okx_connector;
GRANT SELECT, INSERT, UPDATE, DELETE ON okx_credential_versions TO lpbot_okx_connector;
GRANT SELECT, INSERT ON okx_credential_tombstones TO lpbot_okx_connector;
GRANT SELECT, INSERT ON okx_credential_audit_events TO lpbot_okx_connector;
GRANT USAGE, SELECT ON SEQUENCE okx_credential_audit_events_audit_id_seq TO lpbot_okx_connector;

-- migrate:down

DROP TRIGGER okx_credential_audit_append_only ON okx_credential_audit_events;
DROP TABLE okx_credential_audit_events;
DROP FUNCTION reject_okx_credential_audit_mutation();
DROP TABLE okx_credential_tombstones;
DROP TABLE okx_credential_versions;
DROP TABLE okx_credential_heads;
