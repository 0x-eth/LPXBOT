import { createHash, randomUUID } from "node:crypto";

import type {
  LocalPositionOperationStep,
  LocalPositionStepTransactionView,
} from "@lpbot/api-contract";
import {
  localPositionExecutionPlanDigest,
  localPositionSnapshotDigest,
  type LocalPositionExecutionPlan,
  type LocalPositionSnapshot,
} from "@lpbot/domain/local-position-execution";
import type { Pool, PoolClient } from "pg";

import {
  LocalPositionExecutionError,
  localPositionIdempotencyRetentionHours,
  type LocalPositionIdempotencyRecord,
  type LocalPositionNonceView,
  type LocalPositionOperationStore,
  type LocalPositionPreviewStore,
  type LocalPositionSnapshotStore,
  type StoredLocalPositionOperation,
  type StoredLocalPositionPreview,
} from "./local-position-executions.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
  );
}

function retryableDatabaseError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
  return code === "40001" || code === "40P01";
}

function consensusNonce(views: readonly LocalPositionNonceView[]): bigint {
  if (views.length < 1 || views.length > 4) {
    throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const providers = new Set<string>();
  const identities = new Set<string>();
  for (const view of views) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(view.providerId) ||
      providers.has(view.providerId) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(view.latest) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(view.pending) ||
      BigInt(view.pending) < BigInt(view.latest)
    ) {
      throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providers.add(view.providerId);
    identities.add(`${view.latest}:${view.pending}`);
  }
  if (identities.size !== 1) {
    throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return BigInt(views[0]!.pending);
}

export class PostgresLocalPositionSnapshotStore implements LocalPositionSnapshotStore {
  constructor(readonly pool: Pool) {}

  async append(input: {
    snapshot: Readonly<LocalPositionSnapshot>;
    tenantId: string;
    userId: string;
  }): Promise<void> {
    const snapshot = input.snapshot;
    if (snapshot.snapshotDigest !== localPositionSnapshotDigest(snapshot)) {
      throw new LocalPositionExecutionError("SNAPSHOT_CHANGED");
    }
    await this.pool.query(
      `INSERT INTO local_position_snapshots (
         tenant_id, user_id, wallet_id, wallet_address, chain_id, platform_id,
         token_id, owner_address, approved_address, approved_for_all, approval_operator,
         manager_address, manager_abi_hash, manager_runtime_code_hash, token0, token1,
         pool_address, pool_id, tick_lower, tick_upper, tick_spacing, fee_pips,
         liquidity, reserve0_base_unit, reserve1_base_unit, tokens_owed0_base_unit,
         tokens_owed1_base_unit, observed_block_number, observed_block_hash,
         observed_at, expires_at, snapshot_version, snapshot_digest,
         registry_version, registry_digest, pricing_id, snapshot_payload
       ) VALUES (
         $1, $2, $3, $4, 31337, $5, $6::numeric, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18::numeric, $19::numeric,
         $20::numeric, $21::numeric, $22::numeric, $23::numeric, $24::numeric,
         $25::numeric, $26::numeric, $27::numeric, $28, $29, $30, $31, $32,
         $33, $34, NULL, $35::jsonb
       ) ON CONFLICT (tenant_id, user_id, wallet_id, snapshot_digest) DO NOTHING`,
      [
        input.tenantId,
        input.userId,
        snapshot.wallet.walletId,
        snapshot.wallet.address,
        snapshot.position.platformId,
        snapshot.position.tokenId,
        snapshot.position.owner,
        snapshot.position.approval.approvedAddress,
        snapshot.position.approval.approvedForAll,
        snapshot.position.approval.operator,
        snapshot.manager.address,
        snapshot.manager.abiHash,
        snapshot.manager.runtimeCodeHash,
        snapshot.position.pool.token0,
        snapshot.position.pool.token1,
        snapshot.position.pool.poolAddress,
        snapshot.position.pool.poolId,
        snapshot.position.ticks.lower,
        snapshot.position.ticks.upper,
        snapshot.position.pool.tickSpacing,
        snapshot.position.pool.feePips,
        snapshot.position.liquidity,
        snapshot.position.reserve0BaseUnit,
        snapshot.position.reserve1BaseUnit,
        snapshot.position.tokensOwed0BaseUnit,
        snapshot.position.tokensOwed1BaseUnit,
        snapshot.block.number,
        snapshot.block.hash,
        snapshot.observedAt,
        snapshot.expiresAt,
        snapshot.snapshotVersion,
        snapshot.snapshotDigest,
        snapshot.registry.version,
        snapshot.registry.digest,
        JSON.stringify(snapshot),
      ],
    );
  }

  async get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalPositionSnapshot> | null> {
    const result = await this.pool.query<{ snapshot_payload: LocalPositionSnapshot }>(
      `SELECT snapshot_payload
         FROM local_position_snapshots
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND snapshot_digest = $4`,
      [input.tenantId, input.userId, input.walletId, input.snapshotDigest],
    );
    return result.rows[0] ? structuredClone(result.rows[0].snapshot_payload) : null;
  }
}

export class PostgresLocalPositionPreviewStore implements LocalPositionPreviewStore {
  constructor(readonly pool: Pool) {}

  async get(token: string): Promise<StoredLocalPositionPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const result = await this.pool.query<{
      created_at: Date;
      facts_payload: StoredLocalPositionPreview["facts"];
      preview_digest: `sha256:${string}`;
      request_payload: StoredLocalPositionPreview["request"];
      tenant_id: string;
      token_digest: string;
      user_id: string;
    }>(
      `SELECT token_digest, tenant_id, user_id::text, preview_digest,
              request_payload, facts_payload, created_at
         FROM local_position_execution_previews
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

  async put(preview: StoredLocalPositionPreview): Promise<void> {
    await this.pool.query(
      `INSERT INTO local_position_execution_previews (
         token_digest, tenant_id, user_id, wallet_id, snapshot_digest,
         operation_kind, preview_digest, request_payload, facts_payload,
         created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       ON CONFLICT (token_digest) DO NOTHING`,
      [
        preview.tokenDigest,
        preview.tenantId,
        preview.userId,
        preview.request.walletId,
        preview.request.snapshotDigest,
        "percent" in preview.request ? "remove-liquidity" : "collect-fees",
        preview.previewDigest,
        JSON.stringify(preview.request),
        JSON.stringify(preview.facts),
        preview.createdAt,
        preview.facts.expiresAt,
      ],
    );
  }
}

interface OperationRow {
  accounting_payload: StoredLocalPositionOperation["accounting"];
  burn_if_empty: boolean;
  created_at: Date;
  failure_code: string | null;
  manager_address: StoredLocalPositionOperation["managerAddress"];
  operation_id: string;
  operation_kind: StoredLocalPositionOperation["operationKind"];
  percent: number | null;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalPositionExecutionPlan;
  platform_id: StoredLocalPositionOperation["platformId"];
  preview_digest: `sha256:${string}`;
  reauthenticated_session_id: string;
  reconciliation_reason: string | null;
  registry_version: StoredLocalPositionOperation["registryVersion"];
  request_hash: `sha256:${string}`;
  slippage_bps: number | null;
  snapshot_digest: `sha256:${string}`;
  state: StoredLocalPositionOperation["state"];
  tenant_id: string;
  token_id: string;
  updated_at: Date;
  user_id: string;
  wallet_id: string;
}

interface StepRow {
  failure_code: string | null;
  fee_cap_base_unit: string;
  gas_limit: string;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  ordinal: number;
  state: LocalPositionOperationStep["state"];
  step_id: string;
  step_kind: LocalPositionOperationStep["kind"];
}

interface TransactionRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  state: LocalPositionStepTransactionView["state"];
  transaction_hash: `0x${string}` | null;
}

const operationColumns = `
  o.operation_id::text, o.tenant_id, o.user_id::text, o.wallet_id::text,
  o.state, o.operation_kind, o.platform_id, o.token_id::text, o.snapshot_digest,
  o.manager_address, o.percent, o.slippage_bps, o.burn_if_empty,
  o.registry_version, o.preview_digest, o.request_hash, o.plan_digest,
  o.plan_payload, o.accounting_payload, o.reauthenticated_session_id::text,
  o.failure_code, o.reconciliation_reason, o.created_at, o.updated_at`;

export class PostgresLocalPositionOperationStore implements LocalPositionOperationStore {
  readonly #now: () => Date;
  readonly #uuid: () => string;

  constructor(
    readonly pool: Pool,
    input: { now?: () => Date; uuid?: () => string } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalPositionIdempotencyRecord | null> {
    const result = await this.pool.query<OperationRow & { idempotency_hash: `sha256:${string}` }>(
      `SELECT ${operationColumns}, i.request_hash AS idempotency_hash
         FROM local_position_operation_idempotency i
         JOIN local_position_operations o ON o.operation_id = i.operation_id
        WHERE i.tenant_id = $1 AND i.user_id = $2 AND i.wallet_id = $3
          AND i.idempotency_key = $4`,
      [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? { operation: await this.#operation(this.pool, row), requestHash: row.idempotency_hash }
      : null;
  }

  async get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalPositionOperation | null> {
    const result = await this.pool.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM local_position_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [input.operationId, input.tenantId, input.userId],
    );
    return result.rows[0] ? this.#operation(this.pool, result.rows[0]) : null;
  }

  async create(input: Parameters<LocalPositionOperationStore["create"]>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#createOnce(input);
      } catch (error) {
        if (error instanceof LocalPositionExecutionError) throw error;
        if (uniqueViolation(error)) {
          const duplicate = await this.findIdempotency(input);
          if (duplicate) {
            if (duplicate.requestHash !== input.requestHash) {
              throw new LocalPositionExecutionError("IDEMPOTENCY_CONFLICT");
            }
            return { kind: "duplicate" as const, operation: duplicate.operation };
          }
          throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true, {
            cause: error,
          });
        }
        if (!retryableDatabaseError(error) || attempt === 2) {
          throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true, {
            cause: error,
          });
        }
      }
    }
    throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
  }

  async #createOnce(input: Parameters<LocalPositionOperationStore["create"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const duplicate = await client.query<{
        operation_id: string;
        request_hash: `sha256:${string}`;
      }>(
        `SELECT operation_id::text, request_hash
           FROM local_position_operation_idempotency
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND idempotency_key = $4
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== input.requestHash) {
          throw new LocalPositionExecutionError("IDEMPOTENCY_CONFLICT");
        }
        const loaded = await this.#load(client, duplicate.rows[0].operation_id, input);
        if (!loaded) throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { kind: "duplicate" as const, operation: loaded };
      }

      const wallet = await client.query<{
        address_lower: string;
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
        throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
      }
      if (walletRow.lifecycle_status !== "active" || walletRow.lock_status !== "ready") {
        throw new LocalPositionExecutionError("WALLET_LOCKED");
      }
      const snapshot = await client.query<{ snapshot_digest: string }>(
        `SELECT snapshot_digest
           FROM local_position_snapshots
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND snapshot_digest = $4
          FOR SHARE`,
        [input.tenantId, input.userId, input.walletId, input.snapshotDigest],
      );
      if (!snapshot.rows[0]) throw new LocalPositionExecutionError("SNAPSHOT_NOT_FOUND");

      const now = this.#now();
      await client.query(
        `INSERT INTO wallet_nonce_ledgers (
           chain_id, wallet_id, next_nonce, last_confirmed_nonce,
           fencing_token, reconciliation_reason, created_at, updated_at
         ) VALUES (31337, $1, NULL, NULL, 0, NULL, $2, $2)
         ON CONFLICT (chain_id, wallet_id) DO NOTHING`,
        [input.walletId, now],
      );
      const ledgerResult = await client.query<{ fencing_token: string; next_nonce: string | null }>(
        `SELECT next_nonce::text, fencing_token::text
           FROM wallet_nonce_ledgers
          WHERE chain_id = 31337 AND wallet_id = $1
          FOR UPDATE`,
        [input.walletId],
      );
      const ledger = ledgerResult.rows[0];
      if (!ledger) throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
      const providerNonce = consensusNonce(input.nonceViews);
      const nextNonce = ledger.next_nonce === null ? providerNonce : BigInt(ledger.next_nonce);
      if (providerNonce !== BigInt(input.expectedNonce) || nextNonce !== BigInt(input.expectedNonce)) {
        throw new LocalPositionExecutionError("NONCE_DRIFT");
      }
      let fencingToken = BigInt(ledger.fencing_token);
      const reservations = input.stepKinds.map((kind, ordinal) => ({
        fencingToken: (++fencingToken).toString(),
        kind,
        nonce: (nextNonce + BigInt(ordinal)).toString(),
        ordinal,
        stepId: this.#uuid().toLowerCase(),
      }));
      await client.query(
        `UPDATE wallet_nonce_ledgers
            SET next_nonce = $2, fencing_token = $3,
                reconciliation_reason = NULL, updated_at = $4
          WHERE chain_id = 31337 AND wallet_id = $1`,
        [
          input.walletId,
          (nextNonce + BigInt(reservations.length)).toString(),
          fencingToken.toString(),
          now,
        ],
      );
      const operationId = this.#uuid().toLowerCase();
      const plan = input.buildPlan({ operationId, reservations });
      if (
        plan.operationId !== operationId ||
        plan.wallet.walletId !== input.walletId ||
        plan.wallet.address !== input.walletAddress ||
        plan.snapshot.snapshotDigest !== input.snapshotDigest ||
        plan.steps.length !== reservations.length ||
        plan.planDigest !== localPositionExecutionPlanDigest(plan) ||
        plan.steps.some(
          (step, index) =>
            step.stepId !== reservations[index]!.stepId ||
            step.nonce !== reservations[index]!.nonce ||
            step.fencingToken !== reservations[index]!.fencingToken ||
            step.kind !== reservations[index]!.kind,
        )
      ) {
        throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
      }
      const operationKind =
        plan.action.kind === "collect-fees"
          ? "position-collect-fees"
          : "position-remove-liquidity";
      await client.query(
        `INSERT INTO local_position_operations (
           operation_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
           operation_kind, state, platform_id, token_id, snapshot_digest,
           manager_address, percent, slippage_bps, burn_if_empty,
           registry_version, registry_digest, preview_digest, request_hash,
           plan_digest, plan_deadline, plan_payload, accounting_payload,
           reauthenticated_session_id, failure_code, reconciliation_reason,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 31337, $6, 'queued', $7, $8::numeric, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
           $20::jsonb, $21::jsonb, $22, NULL, NULL, $23, $23
         )`,
        [
          operationId,
          input.tenantId,
          input.userId,
          input.walletId,
          input.walletAddress,
          operationKind,
          plan.snapshot.position.platformId,
          plan.snapshot.position.tokenId,
          plan.snapshot.snapshotDigest,
          plan.manager.address,
          plan.action.percent,
          plan.action.slippageBps,
          plan.action.burnIfEmpty,
          plan.registry.version,
          plan.registry.digest,
          input.previewDigest,
          input.requestHash,
          plan.planDigest,
          plan.deadline,
          JSON.stringify(plan),
          JSON.stringify(plan.accounting),
          input.sessionId,
          now,
        ],
      );
      for (const [ordinal, step] of plan.steps.entries()) {
        await client.query(
          `INSERT INTO local_position_operation_steps (
             step_id, operation_id, tenant_id, user_id, wallet_id, chain_id,
             ordinal, step_kind, state, nonce, fencing_token, semantic_digest,
             transaction_to, transaction_value_base_unit, transaction_data,
             transaction_data_digest, gas_limit, max_fee_per_gas_base_unit,
             max_priority_fee_per_gas_base_unit, fee_cap_base_unit,
             active_transaction_id, failure_code, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, 31337, $6, $7, $8, $9::numeric, $10,
             $11, $12, 0, $13, $14, $15::numeric, $16::numeric, $17::numeric,
             $18::numeric, NULL, NULL, $19, $19
           )`,
          [
            step.stepId,
            operationId,
            input.tenantId,
            input.userId,
            input.walletId,
            ordinal,
            step.kind,
            ordinal === 0 ? "queued" : "blocked",
            step.nonce,
            step.fencingToken,
            step.semanticDigest,
            step.transaction.to,
            step.transaction.data,
            step.transaction.dataDigest,
            step.feeLimit.gasLimit,
            step.feeLimit.maxFeePerGasBaseUnit,
            step.feeLimit.maxPriorityFeePerGasBaseUnit,
            step.feeLimit.feeCapBaseUnit,
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO local_position_operation_idempotency (
           tenant_id, user_id, wallet_id, command_type, idempotency_key,
           request_hash, operation_id, created_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.tenantId,
          input.userId,
          input.walletId,
          plan.action.kind === "collect-fees"
            ? "position.collect-fees"
            : "position.remove-liquidity",
          input.idempotencyKey,
          input.requestHash,
          operationId,
          now,
          new Date(now.getTime() + localPositionIdempotencyRetentionHours * 60 * 60 * 1_000),
        ],
      );
      await client.query(
        `INSERT INTO local_position_operation_outbox (
           event_id, aggregate_id, step_id, event_type, payload, state,
           attempt_count, available_at, created_at
         ) VALUES ($1, $2, $3, 'local-position.queued', $4::jsonb, 'pending', 0, $5, $5)`,
        [
          this.#uuid().toLowerCase(),
          operationId,
          plan.steps[0]!.stepId,
          JSON.stringify({
            chainId: 31_337,
            operationId,
            state: "queued",
            walletId: input.walletId,
          }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO local_position_audit_events (
           tenant_id, actor_user_id, session_id, operation_id, step_id, wallet_id,
           nonce, transaction_hash, plan_digest, action, outcome, result_code,
           request_id, created_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, NULL, NULL, $6,
                   'position.submitted', 'allowed', 'ACCEPTED', $7, $8)`,
        [
          input.tenantId,
          input.userId,
          input.sessionId,
          operationId,
          input.walletId,
          plan.planDigest,
          input.requestId,
          now,
        ],
      );
      const stored = await this.#load(client, operationId, input);
      if (!stored) throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
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
    client: Pick<PoolClient, "query">,
    operationId: string,
    owner: { tenantId: string; userId: string },
  ): Promise<StoredLocalPositionOperation | null> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM local_position_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [operationId, owner.tenantId, owner.userId],
    );
    return result.rows[0] ? this.#operation(client, result.rows[0]) : null;
  }

  async #operation(
    client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    row: OperationRow,
  ): Promise<StoredLocalPositionOperation> {
    const plan = row.plan_payload;
    if (
      plan.planDigest !== row.plan_digest ||
      localPositionExecutionPlanDigest(plan) !== row.plan_digest ||
      plan.operationId !== row.operation_id ||
      plan.wallet.walletId !== row.wallet_id ||
      plan.snapshot.snapshotDigest !== row.snapshot_digest
    ) {
      throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
    }
    const stepsResult = await client.query<StepRow>(
      `SELECT step_id::text, ordinal, step_kind, state, nonce::text, failure_code,
              gas_limit::text, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text
         FROM local_position_operation_steps
        WHERE operation_id = $1 ORDER BY ordinal`,
      [row.operation_id],
    );
    const steps: LocalPositionOperationStep[] = [];
    for (const step of stepsResult.rows) {
      const transactions = await client.query<TransactionRow>(
        `SELECT active, generation, state, transaction_hash,
                max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text
           FROM local_position_step_transactions
          WHERE step_id = $1 ORDER BY generation`,
        [step.step_id],
      );
      steps.push({
        failureCode: step.failure_code,
        feeLimit: {
          feeCapBaseUnit: step.fee_cap_base_unit,
          gasLimit: step.gas_limit,
          maxFeePerGasBaseUnit: step.max_fee_per_gas_base_unit,
          maxPriorityFeePerGasBaseUnit: step.max_priority_fee_per_gas_base_unit,
        },
        kind: step.step_kind,
        nonce: step.nonce,
        ordinal: step.ordinal,
        state: step.state,
        stepId: step.step_id,
        transactions: transactions.rows.map((transaction) => ({
          active: transaction.active,
          generation: transaction.generation,
          maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
          maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
          state: transaction.state,
          transactionHash: transaction.transaction_hash,
        })),
      });
    }
    if (
      steps.length !== plan.steps.length ||
      steps.some((step, index) => step.stepId !== plan.steps[index]!.stepId)
    ) {
      throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
    }
    return {
      accounting: structuredClone(row.accounting_payload),
      burnIfEmpty: row.burn_if_empty,
      chainId: 31_337,
      createdAt: row.created_at.toISOString(),
      failureCode: row.failure_code,
      managerAddress: row.manager_address,
      operationId: row.operation_id,
      operationKind: row.operation_kind,
      percent: row.percent,
      plan,
      planDigest: row.plan_digest,
      platformId: row.platform_id,
      previewDigest: row.preview_digest,
      reconciliationReason: row.reconciliation_reason,
      registryVersion: row.registry_version,
      requestHash: row.request_hash,
      sessionId: row.reauthenticated_session_id,
      slippageBps: row.slippage_bps,
      snapshotDigest: row.snapshot_digest,
      state: row.state,
      steps,
      tenantId: row.tenant_id,
      tokenId: row.token_id,
      updatedAt: row.updated_at.toISOString(),
      userId: row.user_id,
      walletId: row.wallet_id,
    };
  }
}
