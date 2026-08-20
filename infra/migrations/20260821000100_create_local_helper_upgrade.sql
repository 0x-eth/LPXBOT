-- migrate:up

CREATE FUNCTION reject_local_helper_upgrade_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'local Helper upgrade evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TABLE local_helper_upgrade_previews (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_payload jsonb NOT NULL CHECK (
    jsonb_typeof(request_payload) = 'object'
    AND request_payload - ARRAY['chainId', 'walletId'] = '{}'::jsonb
    AND request_payload ->> 'chainId' = '31337'
  ),
  facts_payload jsonb NOT NULL CHECK (jsonb_typeof(facts_payload) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX local_helper_upgrade_previews_expiry_idx
  ON local_helper_upgrade_previews (expires_at);

CREATE TABLE local_helper_upgrade_operations (
  operation_id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id bigint NOT NULL CHECK (chain_id = 31337),
  operation_kind text NOT NULL CHECK (operation_kind = 'helper-deploy-new-upgrade'),
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'manual-recovery-required', 'failed', 'completed')
  ),
  cursor text NOT NULL CHECK (cursor IN (
    'preflight', 'deploy-v2', 'verify-v2', 'sweep-v1', 'final-rescan-v1',
    'atomic-binding-switch', 'completed'
  )),
  source_binding_id uuid NOT NULL REFERENCES wallet_helper_deployment_bindings(binding_id),
  source_helper_address text NOT NULL CHECK (source_helper_address ~ '^0x[0-9a-f]{40}$'),
  source_runtime_code_hash text NOT NULL CHECK (source_runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  target_helper_address text NOT NULL CHECK (target_helper_address ~ '^0x[0-9a-f]{40}$'),
  target_runtime_code_hash text NOT NULL CHECK (target_runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  target_abi_hash text NOT NULL CHECK (target_abi_hash ~ '^sha256:[0-9a-f]{64}$'),
  target_selector_set_hash text NOT NULL CHECK (
    target_selector_set_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  target_version text NOT NULL CHECK (target_version = 'WalletHelperV2'),
  owner_address text NOT NULL CHECK (owner_address = wallet_address),
  adapter_address text NOT NULL CHECK (adapter_address ~ '^0x[0-9a-f]{40}$'),
  permit2_address text NOT NULL CHECK (permit2_address ~ '^0x[0-9a-f]{40}$'),
  registry_version text NOT NULL CHECK (registry_version = 'p05-local-helper-upgrade-v3'),
  registry_digest text NOT NULL CHECK (registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_payload jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot_payload) = 'object'
    AND snapshot_payload ->> 'schemaVersion' = '3'
    AND snapshot_payload ->> 'snapshotVersion' = 'p05-local-helper-upgrade-snapshot-v3'
    AND snapshot_payload #>> '{registry,version}' = 'p05-local-helper-upgrade-v3'
  ),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  creation_code_hash text NOT NULL CHECK (creation_code_hash ~ '^0x[0-9a-f]{64}$'),
  constructor_arguments_hash text NOT NULL CHECK (
    constructor_arguments_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
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
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  plan_deadline timestamptz NOT NULL,
  plan_payload jsonb NOT NULL CHECK (
    jsonb_typeof(plan_payload) = 'object'
    AND plan_payload ->> 'schemaVersion' = '3'
    AND plan_payload ->> 'planVersion' = 'p05-local-helper-upgrade-plan-v3'
    AND plan_payload #>> '{target,helperVersion}' = 'WalletHelperV2'
    AND plan_payload #> '{transaction,to}' = 'null'::jsonb
    AND plan_payload #>> '{transaction,valueBaseUnit}' = '0'
  ),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[!-~]+$'
  ),
  reauthenticated_session_id uuid NOT NULL,
  sweep_batch_id uuid REFERENCES local_helper_sweep_batches(batch_id),
  active_transaction_id uuid,
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  manual_recovery_blockers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(manual_recovery_blockers) = 'array'
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, user_id, wallet_id)
    REFERENCES custody_wallets(tenant_id, user_id, wallet_id) ON DELETE CASCADE,
  UNIQUE (operation_id, tenant_id, user_id),
  UNIQUE (tenant_id, user_id, wallet_id, idempotency_key),
  UNIQUE (chain_id, wallet_id, nonce),
  CHECK (max_priority_fee_per_gas_base_unit <= max_fee_per_gas_base_unit),
  CHECK (fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit),
  CHECK ((state = 'completed') = (cursor = 'completed')),
  CHECK ((state = 'manual-recovery-required') =
    (jsonb_array_length(manual_recovery_blockers) > 0)),
  CHECK (updated_at >= created_at)
);

CREATE INDEX local_helper_upgrade_operations_owner_idx
  ON local_helper_upgrade_operations (tenant_id, user_id, created_at DESC, operation_id DESC);
CREATE UNIQUE INDEX local_helper_upgrade_operations_wallet_live_unique
  ON local_helper_upgrade_operations (tenant_id, user_id, wallet_id, chain_id)
  WHERE state IN ('queued', 'running', 'manual-recovery-required');
CREATE INDEX local_helper_upgrade_operations_recovery_idx
  ON local_helper_upgrade_operations (state, cursor, updated_at, operation_id)
  WHERE state IN ('queued', 'running');

CREATE TABLE local_helper_upgrade_steps (
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 6),
  cursor text NOT NULL CHECK (cursor IN (
    'preflight', 'deploy-v2', 'verify-v2', 'sweep-v1', 'final-rescan-v1',
    'atomic-binding-switch', 'completed'
  )),
  state text NOT NULL CHECK (
    state IN ('pending', 'running', 'succeeded', 'failed', 'manual-recovery-required')
  ),
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 120),
  updated_at timestamptz,
  PRIMARY KEY (operation_id, cursor),
  UNIQUE (operation_id, ordinal),
  CHECK (
    (ordinal = 0 AND cursor = 'preflight') OR
    (ordinal = 1 AND cursor = 'deploy-v2') OR
    (ordinal = 2 AND cursor = 'verify-v2') OR
    (ordinal = 3 AND cursor = 'sweep-v1') OR
    (ordinal = 4 AND cursor = 'final-rescan-v1') OR
    (ordinal = 5 AND cursor = 'atomic-binding-switch') OR
    (ordinal = 6 AND cursor = 'completed')
  )
);

CREATE TABLE local_helper_upgrade_transactions (
  transaction_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation >= 0),
  state text NOT NULL CHECK (
    state IN ('signed', 'broadcast', 'pending', 'confirmed', 'failed', 'dropped', 'replaced')
  ),
  active boolean NOT NULL,
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  init_code_hash text NOT NULL CHECK (init_code_hash ~ '^0x[0-9a-f]{64}$'),
  target_version text NOT NULL CHECK (target_version = 'WalletHelperV2'),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  target_helper_address text NOT NULL CHECK (target_helper_address ~ '^0x[0-9a-f]{40}$'),
  max_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (max_fee_per_gas_base_unit > 0),
  max_priority_fee_per_gas_base_unit numeric(78, 0) NOT NULL CHECK (
    max_priority_fee_per_gas_base_unit >= 0
  ),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  delivery_id text CHECK (delivery_id IS NULL OR char_length(delivery_id) BETWEEN 1 AND 160),
  replaces_transaction_id uuid REFERENCES local_helper_upgrade_transactions(transaction_id),
  replaced_by_transaction_id uuid REFERENCES local_helper_upgrade_transactions(transaction_id),
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

CREATE UNIQUE INDEX local_helper_upgrade_transactions_active_unique
  ON local_helper_upgrade_transactions (operation_id) WHERE active;

ALTER TABLE local_helper_upgrade_operations
  ADD CONSTRAINT local_helper_upgrade_operations_active_transaction_fk
  FOREIGN KEY (active_transaction_id)
  REFERENCES local_helper_upgrade_transactions(transaction_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE local_helper_upgrade_replacement_authorizations (
  authorization_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  replaced_transaction_id uuid NOT NULL REFERENCES local_helper_upgrade_transactions(transaction_id),
  generation integer NOT NULL CHECK (generation > 0),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  init_code_hash text NOT NULL CHECK (init_code_hash ~ '^0x[0-9a-f]{64}$'),
  target_version text NOT NULL CHECK (target_version = 'WalletHelperV2'),
  nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
  owner_address text NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  target_helper_address text NOT NULL CHECK (target_helper_address ~ '^0x[0-9a-f]{40}$'),
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
  CHECK (expires_at > created_at),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL))
);

CREATE UNIQUE INDEX local_helper_upgrade_replacement_pending_unique
  ON local_helper_upgrade_replacement_authorizations (operation_id) WHERE state = 'pending';

CREATE TABLE local_helper_upgrade_deployment_receipt_evidence (
  evidence_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES local_helper_upgrade_transactions(transaction_id),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  canonical boolean NOT NULL,
  confirmations numeric(78, 0) NOT NULL CHECK (confirmations > 0),
  receipt_status text NOT NULL CHECK (receipt_status IN ('reverted', 'success')),
  contract_address text CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'),
  runtime_code_hash text CHECK (runtime_code_hash IS NULL OR runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_reconciled boolean NOT NULL,
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (transaction_id, block_hash, evidence_digest)
);

CREATE TABLE local_helper_upgrade_v2_verification_evidence (
  evidence_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES local_helper_upgrade_transactions(transaction_id),
  block_number numeric(78, 0) NOT NULL CHECK (block_number >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  verification_payload jsonb NOT NULL CHECK (jsonb_typeof(verification_payload) = 'object'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz NOT NULL,
  UNIQUE (operation_id, block_hash, evidence_digest)
);

CREATE TABLE local_helper_upgrade_final_rescan_evidence (
  evidence_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_payload jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot_payload) = 'object'
    AND snapshot_payload ->> 'snapshotVersion' = 'p05-local-helper-residual-snapshot-v2'
  ),
  eligible_for_supersede boolean NOT NULL,
  manual_recovery_required boolean NOT NULL,
  blockers jsonb NOT NULL CHECK (jsonb_typeof(blockers) = 'array'),
  observed_at timestamptz NOT NULL,
  UNIQUE (operation_id, snapshot_digest)
);

CREATE TABLE local_helper_upgrade_outbox (
  event_id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  cursor text NOT NULL CHECK (cursor IN (
    'preflight', 'deploy-v2', 'verify-v2', 'sweep-v1', 'final-rescan-v1',
    'atomic-binding-switch', 'completed'
  )),
  event_type text NOT NULL CHECK (event_type = 'helper-upgrade.cursor-ready'),
  state text NOT NULL CHECK (state IN ('pending', 'leased', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 120),
  UNIQUE (operation_id, cursor),
  CHECK (
    (state = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL))
);

CREATE INDEX local_helper_upgrade_outbox_due_idx
  ON local_helper_upgrade_outbox (state, available_at, lease_expires_at, created_at, event_id)
  WHERE state IN ('pending', 'leased');

CREATE TABLE local_helper_upgrade_audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  operation_id uuid NOT NULL REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES custody_wallets(wallet_id) ON DELETE CASCADE,
  cursor text NOT NULL,
  state text NOT NULL,
  action text NOT NULL CHECK (action ~ '^helper-upgrade\.[a-z0-9-]+$'),
  result_code text NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 120),
  transaction_hash text CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE INDEX local_helper_upgrade_audit_owner_idx
  ON local_helper_upgrade_audit_events (tenant_id, actor_user_id, created_at DESC, audit_id DESC);

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'wallet_helper_deployment_bindings'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%helper_version%' OR
         pg_get_constraintdef(oid) ILIKE '%registry_version%' OR
         pg_get_constraintdef(oid) ILIKE '%state%'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE wallet_helper_deployment_bindings DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END;
$$;

DROP INDEX wallet_helper_deployment_bindings_live_unique;
ALTER TABLE wallet_helper_deployment_bindings
  ALTER COLUMN operation_id DROP NOT NULL,
  ADD COLUMN upgrade_operation_id uuid
    REFERENCES local_helper_upgrade_operations(operation_id) ON DELETE CASCADE,
  ADD COLUMN superseded_by_binding_id uuid
    REFERENCES wallet_helper_deployment_bindings(binding_id),
  ADD CONSTRAINT wallet_helper_bindings_version_check CHECK (
    helper_version IN ('WalletHelperV1', 'WalletHelperV2')
  ),
  ADD CONSTRAINT wallet_helper_bindings_state_check CHECK (
    state IN ('deploying', 'active', 'degraded', 'superseded')
  ),
  ADD CONSTRAINT wallet_helper_bindings_registry_check CHECK (
    (helper_version = 'WalletHelperV1' AND registry_version = 'p05-local-helper-deployment-v2')
    OR
    (helper_version = 'WalletHelperV2' AND registry_version = 'p05-local-helper-upgrade-v3')
  ),
  ADD CONSTRAINT wallet_helper_bindings_provenance_check CHECK (
    (helper_version = 'WalletHelperV1' AND operation_id IS NOT NULL AND upgrade_operation_id IS NULL)
    OR
    (helper_version = 'WalletHelperV2' AND operation_id IS NULL AND upgrade_operation_id IS NOT NULL)
  ),
  ADD CONSTRAINT wallet_helper_bindings_evidence_check CHECK (
    state IN ('deploying', 'degraded')
    OR (deployment_transaction_hash IS NOT NULL AND verified_block_number IS NOT NULL)
  ),
  ADD CONSTRAINT wallet_helper_bindings_superseded_check CHECK (
    (state = 'superseded') = (superseded_by_binding_id IS NOT NULL)
  );

CREATE UNIQUE INDEX wallet_helper_deployment_bindings_active_unique
  ON wallet_helper_deployment_bindings (tenant_id, user_id, wallet_id, chain_id)
  WHERE state = 'active';

CREATE TRIGGER local_helper_upgrade_previews_append_only
BEFORE UPDATE OR DELETE ON local_helper_upgrade_previews
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_upgrade_evidence_mutation();

CREATE TRIGGER local_helper_upgrade_v2_evidence_append_only
BEFORE UPDATE OR DELETE ON local_helper_upgrade_v2_verification_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_upgrade_evidence_mutation();

CREATE TRIGGER local_helper_upgrade_deployment_evidence_append_only
BEFORE UPDATE OR DELETE ON local_helper_upgrade_deployment_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_upgrade_evidence_mutation();

CREATE TRIGGER local_helper_upgrade_rescan_evidence_append_only
BEFORE UPDATE OR DELETE ON local_helper_upgrade_final_rescan_evidence
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_upgrade_evidence_mutation();

CREATE TRIGGER local_helper_upgrade_audit_append_only
BEFORE UPDATE OR DELETE ON local_helper_upgrade_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_local_helper_upgrade_evidence_mutation();

REVOKE ALL ON local_helper_upgrade_previews FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_operations FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_steps FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_transactions FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_replacement_authorizations FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_deployment_receipt_evidence FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_v2_verification_evidence FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_final_rescan_evidence FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_outbox FROM PUBLIC;
REVOKE ALL ON local_helper_upgrade_audit_events FROM PUBLIC;

COMMENT ON TABLE local_helper_upgrade_operations IS
  'P05-09 deploy-new V1 to V2 upgrade cursor. Client-owned calldata and target overrides are forbidden.';
COMMENT ON INDEX wallet_helper_deployment_bindings_active_unique IS
  'Exactly one active Helper binding per tenant user wallet and chain across Helper versions.';

-- migrate:down

DROP TRIGGER local_helper_upgrade_audit_append_only ON local_helper_upgrade_audit_events;
DROP TRIGGER local_helper_upgrade_rescan_evidence_append_only
  ON local_helper_upgrade_final_rescan_evidence;
DROP TRIGGER local_helper_upgrade_v2_evidence_append_only
  ON local_helper_upgrade_v2_verification_evidence;
DROP TRIGGER local_helper_upgrade_deployment_evidence_append_only
  ON local_helper_upgrade_deployment_receipt_evidence;
DROP TRIGGER local_helper_upgrade_previews_append_only ON local_helper_upgrade_previews;

DROP INDEX wallet_helper_deployment_bindings_active_unique;
DELETE FROM wallet_helper_deployment_bindings WHERE helper_version = 'WalletHelperV2';
UPDATE wallet_helper_deployment_bindings
   SET state = 'degraded', superseded_by_binding_id = NULL
 WHERE state = 'superseded';
ALTER TABLE wallet_helper_deployment_bindings
  DROP CONSTRAINT wallet_helper_bindings_superseded_check,
  DROP CONSTRAINT wallet_helper_bindings_evidence_check,
  DROP CONSTRAINT wallet_helper_bindings_provenance_check,
  DROP CONSTRAINT wallet_helper_bindings_registry_check,
  DROP CONSTRAINT wallet_helper_bindings_state_check,
  DROP CONSTRAINT wallet_helper_bindings_version_check,
  DROP COLUMN superseded_by_binding_id,
  DROP COLUMN upgrade_operation_id,
  ALTER COLUMN operation_id SET NOT NULL,
  ADD CHECK (helper_version = 'WalletHelperV1'),
  ADD CHECK (state IN ('deploying', 'active', 'degraded')),
  ADD CHECK (registry_version = 'p05-local-helper-deployment-v2'),
  ADD CHECK ((state = 'active') = (deployment_transaction_hash IS NOT NULL
    AND verified_block_number IS NOT NULL AND failure_code IS NULL));

CREATE UNIQUE INDEX wallet_helper_deployment_bindings_live_unique
  ON wallet_helper_deployment_bindings (
    tenant_id, user_id, wallet_id, chain_id, helper_version
  )
  WHERE state <> 'degraded';

ALTER TABLE local_helper_upgrade_operations
  DROP CONSTRAINT local_helper_upgrade_operations_active_transaction_fk;
DROP TABLE local_helper_upgrade_audit_events;
DROP TABLE local_helper_upgrade_outbox;
DROP TABLE local_helper_upgrade_final_rescan_evidence;
DROP TABLE local_helper_upgrade_v2_verification_evidence;
DROP TABLE local_helper_upgrade_deployment_receipt_evidence;
DROP TABLE local_helper_upgrade_replacement_authorizations;
DROP TABLE local_helper_upgrade_transactions;
DROP TABLE local_helper_upgrade_steps;
DROP TABLE local_helper_upgrade_operations;
DROP TABLE local_helper_upgrade_previews;
DROP FUNCTION reject_local_helper_upgrade_evidence_mutation();
