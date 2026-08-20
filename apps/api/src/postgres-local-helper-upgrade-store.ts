import { randomUUID } from "node:crypto";

import type {
  LocalHelperUpgradeStepView,
  LocalHelperUpgradeTransactionView,
} from "@lpbot/api-contract";
import { P05_LOCAL_HELPER_UPGRADE_REGISTRY } from "@lpbot/chain-registry";
import {
  assertWalletHelperV2Verification,
  localHelperUpgradePlanDigest,
  localHelperUpgradeSelectorSetHash,
  localHelperV1SupersedeDecision,
  type LocalHelperUpgradePlan,
  type WalletHelperV2Verification,
} from "@lpbot/domain/local-helper-upgrade";
import type {
  LocalHelperResidualSnapshot,
  LocalHelperSweepBinding,
} from "@lpbot/domain/local-helper-sweep";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  LocalHelperUpgradeError,
  type LocalHelperUpgradeBindingStore,
  type LocalHelperUpgradeCreateInput,
  type LocalHelperUpgradeOperationStore,
  type LocalHelperUpgradePreviewStore,
  type StoredLocalHelperUpgradeOperation,
  type StoredLocalHelperUpgradePreview,
} from "./local-helper-upgrades.js";

interface PreviewRow extends QueryResultRow {
  created_at: Date;
  facts_payload: StoredLocalHelperUpgradePreview["facts"];
  preview_digest: `sha256:${string}`;
  request_payload: StoredLocalHelperUpgradePreview["request"];
  tenant_id: string;
  token_digest: string;
  user_id: string;
}

interface BindingRow extends QueryResultRow {
  adapter_address: `0x${string}`;
  binding_id: string;
  helper_address: `0x${string}`;
  helper_version: "WalletHelperV1";
  owner_address: `0x${string}`;
  permit2_address: `0x${string}`;
  registry_version: "p05-local-helper-deployment-v2";
  runtime_code_hash: `0x${string}`;
  state: "active" | "degraded";
  verified_block_number: string;
  wallet_id: string;
}

interface OperationRow extends QueryResultRow {
  chain_id: number;
  created_at: Date;
  cursor: StoredLocalHelperUpgradeOperation["cursor"];
  failure_code: string | null;
  fencing_token: string;
  idempotency_key: string;
  manual_recovery_blockers: string[];
  nonce: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalHelperUpgradePlan;
  preview_digest: `sha256:${string}`;
  reauthenticated_session_id: string;
  registry_version: "p05-local-helper-upgrade-v3";
  request_hash: `sha256:${string}`;
  source_binding_id: string;
  source_helper_address: `0x${string}`;
  state: StoredLocalHelperUpgradeOperation["state"];
  sweep_batch_id: string | null;
  target_helper_address: `0x${string}`;
  tenant_id: string;
  updated_at: Date;
  user_id: string;
  wallet_id: string;
}

interface StepRow extends QueryResultRow {
  cursor: LocalHelperUpgradeStepView["cursor"];
  failure_code: string | null;
  state: LocalHelperUpgradeStepView["state"];
  updated_at: Date | null;
}

interface TransactionRow extends QueryResultRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  state: LocalHelperUpgradeTransactionView["state"];
  transaction_hash: `0x${string}` | null;
  transaction_id: string;
}

interface LedgerRow extends QueryResultRow {
  fencing_token: string;
  next_nonce: string | null;
  reconciliation_reason: string | null;
}

const bindingColumns = `
  binding_id::text, wallet_id::text, helper_version, state, helper_address,
  owner_address, adapter_address, permit2_address, runtime_code_hash,
  registry_version, verified_block_number::text`;

const operationColumns = `
  operation_id::text, tenant_id, user_id::text, wallet_id::text, chain_id::integer,
  state, cursor, source_binding_id::text, source_helper_address,
  target_helper_address, registry_version, nonce::text, fencing_token::text,
  plan_digest, plan_payload, preview_digest, request_hash, idempotency_key,
  reauthenticated_session_id::text, sweep_batch_id::text, failure_code,
  manual_recovery_blockers, created_at, updated_at`;

function bindingFrom(row: BindingRow): LocalHelperSweepBinding {
  if (!row.verified_block_number) throw new LocalHelperUpgradeError("BINDING_NOT_FOUND");
  return {
    adapterAddress: row.adapter_address,
    bindingId: row.binding_id,
    deploymentRegistryVersion: row.registry_version,
    helperAddress: row.helper_address,
    helperVersion: row.helper_version,
    ownerAddress: row.owner_address,
    permit2Address: row.permit2_address,
    runtimeCodeHash: row.runtime_code_hash,
    state: row.state,
    verifiedBlockNumber: row.verified_block_number,
    walletId: row.wallet_id,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function liveOperationIds(
  client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  input: { tenantId: string; userId: string; walletId: string },
): Promise<string[]> {
  const result = await client.query<{ operation_id: string }>(
    `SELECT operation_id::text FROM chain_operations
      WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        AND state IN ('queued', 'signed', 'broadcast', 'pending', 'confirmed', 'dropped', 'reconciling')
     UNION ALL
     SELECT operation_id::text FROM local_swap_operations
      WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        AND state NOT IN ('succeeded', 'failed')
     UNION ALL
     SELECT operation_id::text FROM local_position_operations
      WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        AND state NOT IN ('succeeded', 'failed')
     UNION ALL
     SELECT operation_id::text FROM local_helper_sweep_operations
      WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        AND state NOT IN ('succeeded', 'failed')
     UNION ALL
     SELECT operation_id::text FROM local_helper_upgrade_operations
      WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        AND state IN ('queued', 'running', 'manual-recovery-required')`,
    [input.tenantId, input.userId, input.walletId],
  );
  return result.rows.map(({ operation_id }) => operation_id);
}

export class PostgresLocalHelperUpgradePreviewStore implements LocalHelperUpgradePreviewStore {
  constructor(readonly pool: Pool) {}

  async get(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const tokenDigest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
    const result = await this.pool.query<PreviewRow>(
      `SELECT token_digest, tenant_id, user_id::text, preview_digest,
              request_payload, facts_payload, created_at
         FROM local_helper_upgrade_previews WHERE token_digest = $1`,
      [tokenDigest],
    );
    const row = result.rows[0];
    return row
      ? {
          createdAt: row.created_at,
          facts: structuredClone(row.facts_payload),
          previewDigest: row.preview_digest,
          request: structuredClone(row.request_payload),
          tenantId: row.tenant_id,
          tokenDigest: row.token_digest,
          userId: row.user_id,
        }
      : null;
  }

  async put(preview: StoredLocalHelperUpgradePreview): Promise<void> {
    await this.pool.query(
      `INSERT INTO local_helper_upgrade_previews (
         token_digest, tenant_id, user_id, wallet_id, preview_digest,
         request_payload, facts_payload, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        preview.tokenDigest,
        preview.tenantId,
        preview.userId,
        preview.request.walletId,
        preview.previewDigest,
        JSON.stringify(preview.request),
        JSON.stringify(preview.facts),
        preview.createdAt,
        preview.facts.snapshot.expiresAt,
      ],
    );
  }
}

export class PostgresLocalHelperUpgradeBindingStore implements LocalHelperUpgradeBindingStore {
  constructor(readonly pool: Pool) {}

  async getSource(input: { tenantId: string; userId: string; walletId: string }) {
    const result = await this.pool.query<BindingRow>(
      `SELECT ${bindingColumns}
         FROM wallet_helper_deployment_bindings
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
          AND chain_id = 31337 AND helper_version = 'WalletHelperV1'
          AND state IN ('active', 'degraded')
        ORDER BY (state = 'active') DESC, updated_at DESC LIMIT 1`,
      [input.tenantId, input.userId, input.walletId],
    );
    return result.rows[0] ? bindingFrom(result.rows[0]) : null;
  }
}

export class PostgresLocalHelperUpgradeOperationStore implements LocalHelperUpgradeOperationStore {
  readonly #now: () => Date;
  readonly #uuid: () => string;

  constructor(
    readonly pool: Pool,
    input: { now?: () => Date; uuid?: () => string } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findLiveOperationIds(input: { tenantId: string; userId: string; walletId: string }) {
    return liveOperationIds(this.pool, input);
  }

  async nonceConflict(input: { chainId: 31_337; nonce: string; walletId: string }) {
    const result = await this.pool.query<{ conflict: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM wallet_nonce_ledgers
          WHERE chain_id = $1 AND wallet_id = $2
            AND (reconciliation_reason IS NOT NULL OR (next_nonce IS NOT NULL AND next_nonce <> $3))
         UNION ALL
         SELECT 1 FROM chain_operations
          WHERE chain_id = $1 AND wallet_id = $2 AND nonce = $3 AND state <> 'failed'
         UNION ALL
         SELECT 1 FROM local_swap_operation_steps s
           JOIN local_swap_operations o ON o.operation_id = s.operation_id
          WHERE o.chain_id = $1 AND o.wallet_id = $2 AND s.nonce = $3
            AND o.state NOT IN ('succeeded', 'failed')
         UNION ALL
         SELECT 1 FROM local_position_operation_steps s
           JOIN local_position_operations o ON o.operation_id = s.operation_id
          WHERE o.chain_id = $1 AND o.wallet_id = $2 AND s.nonce = $3
            AND o.state NOT IN ('succeeded', 'failed')
         UNION ALL
         SELECT 1 FROM local_helper_sweep_operations
          WHERE chain_id = $1 AND wallet_id = $2 AND nonce = $3
            AND state NOT IN ('succeeded', 'failed')
         UNION ALL
         SELECT 1 FROM local_helper_upgrade_operations
          WHERE chain_id = $1 AND wallet_id = $2 AND nonce = $3
            AND state IN ('queued', 'running', 'manual-recovery-required')
       ) AS conflict`,
      [input.chainId, input.walletId, input.nonce],
    );
    return result.rows[0]?.conflict === true;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const result = await this.pool.query<{
      operation_id: string;
      request_hash: `sha256:${string}`;
    }>(
      `SELECT operation_id::text, request_hash
         FROM local_helper_upgrade_operations
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND idempotency_key = $4`,
      [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    const operation = await this.get({
      operationId: row.operation_id,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    return operation ? { operation, requestHash: row.request_hash } : null;
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const client = await this.pool.connect();
    try {
      return await this.#load(client, input.operationId, input.tenantId, input.userId);
    } finally {
      client.release();
    }
  }

  async latest(input: { tenantId: string; userId: string; walletId: string }) {
    const result = await this.pool.query<{ operation_id: string }>(
      `SELECT operation_id::text FROM local_helper_upgrade_operations
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        ORDER BY created_at DESC, operation_id DESC LIMIT 1`,
      [input.tenantId, input.userId, input.walletId],
    );
    return result.rows[0]
      ? this.get({
          operationId: result.rows[0].operation_id,
          tenantId: input.tenantId,
          userId: input.userId,
        })
      : null;
  }

  async create(input: LocalHelperUpgradeCreateInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const duplicate = await client.query<{
        operation_id: string;
        request_hash: `sha256:${string}`;
      }>(
        `SELECT operation_id::text, request_hash
           FROM local_helper_upgrade_operations
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND idempotency_key = $4
          FOR UPDATE`,
        [input.tenantId, input.userId, input.wallet.walletId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== input.requestHash) {
          throw new LocalHelperUpgradeError("IDEMPOTENCY_CONFLICT");
        }
        const operation = await this.#load(
          client,
          duplicate.rows[0].operation_id,
          input.tenantId,
          input.userId,
        );
        if (!operation) throw new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { kind: "duplicate" as const, operation };
      }
      const wallet = await client.query<{
        address_lower: `0x${string}`;
        lifecycle_status: string;
        lock_status: string;
      }>(
        `SELECT address_lower, lifecycle_status, lock_status FROM custody_wallets
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 FOR UPDATE`,
        [input.tenantId, input.userId, input.wallet.walletId],
      );
      const walletRow = wallet.rows[0];
      if (!walletRow || walletRow.address_lower !== input.wallet.address) {
        throw new LocalHelperUpgradeError("WALLET_NOT_FOUND");
      }
      if (walletRow.lifecycle_status !== "active" || walletRow.lock_status !== "ready") {
        throw new LocalHelperUpgradeError("WALLET_LOCKED");
      }
      const bindingResult = await client.query<BindingRow>(
        `SELECT ${bindingColumns} FROM wallet_helper_deployment_bindings
          WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4
            AND chain_id = 31337 AND helper_version = 'WalletHelperV1' FOR UPDATE`,
        [input.sourceBinding.bindingId, input.tenantId, input.userId, input.wallet.walletId],
      );
      const binding = bindingResult.rows[0] ? bindingFrom(bindingResult.rows[0]) : null;
      if (
        !binding ||
        binding.state !== "active" ||
        JSON.stringify(binding) !== JSON.stringify(input.sourceBinding)
      ) {
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      if (
        (
          await liveOperationIds(client, {
            tenantId: input.tenantId,
            userId: input.userId,
            walletId: input.wallet.walletId,
          })
        ).length > 0
      ) {
        throw new LocalHelperUpgradeError("HELPER_UPGRADE_IN_PROGRESS");
      }
      const now = this.#now();
      await client.query(
        `INSERT INTO wallet_nonce_ledgers (
           chain_id, wallet_id, next_nonce, last_confirmed_nonce,
           fencing_token, reconciliation_reason, created_at, updated_at
         ) VALUES (31337, $1, $2, NULL, 0, NULL, $3, $3)
         ON CONFLICT (chain_id, wallet_id) DO NOTHING`,
        [input.wallet.walletId, input.expectedNonce, now],
      );
      const ledgerResult = await client.query<LedgerRow>(
        `SELECT next_nonce::text, fencing_token::text, reconciliation_reason
           FROM wallet_nonce_ledgers WHERE chain_id = 31337 AND wallet_id = $1 FOR UPDATE`,
        [input.wallet.walletId],
      );
      const ledger = ledgerResult.rows[0];
      if (
        !ledger ||
        ledger.reconciliation_reason !== null ||
        ledger.next_nonce !== input.expectedNonce
      ) {
        throw new LocalHelperUpgradeError("NONCE_CONFLICT");
      }
      const fencingToken = (BigInt(ledger.fencing_token) + 1n).toString();
      await client.query(
        `UPDATE wallet_nonce_ledgers
            SET next_nonce = $2, fencing_token = $3, updated_at = $4
          WHERE chain_id = 31337 AND wallet_id = $1`,
        [input.wallet.walletId, (BigInt(input.expectedNonce) + 1n).toString(), fencingToken, now],
      );
      const operationId = this.#uuid().toLowerCase();
      const plan = input.buildPlan({ fencingToken, operationId });
      if (plan.planDigest !== localHelperUpgradePlanDigest(plan)) {
        throw new LocalHelperUpgradeError("PREVIEW_CHANGED");
      }
      await client.query(
        `INSERT INTO local_helper_upgrade_operations (
           operation_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
           operation_kind, state, cursor, source_binding_id, source_helper_address,
           source_runtime_code_hash, target_helper_address, target_runtime_code_hash,
           target_abi_hash, target_selector_set_hash, target_version, owner_address,
           adapter_address, permit2_address, registry_version, registry_digest,
           snapshot_digest, snapshot_payload, nonce, fencing_token, creation_code_hash,
           constructor_arguments_hash, transaction_to, transaction_value_base_unit,
           transaction_data, transaction_data_hash, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, fee_cap_base_unit, plan_digest,
           plan_deadline, plan_payload, preview_digest, request_hash, idempotency_key,
           reauthenticated_session_id, sweep_batch_id, active_transaction_id,
           failure_code, manual_recovery_blockers, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 31337, 'helper-deploy-new-upgrade', 'queued', 'preflight',
           $6, $7, $8, $9, $10, $11, $12, 'WalletHelperV2', $5, $13, $14,
           $15, $16, $17, $18::jsonb, $19, $20, $21, $22, NULL, 0, $23, $24,
           $25, $26, $27, $28, $29, $30, $31::jsonb, $32, $33, $34, $35,
           NULL, NULL, NULL, '[]'::jsonb, $36, $36)`,
        [
          operationId,
          input.tenantId,
          input.userId,
          input.wallet.walletId,
          input.wallet.address,
          binding.bindingId,
          binding.helperAddress,
          binding.runtimeCodeHash,
          plan.target.expectedAddress,
          plan.target.expectedRuntimeCodeHash,
          plan.target.abiHash,
          plan.target.selectorSetHash,
          plan.target.adapter,
          plan.target.permit2,
          plan.registry.version,
          plan.registry.digest,
          plan.snapshot.digest,
          JSON.stringify(input.snapshot),
          plan.nonce,
          plan.fencingToken,
          plan.target.creationCodeHash,
          plan.target.constructorArgumentsHash,
          plan.transaction.data,
          plan.transaction.dataHash,
          plan.feeLimit.gasLimit,
          plan.feeLimit.maxFeePerGasBaseUnit,
          plan.feeLimit.maxPriorityFeePerGasBaseUnit,
          plan.feeLimit.feeCapBaseUnit,
          plan.planDigest,
          plan.deadline,
          JSON.stringify(plan),
          input.previewDigest,
          input.requestHash,
          input.idempotencyKey,
          input.sessionId,
          now,
        ],
      );
      for (const [ordinal, cursor] of [
        "preflight",
        "deploy-v2",
        "verify-v2",
        "sweep-v1",
        "final-rescan-v1",
        "atomic-binding-switch",
        "completed",
      ].entries()) {
        await client.query(
          `INSERT INTO local_helper_upgrade_steps (operation_id, ordinal, cursor, state)
           VALUES ($1, $2, $3, 'pending')`,
          [operationId, ordinal, cursor],
        );
      }
      const targetBindingId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO wallet_helper_deployment_bindings (
           binding_id, tenant_id, user_id, wallet_id, chain_id, helper_version,
           operation_id, state, helper_address, owner_address, adapter_address,
           permit2_address, runtime_code_hash, registry_version,
           deployment_transaction_hash, verified_block_number, failure_code,
           created_at, updated_at, upgrade_operation_id, superseded_by_binding_id
         ) VALUES ($1, $2, $3, $4, 31337, 'WalletHelperV2', NULL, 'deploying',
                   $5, $6, $7, $8, $9, 'p05-local-helper-upgrade-v3',
                   NULL, NULL, NULL, $10, $10, $11, NULL)`,
        [
          targetBindingId,
          input.tenantId,
          input.userId,
          input.wallet.walletId,
          plan.target.expectedAddress,
          plan.target.owner,
          plan.target.adapter,
          plan.target.permit2,
          plan.target.expectedRuntimeCodeHash,
          now,
          operationId,
        ],
      );
      await client.query(
        `INSERT INTO local_helper_upgrade_outbox (
           event_id, operation_id, cursor, event_type, state, attempt_count,
           available_at, created_at
         ) VALUES ($1, $2, 'preflight', 'helper-upgrade.cursor-ready', 'pending', 0, $3, $3)`,
        [this.#uuid().toLowerCase(), operationId, now],
      );
      const operation = await this.#load(client, operationId, input.tenantId, input.userId);
      if (!operation) throw new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true);
      await client.query("COMMIT");
      return { kind: "created" as const, operation };
    } catch (error) {
      await rollback(client);
      if ((error as { code?: string }).code === "23505") {
        throw new LocalHelperUpgradeError("HELPER_UPGRADE_IN_PROGRESS");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordV2Verification(input: {
    operationId: string;
    transactionHash: `0x${string}`;
    transactionId: string;
    verification: WalletHelperV2Verification;
    verifiedAt: Date;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const operation = await this.#lock(client, input.operationId);
      if (operation.cursor !== "verify-v2" || operation.state !== "running") {
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      const plan = operation.plan_payload;
      assertWalletHelperV2Verification(input.verification, {
        abiHash: plan.target.abiHash,
        adapter: plan.target.adapter,
        expectedAddress: plan.target.expectedAddress,
        expectedRuntimeCodeHash: plan.target.expectedRuntimeCodeHash,
        owner: plan.target.owner,
        permit2: plan.target.permit2,
        selectorSetHash: plan.target.selectorSetHash,
        tokenA: plan.target.tokenA,
        tokenB: plan.target.tokenB,
      });
      await client.query(
        `UPDATE wallet_helper_deployment_bindings
            SET deployment_transaction_hash = $2, verified_block_number = $3,
                failure_code = NULL, updated_at = $4
          WHERE upgrade_operation_id = $1 AND helper_version = 'WalletHelperV2'
            AND state = 'deploying'`,
        [
          input.operationId,
          input.transactionHash,
          input.verification.observedAtBlock,
          input.verifiedAt,
        ],
      );
      await client.query(
        `INSERT INTO local_helper_upgrade_v2_verification_evidence (
           evidence_id, operation_id, transaction_id, block_number, block_hash,
           verification_payload, evidence_digest, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          this.#uuid().toLowerCase(),
          input.operationId,
          input.transactionId,
          input.verification.observedAtBlock,
          `0x${"0".repeat(64)}`,
          JSON.stringify(input.verification),
          localHelperUpgradePlanDigest(plan),
          input.verifiedAt,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async atomicBindingSwitch(input: {
    completedAt: Date;
    finalSnapshot: LocalHelperResidualSnapshot;
    operationId: string;
    verification: WalletHelperV2Verification;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const operation = await this.#lock(client, input.operationId);
      if (operation.cursor !== "atomic-binding-switch" || operation.state !== "running") {
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      const plan = operation.plan_payload;
      const decision = localHelperV1SupersedeDecision(input.finalSnapshot);
      assertWalletHelperV2Verification(input.verification, {
        abiHash: plan.target.abiHash,
        adapter: plan.target.adapter,
        expectedAddress: plan.target.expectedAddress,
        expectedRuntimeCodeHash: plan.target.expectedRuntimeCodeHash,
        owner: plan.target.owner,
        permit2: plan.target.permit2,
        selectorSetHash: plan.target.selectorSetHash,
        tokenA: plan.target.tokenA,
        tokenB: plan.target.tokenB,
      });
      await client.query(
        `INSERT INTO local_helper_upgrade_final_rescan_evidence (
           evidence_id, operation_id, snapshot_digest, snapshot_payload,
           eligible_for_supersede, manual_recovery_required, blockers, observed_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)
         ON CONFLICT (operation_id, snapshot_digest) DO NOTHING`,
        [
          this.#uuid().toLowerCase(),
          input.operationId,
          input.finalSnapshot.snapshotDigest,
          JSON.stringify(input.finalSnapshot),
          decision.eligible,
          decision.manualRecoveryRequired,
          JSON.stringify(decision.blockers),
          input.completedAt,
        ],
      );
      if (!decision.eligible) {
        if (decision.manualRecoveryRequired) {
          await client.query(
            `UPDATE local_helper_upgrade_operations
                SET state = 'manual-recovery-required', failure_code = 'MANUAL_RECOVERY_REQUIRED',
                    manual_recovery_blockers = $2::jsonb, updated_at = $3
              WHERE operation_id = $1`,
            [input.operationId, JSON.stringify(decision.blockers), input.completedAt],
          );
          await client.query("COMMIT");
          return;
        }
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      const bindings = await client.query<{
        binding_id: string;
        helper_version: "WalletHelperV1" | "WalletHelperV2";
        state: string;
        verified_block_number: string | null;
      }>(
        `SELECT binding_id::text, helper_version, state, verified_block_number::text
           FROM wallet_helper_deployment_bindings
          WHERE binding_id = $1 OR upgrade_operation_id = $2
          ORDER BY helper_version FOR UPDATE`,
        [operation.source_binding_id, input.operationId],
      );
      const source = bindings.rows.find(
        ({ helper_version }) => helper_version === "WalletHelperV1",
      );
      const target = bindings.rows.find(
        ({ helper_version }) => helper_version === "WalletHelperV2",
      );
      if (
        !source ||
        source.state !== "active" ||
        !target ||
        target.state !== "deploying" ||
        target.verified_block_number === null
      ) {
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      const superseded = await client.query(
        `UPDATE wallet_helper_deployment_bindings
            SET state = 'superseded', superseded_by_binding_id = $2, updated_at = $3
          WHERE binding_id = $1 AND state = 'active'`,
        [source.binding_id, target.binding_id, input.completedAt],
      );
      const activated = await client.query(
        `UPDATE wallet_helper_deployment_bindings
            SET state = 'active', failure_code = NULL, updated_at = $2
          WHERE binding_id = $1 AND state = 'deploying'`,
        [target.binding_id, input.completedAt],
      );
      if (superseded.rowCount !== 1 || activated.rowCount !== 1) {
        throw new LocalHelperUpgradeError("PREFLIGHT_FAILED");
      }
      await client.query(
        `UPDATE local_helper_upgrade_steps
            SET state = 'succeeded', failure_code = NULL, updated_at = $2
          WHERE operation_id = $1 AND cursor IN ('atomic-binding-switch', 'completed')`,
        [input.operationId, input.completedAt],
      );
      await client.query(
        `UPDATE local_helper_upgrade_operations
            SET state = 'completed', cursor = 'completed', failure_code = NULL,
                manual_recovery_blockers = '[]'::jsonb, updated_at = $2
          WHERE operation_id = $1`,
        [input.operationId, input.completedAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #load(client: PoolClient, operationId: string, tenantId: string, userId: string) {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns} FROM local_helper_upgrade_operations
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [operationId, tenantId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.plan_digest !== localHelperUpgradePlanDigest(row.plan_payload)) {
      throw new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true);
    }
    const [stepResult, transactionResult] = await Promise.all([
      client.query<StepRow>(
        `SELECT cursor, state, failure_code, updated_at
           FROM local_helper_upgrade_steps WHERE operation_id = $1 ORDER BY ordinal`,
        [operationId],
      ),
      client.query<TransactionRow>(
        `SELECT transaction_id::text, generation, state, active,
                max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
                transaction_hash
           FROM local_helper_upgrade_transactions
          WHERE operation_id = $1 ORDER BY generation`,
        [operationId],
      ),
    ]);
    return {
      chainId: 31_337,
      createdAt: row.created_at.toISOString(),
      cursor: row.cursor,
      expectedTargetAddress: row.target_helper_address,
      failureCode: row.failure_code,
      fencingToken: row.fencing_token,
      manualRecovery: {
        blockers: row.manual_recovery_blockers,
        required: row.state === "manual-recovery-required",
      },
      nonce: row.nonce,
      operationId: row.operation_id,
      plan: structuredClone(row.plan_payload),
      planDigest: row.plan_digest,
      previewDigest: row.preview_digest,
      registryVersion: row.registry_version,
      requestHash: row.request_hash,
      sessionId: row.reauthenticated_session_id,
      sourceBindingId: row.source_binding_id,
      sourceHelperAddress: row.source_helper_address,
      state: row.state,
      steps: stepResult.rows.map((step) => ({
        cursor: step.cursor,
        failureCode: step.failure_code,
        state: step.state,
        updatedAt: step.updated_at?.toISOString() ?? null,
      })),
      sweepBatchId: row.sweep_batch_id,
      tenantId: row.tenant_id,
      transactions: transactionResult.rows.map((transaction) => ({
        active: transaction.active,
        generation: transaction.generation,
        maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
        maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
        state: transaction.state,
        transactionHash: transaction.transaction_hash,
        transactionId: transaction.transaction_id,
      })),
      updatedAt: row.updated_at.toISOString(),
      userId: row.user_id,
      versions: {
        comparison: "upgrade-available" as const,
        source: "WalletHelperV1" as const,
        target: "WalletHelperV2" as const,
      },
      walletId: row.wallet_id,
    } satisfies StoredLocalHelperUpgradeOperation;
  }

  async #lock(client: PoolClient, operationId: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns} FROM local_helper_upgrade_operations
        WHERE operation_id = $1 FOR UPDATE`,
      [operationId],
    );
    if (!result.rows[0]) throw new LocalHelperUpgradeError("HELPER_UPGRADE_NOT_FOUND");
    return result.rows[0];
  }
}

export const localHelperUpgradeTargetSelectorSetHash = localHelperUpgradeSelectorSetHash(
  P05_LOCAL_HELPER_UPGRADE_REGISTRY.target.selectors,
);
