-- migrate:up

CREATE TABLE wallet_nonce_ledgers (
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  next_nonce numeric(78, 0),
  last_confirmed_nonce numeric(78, 0),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (chain_id, wallet_id),
  CHECK (next_nonce IS NULL OR next_nonce >= 0),
  CHECK (last_confirmed_nonce IS NULL OR last_confirmed_nonce >= 0),
  CHECK (updated_at >= created_at)
);

CREATE TABLE wallet_transfer_operations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  state text NOT NULL CHECK (state IN (
    'ready-for-approval', 'queued', 'signed', 'broadcast', 'pending',
    'confirmed', 'failed', 'dropped', 'replaced', 'reconciling'
  )),
  address_classification text NOT NULL CHECK (
    address_classification IN ('known-external', 'new-external', 'own-wallet')
  ),
  asset_kind text NOT NULL CHECK (asset_kind IN ('native', 'erc20')),
  token_address text CHECK (token_address IS NULL OR token_address ~ '^0x[0-9a-f]{40}$'),
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_unit numeric(78, 0) NOT NULL CHECK (amount_base_unit > 0),
  nonce numeric(78, 0),
  fencing_token bigint CHECK (fencing_token > 0),
  transaction_target text CHECK (
    transaction_target IS NULL OR transaction_target ~ '^0x[0-9a-f]{40}$'
  ),
  transaction_value_base_unit numeric(78, 0),
  transaction_data text CHECK (
    transaction_data IS NULL OR transaction_data ~ '^0x([0-9a-f]{2})*$'
  ),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  fee_cap_base_unit numeric(78, 0) NOT NULL CHECK (fee_cap_base_unit > 0),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (
    char_length(registry_version) BETWEEN 1 AND 120 AND registry_version !~ '[[:cntrl:]]'
  ),
  policy_version text NOT NULL CHECK (
    char_length(policy_version) BETWEEN 1 AND 120 AND policy_version !~ '[[:cntrl:]]'
  ),
  plan_deadline timestamptz,
  security_password_version bigint CHECK (security_password_version > 0),
  active_transaction_id uuid,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT wallet_transfer_operations_owner_fk
    FOREIGN KEY (user_id, wallet_id)
    REFERENCES custody_wallets(user_id, wallet_id)
    ON DELETE CASCADE,
  CONSTRAINT wallet_transfer_operations_owner_key UNIQUE (operation_id, user_id),
  CONSTRAINT wallet_transfer_operations_nonce_key UNIQUE (chain_id, wallet_id, nonce),
  CHECK (recipient <> wallet_address),
  CHECK (
    (asset_kind = 'native' AND token_address IS NULL)
    OR (asset_kind = 'erc20' AND token_address IS NOT NULL)
  ),
  CHECK (
    (nonce IS NULL AND fencing_token IS NULL AND transaction_target IS NULL
      AND transaction_value_base_unit IS NULL AND transaction_data IS NULL AND plan_deadline IS NULL)
    OR
    (nonce IS NOT NULL AND nonce >= 0 AND fencing_token IS NOT NULL AND transaction_target IS NOT NULL
      AND transaction_value_base_unit IS NOT NULL AND transaction_data IS NOT NULL
      AND plan_deadline IS NOT NULL)
  ),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE INDEX wallet_transfer_operations_user_created_idx
  ON wallet_transfer_operations (user_id, created_at DESC, operation_id DESC);
CREATE INDEX wallet_transfer_operations_recovery_idx
  ON wallet_transfer_operations (state, updated_at, operation_id)
  WHERE state IN ('queued', 'signed', 'broadcast', 'pending', 'reconciling');

CREATE TABLE wallet_transfer_idempotency (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_type text NOT NULL CHECK (command_type = 'wallet.transfer'),
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128
    AND idempotency_key ~ '^[!-~]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, command_type, wallet_id, idempotency_key),
  CONSTRAINT wallet_transfer_idempotency_operation_fk
    FOREIGN KEY (operation_id, user_id)
    REFERENCES wallet_transfer_operations(operation_id, user_id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE TABLE wallet_transfer_transactions (
  transaction_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES wallet_transfer_operations(operation_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  generation integer NOT NULL CHECK (generation >= 0),
  state text NOT NULL CHECK (state IN (
    'signed', 'broadcast', 'pending', 'confirmed', 'failed', 'dropped', 'replaced'
  )),
  active boolean NOT NULL,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  replaces_transaction_id uuid REFERENCES wallet_transfer_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES wallet_transfer_transactions(transaction_id),
  replacement_reason text CHECK (
    replacement_reason IS NULL OR char_length(replacement_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  signed_at timestamptz,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  UNIQUE (chain_id, wallet_id, nonce, generation),
  UNIQUE (operation_id, generation),
  CHECK (updated_at >= created_at),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (replaces_transaction_id IS NULL OR replaces_transaction_id <> transaction_id),
  CHECK (replaced_by_transaction_id IS NULL OR replaced_by_transaction_id <> transaction_id)
);

CREATE UNIQUE INDEX wallet_transfer_transactions_active_head_unique
  ON wallet_transfer_transactions (chain_id, wallet_id, nonce)
  WHERE active;
CREATE UNIQUE INDEX wallet_transfer_transactions_hash_unique
  ON wallet_transfer_transactions (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

ALTER TABLE wallet_transfer_operations
  ADD CONSTRAINT wallet_transfer_operations_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES wallet_transfer_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE wallet_transfer_outbox (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES wallet_transfer_operations(operation_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'wallet-transfer.ready-for-approval', 'wallet-transfer.queued',
    'wallet-transfer.reconciling', 'wallet-transfer.state-changed'
  )),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['operationId', 'walletId', 'chainId', 'state']
    AND payload - ARRAY['operationId', 'walletId', 'chainId', 'state'] = '{}'::jsonb
  ),
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  CHECK (
    (state = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX wallet_transfer_outbox_due_idx
  ON wallet_transfer_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE wallet_transfer_reconciliation_cases (
  reconciliation_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES wallet_transfer_operations(operation_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  provider_evidence_digest text CHECK (
    provider_evidence_digest IS NULL OR provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX wallet_transfer_reconciliation_open_unique
  ON wallet_transfer_reconciliation_cases (operation_id)
  WHERE status = 'open';

CREATE TABLE wallet_transfer_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES wallet_transfer_transactions(transaction_id) ON DELETE CASCADE,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  canonical boolean NOT NULL,
  receipt_status text NOT NULL CHECK (receipt_status IN ('success', 'reverted')),
  nonce_reconciled boolean NOT NULL,
  balance_reconciled boolean NOT NULL,
  transfer_log_reconciled boolean NOT NULL,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest)
);

CREATE TABLE wallet_transfer_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid,
  session_id uuid,
  operation_id uuid,
  wallet_id uuid,
  chain_id bigint,
  nonce numeric(78, 0),
  transaction_hash text,
  plan_digest text,
  state text,
  action text NOT NULL CHECK (action IN (
    'transfer.submitted', 'transfer.nonce-reserved', 'transfer.signed',
    'transfer.broadcast', 'transfer.pending', 'transfer.confirmed',
    'transfer.failed', 'transfer.dropped', 'transfer.replaced', 'transfer.reconciled'
  )),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL,
  CHECK (chain_id IS NULL OR chain_id > 0),
  CHECK (nonce IS NULL OR nonce >= 0),
  CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CHECK (plan_digest IS NULL OR plan_digest ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX wallet_transfer_audit_user_created_idx
  ON wallet_transfer_audit_events (actor_user_id, created_at DESC, audit_id DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE FUNCTION reject_wallet_transfer_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet transfer audit and receipt evidence are append-only';
END;
$$;

CREATE TRIGGER wallet_transfer_audit_append_only
BEFORE UPDATE OR DELETE ON wallet_transfer_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_wallet_transfer_audit_mutation();

CREATE TRIGGER wallet_transfer_receipt_evidence_append_only
BEFORE UPDATE OR DELETE ON wallet_transfer_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_wallet_transfer_audit_mutation();

COMMENT ON TABLE wallet_nonce_ledgers IS
  'PostgreSQL source of truth for chainId+walletId nonce allocation and fencing.';
COMMENT ON TABLE wallet_transfer_outbox IS
  'Credential-free operation intents. Raw signed transactions are forbidden from this queue.';
COMMENT ON TABLE wallet_transfer_transactions IS
  'Transaction lineage metadata and hashes only; raw signed transactions are never persisted.';
COMMENT ON TABLE wallet_transfer_audit_events IS
  'Append-only transfer decisions without passwords, private material, raw transactions, or provider credentials.';

REVOKE ALL ON wallet_nonce_ledgers FROM PUBLIC;
REVOKE ALL ON wallet_transfer_operations FROM PUBLIC;
REVOKE ALL ON wallet_transfer_idempotency FROM PUBLIC;
REVOKE ALL ON wallet_transfer_transactions FROM PUBLIC;
REVOKE ALL ON wallet_transfer_outbox FROM PUBLIC;
REVOKE ALL ON wallet_transfer_reconciliation_cases FROM PUBLIC;
REVOKE ALL ON wallet_transfer_receipt_evidence FROM PUBLIC;
REVOKE ALL ON wallet_transfer_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER wallet_transfer_receipt_evidence_append_only ON wallet_transfer_receipt_evidence;
DROP TRIGGER wallet_transfer_audit_append_only ON wallet_transfer_audit_events;
DROP FUNCTION reject_wallet_transfer_audit_mutation();
DROP TABLE wallet_transfer_audit_events;
DROP TABLE wallet_transfer_receipt_evidence;
DROP TABLE wallet_transfer_reconciliation_cases;
DROP TABLE wallet_transfer_outbox;
ALTER TABLE wallet_transfer_operations DROP CONSTRAINT wallet_transfer_operations_active_transaction_fk;
DROP TABLE wallet_transfer_transactions;
DROP TABLE wallet_transfer_idempotency;
DROP TABLE wallet_transfer_operations;
DROP TABLE wallet_nonce_ledgers;
