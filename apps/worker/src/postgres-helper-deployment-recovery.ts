import { createHash, randomUUID } from "node:crypto";

import type { HelperDeploymentState } from "@lpbot/api-contract";
import {
  helperDeploymentPlanDigest,
  type HelperDeploymentPlan,
} from "@lpbot/domain/helper-deployment";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  HelperDeploymentWorkerError,
  replacementHelperDeploymentPlan,
  validateHelperDeploymentWorkPlan,
  type HelperDeploymentObservationDecision,
  type HelperDeploymentReplacementAuthorization,
  type HelperDeploymentSignerResult,
  type HelperDeploymentTransactionHead,
  type HelperDeploymentWorkClaim,
  type HelperDeploymentWorkOperation,
  type HelperDeploymentWorkRepository,
} from "./helper-deployment-worker.js";

interface ClaimedEventRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  event_id: string;
  lease_token: string;
}

interface EventRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  lease_token: string | null;
  state: "dead" | "delivered" | "leased" | "pending";
}

interface OperationRow extends QueryResultRow {
  active_generation: number | null;
  active_max_fee_per_gas_base_unit: string | null;
  active_max_priority_fee_per_gas_base_unit: string | null;
  active_plan_digest: `sha256:${string}` | null;
  active_state: HelperDeploymentTransactionHead["state"] | "replaced" | null;
  active_transaction_hash: `0x${string}` | null;
  active_transaction_id: string | null;
  active_updated_at: Date | null;
  chain_id: string;
  fee_cap_base_unit: string;
  fencing_token: string;
  gas_limit: string;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: unknown;
  reauthenticated_session_id: string;
  state: HelperDeploymentState;
  tenant_id: string;
  user_id: string;
  wallet_id: string;
}

interface TransactionRow extends QueryResultRow {
  generation: number;
  operation_id: string;
  transaction_hash: `0x${string}`;
  transaction_id: string;
  updated_at: Date;
}

interface AuthorizationRow extends QueryResultRow {
  authorization_id: string;
  created_at: Date;
  expires_at: Date;
  fee_cap_base_unit: string;
  gas_limit: string;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  reason: string;
  replaced_transaction_id: string;
  state: "cancelled" | "consumed" | "pending";
}

const operationColumns = `
  o.operation_id::text, o.tenant_id, o.user_id::text, o.wallet_id::text,
  o.chain_id::text, o.state, o.nonce::text, o.fencing_token::text,
  o.gas_limit::text, o.max_fee_per_gas_base_unit::text,
  o.max_priority_fee_per_gas_base_unit::text, o.fee_cap_base_unit::text,
  o.plan_digest, o.plan_payload, o.reauthenticated_session_id::text,
  t.transaction_id::text AS active_transaction_id,
  t.generation AS active_generation, t.state AS active_state,
  t.transaction_hash AS active_transaction_hash, t.plan_digest AS active_plan_digest,
  t.max_fee_per_gas_base_unit::text AS active_max_fee_per_gas_base_unit,
  t.max_priority_fee_per_gas_base_unit::text AS active_max_priority_fee_per_gas_base_unit,
  t.updated_at AS active_updated_at`;

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function basePlan(row: OperationRow): HelperDeploymentPlan {
  const plan = row.plan_payload as HelperDeploymentPlan;
  try {
    validateHelperDeploymentWorkPlan(plan, new Date(0));
  } catch (error) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_PLAN_INVALID", false, {
      cause: error,
    });
  }
  if (
    helperDeploymentPlanDigest(plan) !== row.plan_digest ||
    plan.planDigest !== row.plan_digest ||
    plan.operationId !== row.operation_id ||
    plan.wallet.walletId !== row.wallet_id ||
    plan.chainId.toString() !== row.chain_id ||
    plan.nonce !== row.nonce ||
    plan.fencingToken !== row.fencing_token ||
    plan.feeLimit.gasLimit !== row.gas_limit ||
    plan.feeLimit.maxFeePerGasBaseUnit !== row.max_fee_per_gas_base_unit ||
    plan.feeLimit.maxPriorityFeePerGasBaseUnit !== row.max_priority_fee_per_gas_base_unit ||
    plan.feeLimit.feeCapBaseUnit !== row.fee_cap_base_unit
  ) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_PLAN_INVALID");
  }
  return plan;
}

function activePlan(row: OperationRow): HelperDeploymentPlan {
  const plan = basePlan(row);
  if (row.active_generation === null || row.active_generation === 0) return plan;
  if (
    row.active_plan_digest === null ||
    row.active_max_fee_per_gas_base_unit === null ||
    row.active_max_priority_fee_per_gas_base_unit === null
  ) {
    throw new HelperDeploymentWorkerError("ACTIVE_TRANSACTION_INVALID");
  }
  plan.feeLimit.maxFeePerGasBaseUnit = row.active_max_fee_per_gas_base_unit;
  plan.feeLimit.maxPriorityFeePerGasBaseUnit = row.active_max_priority_fee_per_gas_base_unit;
  plan.feeLimit.feeCapBaseUnit = (
    BigInt(plan.feeLimit.gasLimit) * BigInt(plan.feeLimit.maxFeePerGasBaseUnit)
  ).toString();
  plan.planDigest = helperDeploymentPlanDigest(plan);
  if (plan.planDigest !== row.active_plan_digest) {
    throw new HelperDeploymentWorkerError("ACTIVE_TRANSACTION_INVALID");
  }
  validateHelperDeploymentWorkPlan(plan, new Date(0));
  return plan;
}

function activeTransaction(row: OperationRow): HelperDeploymentTransactionHead | null {
  if (
    row.active_transaction_id === null ||
    row.active_generation === null ||
    row.active_state === null ||
    row.active_transaction_hash === null ||
    row.active_max_fee_per_gas_base_unit === null ||
    row.active_max_priority_fee_per_gas_base_unit === null ||
    row.active_updated_at === null
  ) {
    return null;
  }
  if (row.active_state === "replaced") {
    throw new HelperDeploymentWorkerError("ACTIVE_TRANSACTION_INVALID");
  }
  return {
    generation: row.active_generation,
    maxFeePerGasBaseUnit: row.active_max_fee_per_gas_base_unit,
    maxPriorityFeePerGasBaseUnit: row.active_max_priority_fee_per_gas_base_unit,
    state: row.active_state,
    transactionHash: row.active_transaction_hash,
    transactionId: row.active_transaction_id,
    updatedAt: row.active_updated_at.toISOString(),
  };
}

function workOperation(
  row: OperationRow,
  lineage: readonly TransactionRow[],
): HelperDeploymentWorkOperation {
  if (row.state === "signed" || row.state === "succeeded" || row.state === "failed") {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_STATE_INVALID");
  }
  const plan = activePlan(row);
  return {
    activeTransaction: activeTransaction(row),
    operationId: row.operation_id,
    plan,
    planDigest: plan.planDigest,
    reauthenticatedSessionId: row.reauthenticated_session_id,
    state: row.state,
    tenantId: row.tenant_id,
    transactionLineage: lineage.map((transaction) => ({
      generation: transaction.generation,
      transactionHash: transaction.transaction_hash,
      transactionId: transaction.transaction_id,
      updatedAt: transaction.updated_at.toISOString(),
    })),
    userId: row.user_id,
  };
}

function reason(value: string): string {
  if (
    value.length < 1 ||
    value.length > 120 ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return point <= 0x1f || point === 0x7f;
    })
  ) {
    throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_REASON_INVALID");
  }
  return value;
}

function retryDelay(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1_000);
}

function transitionAllowed(from: HelperDeploymentState, to: HelperDeploymentState): boolean {
  if (from === to) return true;
  const transitions: Partial<Record<HelperDeploymentState, readonly HelperDeploymentState[]>> = {
    broadcast: ["confirmed", "dropped", "failed", "pending", "reconciling", "succeeded"],
    confirmed: ["failed", "reconciling", "succeeded"],
    dropped: ["broadcast", "failed", "pending", "reconciling", "succeeded"],
    pending: ["confirmed", "dropped", "failed", "reconciling", "succeeded"],
    queued: ["broadcast", "failed"],
    reconciling: ["confirmed", "dropped", "failed", "pending", "succeeded"],
  };
  return transitions[from]?.includes(to) ?? false;
}

function transactionState(
  target: HelperDeploymentObservationDecision["state"],
): "confirmed" | "dropped" | "failed" | "pending" | null {
  if (target === "confirmed" || target === "succeeded") return "confirmed";
  if (target === "dropped" || target === "failed" || target === "pending") return target;
  return null;
}

export class PostgresHelperDeploymentRecoveryRepository implements HelperDeploymentWorkRepository {
  readonly #confirmedPollMilliseconds: number;
  readonly #maxAttempts: number;
  readonly #pollMilliseconds: number;
  readonly #pool: Pool;
  readonly #uuid: () => string;

  constructor(
    pool: Pool,
    input: {
      confirmedPollMilliseconds?: number;
      maxAttempts?: number;
      pollMilliseconds?: number;
      uuid?: () => string;
    } = {},
  ) {
    this.#pool = pool;
    this.#uuid = input.uuid ?? randomUUID;
    this.#maxAttempts = input.maxAttempts ?? 20;
    this.#pollMilliseconds = input.pollMilliseconds ?? 5_000;
    this.#confirmedPollMilliseconds = input.confirmedPollMilliseconds ?? 30_000;
    if (
      !Number.isSafeInteger(this.#maxAttempts) ||
      this.#maxAttempts < 1 ||
      this.#maxAttempts > 20 ||
      !Number.isSafeInteger(this.#pollMilliseconds) ||
      this.#pollMilliseconds < 1_000 ||
      !Number.isSafeInteger(this.#confirmedPollMilliseconds) ||
      this.#confirmedPollMilliseconds < 1_000
    ) {
      throw new RangeError("Helper deployment recovery repository configuration is invalid");
    }
  }

  async claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<HelperDeploymentWorkClaim[]> {
    const client = await this.#pool.connect();
    const leaseToken = this.#uuid().toLowerCase();
    try {
      await client.query("BEGIN");
      const events = await client.query<ClaimedEventRow>(
        `WITH due AS (
           SELECT e.event_id
             FROM chain_operation_outbox e
             JOIN chain_operations o ON o.operation_id = e.aggregate_id
            WHERE (
                    (e.state = 'pending' AND e.available_at <= $1)
                    OR (e.state = 'leased' AND e.lease_expires_at <= $1)
                  )
              AND e.attempt_count < $2
              AND o.state IN ('queued', 'broadcast', 'pending', 'confirmed', 'dropped', 'reconciling')
            ORDER BY e.available_at, e.created_at, e.event_id
            FOR UPDATE OF e SKIP LOCKED
            LIMIT $3
         )
         UPDATE chain_operation_outbox e
            SET state = 'leased', attempt_count = e.attempt_count + 1,
                lease_owner = $4, lease_token = $5,
                lease_expires_at = $6, last_error_code = NULL
           FROM due
          WHERE e.event_id = due.event_id
         RETURNING e.event_id::text, e.aggregate_id::text, e.attempt_count,
                   e.lease_token::text`,
        [
          input.now,
          this.#maxAttempts,
          input.limit,
          input.workerId,
          leaseToken,
          new Date(input.now.getTime() + input.leaseMilliseconds),
        ],
      );
      if (events.rows.length === 0) {
        await client.query("COMMIT");
        return [];
      }
      const ids = events.rows.map(({ aggregate_id }) => aggregate_id);
      const operations = await client.query<OperationRow>(
        `SELECT ${operationColumns}
           FROM chain_operations o
           LEFT JOIN chain_operation_transactions t
             ON t.transaction_id = o.active_transaction_id AND t.active
          WHERE o.operation_id = ANY($1::uuid[])`,
        [ids],
      );
      const lineage = await client.query<TransactionRow>(
        `SELECT operation_id::text, transaction_id::text, generation,
                transaction_hash, updated_at
           FROM chain_operation_transactions
          WHERE operation_id = ANY($1::uuid[])
            AND transaction_hash IS NOT NULL
          ORDER BY operation_id, generation`,
        [ids],
      );
      const byOperation = new Map<string, TransactionRow[]>();
      for (const transaction of lineage.rows) {
        const list = byOperation.get(transaction.operation_id) ?? [];
        list.push(transaction);
        byOperation.set(transaction.operation_id, list);
      }
      const rows = new Map(operations.rows.map((row) => [row.operation_id, row]));
      const claims = events.rows.map((event) => {
        const row = rows.get(event.aggregate_id);
        if (!row) throw new HelperDeploymentWorkerError("HELPER_RECOVERY_OPERATION_MISSING");
        return {
          eventId: event.event_id,
          leaseToken: event.lease_token,
          operation: workOperation(row, byOperation.get(row.operation_id) ?? []),
        };
      });
      await client.query("COMMIT");
      return claims;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeBroadcast(input: {
    claim: HelperDeploymentWorkClaim;
    deliveredAt: Date;
    result: HelperDeploymentSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.state !== "queued" || operation.plan_digest !== input.result.planDigest) {
        await this.#finishClaim(client, input.claim, input.deliveredAt);
        return;
      }
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO chain_operation_transactions (
           transaction_id, operation_id, chain_id, wallet_id, nonce, generation,
           state, active, plan_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, 31337, $3, $4, 0, 'broadcast', true, $5, $6, $7, $8,
                   NULL, NULL, NULL, $9, $9, $9, $9, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.wallet_id,
          operation.nonce,
          input.result.planDigest,
          operation.max_fee_per_gas_base_unit,
          operation.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE chain_operations
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await this.#audit(client, operation, {
        action: "helper.signed",
        code: "SIGNED",
        state: "signed",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await this.#audit(client, operation, {
        action: "helper.broadcast",
        code: input.result.status === "already-known" ? "ALREADY_KNOWN" : "BROADCAST_ACCEPTED",
        state: "broadcast",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await this.#finishClaim(client, input.claim, input.deliveredAt);
      await this.#enqueue(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async applyObservation(input: {
    claim: HelperDeploymentWorkClaim;
    decision: HelperDeploymentObservationDecision;
    observedAt: Date;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (
        operation.state !== input.claim.operation.state ||
        operation.active_transaction_id !== input.claim.operation.activeTransaction?.transactionId
      ) {
        await this.#finishClaim(client, input.claim, input.observedAt);
        return;
      }
      const target = input.decision.state;
      if (!transitionAllowed(operation.state, target)) {
        throw new HelperDeploymentWorkerError("HELPER_RECOVERY_TRANSITION_INVALID");
      }
      const activeTransactionId = operation.active_transaction_id;
      if (!activeTransactionId) throw new HelperDeploymentWorkerError("ACTIVE_TRANSACTION_MISSING");
      let evidenceTransactionId = activeTransactionId;
      let transactionHash = operation.active_transaction_hash;
      if (input.decision.kind === "receipt") {
        const receipt = input.decision.receipt;
        evidenceTransactionId = input.decision.transactionId;
        const observed = await client.query<{ transaction_hash: `0x${string}` }>(
          `SELECT transaction_hash
             FROM chain_operation_transactions
            WHERE transaction_id = $1 AND operation_id = $2
            FOR UPDATE`,
          [evidenceTransactionId, operation.operation_id],
        );
        if (
          observed.rows[0]?.transaction_hash !== receipt.transactionHash ||
          !input.claim.operation.transactionLineage.some(
            ({ transactionHash: hash, transactionId }) =>
              transactionId === evidenceTransactionId && hash === receipt.transactionHash,
          )
        ) {
          throw new HelperDeploymentWorkerError("HELPER_RECOVERY_LINEAGE_INVALID");
        }
        transactionHash = receipt.transactionHash;
        const evidenceDigest = digest([
          receipt.transactionHash,
          receipt.blockHash,
          receipt.blockNumber,
          receipt.blockCanonical,
          receipt.receiptStatus,
          receipt.contractAddress,
          receipt.runtimeCodeHash,
          receipt.observedOwner,
          receipt.observedAdapter,
          receipt.observedPermit2,
          receipt.contractAddressReconciled,
          receipt.runtimeCodeReconciled,
          receipt.ownerReconciled,
          receipt.constructorReconciled,
        ]);
        await client.query(
          `INSERT INTO chain_operation_receipt_evidence (
             evidence_id, transaction_id, transaction_hash, block_hash, block_number,
             canonical, receipt_status, contract_address, runtime_code_hash,
             observed_owner, observed_adapter, observed_permit2,
             contract_address_reconciled, runtime_code_reconciled,
             owner_reconciled, constructor_reconciled, evidence_digest, observed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                     $13, $14, $15, $16, $17, $18)
           ON CONFLICT (transaction_id, block_hash, evidence_digest) DO NOTHING`,
          [
            this.#uuid().toLowerCase(),
            evidenceTransactionId,
            receipt.transactionHash,
            receipt.blockHash,
            receipt.blockNumber,
            receipt.blockCanonical,
            receipt.receiptStatus,
            receipt.contractAddress,
            receipt.runtimeCodeHash,
            receipt.observedOwner,
            receipt.observedAdapter,
            receipt.observedPermit2,
            receipt.contractAddressReconciled,
            receipt.runtimeCodeReconciled,
            receipt.ownerReconciled,
            receipt.constructorReconciled,
            evidenceDigest,
            input.observedAt,
          ],
        );
        if (receipt.blockCanonical) {
          await client.query(
            `UPDATE wallet_nonce_ledgers
                SET last_confirmed_nonce = CASE
                      WHEN last_confirmed_nonce IS NULL THEN $2
                      ELSE GREATEST(last_confirmed_nonce, $2)
                    END,
                    updated_at = $3
              WHERE chain_id = 31337 AND wallet_id = $1`,
            [operation.wallet_id, operation.nonce, input.observedAt],
          );
        }
      }
      const nextTransactionState = transactionState(target);
      const settlesHistoricalReceipt =
        input.decision.kind === "receipt" &&
        evidenceTransactionId !== activeTransactionId &&
        (target === "confirmed" || target === "succeeded" || target === "failed");
      if (settlesHistoricalReceipt) {
        await client.query(
          `UPDATE chain_operation_transactions
              SET state = 'dropped', active = false, updated_at = $2
            WHERE transaction_id = $1 AND active`,
          [activeTransactionId, input.observedAt],
        );
        await client.query(
          `UPDATE chain_operation_transactions
              SET active = true, updated_at = $2
            WHERE transaction_id = $1`,
          [evidenceTransactionId, input.observedAt],
        );
      }
      if (nextTransactionState) {
        await client.query(
          `UPDATE chain_operation_transactions
              SET state = $2, updated_at = $3,
                  confirmed_at = CASE WHEN $2 = 'confirmed' THEN $3 ELSE confirmed_at END
            WHERE transaction_id = $1`,
          [evidenceTransactionId, nextTransactionState, input.observedAt],
        );
      }
      const failureCode = target === "failed" ? (input.decision.reason ?? "HELPER_FAILED") : null;
      const reconciliationReason =
        target === "reconciling" ? (input.decision.reason ?? "RECONCILIATION_REQUIRED") : null;
      await client.query(
        `UPDATE chain_operations
            SET state = $2, failure_code = $3, reconciliation_reason = $4,
                active_transaction_id = $6, updated_at = $5
          WHERE operation_id = $1`,
        [
          operation.operation_id,
          target,
          failureCode,
          reconciliationReason,
          input.observedAt,
          settlesHistoricalReceipt ? evidenceTransactionId : activeTransactionId,
        ],
      );
      if (target === "reconciling") {
        await this.#openReconciliation(
          client,
          operation,
          reconciliationReason ?? "RECONCILIATION_REQUIRED",
          input.observedAt,
        );
      } else {
        await this.#resolveReconciliation(client, operation.operation_id, input.observedAt);
      }
      if (target === "succeeded" && input.decision.kind === "receipt") {
        await client.query(
          `UPDATE wallet_helper_deployment_bindings
              SET state = 'active', deployment_transaction_hash = $2,
                  verified_block_number = $3, failure_code = NULL, updated_at = $4
            WHERE operation_id = $1 AND state = 'deploying'`,
          [
            operation.operation_id,
            input.decision.receipt.transactionHash,
            input.decision.receipt.blockNumber,
            input.observedAt,
          ],
        );
      } else if (target === "failed") {
        await client.query(
          `UPDATE wallet_helper_deployment_bindings
              SET state = 'degraded', failure_code = $2, updated_at = $3
            WHERE operation_id = $1 AND state = 'deploying'`,
          [operation.operation_id, failureCode, input.observedAt],
        );
      }
      await this.#audit(client, operation, {
        action: target === "succeeded" ? "helper.verified" : `helper.${target}`,
        code: input.decision.reason ?? target.toUpperCase(),
        ...(target === "reconciling" ? { outcome: "reconciled" as const } : {}),
        state: target,
        transactionHash,
        when: input.observedAt,
      });
      await this.#finishClaim(client, input.claim, input.observedAt);
      if (target !== "succeeded" && target !== "failed") {
        await this.#enqueue(client, operation, target, input.observedAt, target === "confirmed");
      }
    });
  }

  async failClaim(input: {
    claim: HelperDeploymentWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (input.retryable && event.attempt_count < this.#maxAttempts) {
        await client.query(
          `UPDATE chain_operation_outbox
              SET state = 'pending', available_at = $2, lease_owner = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error_code = $3
            WHERE event_id = $1`,
          [
            input.claim.eventId,
            new Date(input.failedAt.getTime() + retryDelay(event.attempt_count)),
            input.code.slice(0, 120),
          ],
        );
        return;
      }
      if (operation.state === "queued") {
        await client.query(
          `DELETE FROM wallet_helper_deployment_bindings WHERE operation_id = $1`,
          [operation.operation_id],
        );
        await client.query(
          `UPDATE wallet_nonce_ledgers l
              SET next_nonce = $2, fencing_token = fencing_token + 1, updated_at = $3
            WHERE l.chain_id = 31337 AND l.wallet_id = $1
              AND l.next_nonce = $2 + 1
              AND NOT EXISTS (
                SELECT 1 FROM chain_operations later
                 WHERE later.chain_id = 31337 AND later.wallet_id = $1
                   AND later.nonce > $2 AND later.state <> 'failed'
              )`,
          [operation.wallet_id, operation.nonce, input.failedAt],
        );
      } else {
        await client.query(
          `UPDATE wallet_helper_deployment_bindings
              SET state = 'degraded', failure_code = $2, updated_at = $3
            WHERE operation_id = $1 AND state = 'deploying'`,
          [operation.operation_id, input.code.slice(0, 120), input.failedAt],
        );
      }
      await client.query(
        `UPDATE chain_operations
            SET state = 'failed', failure_code = $2,
                reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, input.code.slice(0, 120), input.failedAt],
      );
      await this.#audit(client, operation, {
        action: "helper.failed",
        code: input.code,
        state: "failed",
        transactionHash: operation.active_transaction_hash,
        when: input.failedAt,
      });
      await client.query(
        `UPDATE chain_operation_outbox
            SET state = 'dead', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, last_error_code = $2
          WHERE event_id = $1`,
        [input.claim.eventId, input.code.slice(0, 120)],
      );
    });
  }

  async prepareReplacement(input: {
    feeLimit: HelperDeploymentPlan["feeLimit"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<HelperDeploymentReplacementAuthorization> {
    return this.#transaction(async (client) => {
      const operation = await this.#lockOperation(client, input.operationId);
      if (
        !["broadcast", "pending", "dropped"].includes(operation.state) ||
        !operation.active_transaction_id ||
        operation.active_generation === null
      ) {
        throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_NOT_ALLOWED");
      }
      const plan = replacementHelperDeploymentPlan({
        feeLimit: input.feeLimit,
        now: input.now,
        plan: activePlan(operation),
      });
      const authorizationId = this.#uuid().toLowerCase();
      const generation = operation.active_generation + 1;
      const expiresAt = new Date(
        Math.min(new Date(plan.deadline).getTime(), input.now.getTime() + 5 * 60 * 1_000),
      );
      await client.query(
        `INSERT INTO chain_operation_replacement_authorizations (
           authorization_id, operation_id, replaced_transaction_id, generation,
           plan_digest, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, fee_cap_base_unit,
           reason, state, expires_at, created_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   'pending', $11, $12, NULL)`,
        [
          authorizationId,
          operation.operation_id,
          operation.active_transaction_id,
          generation,
          plan.planDigest,
          plan.feeLimit.gasLimit,
          plan.feeLimit.maxFeePerGasBaseUnit,
          plan.feeLimit.maxPriorityFeePerGasBaseUnit,
          plan.feeLimit.feeCapBaseUnit,
          reason(input.reason),
          expiresAt,
          input.now,
        ],
      );
      return {
        generation,
        operationId: operation.operation_id,
        plan,
        planDigest: plan.planDigest,
        reauthenticatedSessionId: operation.reauthenticated_session_id,
        replacedTransactionId: operation.active_transaction_id,
        tenantId: operation.tenant_id,
        userId: operation.user_id,
      };
    });
  }

  async completeReplacement(input: {
    authorization: HelperDeploymentReplacementAuthorization;
    deliveredAt: Date;
    result: HelperDeploymentSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorization = await this.#lockAuthorization(
        client,
        input.authorization.operationId,
        input.authorization.generation,
      );
      if (
        authorization.state !== "pending" ||
        authorization.plan_digest !== input.result.planDigest ||
        authorization.replaced_transaction_id !== input.authorization.replacedTransactionId ||
        authorization.expires_at <= input.deliveredAt
      ) {
        throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_AUTHORIZATION_INVALID");
      }
      const operation = await this.#lockOperation(client, input.authorization.operationId);
      if (operation.active_transaction_id !== authorization.replaced_transaction_id) {
        throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_AUTHORIZATION_INVALID");
      }
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO chain_operation_transactions (
           transaction_id, operation_id, chain_id, wallet_id, nonce, generation,
           state, active, plan_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, 31337, $3, $4, $5, 'broadcast', false, $6, $7, $8, $9,
                   $10, NULL, $11, $12, $12, $12, $12, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.wallet_id,
          operation.nonce,
          authorization.generation,
          authorization.plan_digest,
          authorization.max_fee_per_gas_base_unit,
          authorization.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          authorization.replaced_transaction_id,
          authorization.reason,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE chain_operation_transactions
            SET state = 'replaced', active = false, replaced_by_transaction_id = $2,
                replacement_reason = $3, updated_at = $4
          WHERE transaction_id = $1 AND active`,
        [
          authorization.replaced_transaction_id,
          transactionId,
          authorization.reason,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE chain_operation_transactions SET active = true WHERE transaction_id = $1`,
        [transactionId],
      );
      await client.query(
        `UPDATE chain_operation_replacement_authorizations
            SET state = 'consumed', consumed_at = $2
          WHERE authorization_id = $1`,
        [authorization.authorization_id, input.deliveredAt],
      );
      await client.query(
        `UPDATE chain_operations
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await this.#audit(client, operation, {
        action: "helper.replaced",
        code: "REPLACEMENT_BROADCAST",
        state: "broadcast",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await this.#enqueue(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async rejectReplacement(input: {
    authorization: HelperDeploymentReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorization = await this.#lockAuthorization(
        client,
        input.authorization.operationId,
        input.authorization.generation,
      );
      if (authorization.state !== "pending") return;
      await client.query(
        `UPDATE chain_operation_replacement_authorizations
            SET state = 'cancelled'
          WHERE authorization_id = $1`,
        [authorization.authorization_id],
      );
      const operation = await this.#lockOperation(client, input.authorization.operationId);
      await this.#audit(client, operation, {
        action: "helper.replacement-failed",
        code: input.code,
        state: operation.state,
        transactionHash: operation.active_transaction_hash,
        when: input.failedAt,
      });
    });
  }

  async #lockClaim(client: PoolClient, claim: HelperDeploymentWorkClaim): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT aggregate_id::text, state, attempt_count, lease_token::text
         FROM chain_operation_outbox
        WHERE event_id = $1
        FOR UPDATE`,
      [claim.eventId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.aggregate_id !== claim.operation.operationId ||
      row.state !== "leased" ||
      row.lease_token !== claim.leaseToken
    ) {
      throw new HelperDeploymentWorkerError("HELPER_RECOVERY_LEASE_INVALID");
    }
    return row;
  }

  async #lockOperation(client: PoolClient, operationId: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM chain_operations o
         LEFT JOIN chain_operation_transactions t
           ON t.transaction_id = o.active_transaction_id AND t.active
        WHERE o.operation_id = $1
        FOR UPDATE OF o`,
      [operationId],
    );
    const row = result.rows[0];
    if (!row) throw new HelperDeploymentWorkerError("HELPER_RECOVERY_OPERATION_MISSING");
    return row;
  }

  async #lockAuthorization(
    client: PoolClient,
    operationId: string,
    generation: number,
  ): Promise<AuthorizationRow> {
    const result = await client.query<AuthorizationRow>(
      `SELECT authorization_id::text, operation_id::text,
              replaced_transaction_id::text, generation, plan_digest,
              gas_limit::text, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text,
              reason, state, expires_at, created_at
         FROM chain_operation_replacement_authorizations
        WHERE operation_id = $1 AND generation = $2
        FOR UPDATE`,
      [operationId, generation],
    );
    const row = result.rows[0];
    if (!row) {
      throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_AUTHORIZATION_INVALID");
    }
    return row;
  }

  async #finishClaim(
    client: PoolClient,
    claim: HelperDeploymentWorkClaim,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE chain_operation_outbox
          SET state = 'delivered', lease_owner = NULL, lease_token = NULL,
              lease_expires_at = NULL, delivered_at = $2, last_error_code = NULL
        WHERE event_id = $1`,
      [claim.eventId, when],
    );
  }

  async #openReconciliation(
    client: PoolClient,
    operation: OperationRow,
    reconciliationReason: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO chain_operation_reconciliation_cases (
         reconciliation_id, operation_id, reason, status,
         provider_evidence_digest, opened_at, resolved_at
       ) SELECT $1, $2, $3, 'open', NULL, $4, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM chain_operation_reconciliation_cases
           WHERE operation_id = $2 AND status = 'open'
        )`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        reconciliationReason.slice(0, 120),
        when,
      ],
    );
  }

  async #resolveReconciliation(
    client: PoolClient,
    operationId: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE chain_operation_reconciliation_cases
          SET status = 'resolved', resolved_at = $2
        WHERE operation_id = $1 AND status = 'open'`,
      [operationId, when],
    );
  }

  async #enqueue(
    client: PoolClient,
    operation: OperationRow,
    state: HelperDeploymentState,
    when: Date,
    confirmed = false,
  ): Promise<void> {
    await client.query(
      `INSERT INTO chain_operation_outbox (
         event_id, aggregate_id, event_type, payload, state, attempt_count,
         available_at, lease_owner, lease_token, lease_expires_at,
         created_at, delivered_at, last_error_code
       ) VALUES ($1, $2, 'chain-operation.state-changed', $3::jsonb, 'pending', 0,
                 $4, NULL, NULL, NULL, $5, NULL, NULL)`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        JSON.stringify({
          chainId: 31_337,
          operationId: operation.operation_id,
          state,
          walletId: operation.wallet_id,
        }),
        new Date(
          when.getTime() + (confirmed ? this.#confirmedPollMilliseconds : this.#pollMilliseconds),
        ),
        when,
      ],
    );
  }

  async #audit(
    client: PoolClient,
    operation: OperationRow,
    input: {
      action: string;
      code: string;
      outcome?: "allowed" | "denied" | "reconciled";
      state: HelperDeploymentState;
      transactionHash: `0x${string}` | null;
      when: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO chain_operation_audit_events (
         tenant_id, actor_user_id, session_id, operation_id, wallet_id,
         chain_id, nonce, transaction_hash, plan_digest, state, action,
         outcome, result_code, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, 31337, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        operation.tenant_id,
        operation.user_id,
        operation.reauthenticated_session_id,
        operation.operation_id,
        operation.wallet_id,
        operation.nonce,
        input.transactionHash,
        operation.plan_digest,
        input.state,
        input.action,
        input.outcome ?? "allowed",
        input.code.slice(0, 120),
        `worker:${this.#uuid().toLowerCase()}`,
        input.when,
      ],
    );
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
