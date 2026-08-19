-- migrate:up

CREATE FUNCTION prevent_wallet_helper_read_model_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'wallet Helper bindings and read snapshots are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE wallet_helper_bindings (
  binding_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  helper_version text NOT NULL CHECK (
    helper_version ~ '^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$'
  ),
  registry_version text NOT NULL CHECK (registry_version = 'p05-bsc-execution-v1'),
  source text NOT NULL CHECK (source IN ('deployment-result', 'trusted-migration')),
  bound_at timestamptz NOT NULL,
  FOREIGN KEY (user_id, wallet_id)
    REFERENCES custody_wallets(user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (chain_id, helper_address),
  UNIQUE (
    binding_id, user_id, wallet_id, chain_id, helper_address, helper_version
  )
);

CREATE INDEX wallet_helper_bindings_wallet_chain_latest_idx
  ON wallet_helper_bindings (user_id, wallet_id, chain_id, bound_at DESC, binding_id DESC);

CREATE TRIGGER wallet_helper_bindings_append_only
BEFORE UPDATE OR DELETE ON wallet_helper_bindings
FOR EACH ROW EXECUTE FUNCTION prevent_wallet_helper_read_model_mutation();

CREATE TABLE wallet_helper_verification_snapshots (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  helper_version text NOT NULL CHECK (
    helper_version ~ '^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$'
  ),
  failures jsonb NOT NULL CHECK (jsonb_typeof(failures) = 'array'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz NOT NULL,
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^0x[0-9a-f]{64}$'),
  observed_owner text CHECK (
    observed_owner IS NULL OR observed_owner ~ '^0x[0-9a-f]{40}$'
  ),
  observed_runtime_code_hash text CHECK (
    observed_runtime_code_hash IS NULL
    OR observed_runtime_code_hash ~ '^0x[0-9a-f]{64}$'
  ),
  observed_selectors jsonb NOT NULL CHECK (jsonb_typeof(observed_selectors) = 'array'),
  verified_at timestamptz NOT NULL,
  FOREIGN KEY (
    binding_id, user_id, wallet_id, chain_id, helper_address, helper_version
  ) REFERENCES wallet_helper_bindings(
    binding_id, user_id, wallet_id, chain_id, helper_address, helper_version
  ) ON DELETE CASCADE
);

CREATE INDEX wallet_helper_verification_snapshots_latest_idx
  ON wallet_helper_verification_snapshots (
    user_id, wallet_id, chain_id, verified_at DESC, verification_id DESC
  );

CREATE TRIGGER wallet_helper_verification_snapshots_append_only
BEFORE UPDATE OR DELETE ON wallet_helper_verification_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_wallet_helper_read_model_mutation();

CREATE TABLE wallet_helper_residual_snapshots (
  scan_id uuid PRIMARY KEY,
  binding_id uuid NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 56),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  helper_version text NOT NULL CHECK (
    helper_version ~ '^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$'
  ),
  idempotency_key text NOT NULL CHECK (
    idempotency_key ~ '^[A-Za-z0-9]([A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$'
  ),
  registry_version text NOT NULL CHECK (registry_version = 'p05-bsc-execution-v1'),
  allowlist_version text NOT NULL CHECK (
    allowlist_version ~ '^[a-z0-9]([a-z0-9.-]{0,62}[a-z0-9])?$'
  ),
  state text NOT NULL CHECK (state IN ('empty', 'ready', 'partial')),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^0x[0-9a-f]{64}$'),
  scanned_at timestamptz NOT NULL,
  FOREIGN KEY (
    binding_id, user_id, wallet_id, chain_id, helper_address, helper_version
  ) REFERENCES wallet_helper_bindings(
    binding_id, user_id, wallet_id, chain_id, helper_address, helper_version
  ) ON DELETE CASCADE,
  UNIQUE (user_id, wallet_id, chain_id, idempotency_key)
);

CREATE INDEX wallet_helper_residual_snapshots_latest_idx
  ON wallet_helper_residual_snapshots (
    user_id, wallet_id, chain_id, helper_address, scanned_at DESC, scan_id DESC
  );

CREATE TRIGGER wallet_helper_residual_snapshots_append_only
BEFORE UPDATE OR DELETE ON wallet_helper_residual_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_wallet_helper_read_model_mutation();

COMMENT ON TABLE wallet_helper_bindings IS
  'Trusted internal Helper identities for custody wallets; there is no client write endpoint.';
COMMENT ON TABLE wallet_helper_verification_snapshots IS
  'Append-only same-block Helper owner, runtime hash, selector, version, and canonical-block evidence.';
COMMENT ON TABLE wallet_helper_residual_snapshots IS
  'Append-only idempotent snapshots from bounded native, token, allowance, and known-NFT reads.';

REVOKE ALL ON wallet_helper_bindings FROM PUBLIC;
REVOKE ALL ON wallet_helper_verification_snapshots FROM PUBLIC;
REVOKE ALL ON wallet_helper_residual_snapshots FROM PUBLIC;

-- migrate:down

DROP TABLE wallet_helper_residual_snapshots;
DROP TABLE wallet_helper_verification_snapshots;
DROP TABLE wallet_helper_bindings;
DROP FUNCTION prevent_wallet_helper_read_model_mutation();
