-- migrate:up

CREATE FUNCTION reject_local_helper_sweep_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'local Helper sweep evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE local_helper_residual_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  binding_id uuid NOT NULL REFERENCES wallet_helper_deployment_bindings(binding_id),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  runtime_code_hash text NOT NULL CHECK (runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  binding_state text NOT NULL CHECK (binding_state IN ('active', 'degraded')),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  snapshot_version text NOT NULL CHECK (
    snapshot_version = 'p05-local-helper-residual-snapshot-v2'
  ),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-helper-sweep-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  coverage_complete boolean NOT NULL,
  manual_recovery_required boolean NOT NULL,
  snapshot_payload jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot_payload) = 'object'
    AND snapshot_payload ->> 'schemaVersion' = '2'
    AND snapshot_payload ->> 'chainId' = '31337'
    AND snapshot_payload ->> 'snapshotVersion' = 'p05-local-helper-residual-snapshot-v2'
    AND snapshot_payload #>> '{registry,version}' = 'p05-local-helper-sweep-v2'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, wallet_id, idempotency_key),
  UNIQUE (tenant_id, user_id, wallet_id, snapshot_digest),
  CHECK (observed_at < expires_at),
  CHECK (block_timestamp <= observed_at)
);

CREATE INDEX local_helper_residual_latest_idx
  ON local_helper_residual_snapshots (
    tenant_id, user_id, wallet_id, observed_at DESC, snapshot_id DESC
  );

CREATE TRIGGER local_helper_residual_snapshots_append_only
BEFORE UPDATE OR DELETE ON local_helper_residual_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_sweep_evidence_mutation();

CREATE TABLE local_helper_sweep_previews (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND request_payload - ARRAY['walletId', 'chainId', 'assetIds', 'snapshotDigest'] = '{}'::jsonb
    AND NOT (request_payload ?| ARRAY[
      'helper', 'token', 'target', 'selector', 'calldata', 'amount', 'recipient',
      'fee', 'feeLimit', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas'
    ])
  ),
  facts_payload jsonb NOT NULL CHECK (jsonb_typeof(facts_payload) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id, snapshot_digest)
    REFERENCES local_helper_residual_snapshots(tenant_id, user_id, wallet_id, snapshot_digest)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX local_helper_sweep_previews_expiry_idx
  ON local_helper_sweep_previews (expires_at);

CREATE TRIGGER local_helper_sweep_previews_append_only
BEFORE UPDATE OR DELETE ON local_helper_sweep_previews
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_sweep_evidence_mutation();

CREATE TABLE local_helper_sweep_batches (
  batch_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  helper_binding_id uuid NOT NULL REFERENCES wallet_helper_deployment_bindings(binding_id),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  state text NOT NULL CHECK (state IN (
    'queued', 'running', 'partial', 'reconciling', 'succeeded', 'failed',
    'manual-recovery-required'
  )),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-helper-sweep-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[!-~]+$'
  ),
  reauthenticated_session_id uuid NOT NULL,
  rescan_state text NOT NULL DEFAULT 'pending' CHECK (
    rescan_state IN ('pending', 'running', 'passed', 'failed', 'manual-recovery-required')
  ),
  rescan_snapshot_digest text CHECK (
    rescan_snapshot_digest IS NULL OR rescan_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id, wallet_id, snapshot_digest)
    REFERENCES local_helper_residual_snapshots(tenant_id, user_id, wallet_id, snapshot_digest),
  UNIQUE (batch_id, tenant_id, user_id),
  UNIQUE (tenant_id, user_id, wallet_id, idempotency_key),
  CHECK (updated_at >= created_at),
  CHECK ((rescan_state IN ('passed', 'manual-recovery-required')) =
    (rescan_snapshot_digest IS NOT NULL))
);

CREATE INDEX local_helper_sweep_batches_owner_idx
  ON local_helper_sweep_batches (tenant_id, user_id, created_at DESC, batch_id DESC);
CREATE UNIQUE INDEX local_helper_sweep_batches_wallet_live_unique
  ON local_helper_sweep_batches (chain_id, wallet_id)
  WHERE state IN ('queued', 'running', 'reconciling');

CREATE TABLE local_helper_sweep_operations (
  operation_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES local_helper_sweep_batches(batch_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 2),
  operation_kind text NOT NULL CHECK (operation_kind = 'helper-residual-sweep'),
  state text NOT NULL CHECK (state IN (
    'queued', 'signing', 'broadcast', 'pending', 'confirmed', 'succeeded',
    'failed', 'dropped', 'reconciling'
  )),
  asset_id text NOT NULL CHECK (char_length(asset_id) BETWEEN 1 AND 128),
  asset_kind text NOT NULL CHECK (asset_kind IN ('native', 'token')),
  token_address text CHECK (token_address IS NULL OR token_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_unit numeric(78, 0) NOT NULL CHECK (amount_base_unit > 0),
  dust_base_unit numeric(78, 0) NOT NULL CHECK (dust_base_unit >= 0),
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_to text NOT NULL CHECK (transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_value_base_unit numeric(78, 0) NOT NULL CHECK (transaction_value_base_unit = 0),
  transaction_selector text NOT NULL CHECK (
    transaction_selector IN ('0x3609afa9', '0x6971b189')
  ),
  transaction_data text NOT NULL CHECK (transaction_data ~ '^0x([0-9a-f]{2})+$'),
  transaction_data_digest text NOT NULL CHECK (
    transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  fee_cap_base_unit numeric(78, 0) NOT NULL CHECK (fee_cap_base_unit > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_deadline timestamptz NOT NULL,
  plan_payload jsonb NOT NULL CHECK (
    jsonb_typeof(plan_payload) = 'object'
    AND plan_payload ->> 'schemaVersion' = '2'
    AND plan_payload ->> 'planVersion' = 'p05-local-helper-sweep-plan-v2'
    AND plan_payload ->> 'serviceFeeBps' = '0'
    AND plan_payload #>> '{transaction,to}' = helper_address
    AND plan_payload #>> '{transaction,valueBaseUnit}' = '0'
    AND plan_payload ->> 'recipient' = recipient
  ),
  active_transaction_id uuid,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (batch_id, tenant_id, user_id)
    REFERENCES local_helper_sweep_batches(batch_id, tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (batch_id, ordinal),
  UNIQUE (batch_id, asset_id),
  UNIQUE (chain_id, wallet_id, nonce),
  CHECK ((asset_kind = 'native' AND token_address IS NULL AND asset_id = 'native:31337'
      AND transaction_selector = '0x6971b189')
    OR (asset_kind = 'token' AND token_address IS NOT NULL
      AND asset_id = 'token:' || token_address AND transaction_selector = '0x3609afa9')),
  CHECK (amount_base_unit > dust_base_unit),
  CHECK (recipient <> helper_address),
  CHECK (transaction_to = helper_address),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_helper_sweep_operations_recovery_idx
  ON local_helper_sweep_operations (state, updated_at, operation_id)
  WHERE state IN ('queued', 'signed', 'broadcast', 'pending', 'dropped', 'reconciling');

CREATE TABLE local_helper_sweep_transactions (
  transaction_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES local_helper_sweep_batches(batch_id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation >= 0),
  state text NOT NULL CHECK (state IN (
    'signed', 'broadcast', 'pending', 'confirmed', 'failed', 'dropped', 'replaced'
  )),
  active boolean NOT NULL,
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_to text NOT NULL CHECK (transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_data_digest text NOT NULL CHECK (
    transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  delivery_id text CHECK (delivery_id IS NULL OR char_length(delivery_id) BETWEEN 1 AND 160),
  replaces_transaction_id uuid REFERENCES local_helper_sweep_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES local_helper_sweep_transactions(transaction_id),
  replacement_reason text CHECK (
    replacement_reason IS NULL OR char_length(replacement_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  signed_at timestamptz,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  UNIQUE (operation_id, generation),
  UNIQUE (transaction_hash),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX local_helper_sweep_transactions_active_unique
  ON local_helper_sweep_transactions (operation_id) WHERE active;

ALTER TABLE local_helper_sweep_operations
  ADD CONSTRAINT local_helper_sweep_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES local_helper_sweep_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE local_helper_sweep_replacement_authorizations (
  authorization_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  replaced_transaction_id uuid NOT NULL REFERENCES local_helper_sweep_transactions(transaction_id),
  generation integer NOT NULL CHECK (generation > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_data_digest text NOT NULL CHECK (
    transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  amount_base_unit numeric(78, 0) NOT NULL CHECK (amount_base_unit > 0),
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9a-f]{40}$'),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  state text NOT NULL CHECK (state IN ('pending', 'consumed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (operation_id, generation),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (expires_at > created_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_helper_sweep_replacement_pending_unique
  ON local_helper_sweep_replacement_authorizations (operation_id) WHERE state = 'pending';

CREATE TABLE local_helper_sweep_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES local_helper_sweep_transactions(transaction_id) ON DELETE CASCADE,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  canonical boolean NOT NULL,
  confirmations numeric(78, 0) NOT NULL CHECK (confirmations >= 0),
  receipt_status text NOT NULL CHECK (receipt_status IN ('success', 'reverted')),
  asset_kind text NOT NULL CHECK (asset_kind IN ('native', 'token')),
  token_address text CHECK (token_address IS NULL OR token_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_unit numeric(78, 0) NOT NULL CHECK (amount_base_unit > 0),
  transfer_from text CHECK (transfer_from IS NULL OR transfer_from ~ '^0x[0-9a-f]{40}$'),
  transfer_to text CHECK (transfer_to IS NULL OR transfer_to ~ '^0x[0-9a-f]{40}$'),
  transfer_amount_base_unit numeric(78, 0),
  helper_balance_before numeric(78, 0) NOT NULL CHECK (helper_balance_before >= 0),
  helper_balance_after numeric(78, 0) NOT NULL CHECK (helper_balance_after >= 0),
  owner_balance_before numeric(78, 0) NOT NULL CHECK (owner_balance_before >= 0),
  owner_balance_after numeric(78, 0) NOT NULL CHECK (owner_balance_after >= 0),
  gas_used numeric(78, 0) NOT NULL CHECK (gas_used >= 0),
  effective_gas_price numeric(78, 0) NOT NULL CHECK (effective_gas_price >= 0),
  helper_runtime_code_hash text CHECK (
    helper_runtime_code_hash IS NULL OR helper_runtime_code_hash ~ '^0x[0-9a-f]{64}$'
  ),
  observed_owner text CHECK (observed_owner IS NULL OR observed_owner ~ '^0x[0-9a-f]{40}$'),
  reconciled boolean NOT NULL,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest),
  CHECK ((asset_kind = 'native') = (token_address IS NULL)),
  CHECK ((asset_kind = 'token') =
    (transfer_from IS NOT NULL AND transfer_to IS NOT NULL AND transfer_amount_base_unit IS NOT NULL))
);

CREATE TRIGGER local_helper_sweep_receipts_append_only
BEFORE UPDATE OR DELETE ON local_helper_sweep_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_sweep_evidence_mutation();

CREATE TABLE local_helper_sweep_reconciliation_cases (
  reconciliation_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  provider_evidence_digest text CHECK (
    provider_evidence_digest IS NULL OR provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_helper_sweep_reconciliation_open_unique
  ON local_helper_sweep_reconciliation_cases (operation_id) WHERE status = 'open';

CREATE TABLE local_helper_sweep_outbox (
  event_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES local_helper_sweep_batches(batch_id) ON DELETE CASCADE,
  operation_id uuid REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'helper-sweep.operation-queued', 'helper-sweep.operation-state-changed',
    'helper-sweep.operation-reconciling', 'helper-sweep.batch-rescan-required'
  )),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
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
    OR (state <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX local_helper_sweep_outbox_due_idx
  ON local_helper_sweep_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE local_helper_sweep_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES local_helper_sweep_batches(batch_id) ON DELETE CASCADE,
  operation_id uuid REFERENCES local_helper_sweep_operations(operation_id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  asset_id text,
  nonce numeric(78, 0),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  plan_digest text CHECK (plan_digest IS NULL OR plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action ~ '^helper-sweep\.[a-z-]+$'),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'reconciled')),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);

CREATE TRIGGER local_helper_sweep_audit_append_only
BEFORE UPDATE OR DELETE ON local_helper_sweep_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_sweep_evidence_mutation();

COMMENT ON TABLE local_helper_residual_snapshots IS
  'Independent local chainId 31337 Helper residual evidence; BSC read snapshots remain separate.';
COMMENT ON TABLE local_helper_sweep_operations IS
  'One typed owner-only WalletHelperV1 sweep call per allowlisted residual asset.';
COMMENT ON TABLE local_helper_sweep_outbox IS
  'Credential-free operation and mandatory post-sweep rescan work; raw transactions are forbidden.';

REVOKE ALL ON local_helper_residual_snapshots FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_previews FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_batches FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_operations FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_transactions FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_replacement_authorizations FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_receipt_evidence FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_reconciliation_cases FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_outbox FROM PUBLIC;
REVOKE ALL ON local_helper_sweep_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER local_helper_sweep_audit_append_only ON local_helper_sweep_audit_events;
DROP TABLE local_helper_sweep_audit_events;
DROP TABLE local_helper_sweep_outbox;
DROP TABLE local_helper_sweep_reconciliation_cases;
DROP TRIGGER local_helper_sweep_receipts_append_only ON local_helper_sweep_receipt_evidence;
DROP TABLE local_helper_sweep_receipt_evidence;
DROP TABLE local_helper_sweep_replacement_authorizations;
ALTER TABLE local_helper_sweep_operations DROP CONSTRAINT local_helper_sweep_active_transaction_fk;
DROP TABLE local_helper_sweep_transactions;
DROP TABLE local_helper_sweep_operations;
DROP TABLE local_helper_sweep_batches;
DROP TRIGGER local_helper_sweep_previews_append_only ON local_helper_sweep_previews;
DROP TABLE local_helper_sweep_previews;
DROP TRIGGER local_helper_residual_snapshots_append_only ON local_helper_residual_snapshots;
DROP TABLE local_helper_residual_snapshots;
DROP FUNCTION reject_local_helper_sweep_evidence_mutation();
