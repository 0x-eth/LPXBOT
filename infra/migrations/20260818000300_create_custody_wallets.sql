-- migrate:up

CREATE FUNCTION prevent_custody_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'custody envelope and audit records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE custody_wallets (
  wallet_id uuid PRIMARY KEY,
  tenant_id text NOT NULL CHECK (
    tenant_id ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
  ),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (
    char_length(name) BETWEEN 1 AND 80
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
  ),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  address_lower text NOT NULL CHECK (address_lower ~ '^0x[0-9a-f]{40}$'),
  mode text NOT NULL CHECK (mode = 'server-kek'),
  lock_status text NOT NULL CHECK (lock_status IN ('ready', 'locked', 'quarantined')),
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'recoverable', 'retired')),
  current_envelope_version integer NOT NULL CHECK (current_envelope_version > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at),
  CHECK (lower(address) = address_lower),
  UNIQUE (wallet_id, current_envelope_version)
);

CREATE UNIQUE INDEX custody_wallets_user_active_address_unique
  ON custody_wallets (user_id, address_lower)
  WHERE lifecycle_status IN ('active', 'recoverable');

CREATE INDEX custody_wallets_user_created_idx
  ON custody_wallets (user_id, created_at DESC, wallet_id DESC);

CREATE TABLE custody_wallet_envelopes (
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  envelope_version integer NOT NULL CHECK (envelope_version > 0),
  algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) = 32),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  aad_version integer NOT NULL CHECK (aad_version = 1),
  wrapped_dek bytea NOT NULL CHECK (octet_length(wrapped_dek) > 0),
  kek_id text NOT NULL CHECK (kek_id ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'),
  kek_version text NOT NULL CHECK (
    kek_version ~ '^[a-z0-9]([a-z0-9._:-]{0,126}[a-z0-9])?$'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (wallet_id, envelope_version)
);

ALTER TABLE custody_wallets
  ADD CONSTRAINT custody_wallets_current_envelope_fk
  FOREIGN KEY (wallet_id, current_envelope_version)
  REFERENCES custody_wallet_envelopes(wallet_id, envelope_version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER custody_wallet_envelopes_append_only
BEFORE UPDATE OR DELETE ON custody_wallet_envelopes
FOR EACH ROW EXECUTE FUNCTION prevent_custody_append_only_mutation();

CREATE TABLE custody_wallet_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (
    action IN ('wallet.import', 'wallet.generate', 'wallet.lock', 'wallet.quarantine', 'wallet.recover')
  ),
  outcome text NOT NULL CHECK (outcome = 'allowed'),
  wallet_revision bigint NOT NULL CHECK (wallet_revision > 0),
  envelope_version integer NOT NULL CHECK (envelope_version > 0),
  created_at timestamptz NOT NULL
);

CREATE INDEX custody_wallet_audit_events_user_created_idx
  ON custody_wallet_audit_events (user_id, created_at DESC, audit_id DESC);

CREATE TRIGGER custody_wallet_audit_events_append_only
BEFORE UPDATE OR DELETE ON custody_wallet_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_custody_append_only_mutation();

COMMENT ON TABLE custody_wallet_envelopes IS
  'Signer-owned append-only AES-256-GCM envelopes containing only authenticated encrypted material.';
COMMENT ON COLUMN custody_wallet_envelopes.wrapped_dek IS
  'Opaque KMS ciphertext containing one independently generated wallet-version DEK.';
COMMENT ON TABLE custody_wallets IS
  'Ordinary user-scoped custody metadata. This table carries no secret or decryption capability.';

REVOKE ALL ON custody_wallet_envelopes FROM PUBLIC;
REVOKE ALL ON custody_wallet_audit_events FROM PUBLIC;

-- migrate:down

ALTER TABLE custody_wallets DROP CONSTRAINT custody_wallets_current_envelope_fk;
DROP TABLE custody_wallet_audit_events;
DROP TABLE custody_wallet_envelopes;
DROP TABLE custody_wallets;
DROP FUNCTION prevent_custody_append_only_mutation();
