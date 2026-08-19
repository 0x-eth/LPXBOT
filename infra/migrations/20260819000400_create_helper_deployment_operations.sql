-- migrate:up

CREATE FUNCTION reject_chain_operation_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'chain operation evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE helper_deployment_previews (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  facts_payload jsonb NOT NULL CHECK (jsonb_typeof(facts_payload) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT helper_deployment_previews_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX helper_deployment_previews_expiry_idx
  ON helper_deployment_previews (expires_at);

CREATE TABLE chain_operations (
  operation_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  operation_kind text NOT NULL CHECK (operation_kind = 'helper-deployment'),
  state text NOT NULL CHECK (state IN (
    'queued', 'signed', 'broadcast', 'pending', 'confirmed', 'succeeded',
    'failed', 'dropped', 'reconciling'
  )),
  helper_version text NOT NULL CHECK (helper_version = 'WalletHelperV1'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-helper-deployment-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_block_number numeric(78, 0) NOT NULL CHECK (registry_block_number >= 0),
  expected_address text NOT NULL CHECK (expected_address ~ '^0x[0-9a-f]{40}$'),
  expected_runtime_code_hash text NOT NULL CHECK (
    expected_runtime_code_hash ~ '^0x[0-9a-f]{64}$'
  ),
  creation_code_hash text NOT NULL CHECK (creation_code_hash ~ '^0x[0-9a-f]{64}$'),
  constructor_arguments_hash text NOT NULL CHECK (
    constructor_arguments_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  adapter_address text NOT NULL CHECK (adapter_address ~ '^0x[0-9a-f]{40}$'),
  permit2_address text NOT NULL CHECK (permit2_address ~ '^0x[0-9a-f]{40}$'),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  transaction_to text CHECK (transaction_to IS NULL),
  transaction_value_base_unit numeric(78, 0) NOT NULL CHECK (transaction_value_base_unit = 0),
  transaction_data text NOT NULL CHECK (transaction_data ~ '^0x([0-9a-f]{2})+$'),
  transaction_data_hash text NOT NULL CHECK (transaction_data_hash ~ '^0x[0-9a-f]{64}$'),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  fee_cap_base_unit numeric(78, 0) NOT NULL CHECK (fee_cap_base_unit > 0),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_deadline timestamptz NOT NULL,
  plan_payload jsonb NOT NULL CHECK (
    jsonb_typeof(plan_payload) = 'object'
    AND plan_payload ->> 'planVersion' = 'p05-helper-deployment-plan-v2'
    AND plan_payload #> '{transaction,to}' = 'null'::jsonb
    AND plan_payload #>> '{transaction,valueBaseUnit}' = '0'
  ),
  reauthenticated_session_id uuid NOT NULL,
  active_transaction_id uuid,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT chain_operations_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  CONSTRAINT chain_operations_owner_key UNIQUE (operation_id, tenant_id, user_id),
  CONSTRAINT chain_operations_nonce_key UNIQUE (chain_id, wallet_id, nonce),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE INDEX chain_operations_owner_created_idx
  ON chain_operations (tenant_id, user_id, created_at DESC, operation_id DESC);
CREATE INDEX chain_operations_recovery_idx
  ON chain_operations (state, updated_at, operation_id)
  WHERE state IN ('queued', 'signed', 'broadcast', 'pending', 'confirmed', 'reconciling');

CREATE TABLE chain_operation_idempotency (
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type = 'helper.deploy'),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[!-~]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, wallet_id, command_type, idempotency_key),
  CONSTRAINT chain_operation_idempotency_operation_fk
    FOREIGN KEY (operation_id, tenant_id, user_id)
    REFERENCES chain_operations(operation_id, tenant_id, user_id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE TABLE chain_operation_transactions (
  transaction_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
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
  replaces_transaction_id uuid REFERENCES chain_operation_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES chain_operation_transactions(transaction_id),
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
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit)
);

CREATE UNIQUE INDEX chain_operation_transactions_active_head_unique
  ON chain_operation_transactions (chain_id, wallet_id, nonce)
  WHERE active;
CREATE UNIQUE INDEX chain_operation_transactions_hash_unique
  ON chain_operation_transactions (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

ALTER TABLE chain_operations
  ADD CONSTRAINT chain_operations_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES chain_operation_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE chain_operation_replacement_authorizations (
  authorization_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  replaced_transaction_id uuid NOT NULL REFERENCES chain_operation_transactions(transaction_id),
  generation integer NOT NULL CHECK (generation > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  fee_cap_base_unit numeric(78, 0) NOT NULL CHECK (fee_cap_base_unit > 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  state text NOT NULL CHECK (state IN ('pending', 'consumed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (operation_id, generation),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK (expires_at > created_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE UNIQUE INDEX chain_operation_replacement_pending_unique
  ON chain_operation_replacement_authorizations (operation_id)
  WHERE state = 'pending';

CREATE TABLE chain_operation_outbox (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'chain-operation.queued', 'chain-operation.state-changed',
    'chain-operation.reconciling'
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
    (state = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX chain_operation_outbox_due_idx
  ON chain_operation_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE chain_operation_reconciliation_cases (
  reconciliation_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  provider_evidence_digest text CHECK (
    provider_evidence_digest IS NULL OR provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX chain_operation_reconciliation_open_unique
  ON chain_operation_reconciliation_cases (operation_id)
  WHERE status = 'open';

CREATE TABLE chain_operation_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES chain_operation_transactions(transaction_id) ON DELETE CASCADE,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  canonical boolean NOT NULL,
  receipt_status text NOT NULL CHECK (receipt_status IN ('success', 'reverted')),
  contract_address text CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'),
  runtime_code_hash text CHECK (runtime_code_hash IS NULL OR runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  observed_owner text CHECK (observed_owner IS NULL OR observed_owner ~ '^0x[0-9a-f]{40}$'),
  observed_adapter text CHECK (observed_adapter IS NULL OR observed_adapter ~ '^0x[0-9a-f]{40}$'),
  observed_permit2 text CHECK (observed_permit2 IS NULL OR observed_permit2 ~ '^0x[0-9a-f]{40}$'),
  contract_address_reconciled boolean NOT NULL,
  runtime_code_reconciled boolean NOT NULL,
  owner_reconciled boolean NOT NULL,
  constructor_reconciled boolean NOT NULL,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest)
);

CREATE TABLE wallet_helper_deployment_bindings (
  binding_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  helper_version text NOT NULL CHECK (helper_version = 'WalletHelperV1'),
  operation_id uuid NOT NULL UNIQUE REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('deploying', 'active', 'degraded')),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  adapter_address text NOT NULL CHECK (adapter_address ~ '^0x[0-9a-f]{40}$'),
  permit2_address text NOT NULL CHECK (permit2_address ~ '^0x[0-9a-f]{40}$'),
  runtime_code_hash text NOT NULL CHECK (runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-helper-deployment-v2'),
  deployment_transaction_hash text CHECK (
    deployment_transaction_hash IS NULL OR deployment_transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  verified_block_number numeric(78, 0),
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT wallet_helper_deployment_bindings_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, wallet_id, chain_id, helper_version),
  UNIQUE (chain_id, helper_address),
  CHECK ((state = 'active') = (deployment_transaction_hash IS NOT NULL
    AND verified_block_number IS NOT NULL AND failure_code IS NULL)),
  CHECK (updated_at >= created_at)
);

CREATE TABLE chain_operation_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES chain_operations(operation_id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  nonce numeric(78, 0),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL,
  action text NOT NULL CHECK (action ~ '^helper\.[a-z-]+$'),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'reconciled')),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);

CREATE INDEX chain_operation_audit_owner_created_idx
  ON chain_operation_audit_events (tenant_id, actor_user_id, created_at DESC, audit_id DESC);

CREATE TRIGGER chain_operation_receipt_evidence_append_only
BEFORE UPDATE OR DELETE ON chain_operation_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_chain_operation_evidence_mutation();

CREATE TRIGGER chain_operation_audit_append_only
BEFORE UPDATE OR DELETE ON chain_operation_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_chain_operation_evidence_mutation();

COMMENT ON TABLE chain_operations IS
  'Immutable plan-bound local chain writes; helper deployment transactions always have NULL to and zero value.';
COMMENT ON TABLE chain_operation_outbox IS
  'Credential-free durable work intents. Raw signed transactions are forbidden.';
COMMENT ON TABLE wallet_helper_deployment_bindings IS
  'Per-wallet Helper instances, separate from the Registry bytecode template.';

REVOKE ALL ON helper_deployment_previews FROM PUBLIC;
REVOKE ALL ON chain_operations FROM PUBLIC;
REVOKE ALL ON chain_operation_idempotency FROM PUBLIC;
REVOKE ALL ON chain_operation_transactions FROM PUBLIC;
REVOKE ALL ON chain_operation_replacement_authorizations FROM PUBLIC;
REVOKE ALL ON chain_operation_outbox FROM PUBLIC;
REVOKE ALL ON chain_operation_reconciliation_cases FROM PUBLIC;
REVOKE ALL ON chain_operation_receipt_evidence FROM PUBLIC;
REVOKE ALL ON wallet_helper_deployment_bindings FROM PUBLIC;
REVOKE ALL ON chain_operation_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER chain_operation_audit_append_only ON chain_operation_audit_events;
DROP TRIGGER chain_operation_receipt_evidence_append_only ON chain_operation_receipt_evidence;
DROP TABLE chain_operation_audit_events;
DROP TABLE wallet_helper_deployment_bindings;
DROP TABLE chain_operation_receipt_evidence;
DROP TABLE chain_operation_reconciliation_cases;
DROP TABLE chain_operation_outbox;
DROP TABLE chain_operation_replacement_authorizations;
ALTER TABLE chain_operations DROP CONSTRAINT chain_operations_active_transaction_fk;
DROP TABLE chain_operation_transactions;
DROP TABLE chain_operation_idempotency;
DROP TABLE chain_operations;
DROP TABLE helper_deployment_previews;
DROP FUNCTION reject_chain_operation_evidence_mutation();
