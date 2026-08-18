-- migrate:up

ALTER TABLE custody_wallets DROP CONSTRAINT custody_wallets_mode_check;
ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_mode_check
  CHECK (mode IN ('server-kek', 'user-password'));

ALTER TABLE custody_wallet_envelopes
  ADD COLUMN dek_wrap_version integer NOT NULL DEFAULT 1 CHECK (dek_wrap_version = 1),
  ADD COLUMN dek_wrap_nonce bytea,
  ADD COLUMN dek_wrap_authentication_tag bytea,
  ADD COLUMN secret_version bigint;

ALTER TABLE custody_wallet_envelopes
  ADD CONSTRAINT custody_wallet_envelopes_wrap_shape_check CHECK (
    (
      kek_id = 'user-password'
      AND octet_length(wrapped_dek) = 32
      AND octet_length(dek_wrap_nonce) = 12
      AND octet_length(dek_wrap_authentication_tag) = 16
      AND secret_version > 0
    )
    OR
    (
      kek_id <> 'user-password'
      AND dek_wrap_nonce IS NULL
      AND dek_wrap_authentication_tag IS NULL
      AND secret_version IS NULL
    )
  );

CREATE TABLE user_keystores (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_secret_version bigint NOT NULL CHECK (current_secret_version > 0),
  auto_lock_minutes integer NOT NULL DEFAULT 15 CHECK (auto_lock_minutes IN (1, 5, 15, 30, 60)),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  UNIQUE (user_id, current_secret_version)
);

CREATE TABLE user_keystore_versions (
  user_id uuid NOT NULL REFERENCES user_keystores(user_id) ON DELETE CASCADE,
  secret_version bigint NOT NULL CHECK (secret_version > 0),
  kdf_algorithm text NOT NULL CHECK (kdf_algorithm = 'Argon2id'),
  parameter_version integer NOT NULL CHECK (parameter_version = 1),
  argon_version integer NOT NULL CHECK (argon_version = 19),
  memory_kib integer NOT NULL CHECK (memory_kib = 65536),
  iterations integer NOT NULL CHECK (iterations = 3),
  parallelism integer NOT NULL CHECK (parallelism = 1),
  output_bytes integer NOT NULL CHECK (output_bytes = 32),
  salt bytea NOT NULL CHECK (octet_length(salt) = 16),
  verifier bytea NOT NULL CHECK (octet_length(verifier) = 32),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('active', 'retired')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, secret_version)
);

CREATE UNIQUE INDEX user_keystore_versions_one_active
  ON user_keystore_versions (user_id)
  WHERE lifecycle_status = 'active';

ALTER TABLE user_keystores
  ADD CONSTRAINT user_keystores_current_version_fk
  FOREIGN KEY (user_id, current_secret_version)
  REFERENCES user_keystore_versions(user_id, secret_version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE user_keystore_failures (
  user_id uuid NOT NULL REFERENCES user_keystores(user_id) ON DELETE CASCADE,
  source_session_id text NOT NULL CHECK (
    char_length(source_session_id) BETWEEN 1 AND 128
    AND source_session_id !~ '[[:cntrl:]]'
  ),
  window_started_at timestamptz NOT NULL,
  failure_count integer NOT NULL CHECK (failure_count BETWEEN 1 AND 5),
  backoff_until timestamptz NOT NULL,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, source_session_id),
  CHECK (backoff_until >= window_started_at),
  CHECK (locked_until IS NULL OR locked_until >= window_started_at)
);

CREATE TABLE user_keystore_reset_previews (
  user_id uuid NOT NULL REFERENCES user_keystores(user_id) ON DELETE CASCADE,
  preview_token_digest bytea NOT NULL CHECK (octet_length(preview_token_digest) = 32),
  secret_version bigint NOT NULL CHECK (secret_version > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, preview_token_digest)
);

CREATE INDEX user_keystore_reset_previews_expiry_idx
  ON user_keystore_reset_previews (expires_at);

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

COMMENT ON TABLE user_keystore_versions IS
  'Signer-owned version metadata containing only salt, approved parameters, and an authentication verifier.';
COMMENT ON COLUMN custody_wallet_envelopes.dek_wrap_nonce IS
  'Independent AES-256-GCM nonce for a versioned user-password DEK wrap; absent for KMS wraps.';

REVOKE ALL ON user_keystore_versions FROM PUBLIC;
REVOKE ALL ON user_keystore_failures FROM PUBLIC;
REVOKE ALL ON user_keystore_reset_previews FROM PUBLIC;

-- migrate:down

ALTER TABLE custody_wallet_audit_events
  DROP CONSTRAINT custody_wallet_audit_events_action_check;
ALTER TABLE custody_wallet_audit_events
  ADD CONSTRAINT custody_wallet_audit_events_action_check CHECK (
    action IN ('wallet.import', 'wallet.generate', 'wallet.lock', 'wallet.quarantine', 'wallet.recover')
  );

DROP TABLE user_keystore_reset_previews;
DROP TABLE user_keystore_failures;
ALTER TABLE user_keystores DROP CONSTRAINT user_keystores_current_version_fk;
DROP TABLE user_keystore_versions;
DROP TABLE user_keystores;

ALTER TABLE custody_wallet_envelopes
  DROP CONSTRAINT custody_wallet_envelopes_wrap_shape_check;
ALTER TABLE custody_wallet_envelopes DROP COLUMN secret_version;
ALTER TABLE custody_wallet_envelopes DROP COLUMN dek_wrap_authentication_tag;
ALTER TABLE custody_wallet_envelopes DROP COLUMN dek_wrap_nonce;
ALTER TABLE custody_wallet_envelopes DROP COLUMN dek_wrap_version;

ALTER TABLE custody_wallets DROP CONSTRAINT custody_wallets_mode_check;
ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_mode_check
  CHECK (mode = 'server-kek');
