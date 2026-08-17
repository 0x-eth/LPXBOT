-- migrate:up

CREATE FUNCTION reject_pool_creation_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TABLE pool_creation_provenance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  pool_key text NOT NULL CHECK (pool_key ~ '^56:0x([0-9a-f]{40}|[0-9a-f]{64})$'),
  protocol text NOT NULL CHECK (protocol IN ('pcsv3', 'univ3', 'pcsv4', 'univ4')),
  creator_address text CHECK (
    creator_address IS NULL OR creator_address ~ '^0x[0-9a-f]{40}$'
  ),
  fee_pips numeric(78, 0) NOT NULL CHECK (fee_pips >= 0),
  tx_hash text CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('created', 'already_exists')),
  completed_at timestamptz NOT NULL CHECK (isfinite(completed_at)),
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL CHECK (isfinite(recorded_at)),
  CONSTRAINT pool_creation_provenance_generation_valid CHECK (
    (protocol IN ('pcsv3', 'univ3') AND pool_key ~ '^56:0x[0-9a-f]{40}$')
    OR (protocol IN ('pcsv4', 'univ4') AND pool_key ~ '^56:0x[0-9a-f]{64}$')
  ),
  CONSTRAINT pool_creation_provenance_created_evidence_valid CHECK (
    outcome <> 'created' OR (creator_address IS NOT NULL AND tx_hash IS NOT NULL)
  ),
  CHECK (recorded_at >= completed_at)
);

CREATE TRIGGER pool_creation_provenance_append_only
BEFORE UPDATE OR DELETE ON pool_creation_provenance
FOR EACH ROW EXECUTE FUNCTION reject_pool_creation_provenance_mutation();

CREATE INDEX pool_creation_provenance_user_page_idx
  ON pool_creation_provenance (user_id, completed_at DESC, id DESC);

CREATE INDEX pool_creation_provenance_attribution_idx
  ON pool_creation_provenance (
    pool_key,
    (CASE WHEN outcome = 'created' THEN 0 ELSE 1 END),
    completed_at,
    id
  );

CREATE TABLE pool_creation_provenance_conflicts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES pool_creation_provenance(operation_id),
  existing_payload_sha256 text NOT NULL
    CHECK (existing_payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  attempted_payload_sha256 text NOT NULL
    CHECK (attempted_payload_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  mismatch_fields text[] NOT NULL CHECK (cardinality(mismatch_fields) > 0),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  CHECK (existing_payload_sha256 <> attempted_payload_sha256)
);

CREATE TRIGGER pool_creation_provenance_conflicts_append_only
BEFORE UPDATE OR DELETE ON pool_creation_provenance_conflicts
FOR EACH ROW EXECUTE FUNCTION reject_pool_creation_provenance_mutation();

CREATE INDEX pool_creation_provenance_conflicts_operation_idx
  ON pool_creation_provenance_conflicts (operation_id, observed_at DESC, id DESC);

CREATE TABLE pool_creator_query_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('pool-creator.single', 'pool-creator.batch')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  result_code text NOT NULL CHECK (result_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  identity_count integer NOT NULL CHECK (identity_count BETWEEN 0 AND 100),
  identity_digest text NOT NULL CHECK (identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_id text NOT NULL CHECK (request_id <> ''),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at))
);

CREATE INDEX pool_creator_query_audit_actor_created_idx
  ON pool_creator_query_audit_events (actor_user_id, created_at DESC, id DESC);

COMMENT ON TABLE pool_creation_provenance IS
  'Append-only results recorded by the LPXBOT platform create workflow; creator is never inferred from chain events, transaction senders, catalog rows, or token ownership.';
COMMENT ON COLUMN pool_creation_provenance.user_id IS
  'Platform operation user retained after account deletion; not a chain transaction sender.';
COMMENT ON COLUMN pool_creation_provenance.outcome IS
  'already_exists records an attempted platform operation and does not prove platform-first creation.';
COMMENT ON TABLE pool_creation_provenance_conflicts IS
  'Safe operationId conflict evidence containing canonical payload hashes and differing field names only.';
COMMENT ON TABLE pool_creator_query_audit_events IS
  'Admin creator-query decision summaries; raw pool identities and creator profile fields are excluded.';

-- migrate:down

DROP TABLE pool_creator_query_audit_events;
DROP TABLE pool_creation_provenance_conflicts;
DROP TABLE pool_creation_provenance;
DROP FUNCTION reject_pool_creation_provenance_mutation();
