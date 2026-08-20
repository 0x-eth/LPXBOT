import { createHash, randomUUID } from "node:crypto";

import type { HelperDeploymentState, HelperDeploymentTransactionView } from "@lpbot/api-contract";
import { helperDeploymentComponent, P05_HELPER_DEPLOYMENT_REGISTRY } from "@lpbot/chain-registry";
import {
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
  type HelperDeploymentPlanValidationContext,
} from "@lpbot/domain/helper-deployment";
import type { Pool, PoolClient } from "pg";
import { getContractAddress } from "viem";

import {
  HelperDeploymentError,
  helperDeploymentIdempotencyRetentionHours,
  type HelperDeploymentCreateInput,
  type HelperDeploymentIdempotencyRecord,
  type HelperDeploymentNonceView,
  type HelperDeploymentOperationStore,
  type HelperDeploymentPreviewStore,
  type StoredHelperDeploymentOperation,
  type StoredHelperDeploymentPreview,
} from "./helper-deployments.js";
import { hasLiveLocalHelperUpgrade } from "./postgres-local-helper-upgrade-guard.js";

interface OperationRow {
  active_transaction_id: string | null;
  adapter_address: `0x${string}`;
  chain_id: string;
  constructor_arguments_hash: `sha256:${string}`;
  created_at: Date;
  creation_code_hash: `0x${string}`;
  expected_address: `0x${string}`;
  expected_runtime_code_hash: `0x${string}`;
  failure_code: string | null;
  fee_cap_base_unit: string;
  fencing_token: string;
  gas_limit: string;
  helper_version: "WalletHelperV1";
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  permit2_address: `0x${string}`;
  plan_deadline: Date;
  plan_digest: `sha256:${string}`;
  plan_payload: unknown;
  preview_digest: `sha256:${string}`;
  reconciliation_reason: string | null;
  reauthenticated_session_id: string;
  registry_block_number: string;
  registry_digest: `sha256:${string}`;
  registry_version: string;
  request_hash: `sha256:${string}`;
  snapshot_digest: `sha256:${string}`;
  state: HelperDeploymentState;
  tenant_id: string;
  transaction_data: `0x${string}`;
  transaction_data_hash: `0x${string}`;
  transaction_to: null;
  transaction_value_base_unit: string;
  updated_at: Date;
  user_id: string;
  wallet_address: `0x${string}`;
  wallet_id: string;
}

interface TransactionRow {
  active: boolean;
  generation: number;
  state: HelperDeploymentTransactionView["state"];
  transaction_hash: `0x${string}` | null;
}

interface LedgerRow {
  fencing_token: string;
  next_nonce: string | null;
}

const operationColumns = `
  o.operation_id::text, o.tenant_id, o.user_id::text, o.wallet_id::text, o.wallet_address,
  o.chain_id::text, o.state, o.helper_version, o.registry_version, o.registry_digest,
  o.registry_block_number::text, o.expected_address, o.expected_runtime_code_hash,
  o.creation_code_hash, o.constructor_arguments_hash, o.adapter_address, o.permit2_address,
  o.nonce::text, o.fencing_token::text, o.transaction_to,
  o.transaction_value_base_unit::text, o.transaction_data, o.transaction_data_hash,
  o.gas_limit::text, o.max_fee_per_gas_base_unit::text,
  o.max_priority_fee_per_gas_base_unit::text, o.fee_cap_base_unit::text,
  o.preview_digest, o.request_hash, o.plan_digest, o.snapshot_digest, o.plan_deadline,
  o.plan_payload, o.reauthenticated_session_id::text, o.active_transaction_id::text,
  o.failure_code, o.reconciliation_reason, o.created_at, o.updated_at`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function retryableDatabaseError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return code === "40001" || code === "40P01";
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function consensusNonce(views: readonly HelperDeploymentNonceView[]): bigint {
  if (views.length < 1 || views.length > 4) {
    throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const identities = new Set<string>();
  const providerIds = new Set<string>();
  for (const view of views) {
    if (
      providerIds.has(view.providerId) ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(view.providerId) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(view.latest) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(view.pending)
    ) {
      throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providerIds.add(view.providerId);
    const latest = BigInt(view.latest);
    const pending = BigInt(view.pending);
    if (pending < latest) {
      throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    identities.add(`${latest}:${pending}`);
  }
  if (identities.size !== 1) {
    throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return BigInt(views[0]!.pending);
}

function planContext(plan: HelperDeploymentPlan): HelperDeploymentPlanValidationContext {
  const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
  return {
    adapter: helperDeploymentComponent("adapter", registry).address,
    chainId: 31_337,
    constructorArgumentsHash: plan.deployment.constructorArgumentsHash,
    creationCodeHash: registry.helperTemplate.creationCodeHash,
    expectedAddress: plan.deployment.expectedAddress,
    expectedRuntimeCodeHash: plan.deployment.expectedRuntimeCodeHash,
    helperVersion: "WalletHelperV1",
    initCode: plan.transaction.data,
    initCodeHash: plan.transaction.dataHash,
    owner: plan.wallet.address,
    permit2: helperDeploymentComponent("permit2", registry).address,
    registryDigest: registry.registryDigest,
    registryRollbackVersion: registry.rollbackVersion,
    registryValidFromBlock: registry.validFromBlock,
    registryValidToBlock: registry.validToBlock,
    registryVersion: registry.registryVersion,
    tokenA: registry.tokens[0],
    tokenB: registry.tokens[1],
  };
}

function storedPlan(row: OperationRow): HelperDeploymentPlan {
  const plan = row.plan_payload as HelperDeploymentPlan;
  const validationTime = new Date(new Date(plan.deadline).getTime() - 1);
  try {
    validateHelperDeploymentPlan(plan, planContext(plan), validationTime);
  } catch (error) {
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true, { cause: error });
  }
  if (
    helperDeploymentPlanDigest(plan) !== row.plan_digest ||
    plan.operationId !== row.operation_id ||
    plan.wallet.walletId !== row.wallet_id ||
    plan.wallet.address !== row.wallet_address ||
    plan.nonce !== row.nonce ||
    plan.fencingToken !== row.fencing_token ||
    plan.transaction.to !== row.transaction_to ||
    plan.transaction.valueBaseUnit !== row.transaction_value_base_unit ||
    plan.transaction.data !== row.transaction_data ||
    plan.transaction.dataHash !== row.transaction_data_hash ||
    plan.deployment.expectedAddress !== row.expected_address ||
    plan.deployment.expectedRuntimeCodeHash !== row.expected_runtime_code_hash
  ) {
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
  }
  return plan;
}

function transaction(row: TransactionRow): HelperDeploymentTransactionView {
  return {
    active: row.active,
    generation: row.generation,
    state: row.state,
    transactionHash: row.transaction_hash,
  };
}

function operation(
  row: OperationRow,
  transactions: HelperDeploymentTransactionView[],
): StoredHelperDeploymentOperation {
  const plan = storedPlan(row);
  return {
    chainId: 31_337,
    createdAt: row.created_at.toISOString(),
    expectedAddress: row.expected_address,
    failureCode: row.failure_code,
    feeLimit: {
      feeCapBaseUnit: row.fee_cap_base_unit,
      gasLimit: row.gas_limit,
      maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
      maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
    },
    fencingToken: row.fencing_token,
    helperVersion: row.helper_version,
    nonce: row.nonce,
    operationId: row.operation_id,
    plan,
    planDigest: row.plan_digest,
    previewDigest: row.preview_digest,
    reconciliationReason: row.reconciliation_reason,
    registryVersion: row.registry_version,
    requestHash: row.request_hash,
    sessionId: row.reauthenticated_session_id,
    state: row.state,
    tenantId: row.tenant_id,
    transactions,
    updatedAt: row.updated_at.toISOString(),
    userId: row.user_id,
    walletId: row.wallet_id,
  };
}

export class PostgresHelperDeploymentPreviewStore implements HelperDeploymentPreviewStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async get(token: string): Promise<StoredHelperDeploymentPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const result = await this.#pool.query<{
      created_at: Date;
      facts_payload: StoredHelperDeploymentPreview["facts"];
      preview_digest: `sha256:${string}`;
      request_payload: StoredHelperDeploymentPreview["request"];
      tenant_id: string;
      token_digest: string;
      user_id: string;
    }>(
      `SELECT token_digest, tenant_id, user_id::text, preview_digest,
              request_payload, facts_payload, created_at
         FROM helper_deployment_previews
        WHERE token_digest = $1`,
      [sha256(token)],
    );
    const row = result.rows[0];
    return row
      ? {
          createdAt: row.created_at,
          facts: row.facts_payload,
          previewDigest: row.preview_digest,
          request: row.request_payload,
          tenantId: row.tenant_id,
          tokenDigest: row.token_digest,
          userId: row.user_id,
        }
      : null;
  }

  async put(preview: StoredHelperDeploymentPreview): Promise<void> {
    await this.#pool.query(
      `INSERT INTO helper_deployment_previews (
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
        preview.facts.expiresAt,
      ],
    );
  }
}

export class PostgresHelperDeploymentOperationStore implements HelperDeploymentOperationStore {
  readonly #now: () => Date;
  readonly #pool: Pool;
  readonly #uuid: () => string;

  constructor(pool: Pool, input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#pool = pool;
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<HelperDeploymentIdempotencyRecord | null> {
    const result = await this.#pool.query<OperationRow & { idempotency_hash: `sha256:${string}` }>(
      `SELECT ${operationColumns}, i.request_hash AS idempotency_hash
         FROM chain_operation_idempotency i
         JOIN chain_operations o ON o.operation_id = i.operation_id
        WHERE i.tenant_id = $1 AND i.user_id = $2 AND i.wallet_id = $3
          AND i.command_type = 'helper.deploy' AND i.idempotency_key = $4`,
      [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? {
          operation: operation(row, await this.#transactions(row.operation_id)),
          requestHash: row.idempotency_hash,
        }
      : null;
  }

  async get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredHelperDeploymentOperation | null> {
    const result = await this.#pool.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM chain_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [input.operationId, input.tenantId, input.userId],
    );
    const row = result.rows[0];
    return row ? operation(row, await this.#transactions(row.operation_id)) : null;
  }

  async create(input: HelperDeploymentCreateInput) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#createOnce(input);
      } catch (error) {
        if (error instanceof HelperDeploymentError) throw error;
        if (uniqueViolation(error)) {
          const existing = await this.findIdempotency(input);
          if (existing) {
            if (existing.requestHash !== input.requestHash) {
              throw new HelperDeploymentError("IDEMPOTENCY_CONFLICT");
            }
            return { kind: "duplicate" as const, operation: existing.operation };
          }
          throw new HelperDeploymentError("HELPER_DEPLOYMENT_IN_PROGRESS");
        }
        if (!retryableDatabaseError(error) || attempt === 2) {
          throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true, {
            cause: error,
          });
        }
      }
    }
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
  }

  async #createOnce(input: HelperDeploymentCreateInput) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const duplicate = await client.query<{
        operation_id: string;
        request_hash: `sha256:${string}`;
      }>(
        `SELECT operation_id::text, request_hash
           FROM chain_operation_idempotency
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND command_type = 'helper.deploy' AND idempotency_key = $4
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== input.requestHash) {
          throw new HelperDeploymentError("IDEMPOTENCY_CONFLICT");
        }
        const stored = await this.#load(client, duplicate.rows[0].operation_id, input);
        if (!stored) throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { kind: "duplicate" as const, operation: stored };
      }

      const wallet = await client.query<{
        address_lower: `0x${string}`;
        lifecycle_status: string;
        lock_status: string;
      }>(
        `SELECT address_lower, lifecycle_status, lock_status
           FROM custody_wallets
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId],
      );
      const walletRow = wallet.rows[0];
      if (!walletRow || walletRow.address_lower !== input.walletAddress) {
        throw new HelperDeploymentError("WALLET_NOT_FOUND");
      }
      if (walletRow.lifecycle_status !== "active" || walletRow.lock_status !== "ready") {
        throw new HelperDeploymentError("WALLET_LOCKED");
      }
      if (
        await hasLiveLocalHelperUpgrade(client, {
          tenantId: input.tenantId,
          userId: input.userId,
          walletId: input.walletId,
        })
      ) {
        throw new HelperDeploymentError("HELPER_UPGRADE_IN_PROGRESS");
      }
      const binding = await client.query<{ state: "active" | "deploying" }>(
        `SELECT state
           FROM wallet_helper_deployment_bindings
         WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND chain_id = 31337
            AND state IN ('deploying', 'active')
          ORDER BY (state = 'active') DESC
          LIMIT 1
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId],
      );
      if (binding.rows[0]?.state === "active") {
        throw new HelperDeploymentError("HELPER_ALREADY_ACTIVE");
      }
      if (binding.rows[0]) throw new HelperDeploymentError("HELPER_DEPLOYMENT_IN_PROGRESS");

      const now = this.#now();
      await client.query(
        `INSERT INTO wallet_nonce_ledgers (
           chain_id, wallet_id, next_nonce, last_confirmed_nonce,
           fencing_token, reconciliation_reason, created_at, updated_at
         ) VALUES (31337, $1, NULL, NULL, 0, NULL, $2, $2)
         ON CONFLICT (chain_id, wallet_id) DO NOTHING`,
        [input.walletId, now],
      );
      const ledgerResult = await client.query<LedgerRow>(
        `SELECT next_nonce::text, fencing_token::text
           FROM wallet_nonce_ledgers
          WHERE chain_id = 31337 AND wallet_id = $1
          FOR UPDATE`,
        [input.walletId],
      );
      const ledger = ledgerResult.rows[0];
      if (!ledger) throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
      const providerNonce = consensusNonce(input.nonceViews);
      const nextNonce = ledger.next_nonce === null ? providerNonce : BigInt(ledger.next_nonce);
      if (
        providerNonce !== BigInt(input.expectedNonce) ||
        nextNonce !== BigInt(input.expectedNonce)
      ) {
        throw new HelperDeploymentError("NONCE_DRIFT");
      }
      const fencingToken = (BigInt(ledger.fencing_token) + 1n).toString();
      await client.query(
        `UPDATE wallet_nonce_ledgers
            SET next_nonce = $2, fencing_token = $3,
                reconciliation_reason = NULL, updated_at = $4
          WHERE chain_id = 31337 AND wallet_id = $1`,
        [input.walletId, (nextNonce + 1n).toString(), fencingToken, now],
      );

      const operationId = this.#uuid().toLowerCase();
      const plan = input.buildPlan({
        fencingToken,
        nonce: nextNonce.toString(),
        operationId,
      });
      validateHelperDeploymentPlan(plan, planContext(plan), now);
      const predicted = getContractAddress({
        from: input.walletAddress,
        nonce: nextNonce,
      }).toLowerCase();
      if (predicted !== input.expectedAddress || plan.deployment.expectedAddress !== predicted) {
        throw new HelperDeploymentError("NONCE_DRIFT");
      }

      await client.query(
        `INSERT INTO chain_operations (
           operation_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
           operation_kind, state, helper_version, registry_version, registry_digest,
           registry_block_number, expected_address, expected_runtime_code_hash,
           creation_code_hash, constructor_arguments_hash, adapter_address, permit2_address,
           nonce, fencing_token, transaction_to, transaction_value_base_unit,
           transaction_data, transaction_data_hash, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, fee_cap_base_unit, preview_digest,
           request_hash, plan_digest, snapshot_digest, plan_deadline, plan_payload,
           reauthenticated_session_id, active_transaction_id, failure_code,
           reconciliation_reason, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 31337, 'helper-deployment', 'queued', 'WalletHelperV1',
           $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NULL, 0,
           $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb,
           $29, NULL, NULL, NULL, $30, $30)`,
        [
          operationId,
          input.tenantId,
          input.userId,
          input.walletId,
          input.walletAddress,
          plan.registry.version,
          plan.registry.digest,
          plan.registry.blockNumber,
          plan.deployment.expectedAddress,
          plan.deployment.expectedRuntimeCodeHash,
          plan.deployment.creationCodeHash,
          plan.deployment.constructorArgumentsHash,
          plan.deployment.adapter,
          plan.deployment.permit2,
          plan.nonce,
          plan.fencingToken,
          plan.transaction.data,
          plan.transaction.dataHash,
          plan.feeLimit.gasLimit,
          plan.feeLimit.maxFeePerGasBaseUnit,
          plan.feeLimit.maxPriorityFeePerGasBaseUnit,
          plan.feeLimit.feeCapBaseUnit,
          input.previewDigest,
          input.requestHash,
          plan.planDigest,
          plan.snapshotDigest,
          plan.deadline,
          JSON.stringify(plan),
          input.sessionId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO chain_operation_idempotency (
           tenant_id, user_id, wallet_id, command_type, idempotency_key,
           request_hash, operation_id, created_at, expires_at
         ) VALUES ($1, $2, $3, 'helper.deploy', $4, $5, $6, $7, $8)`,
        [
          input.tenantId,
          input.userId,
          input.walletId,
          input.idempotencyKey,
          input.requestHash,
          operationId,
          now,
          new Date(now.getTime() + helperDeploymentIdempotencyRetentionHours * 60 * 60 * 1_000),
        ],
      );
      await client.query(
        `INSERT INTO wallet_helper_deployment_bindings (
           binding_id, tenant_id, user_id, wallet_id, chain_id, helper_version,
           operation_id, state, helper_address, owner_address, adapter_address,
           permit2_address, runtime_code_hash, registry_version,
           deployment_transaction_hash, verified_block_number, failure_code,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 31337, 'WalletHelperV1', $5, 'deploying',
                   $6, $7, $8, $9, $10, $11, NULL, NULL, NULL, $12, $12)`,
        [
          this.#uuid().toLowerCase(),
          input.tenantId,
          input.userId,
          input.walletId,
          operationId,
          plan.deployment.expectedAddress,
          plan.deployment.owner,
          plan.deployment.adapter,
          plan.deployment.permit2,
          plan.deployment.expectedRuntimeCodeHash,
          plan.registry.version,
          now,
        ],
      );
      await client.query(
        `INSERT INTO chain_operation_outbox (
           event_id, aggregate_id, event_type, payload, state,
           attempt_count, available_at, created_at
         ) VALUES ($1, $2, 'chain-operation.queued', $3::jsonb, 'pending', 0, $4, $4)`,
        [
          this.#uuid().toLowerCase(),
          operationId,
          JSON.stringify({
            chainId: 31_337,
            operationId,
            state: "queued",
            walletId: input.walletId,
          }),
          now,
        ],
      );
      for (const action of ["helper.submitted", "helper.nonce-reserved"]) {
        await client.query(
          `INSERT INTO chain_operation_audit_events (
             tenant_id, actor_user_id, session_id, operation_id, wallet_id, chain_id,
             nonce, transaction_hash, plan_digest, state, action, outcome,
             result_code, request_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, 31337, $6, NULL, $7, 'queued',
                     $8, 'allowed', 'ACCEPTED', $9, $10)`,
          [
            input.tenantId,
            input.userId,
            input.sessionId,
            operationId,
            input.walletId,
            plan.nonce,
            plan.planDigest,
            action,
            input.requestId,
            now,
          ],
        );
      }
      const stored = await this.#load(client, operationId, input);
      if (!stored) throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
      await client.query("COMMIT");
      return { kind: "created" as const, operation: stored };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #load(
    client: PoolClient,
    operationId: string,
    owner: { tenantId: string; userId: string },
  ): Promise<StoredHelperDeploymentOperation | null> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM chain_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [operationId, owner.tenantId, owner.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const transactions = await client.query<TransactionRow>(
      `SELECT active, generation, state, transaction_hash
         FROM chain_operation_transactions
        WHERE operation_id = $1
        ORDER BY generation`,
      [operationId],
    );
    return operation(row, transactions.rows.map(transaction));
  }

  async #transactions(operationId: string): Promise<HelperDeploymentTransactionView[]> {
    const result = await this.#pool.query<TransactionRow>(
      `SELECT active, generation, state, transaction_hash
         FROM chain_operation_transactions
        WHERE operation_id = $1
        ORDER BY generation`,
      [operationId],
    );
    return result.rows.map(transaction);
  }
}
