-- migrate:up
CREATE TABLE chain_access_policies (
  chain_id bigint PRIMARY KEY CHECK (chain_id > 0),
  access text NOT NULL CHECK (access IN ('off', 'pro', 'all')),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500)
);

CREATE TABLE chain_access_policy_history (
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  before_access text CHECK (before_access IN ('off', 'pro', 'all')),
  after_access text NOT NULL CHECK (after_access IN ('off', 'pro', 'all')),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  PRIMARY KEY (chain_id, revision)
);

CREATE INDEX chain_access_policy_history_updated_idx
  ON chain_access_policy_history (updated_at DESC, chain_id);

CREATE TABLE chain_access_management_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  request_id text NOT NULL CHECK (request_id <> ''),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  result_code text NOT NULL CHECK (result_code <> ''),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  before_state jsonb CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'array'),
  after_state jsonb CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'array'),
  created_at timestamptz NOT NULL
);

CREATE INDEX chain_access_management_audit_created_idx
  ON chain_access_management_audit_events (created_at DESC);
CREATE INDEX chain_access_management_audit_actor_created_idx
  ON chain_access_management_audit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER chain_access_policy_history_append_only
BEFORE UPDATE OR DELETE ON chain_access_policy_history
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE TRIGGER chain_access_management_audit_append_only
BEFORE UPDATE OR DELETE ON chain_access_management_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

COMMENT ON TABLE chain_access_policies IS
  'Current local chain access policy; authorization reads this versioned server state.';
COMMENT ON TABLE chain_access_policy_history IS
  'Append-only before/after policy history used for review and validated rollback.';
COMMENT ON TABLE chain_access_management_audit_events IS
  'Minimal management-write decisions without credentials, headers, network identifiers, or profile data.';

-- migrate:down
DROP TRIGGER chain_access_management_audit_append_only ON chain_access_management_audit_events;
DROP TRIGGER chain_access_policy_history_append_only ON chain_access_policy_history;
DROP TABLE chain_access_management_audit_events;
DROP TABLE chain_access_policy_history;
DROP TABLE chain_access_policies;
DROP FUNCTION reject_append_only_mutation();
