-- migrate:up

-- P04-04 LOCAL-DECISION: wallet deletion preview is a new endpoint and does not amend P04-01.

ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_user_wallet_unique UNIQUE (user_id, wallet_id);

ALTER TABLE custody_wallet_audit_events
  DROP CONSTRAINT custody_wallet_audit_events_wallet_id_fkey;
ALTER TABLE custody_wallet_audit_events
  DROP CONSTRAINT custody_wallet_audit_events_user_id_fkey;
ALTER TABLE custody_wallet_audit_events
  DROP CONSTRAINT custody_wallet_audit_events_action_check;
ALTER TABLE custody_wallet_audit_events
  ADD CONSTRAINT custody_wallet_audit_events_action_check CHECK (
    action IN (
      'wallet.import',
      'wallet.generate',
      'wallet.lock',
      'wallet.quarantine',
      'wallet.recover',
      'wallet.password-change',
      'wallet.mode-switch',
      'wallet.rename',
      'wallet.delete',
      'wallet.force-delete',
      'keystore.reset'
    )
  );

CREATE TABLE custody_wallet_delete_previews (
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  preview_token_digest bytea NOT NULL CHECK (octet_length(preview_token_digest) = 32),
  wallet_revision bigint NOT NULL CHECK (wallet_revision > 0),
  task_ids text[] NOT NULL,
  policy_ids text[] NOT NULL,
  position_ids text[] NOT NULL,
  asset_ids text[] NOT NULL,
  task_count integer GENERATED ALWAYS AS (cardinality(task_ids)) STORED,
  policy_count integer GENERATED ALWAYS AS (cardinality(policy_ids)) STORED,
  position_count integer GENERATED ALWAYS AS (cardinality(position_ids)) STORED,
  asset_count integer GENERATED ALWAYS AS (cardinality(asset_ids)) STORED,
  asset_risk_digest text NOT NULL CHECK (
    char_length(asset_risk_digest) BETWEEN 1 AND 256
    AND asset_risk_digest !~ '[[:cntrl:]]'
  ),
  force_eligible boolean NOT NULL,
  confirmation_phrase text NOT NULL CHECK (
    confirmation_phrase ~ '^DELETE WALLET [A-F0-9]{8}$'
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, wallet_id, preview_token_digest),
  FOREIGN KEY (user_id, wallet_id)
    REFERENCES custody_wallets(user_id, wallet_id) ON DELETE CASCADE,
  CHECK (array_position(task_ids, NULL) IS NULL),
  CHECK (array_position(policy_ids, NULL) IS NULL),
  CHECK (array_position(position_ids, NULL) IS NULL),
  CHECK (array_position(asset_ids, NULL) IS NULL),
  CHECK (expires_at = created_at + interval '300 seconds')
);

CREATE INDEX custody_wallet_delete_previews_expiry_idx
  ON custody_wallet_delete_previews (expires_at);

CREATE TABLE custody_wallet_tombstones (
  wallet_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  final_revision bigint NOT NULL CHECK (final_revision > 1),
  deletion_type text NOT NULL CHECK (deletion_type IN ('normal', 'force')),
  deletion_audit_id bigint NOT NULL UNIQUE CHECK (deletion_audit_id > 0),
  deleted_at timestamptz NOT NULL
);

CREATE INDEX custody_wallet_tombstones_user_deleted_idx
  ON custody_wallet_tombstones (user_id, deleted_at DESC, wallet_id DESC);

CREATE FUNCTION prevent_security_password_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'security password versions and audits are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE user_security_passwords (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_version bigint NOT NULL CHECK (current_version > 0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 5),
  locked_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, current_version),
  CHECK (updated_at >= created_at),
  CHECK (locked_until IS NULL OR locked_until >= updated_at)
);

CREATE TABLE user_security_password_versions (
  user_id uuid NOT NULL REFERENCES user_security_passwords(user_id) ON DELETE CASCADE,
  version bigint NOT NULL CHECK (version > 0),
  kdf_algorithm text NOT NULL CHECK (kdf_algorithm = 'Argon2id'),
  kdf_domain text NOT NULL CHECK (kdf_domain = 'lpbot-security-password-kdf/v1'),
  parameter_version integer NOT NULL CHECK (parameter_version = 1),
  argon_version integer NOT NULL CHECK (argon_version = 19),
  memory_kib integer NOT NULL CHECK (memory_kib = 65536),
  iterations integer NOT NULL CHECK (iterations = 3),
  parallelism integer NOT NULL CHECK (parallelism = 1),
  output_bytes integer NOT NULL CHECK (output_bytes = 32),
  salt bytea NOT NULL CHECK (octet_length(salt) = 16),
  verifier bytea NOT NULL CHECK (octet_length(verifier) = 32),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, version)
);

ALTER TABLE user_security_passwords
  ADD CONSTRAINT user_security_passwords_current_version_fk
  FOREIGN KEY (user_id, current_version)
  REFERENCES user_security_password_versions(user_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER security_password_versions_immutable
BEFORE UPDATE OR DELETE ON user_security_password_versions
FOR EACH ROW EXECUTE FUNCTION prevent_security_password_version_mutation();

CREATE TABLE security_password_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (
    action IN ('security-password.create', 'security-password.change', 'security-password.verify')
  ),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  password_version bigint NOT NULL CHECK (password_version > 0),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL
);

CREATE INDEX security_password_audit_events_user_created_idx
  ON security_password_audit_events (user_id, created_at DESC, audit_id DESC);

CREATE TRIGGER security_password_audit_events_immutable
BEFORE UPDATE OR DELETE ON security_password_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_security_password_version_mutation();

COMMENT ON TABLE custody_wallet_tombstones IS
  'Non-secret durable evidence that all recoverable wallet envelopes were destroyed.';
COMMENT ON TABLE user_security_password_versions IS
  'Immutable security-password verifier versions in a KDF domain independent from Keystore.';

REVOKE ALL ON custody_wallet_delete_previews FROM PUBLIC;
REVOKE ALL ON custody_wallet_tombstones FROM PUBLIC;
REVOKE ALL ON user_security_passwords FROM PUBLIC;
REVOKE ALL ON user_security_password_versions FROM PUBLIC;
REVOKE ALL ON security_password_audit_events FROM PUBLIC;

-- migrate:down

DROP TABLE security_password_audit_events;
ALTER TABLE user_security_passwords
  DROP CONSTRAINT user_security_passwords_current_version_fk;
DROP TABLE user_security_password_versions;
DROP TABLE user_security_passwords;
DROP FUNCTION prevent_security_password_version_mutation();

DROP TABLE custody_wallet_tombstones;
DROP TABLE custody_wallet_delete_previews;

DROP TRIGGER custody_wallet_audit_events_append_only ON custody_wallet_audit_events;
DELETE FROM custody_wallet_audit_events
 WHERE action IN ('wallet.rename', 'wallet.delete', 'wallet.force-delete')
    OR NOT EXISTS (
      SELECT 1 FROM custody_wallets
       WHERE custody_wallets.wallet_id = custody_wallet_audit_events.wallet_id
    );
ALTER TABLE custody_wallet_audit_events
  DROP CONSTRAINT custody_wallet_audit_events_action_check;
ALTER TABLE custody_wallet_audit_events
  ADD CONSTRAINT custody_wallet_audit_events_action_check CHECK (
    action IN (
      'wallet.import',
      'wallet.generate',
      'wallet.lock',
      'wallet.quarantine',
      'wallet.recover',
      'wallet.password-change',
      'wallet.mode-switch',
      'keystore.reset'
    )
  );
ALTER TABLE custody_wallet_audit_events
  ADD CONSTRAINT custody_wallet_audit_events_wallet_id_fkey
  FOREIGN KEY (wallet_id) REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE;
ALTER TABLE custody_wallet_audit_events
  ADD CONSTRAINT custody_wallet_audit_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE TRIGGER custody_wallet_audit_events_append_only
BEFORE UPDATE OR DELETE ON custody_wallet_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_custody_append_only_mutation();

ALTER TABLE custody_wallets DROP CONSTRAINT custody_wallets_user_wallet_unique;
