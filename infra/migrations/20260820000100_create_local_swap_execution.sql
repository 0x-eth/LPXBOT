-- migrate:up

CREATE FUNCTION reject_local_swap_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'local swap evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE local_swap_quote_snapshots (
  quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  quote_digest text NOT NULL CHECK (quote_digest ~ '^sha256:[0-9a-f]{64}$'),
  quote_version text NOT NULL CHECK (quote_version = 'p05-local-swap-quote-v2'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-swap-execution-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  token_in text NOT NULL CHECK (token_in ~ '^0x[0-9a-f]{40}$'),
  token_out text NOT NULL CHECK (token_out ~ '^0x[0-9a-f]{40}$'),
  amount_in_base_unit numeric(78, 0) NOT NULL CHECK (amount_in_base_unit > 0),
  amount_out_base_unit numeric(78, 0) NOT NULL CHECK (amount_out_base_unit > 0),
  min_out_base_unit numeric(78, 0) NOT NULL CHECK (
    min_out_base_unit > 0 AND min_out_base_unit <= amount_out_base_unit
  ),
  slippage_bps integer NOT NULL CHECK (slippage_bps BETWEEN 1 AND 500),
  service_fee_bps integer NOT NULL CHECK (service_fee_bps = 0),
  observed_block_number numeric(78, 0) NOT NULL CHECK (observed_block_number >= 0),
  observed_block_hash text NOT NULL CHECK (observed_block_hash ~ '^0x[0-9a-f]{64}$'),
  max_block_number numeric(78, 0) NOT NULL CHECK (
    max_block_number >= observed_block_number
  ),
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  execution_enabled boolean NOT NULL CHECK (execution_enabled),
  quote_payload jsonb NOT NULL CHECK (
    jsonb_typeof(quote_payload) = 'object'
    AND quote_payload ->> 'quoteVersion' = 'p05-local-swap-quote-v2'
    AND quote_payload ->> 'registryVersion' = 'p05-local-swap-execution-v2'
    AND quote_payload ->> 'digestDomain' = 'LPXBOT_LOCAL_SWAP_QUOTE'
    AND quote_payload ->> 'digestVersion' = '2'
    AND quote_payload ->> 'executionEnabled' = 'true'
    AND quote_payload ->> 'serviceFeeBps' = '0'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT local_swap_quotes_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, user_id, wallet_id, quote_digest),
  CHECK (token_in <> token_out),
  CHECK (quoted_at < expires_at AND expires_at <= deadline)
);

CREATE INDEX local_swap_quotes_owner_created_idx
  ON local_swap_quote_snapshots (tenant_id, user_id, created_at DESC, quote_id DESC);

CREATE TRIGGER local_swap_quote_snapshots_append_only
BEFORE UPDATE OR DELETE ON local_swap_quote_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_local_swap_evidence_mutation();

CREATE TABLE local_swap_execution_previews (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  quote_digest text NOT NULL CHECK (quote_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND request_payload - ARRAY['walletId', 'quoteDigest', 'authorizationMode'] = '{}'::jsonb
  ),
  facts_payload jsonb NOT NULL CHECK (jsonb_typeof(facts_payload) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT local_swap_previews_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  CONSTRAINT local_swap_previews_quote_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id, quote_digest)
    REFERENCES local_swap_quote_snapshots(tenant_id, user_id, wallet_id, quote_digest)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX local_swap_previews_expiry_idx ON local_swap_execution_previews (expires_at);

CREATE TRIGGER local_swap_execution_previews_append_only
BEFORE UPDATE OR DELETE ON local_swap_execution_previews
FOR EACH ROW EXECUTE FUNCTION reject_local_swap_evidence_mutation();

CREATE TABLE local_swap_operations (
  operation_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  operation_kind text NOT NULL CHECK (operation_kind = 'local-swap'),
  state text NOT NULL CHECK (state IN (
    'queued', 'signing', 'broadcast', 'pending', 'reconciling', 'succeeded', 'failed'
  )),
  authorization_mode text NOT NULL CHECK (authorization_mode IN ('direct', 'permit2')),
  quote_digest text NOT NULL CHECK (quote_digest ~ '^sha256:[0-9a-f]{64}$'),
  helper_binding_id uuid NOT NULL,
  helper_address text NOT NULL CHECK (helper_address ~ '^0x[0-9a-f]{40}$'),
  helper_plan_digest text NOT NULL CHECK (helper_plan_digest ~ '^0x[0-9a-f]{64}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-swap-execution-v2'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_deadline timestamptz NOT NULL,
  plan_payload jsonb NOT NULL CHECK (
    jsonb_typeof(plan_payload) = 'object'
    AND plan_payload ->> 'planVersion' = 'p05-local-swap-plan-v2'
    AND plan_payload ->> 'serviceFeeBps' = '0'
  ),
  reauthenticated_session_id uuid NOT NULL,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  reconciliation_reason text CHECK (
    reconciliation_reason IS NULL OR char_length(reconciliation_reason) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT local_swap_operations_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  CONSTRAINT local_swap_operations_quote_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id, quote_digest)
    REFERENCES local_swap_quote_snapshots(tenant_id, user_id, wallet_id, quote_digest),
  CONSTRAINT local_swap_operations_binding_fk
    FOREIGN KEY (helper_binding_id)
    REFERENCES wallet_helper_deployment_bindings(binding_id),
  UNIQUE (operation_id, tenant_id, user_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_swap_operations_owner_created_idx
  ON local_swap_operations (tenant_id, user_id, created_at DESC, operation_id DESC);
CREATE INDEX local_swap_operations_recovery_idx
  ON local_swap_operations (state, updated_at, operation_id)
  WHERE state IN ('queued', 'signing', 'broadcast', 'pending', 'reconciling');
CREATE UNIQUE INDEX local_swap_operations_wallet_live_unique
  ON local_swap_operations (chain_id, wallet_id)
  WHERE state NOT IN ('succeeded', 'failed');

CREATE TABLE local_swap_operation_idempotency (
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  command_type text NOT NULL CHECK (command_type = 'swap.execute'),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[!-~]+$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, user_id, wallet_id, command_type, idempotency_key),
  CONSTRAINT local_swap_idempotency_operation_fk
    FOREIGN KEY (operation_id, tenant_id, user_id)
    REFERENCES local_swap_operations(operation_id, tenant_id, user_id)
    ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE TABLE local_swap_operation_steps (
  step_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  step_kind text NOT NULL CHECK (step_kind IN ('allowance-reset', 'approve', 'swap', 'cleanup')),
  run_condition text NOT NULL CHECK (run_condition IN ('always', 'swap-failed-after-approval')),
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
  CONSTRAINT local_swap_steps_owner_fk
    FOREIGN KEY (operation_id, tenant_id, user_id)
    REFERENCES local_swap_operations(operation_id, tenant_id, user_id)
    ON DELETE CASCADE,
  CONSTRAINT local_swap_steps_wallet_fk
    FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id)
    ON DELETE CASCADE,
  UNIQUE (operation_id, ordinal),
  UNIQUE (chain_id, wallet_id, nonce),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK ((step_kind = 'cleanup') = (run_condition = 'swap-failed-after-approval')),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_swap_steps_recovery_idx
  ON local_swap_operation_steps (state, updated_at, step_id)
  WHERE state IN ('queued', 'signed', 'broadcast', 'pending', 'dropped', 'reconciling');

CREATE TABLE local_swap_step_transactions (
  transaction_id uuid PRIMARY KEY,
  step_id uuid NOT NULL REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
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
  replaces_transaction_id uuid REFERENCES local_swap_step_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES local_swap_step_transactions(transaction_id),
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

CREATE UNIQUE INDEX local_swap_step_transactions_active_unique
  ON local_swap_step_transactions (step_id) WHERE active;
CREATE UNIQUE INDEX local_swap_step_transactions_hash_unique
  ON local_swap_step_transactions (transaction_hash) WHERE transaction_hash IS NOT NULL;

ALTER TABLE local_swap_operation_steps
  ADD CONSTRAINT local_swap_steps_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES local_swap_step_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE local_swap_replacement_authorizations (
  authorization_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  replaced_transaction_id uuid NOT NULL REFERENCES local_swap_step_transactions(transaction_id),
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

CREATE UNIQUE INDEX local_swap_replacement_pending_unique
  ON local_swap_replacement_authorizations (step_id) WHERE state = 'pending';

CREATE TABLE local_swap_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES local_swap_step_transactions(transaction_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  canonical boolean NOT NULL,
  receipt_status text NOT NULL CHECK (receipt_status IN ('success', 'reverted')),
  owner_output_before numeric(78, 0),
  owner_output_after numeric(78, 0),
  owner_output_delta numeric(78, 0),
  min_out_base_unit numeric(78, 0),
  plan_executed_event boolean,
  swap_executed_event boolean,
  helper_plan_replay_state boolean,
  owner_to_spender_allowance numeric(78, 0),
  helper_to_adapter_allowance numeric(78, 0),
  adapter_to_router_allowance numeric(78, 0),
  helper_input_dust numeric(78, 0),
  helper_output_dust numeric(78, 0),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest),
  CHECK (
    (owner_output_before IS NULL AND owner_output_after IS NULL AND owner_output_delta IS NULL)
    OR owner_output_delta = owner_output_after - owner_output_before
  )
);

CREATE TRIGGER local_swap_receipt_evidence_append_only
BEFORE UPDATE OR DELETE ON local_swap_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_swap_evidence_mutation();

CREATE TABLE local_swap_reconciliation_cases (
  reconciliation_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  provider_evidence_digest text CHECK (
    provider_evidence_digest IS NULL OR provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_swap_reconciliation_open_unique
  ON local_swap_reconciliation_cases (operation_id) WHERE status = 'open';

CREATE TABLE local_swap_operation_outbox (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'local-swap.queued', 'local-swap.step-ready', 'local-swap.state-changed',
    'local-swap.cleanup-required', 'local-swap.reconciling'
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

CREATE INDEX local_swap_operation_outbox_due_idx
  ON local_swap_operation_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE local_swap_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES local_swap_operations(operation_id) ON DELETE CASCADE,
  step_id uuid REFERENCES local_swap_operation_steps(step_id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  nonce numeric(78, 0),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action ~ '^swap\.[a-z-]+$'),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'reconciled')),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL
);

CREATE INDEX local_swap_audit_owner_created_idx
  ON local_swap_audit_events (tenant_id, actor_user_id, created_at DESC, audit_id DESC);

CREATE TRIGGER local_swap_audit_events_append_only
BEFORE UPDATE OR DELETE ON local_swap_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_local_swap_evidence_mutation();

COMMENT ON TABLE local_swap_quote_snapshots IS
  'Executable local quote v2 snapshots; separate from immutable BSC quote-only snapshots.';
COMMENT ON TABLE local_swap_operation_steps IS
  'Ordered nonce/fencing/data/fee-bound local Swap steps; cleanup is conditional on Swap failure.';
COMMENT ON TABLE local_swap_operation_outbox IS
  'Credential-free durable local work intents; raw signed transactions are forbidden.';

REVOKE ALL ON local_swap_quote_snapshots FROM PUBLIC;
REVOKE ALL ON local_swap_execution_previews FROM PUBLIC;
REVOKE ALL ON local_swap_operations FROM PUBLIC;
REVOKE ALL ON local_swap_operation_idempotency FROM PUBLIC;
REVOKE ALL ON local_swap_operation_steps FROM PUBLIC;
REVOKE ALL ON local_swap_step_transactions FROM PUBLIC;
REVOKE ALL ON local_swap_replacement_authorizations FROM PUBLIC;
REVOKE ALL ON local_swap_receipt_evidence FROM PUBLIC;
REVOKE ALL ON local_swap_reconciliation_cases FROM PUBLIC;
REVOKE ALL ON local_swap_operation_outbox FROM PUBLIC;
REVOKE ALL ON local_swap_audit_events FROM PUBLIC;

-- migrate:down

DROP TRIGGER local_swap_audit_events_append_only ON local_swap_audit_events;
DROP TABLE local_swap_audit_events;
DROP TABLE local_swap_operation_outbox;
DROP TABLE local_swap_reconciliation_cases;
DROP TRIGGER local_swap_receipt_evidence_append_only ON local_swap_receipt_evidence;
DROP TABLE local_swap_receipt_evidence;
DROP TABLE local_swap_replacement_authorizations;
ALTER TABLE local_swap_operation_steps DROP CONSTRAINT local_swap_steps_active_transaction_fk;
DROP TABLE local_swap_step_transactions;
DROP TABLE local_swap_operation_steps;
DROP TABLE local_swap_operation_idempotency;
DROP TABLE local_swap_operations;
DROP TRIGGER local_swap_execution_previews_append_only ON local_swap_execution_previews;
DROP TABLE local_swap_execution_previews;
DROP TRIGGER local_swap_quote_snapshots_append_only ON local_swap_quote_snapshots;
DROP TABLE local_swap_quote_snapshots;
DROP FUNCTION reject_local_swap_evidence_mutation();
