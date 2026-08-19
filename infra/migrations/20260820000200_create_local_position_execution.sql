-- migrate:up

CREATE FUNCTION reject_local_position_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'local position evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE local_position_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  platform_id integer NOT NULL CHECK (platform_id IN (1, 2, 4, 5)),
  token_id numeric(78, 0) NOT NULL CHECK (token_id > 0),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  approved_address text CHECK (approved_address IS NULL OR approved_address ~ '^0x[0-9a-f]{40}$'),
  approved_for_all boolean NOT NULL,
  approval_operator text CHECK (approval_operator IS NULL OR approval_operator ~ '^0x[0-9a-f]{40}$'),
  manager_address text NOT NULL CHECK (manager_address ~ '^0x[0-9a-f]{40}$'),
  manager_abi_hash text NOT NULL CHECK (manager_abi_hash ~ '^sha256:[0-9a-f]{64}$'),
  manager_runtime_code_hash text NOT NULL CHECK (manager_runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  token0 text NOT NULL CHECK (token0 ~ '^0x[0-9a-f]{40}$'),
  token1 text NOT NULL CHECK (token1 ~ '^0x[0-9a-f]{40}$'),
  pool_address text CHECK (pool_address IS NULL OR pool_address ~ '^0x[0-9a-f]{40}$'),
  pool_id text CHECK (pool_id IS NULL OR pool_id ~ '^0x[0-9a-f]{64}$'),
  tick_lower numeric(78, 0) NOT NULL,
  tick_upper numeric(78, 0) NOT NULL,
  tick_spacing numeric(78, 0) NOT NULL CHECK (tick_spacing <> 0),
  fee_pips numeric(78, 0) NOT NULL CHECK (fee_pips >= 0),
  liquidity numeric(78, 0) NOT NULL CHECK (liquidity >= 0),
  reserve0_base_unit numeric(78, 0) NOT NULL CHECK (reserve0_base_unit >= 0),
  reserve1_base_unit numeric(78, 0) NOT NULL CHECK (reserve1_base_unit >= 0),
  tokens_owed0_base_unit numeric(78, 0) NOT NULL CHECK (tokens_owed0_base_unit >= 0),
  tokens_owed1_base_unit numeric(78, 0) NOT NULL CHECK (tokens_owed1_base_unit >= 0),
  observed_block_number numeric(78, 0) NOT NULL CHECK (observed_block_number >= 0),
  observed_block_hash text NOT NULL CHECK (observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  snapshot_version text NOT NULL CHECK (snapshot_version = 'p05-local-position-snapshot-v2'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-position-execution-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  pricing_id uuid,
  snapshot_payload jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot_payload) = 'object'
    AND snapshot_payload ->> 'snapshotVersion' = 'p05-local-position-snapshot-v2'
    AND snapshot_payload ->> 'schemaVersion' = '2'
    AND snapshot_payload ->> 'chainId' = '31337'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id),
  UNIQUE (tenant_id, user_id, wallet_id, snapshot_digest),
  CHECK (owner_address = wallet_address),
  CHECK (token0 <> token1),
  CHECK ((pool_address IS NULL) <> (pool_id IS NULL)),
  CHECK (tick_lower < tick_upper),
  CHECK (observed_at < expires_at)
);

CREATE INDEX local_position_snapshots_owner_created_idx
  ON local_position_snapshots (tenant_id, user_id, wallet_id, created_at DESC, snapshot_id DESC);

CREATE TRIGGER local_position_snapshots_append_only
BEFORE UPDATE OR DELETE ON local_position_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_local_position_evidence_mutation();

CREATE TABLE local_position_execution_previews (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation_kind text NOT NULL CHECK (operation_kind IN ('collect-fees', 'remove-liquidity')),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND NOT (request_payload ?| ARRAY[
      'manager', 'target', 'selector', 'calldata', 'recipient', 'liquidityDelta',
      'amount0Max', 'amount1Max', 'amount0Min', 'amount1Min', 'fee', 'serviceFeeBps'
    ])
  ),
  facts_payload jsonb NOT NULL CHECK (jsonb_typeof(facts_payload) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id, snapshot_digest)
    REFERENCES local_position_snapshots(tenant_id, user_id, wallet_id, snapshot_digest)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX local_position_previews_expiry_idx ON local_position_execution_previews (expires_at);

CREATE TRIGGER local_position_previews_append_only
BEFORE UPDATE OR DELETE ON local_position_execution_previews
FOR EACH ROW EXECUTE FUNCTION reject_local_position_evidence_mutation();

CREATE TABLE local_position_operations (
  operation_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  operation_kind text NOT NULL CHECK (
    operation_kind IN ('position-collect-fees', 'position-remove-liquidity')
  ),
  state text NOT NULL CHECK (state IN (
    'queued', 'signing', 'broadcast', 'pending', 'reconciling', 'succeeded', 'failed'
  )),
  platform_id integer NOT NULL CHECK (platform_id IN (1, 2, 4, 5)),
  token_id numeric(78, 0) NOT NULL CHECK (token_id > 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  manager_address text NOT NULL CHECK (manager_address ~ '^0x[0-9a-f]{40}$'),
  percent integer CHECK (percent IS NULL OR percent BETWEEN 1 AND 100),
  slippage_bps integer CHECK (slippage_bps IS NULL OR slippage_bps BETWEEN 1 AND 500),
  burn_if_empty boolean NOT NULL,
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-position-execution-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_deadline timestamptz NOT NULL,
  plan_payload jsonb NOT NULL CHECK (
    jsonb_typeof(plan_payload) = 'object'
    AND plan_payload ->> 'planVersion' = 'p05-local-position-plan-v2'
    AND plan_payload ->> 'serviceFeeBps' = '0'
  ),
  accounting_payload jsonb NOT NULL CHECK (jsonb_typeof(accounting_payload) = 'object'),
  reauthenticated_session_id uuid NOT NULL,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id, wallet_id, snapshot_digest)
    REFERENCES local_position_snapshots(tenant_id, user_id, wallet_id, snapshot_digest),
  UNIQUE (operation_id, tenant_id, user_id),
  CHECK (
    (operation_kind = 'position-collect-fees' AND percent IS NULL AND slippage_bps IS NULL
      AND burn_if_empty = false)
    OR
    (operation_kind = 'position-remove-liquidity' AND percent IS NOT NULL
      AND slippage_bps IS NOT NULL AND (burn_if_empty = false OR percent = 100))
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_position_operations_owner_created_idx
  ON local_position_operations (tenant_id, user_id, created_at DESC, operation_id DESC);
CREATE INDEX local_position_operations_recovery_idx
  ON local_position_operations (state, updated_at, operation_id)
  WHERE state IN ('queued', 'signing', 'broadcast', 'pending', 'reconciling');
CREATE UNIQUE INDEX local_position_operations_wallet_live_unique
  ON local_position_operations (chain_id, wallet_id)
  WHERE state NOT IN ('succeeded', 'failed');

CREATE TABLE local_position_operation_idempotency (
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  command_type text NOT NULL CHECK (
    command_type IN ('position.collect-fees', 'position.remove-liquidity')
  ),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[!-~]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, wallet_id, command_type, idempotency_key),
  FOREIGN KEY (operation_id, tenant_id, user_id)
    REFERENCES local_position_operations(operation_id, tenant_id, user_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX local_position_idempotency_scope_unique
  ON local_position_operation_idempotency
  (tenant_id, user_id, wallet_id, idempotency_key);

CREATE TABLE local_position_operation_steps (
  step_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 2),
  step_kind text NOT NULL CHECK (step_kind IN ('decrease', 'collect', 'burn')),
  state text NOT NULL CHECK (state IN (
    'blocked', 'queued', 'signed', 'broadcast', 'pending', 'confirmed', 'succeeded',
    'failed', 'dropped', 'replaced', 'skipped', 'reconciling'
  )),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_to text NOT NULL CHECK (transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_value_base_unit numeric(78, 0) NOT NULL CHECK (transaction_value_base_unit = 0),
  transaction_data text NOT NULL CHECK (transaction_data ~ '^0x([0-9a-f]{2})+$'),
  transaction_data_digest text NOT NULL CHECK (transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'),
  gas_limit numeric(78, 0) NOT NULL CHECK (gas_limit > 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  fee_cap_base_unit numeric(78, 0) NOT NULL CHECK (fee_cap_base_unit > 0),
  active_transaction_id uuid,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (operation_id, tenant_id, user_id)
    REFERENCES local_position_operations(operation_id, tenant_id, user_id) ON DELETE CASCADE,
  UNIQUE (operation_id, ordinal),
  UNIQUE (chain_id, wallet_id, nonce),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_position_steps_recovery_idx
  ON local_position_operation_steps (state, updated_at, step_id)
  WHERE state IN ('queued', 'signed', 'broadcast', 'pending', 'dropped', 'reconciling');

CREATE TABLE local_position_step_transactions (
  transaction_id uuid PRIMARY KEY,
  step_id uuid NOT NULL REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation >= 0),
  state text NOT NULL CHECK (state IN (
    'signed', 'broadcast', 'pending', 'confirmed', 'failed', 'dropped', 'replaced'
  )),
  active boolean NOT NULL,
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_to text NOT NULL CHECK (transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_data_digest text NOT NULL CHECK (transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  replaces_transaction_id uuid REFERENCES local_position_step_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES local_position_step_transactions(transaction_id),
  replacement_reason text CHECK (
    replacement_reason IS NULL OR char_length(replacement_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  signed_at timestamptz,
  broadcast_at timestamptz,
  confirmed_at timestamptz,
  UNIQUE (step_id, generation),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX local_position_step_transactions_active_unique
  ON local_position_step_transactions (step_id) WHERE active;
CREATE UNIQUE INDEX local_position_step_transactions_hash_unique
  ON local_position_step_transactions (transaction_hash) WHERE transaction_hash IS NOT NULL;

ALTER TABLE local_position_operation_steps
  ADD CONSTRAINT local_position_steps_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES local_position_step_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE local_position_replacement_authorizations (
  authorization_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  replaced_transaction_id uuid NOT NULL REFERENCES local_position_step_transactions(transaction_id),
  generation integer NOT NULL CHECK (generation > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  transaction_to text NOT NULL CHECK (transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_data_digest text NOT NULL CHECK (transaction_data_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  state text NOT NULL CHECK (state IN ('pending', 'consumed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (step_id, generation),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (expires_at > created_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_position_replacement_pending_unique
  ON local_position_replacement_authorizations (step_id) WHERE state = 'pending';

CREATE TABLE local_position_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES local_position_step_transactions(transaction_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  step_kind text NOT NULL CHECK (step_kind IN ('decrease', 'collect', 'burn')),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  canonical boolean NOT NULL,
  receipt_status text NOT NULL CHECK (receipt_status IN ('success', 'reverted')),
  owner_before text CHECK (owner_before IS NULL OR owner_before ~ '^0x[0-9a-f]{40}$'),
  owner_after text CHECK (owner_after IS NULL OR owner_after ~ '^0x[0-9a-f]{40}$'),
  liquidity_before numeric(78, 0),
  liquidity_after numeric(78, 0),
  tokens_owed0_before numeric(78, 0),
  tokens_owed0_after numeric(78, 0),
  tokens_owed1_before numeric(78, 0),
  tokens_owed1_after numeric(78, 0),
  wallet_token0_before numeric(78, 0),
  wallet_token0_after numeric(78, 0),
  wallet_token0_delta numeric(78, 0),
  wallet_token1_before numeric(78, 0),
  wallet_token1_after numeric(78, 0),
  wallet_token1_delta numeric(78, 0),
  decrease_liquidity_delta numeric(78, 0),
  decrease_amount0 numeric(78, 0),
  decrease_amount1 numeric(78, 0),
  collect_recipient text CHECK (collect_recipient IS NULL OR collect_recipient ~ '^0x[0-9a-f]{40}$'),
  collect_amount0 numeric(78, 0),
  collect_amount1 numeric(78, 0),
  burn_event boolean,
  manager_runtime_code_hash text CHECK (
    manager_runtime_code_hash IS NULL OR manager_runtime_code_hash ~ '^0x[0-9a-f]{64}$'
  ),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest),
  CHECK (
    (wallet_token0_before IS NULL AND wallet_token0_after IS NULL AND wallet_token0_delta IS NULL)
    OR wallet_token0_delta = wallet_token0_after - wallet_token0_before
  ),
  CHECK (
    (wallet_token1_before IS NULL AND wallet_token1_after IS NULL AND wallet_token1_delta IS NULL)
    OR wallet_token1_delta = wallet_token1_after - wallet_token1_before
  )
);

CREATE TRIGGER local_position_receipt_evidence_append_only
BEFORE UPDATE OR DELETE ON local_position_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_position_evidence_mutation();

CREATE TABLE local_position_proceeds_events (
  proceeds_event_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES local_position_receipt_evidence(evidence_id) ON DELETE CASCADE,
  classification text NOT NULL CHECK (classification IN ('fee', 'principal')),
  availability text NOT NULL CHECK (availability IN ('pending-collect', 'available')),
  token_ordinal integer NOT NULL CHECK (token_ordinal IN (0, 1)),
  token_address text NOT NULL CHECK (token_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_unit numeric(78, 0) NOT NULL CHECK (amount_base_unit >= 0),
  created_at timestamptz NOT NULL,
  UNIQUE (operation_id, step_id, classification, availability, token_ordinal),
  CHECK (classification = 'principal' OR availability = 'available')
);

CREATE TRIGGER local_position_proceeds_events_append_only
BEFORE UPDATE OR DELETE ON local_position_proceeds_events
FOR EACH ROW EXECUTE FUNCTION reject_local_position_evidence_mutation();

CREATE TABLE local_position_pricing_completions (
  completion_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  pricing_id uuid NOT NULL,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  withdrawn_state_event_id uuid NOT NULL REFERENCES pricing_position_state_events(state_event_id),
  withdrawn_tombstone_id uuid NOT NULL REFERENCES pricing_position_withdrawn_tombstones(tombstone_id),
  completed_at timestamptz NOT NULL,
  FOREIGN KEY (pricing_id, tenant_id, user_id)
    REFERENCES pricing_positions(pricing_id, tenant_id, user_id),
  UNIQUE (pricing_id)
);

CREATE TABLE local_position_reconciliation_cases (
  reconciliation_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  provider_evidence_digest text CHECK (
    provider_evidence_digest IS NULL OR provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_position_reconciliation_open_unique
  ON local_position_reconciliation_cases (operation_id) WHERE status = 'open';

CREATE TABLE local_position_operation_outbox (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'local-position.queued', 'local-position.step-ready', 'local-position.state-changed',
    'local-position.reconciling', 'local-position.pricing-withdrawn'
  )),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['operationId', 'walletId', 'chainId', 'state']
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

CREATE INDEX local_position_operation_outbox_due_idx
  ON local_position_operation_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE local_position_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES local_position_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_position_operation_steps(step_id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  nonce numeric(78, 0),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action ~ '^position\.[a-z-]+$'),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'reconciled')),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);

CREATE TRIGGER local_position_audit_events_append_only
BEFORE UPDATE OR DELETE ON local_position_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_local_position_evidence_mutation();

COMMENT ON TABLE local_position_operation_steps IS
  'Ordered direct Manager steps with independent nonce, fencing, semantic, calldata and fee bindings.';
COMMENT ON TABLE local_position_proceeds_events IS
  'Append-only fee/principal classification; decrease principal stays pending until canonical collect.';
COMMENT ON TABLE local_position_pricing_completions IS
  'Links only completed 100% exits to the P05-03 withdrawn state event and tombstone.';

REVOKE ALL ON local_position_snapshots FROM PUBLIC;
REVOKE ALL ON local_position_execution_previews FROM PUBLIC;
REVOKE ALL ON local_position_operations FROM PUBLIC;
REVOKE ALL ON local_position_operation_idempotency FROM PUBLIC;
REVOKE ALL ON local_position_operation_steps FROM PUBLIC;
REVOKE ALL ON local_position_step_transactions FROM PUBLIC;
REVOKE ALL ON local_position_replacement_authorizations FROM PUBLIC;
REVOKE ALL ON local_position_receipt_evidence FROM PUBLIC;
REVOKE ALL ON local_position_proceeds_events FROM PUBLIC;
REVOKE ALL ON local_position_pricing_completions FROM PUBLIC;
REVOKE ALL ON local_position_reconciliation_cases FROM PUBLIC;
REVOKE ALL ON local_position_operation_outbox FROM PUBLIC;
REVOKE ALL ON local_position_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER local_position_audit_events_append_only ON local_position_audit_events;
DROP TABLE local_position_audit_events;
DROP TABLE local_position_operation_outbox;
DROP TABLE local_position_reconciliation_cases;
DROP TABLE local_position_pricing_completions;
DROP TRIGGER local_position_proceeds_events_append_only ON local_position_proceeds_events;
DROP TABLE local_position_proceeds_events;
DROP TRIGGER local_position_receipt_evidence_append_only ON local_position_receipt_evidence;
DROP TABLE local_position_receipt_evidence;
DROP TABLE local_position_replacement_authorizations;
ALTER TABLE local_position_operation_steps DROP CONSTRAINT local_position_steps_active_transaction_fk;
DROP TABLE local_position_step_transactions;
DROP TABLE local_position_operation_steps;
DROP TABLE local_position_operation_idempotency;
DROP TABLE local_position_operations;
DROP TRIGGER local_position_previews_append_only ON local_position_execution_previews;
DROP TABLE local_position_execution_previews;
DROP TRIGGER local_position_snapshots_append_only ON local_position_snapshots;
DROP TABLE local_position_snapshots;
DROP FUNCTION reject_local_position_evidence_mutation();
