import { createHash, randomUUID } from "node:crypto";

import {
  localSwapExecutionPlanDigest,
  validateLocalSwapReplacement,
  type LocalSwapExecutionPlan,
  type LocalSwapPlanStep,
  type LocalSwapReplacementCandidate,
} from "@lpbot/domain/local-swap-execution";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  LocalSwapWorkerError,
  validateLocalSwapWorkPlan,
  type LocalSwapObservationDecision,
  type LocalSwapReceiptObservation,
  type LocalSwapReplacementAuthorization,
  type LocalSwapStepSignerResult,
  type LocalSwapStepWorkOperation,
  type LocalSwapTransactionReference,
  type LocalSwapWorkClaim,
  type LocalSwapWorkRepository,
} from "./local-swap-worker.js";

interface ClaimedEventRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  event_id: string;
  lease_token: string;
  step_id: string;
}

interface EventRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  lease_token: string | null;
  state: "dead" | "delivered" | "leased" | "pending";
  step_id: string | null;
}

interface WorkRow extends QueryResultRow {
  active_transaction_id: string | null;
  approval_succeeded: boolean;
  operation_id: string;
  operation_state: LocalSwapStepWorkOperation["operationState"];
  plan_digest: `sha256:${string}`;
  plan_payload: LocalSwapExecutionPlan;
  reauthenticated_session_id: string;
  session_id: string;
  step_id: string;
  step_state: LocalSwapStepWorkOperation["stepState"];
  tenant_id: string;
  user_id: string;
  wallet_id: string;
}

interface LockedOperationRow extends QueryResultRow {
  failure_code: string | null;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalSwapExecutionPlan;
  reauthenticated_session_id: string;
  reconciliation_reason: string | null;
  state: LocalSwapStepWorkOperation["operationState"] | "failed" | "succeeded";
  tenant_id: string;
  user_id: string;
  wallet_id: string;
}

interface LockedStepRow extends QueryResultRow {
  active_transaction_id: string | null;
  nonce: string;
  ordinal: number;
  state: LocalSwapPlanStepState;
  step_id: string;
  step_kind: LocalSwapPlanStep["kind"];
}

type LocalSwapPlanStepState =
  | LocalSwapStepWorkOperation["stepState"]
  | "blocked"
  | "failed"
  | "replaced"
  | "skipped"
  | "succeeded";

interface TransactionRow extends QueryResultRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  semantic_digest: `sha256:${string}`;
  transaction_data_digest: `sha256:${string}`;
  transaction_hash: `0x${string}`;
  transaction_id: string;
  transaction_to: `0x${string}`;
  updated_at: Date;
}

interface AuthorizationRow extends QueryResultRow {
  authorization_id: string;
  expires_at: Date;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  reason: string;
  replaced_transaction_id: string;
  semantic_digest: `sha256:${string}`;
  state: "cancelled" | "consumed" | "pending";
  step_id: string;
  transaction_data_digest: `sha256:${string}`;
  transaction_to: `0x${string}`;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function retryDelay(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1_000);
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
    throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_REASON_INVALID");
  }
  return value;
}

function stepFromPlan(plan: LocalSwapExecutionPlan, stepId: string): LocalSwapPlanStep {
  const step = plan.steps.find((candidate) => candidate.stepId === stepId);
  if (!step) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
  return structuredClone(step);
}

function reference(row: TransactionRow): LocalSwapTransactionReference {
  return {
    active: row.active,
    dataDigest: row.transaction_data_digest,
    fee: {
      maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
      maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
    },
    generation: row.generation,
    nonce: row.nonce,
    planDigest: row.plan_digest,
    semanticDigest: row.semantic_digest,
    target: row.transaction_to,
    transactionHash: row.transaction_hash,
    transactionId: row.transaction_id,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresLocalSwapRecoveryRepository implements LocalSwapWorkRepository {
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
      throw new RangeError("Local Swap recovery repository configuration is invalid");
    }
  }

  async claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalSwapWorkClaim[]> {
    return this.#transaction(async (client) => {
      const leaseToken = this.#uuid().toLowerCase();
      const events = await client.query<ClaimedEventRow>(
        `WITH due AS (
           SELECT e.event_id
             FROM local_swap_operation_outbox e
             JOIN local_swap_operations o ON o.operation_id = e.aggregate_id
             JOIN local_swap_operation_steps s ON s.step_id = e.step_id
            WHERE ((e.state = 'pending' AND e.available_at <= $1)
                   OR (e.state = 'leased' AND e.lease_expires_at <= $1))
              AND e.attempt_count < $2
              AND o.state IN ('queued', 'signing', 'broadcast', 'pending', 'reconciling')
              AND s.state IN ('queued', 'signed', 'broadcast', 'pending', 'confirmed', 'dropped', 'reconciling')
            ORDER BY e.available_at, e.created_at, e.event_id
            FOR UPDATE OF e SKIP LOCKED
            LIMIT $3
         )
         UPDATE local_swap_operation_outbox e
            SET state = 'leased', attempt_count = e.attempt_count + 1,
                lease_owner = $4, lease_token = $5, lease_expires_at = $6,
                last_error_code = NULL
           FROM due
          WHERE e.event_id = due.event_id
         RETURNING e.event_id::text, e.aggregate_id::text, e.step_id::text,
                   e.attempt_count, e.lease_token::text`,
        [
          input.now,
          this.#maxAttempts,
          input.limit,
          input.workerId,
          leaseToken,
          new Date(input.now.getTime() + input.leaseMilliseconds),
        ],
      );
      if (events.rows.length === 0) return [];
      const eventIds = events.rows.map(({ event_id }) => event_id);
      const work = await client.query<WorkRow>(
        `SELECT o.operation_id::text, o.tenant_id, o.user_id::text, o.wallet_id::text,
                o.state AS operation_state, o.plan_digest, o.plan_payload,
                o.reauthenticated_session_id::text, o.reauthenticated_session_id::text AS session_id,
                s.step_id::text, s.state AS step_state, s.active_transaction_id::text,
                EXISTS (
                  SELECT 1 FROM local_swap_operation_steps approved
                   WHERE approved.operation_id = o.operation_id
                     AND approved.step_kind = 'approve' AND approved.state = 'succeeded'
                ) AS approval_succeeded
           FROM local_swap_operation_outbox e
           JOIN local_swap_operations o ON o.operation_id = e.aggregate_id
           JOIN local_swap_operation_steps s ON s.step_id = e.step_id
          WHERE e.event_id = ANY($1::uuid[])`,
        [eventIds],
      );
      const lineage = await client.query<TransactionRow>(
        `SELECT t.operation_id::text, t.transaction_id::text, t.active, t.generation,
                t.transaction_hash, t.nonce::text, t.plan_digest, t.semantic_digest,
                t.transaction_to, t.transaction_data_digest,
                t.max_fee_per_gas_base_unit::text,
                t.max_priority_fee_per_gas_base_unit::text, t.updated_at
           FROM local_swap_step_transactions t
           JOIN local_swap_operation_outbox e ON e.step_id = t.step_id
          WHERE e.event_id = ANY($1::uuid[]) AND t.transaction_hash IS NOT NULL
          ORDER BY t.step_id, t.generation`,
        [eventIds],
      );
      const byOperationStep = new Map<string, TransactionRow[]>();
      for (const row of lineage.rows) {
        const key = `${row.operation_id}:${row.semantic_digest}`;
        const values = byOperationStep.get(key) ?? [];
        values.push(row);
        byOperationStep.set(key, values);
      }
      const rows = new Map(work.rows.map((row) => [`${row.operation_id}:${row.step_id}`, row]));
      return events.rows.map((event) => {
        const row = rows.get(`${event.aggregate_id}:${event.step_id}`);
        if (!row) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_OPERATION_MISSING");
        const plan = structuredClone(row.plan_payload);
        if (
          plan.planDigest !== row.plan_digest ||
          localSwapExecutionPlanDigest(plan) !== row.plan_digest ||
          plan.operationId !== row.operation_id
        ) {
          throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
        }
        const step = stepFromPlan(plan, row.step_id);
        const transactions = (
          byOperationStep.get(`${row.operation_id}:${step.semanticDigest}`) ?? []
        ).map(reference);
        const operation: LocalSwapStepWorkOperation = {
          activeTransaction:
            transactions.find(({ transactionId }) => transactionId === row.active_transaction_id) ??
            null,
          approvalSucceeded: row.approval_succeeded,
          operationId: row.operation_id,
          operationState: row.operation_state,
          plan,
          planDigest: row.plan_digest,
          reauthenticatedSessionId: row.reauthenticated_session_id,
          step,
          stepState: row.step_state,
          tenantId: row.tenant_id,
          transactionLineage: transactions,
          userId: row.user_id,
        };
        validateLocalSwapWorkPlan(operation);
        return {
          leaseToken: event.lease_token,
          operation,
          outboxEventId: event.event_id,
        };
      });
    });
  }

  async completeBroadcast(input: {
    claim: LocalSwapWorkClaim;
    deliveredAt: Date;
    result: LocalSwapStepSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      const step = await this.#lockStep(client, input.claim.operation.step.stepId);
      if (
        step.state !== "queued" ||
        operation.plan_digest !== input.result.planDigest ||
        input.result.stepId !== step.step_id
      ) {
        await this.#finishClaim(client, input.claim, input.deliveredAt);
        return;
      }
      const planStep = stepFromPlan(operation.plan_payload, step.step_id);
      const transactionId = this.#uuid().toLowerCase();
      const fee = input.claim.operation.step.feeLimit;
      const maxFee =
        BigInt(fee.maxFeePerGasBaseUnit) > 1n ? BigInt(fee.maxFeePerGasBaseUnit) / 2n : 1n;
      const priority =
        BigInt(fee.maxPriorityFeePerGasBaseUnit) > 1n
          ? BigInt(fee.maxPriorityFeePerGasBaseUnit) / 2n
          : BigInt(fee.maxPriorityFeePerGasBaseUnit);
      await client.query(
        `INSERT INTO local_swap_step_transactions (
           transaction_id, step_id, operation_id, generation, state, active, nonce,
           plan_digest, semantic_digest, transaction_to, transaction_data_digest,
           max_fee_per_gas_base_unit, max_priority_fee_per_gas_base_unit,
           transaction_hash, replaces_transaction_id, replaced_by_transaction_id,
           replacement_reason, created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, 0, 'broadcast', true, $4, $5, $6, $7, $8,
                   $9, $10, $11, NULL, NULL, NULL, $12, $12, $12, $12, NULL)`,
        [
          transactionId,
          step.step_id,
          operation.operation_id,
          planStep.nonce,
          operation.plan_digest,
          planStep.semanticDigest,
          planStep.transaction.to,
          planStep.transaction.dataDigest,
          maxFee.toString(),
          priority.toString(),
          input.result.transactionHash,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_swap_operation_steps
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, updated_at = $3
          WHERE step_id = $1`,
        [step.step_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_swap_operations
            SET state = $2,
                failure_code = CASE WHEN $2 = 'reconciling' THEN failure_code ELSE NULL END,
                reconciliation_reason = CASE WHEN $2 = 'reconciling'
                  THEN 'ALLOWANCE_CLEANUP_REQUIRED' ELSE NULL END,
                updated_at = $3
          WHERE operation_id = $1`,
        [
          operation.operation_id,
          step.step_kind === "cleanup" ? "reconciling" : "broadcast",
          input.deliveredAt,
        ],
      );
      if (step.step_kind !== "cleanup") {
        await this.#resolveReconciliation(client, operation.operation_id, input.deliveredAt);
      }
      await this.#audit(
        client,
        operation,
        planStep,
        "swap.broadcast",
        "BROADCAST_ACCEPTED",
        input.deliveredAt,
        input.result.transactionHash,
      );
      await this.#finishClaim(client, input.claim, input.deliveredAt);
      await this.#enqueue(
        client,
        operation,
        step.step_id,
        step.step_kind === "cleanup" ? "local-swap.reconciling" : "local-swap.state-changed",
        step.step_kind === "cleanup" ? "reconciling" : "broadcast",
        input.deliveredAt,
      );
    });
  }

  async applyObservation(input: {
    claim: LocalSwapWorkClaim;
    decision: LocalSwapObservationDecision;
    observedAt: Date;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      const step = await this.#lockStep(client, input.claim.operation.step.stepId);
      if (
        step.state !== input.claim.operation.stepState ||
        step.active_transaction_id !== input.claim.operation.activeTransaction?.transactionId
      ) {
        await this.#finishClaim(client, input.claim, input.observedAt);
        return;
      }
      let observedTransactionId = step.active_transaction_id;
      if (input.decision.kind === "receipt") {
        observedTransactionId = input.decision.transactionId;
        await this.#appendReceipt(
          client,
          operation,
          step,
          input.decision.receipt,
          observedTransactionId,
          input.observedAt,
          input.claim,
        );
        if (step.active_transaction_id !== observedTransactionId) {
          await client.query(
            `UPDATE local_swap_step_transactions
                SET active = false, state = 'dropped', updated_at = $2
              WHERE transaction_id = $1 AND active`,
            [step.active_transaction_id, input.observedAt],
          );
          await client.query(
            `UPDATE local_swap_step_transactions SET active = true, updated_at = $2
              WHERE transaction_id = $1`,
            [observedTransactionId, input.observedAt],
          );
          await client.query(
            `UPDATE local_swap_operation_steps SET active_transaction_id = $2, updated_at = $3
              WHERE step_id = $1`,
            [step.step_id, observedTransactionId, input.observedAt],
          );
        }
      }
      if (input.decision.kind === "defer") {
        await this.#finishClaim(client, input.claim, input.observedAt);
        await this.#enqueue(
          client,
          operation,
          step.step_id,
          "local-swap.state-changed",
          input.decision.operationState,
          new Date(input.observedAt.getTime() + this.#pollMilliseconds),
        );
        return;
      }
      if (input.decision.kind === "transition") {
        await this.#applyTransition(client, operation, step, input.decision, input.observedAt);
        await this.#finishClaim(client, input.claim, input.observedAt);
        await this.#enqueue(
          client,
          operation,
          step.step_id,
          input.decision.operationState === "reconciling"
            ? "local-swap.reconciling"
            : "local-swap.state-changed",
          input.decision.operationState,
          new Date(input.observedAt.getTime() + this.#pollMilliseconds),
        );
        return;
      }
      if (!observedTransactionId) throw new LocalSwapWorkerError("ACTIVE_TRANSACTION_MISSING");
      await this.#applyReceiptDecision(
        client,
        operation,
        step,
        observedTransactionId,
        input.decision,
        input.observedAt,
      );
      await this.#finishClaim(client, input.claim, input.observedAt);
    });
  }

  async failClaim(input: {
    claim: LocalSwapWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      const step = await this.#lockStep(client, input.claim.operation.step.stepId);
      if (input.retryable && event.attempt_count < this.#maxAttempts) {
        await client.query(
          `UPDATE local_swap_operation_outbox
              SET state = 'pending', available_at = $2, lease_owner = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error_code = $3
            WHERE event_id = $1`,
          [
            input.claim.outboxEventId,
            new Date(input.failedAt.getTime() + retryDelay(event.attempt_count)),
            input.code.slice(0, 120),
          ],
        );
        return;
      }
      await client.query(
        `UPDATE local_swap_operation_outbox
            SET state = 'dead', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, last_error_code = $2
          WHERE event_id = $1`,
        [input.claim.outboxEventId, input.code.slice(0, 120)],
      );
      if (
        step.step_kind === "swap" &&
        input.claim.operation.approvalSucceeded &&
        step.state === "queued"
      ) {
        await this.#queueCleanup(client, operation, step, input.code, input.failedAt);
        return;
      }
      const cleanupOutstanding =
        input.claim.operation.approvalSucceeded || step.step_kind === "cleanup";
      const target = cleanupOutstanding ? "reconciling" : "failed";
      await client.query(
        `UPDATE local_swap_operation_steps
            SET state = $2, failure_code = $3, updated_at = $4 WHERE step_id = $1`,
        [step.step_id, target, input.code.slice(0, 120), input.failedAt],
      );
      await client.query(
        `UPDATE local_swap_operations
            SET state = $2,
                failure_code = CASE WHEN $2 = 'failed' THEN $3 ELSE failure_code END,
                reconciliation_reason = CASE WHEN $2 = 'reconciling' THEN $3 ELSE NULL END,
                updated_at = $4 WHERE operation_id = $1`,
        [operation.operation_id, target, input.code.slice(0, 120), input.failedAt],
      );
      if (target === "reconciling") {
        await this.#openReconciliation(
          client,
          operation.operation_id,
          step.step_id,
          input.code,
          input.failedAt,
        );
        await this.#enqueue(
          client,
          operation,
          step.step_id,
          "local-swap.reconciling",
          "reconciling",
          new Date(input.failedAt.getTime() + this.#pollMilliseconds),
        );
      } else if (step.state === "queued") {
        await this.#releaseUnusedNonces(client, operation, input.failedAt);
      }
      await this.#audit(
        client,
        operation,
        stepFromPlan(operation.plan_payload, step.step_id),
        `swap.${target}`,
        input.code,
        input.failedAt,
        null,
        target === "reconciling",
      );
    });
  }

  async prepareReplacement(input: {
    fee: { maxFeePerGasBaseUnit: string; maxPriorityFeePerGasBaseUnit: string };
    now: Date;
    operationId: string;
    reason: string;
    stepId: string;
  }): Promise<LocalSwapReplacementAuthorization> {
    return this.#transaction(async (client) => {
      const operation = await this.#lockOperation(client, input.operationId);
      const step = await this.#lockStep(client, input.stepId);
      if (
        step.step_id !== input.stepId ||
        !["broadcast", "pending", "dropped"].includes(step.state) ||
        !step.active_transaction_id ||
        operation.operation_id !== input.operationId
      ) {
        throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_NOT_ALLOWED");
      }
      const transaction = await this.#lockTransaction(client, step.active_transaction_id);
      const planStep = stepFromPlan(operation.plan_payload, step.step_id);
      const previous = reference(transaction);
      const next: LocalSwapReplacementCandidate = {
        dataDigest: planStep.transaction.dataDigest,
        fee: structuredClone(input.fee),
        nonce: planStep.nonce,
        planDigest: operation.plan_digest,
        semanticDigest: planStep.semanticDigest,
        target: planStep.transaction.to,
      };
      validateLocalSwapReplacement(planStep, previous, next, operation.plan_digest);
      const generation = transaction.generation + 1;
      const expiresAt = new Date(
        Math.min(Date.parse(operation.plan_payload.deadline), input.now.getTime() + 5 * 60 * 1_000),
      );
      await client.query(
        `INSERT INTO local_swap_replacement_authorizations (
           authorization_id, operation_id, step_id, replaced_transaction_id,
           generation, plan_digest, semantic_digest, transaction_to,
           transaction_data_digest, nonce, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, reason, state, expires_at,
           created_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, 'pending', $14, $15, NULL)`,
        [
          this.#uuid().toLowerCase(),
          operation.operation_id,
          step.step_id,
          transaction.transaction_id,
          generation,
          operation.plan_digest,
          planStep.semanticDigest,
          planStep.transaction.to,
          planStep.transaction.dataDigest,
          planStep.nonce,
          input.fee.maxFeePerGasBaseUnit,
          input.fee.maxPriorityFeePerGasBaseUnit,
          reason(input.reason),
          expiresAt,
          input.now,
        ],
      );
      return {
        expiresAt: expiresAt.toISOString(),
        generation,
        next,
        operationId: operation.operation_id,
        plan: structuredClone(operation.plan_payload),
        previous,
        reauthenticatedSessionId: operation.reauthenticated_session_id,
        stepId: step.step_id,
        tenantId: operation.tenant_id,
        userId: operation.user_id,
      };
    });
  }

  async completeReplacement(input: {
    authorization: LocalSwapReplacementAuthorization;
    deliveredAt: Date;
    result: LocalSwapStepSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorization = await this.#lockAuthorization(
        client,
        input.authorization.operationId,
        input.authorization.stepId,
        input.authorization.generation,
      );
      if (
        authorization.state !== "pending" ||
        authorization.expires_at <= input.deliveredAt ||
        authorization.plan_digest !== input.result.planDigest ||
        input.result.stepId !== authorization.step_id ||
        input.result.generation !== authorization.generation
      ) {
        throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_AUTHORIZATION_INVALID");
      }
      const operation = await this.#lockOperation(client, authorization.operation_id);
      const step = await this.#lockStep(client, authorization.step_id);
      if (step.active_transaction_id !== authorization.replaced_transaction_id) {
        throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_AUTHORIZATION_INVALID");
      }
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO local_swap_step_transactions (
           transaction_id, step_id, operation_id, generation, state, active, nonce,
           plan_digest, semantic_digest, transaction_to, transaction_data_digest,
           max_fee_per_gas_base_unit, max_priority_fee_per_gas_base_unit,
           transaction_hash, replaces_transaction_id, replaced_by_transaction_id,
           replacement_reason, created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, $4, 'broadcast', false, $5, $6, $7, $8, $9,
                   $10, $11, $12, $13, NULL, $14, $15, $15, $15, $15, NULL)`,
        [
          transactionId,
          step.step_id,
          operation.operation_id,
          authorization.generation,
          authorization.nonce,
          authorization.plan_digest,
          authorization.semantic_digest,
          authorization.transaction_to,
          authorization.transaction_data_digest,
          authorization.max_fee_per_gas_base_unit,
          authorization.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          authorization.replaced_transaction_id,
          authorization.reason,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_swap_step_transactions
            SET active = false, state = 'replaced', replaced_by_transaction_id = $2,
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
        `UPDATE local_swap_step_transactions SET active = true WHERE transaction_id = $1`,
        [transactionId],
      );
      await client.query(
        `UPDATE local_swap_operation_steps
            SET state = 'broadcast', active_transaction_id = $2, updated_at = $3
          WHERE step_id = $1`,
        [step.step_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_swap_replacement_authorizations
            SET state = 'consumed', consumed_at = $2 WHERE authorization_id = $1`,
        [authorization.authorization_id, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_swap_operations
            SET state = $2,
                reconciliation_reason = CASE WHEN $2 = 'reconciling'
                  THEN 'ALLOWANCE_CLEANUP_REQUIRED' ELSE NULL END,
                updated_at = $3
          WHERE operation_id = $1`,
        [
          operation.operation_id,
          step.step_kind === "cleanup" ? "reconciling" : "broadcast",
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_swap_operation_outbox
            SET state = 'delivered', delivered_at = $3
          WHERE aggregate_id = $1 AND step_id = $2 AND state = 'pending'`,
        [operation.operation_id, step.step_id, input.deliveredAt],
      );
      const planStep = stepFromPlan(operation.plan_payload, step.step_id);
      await this.#audit(
        client,
        operation,
        planStep,
        "swap.replaced",
        "REPLACEMENT_BROADCAST",
        input.deliveredAt,
        input.result.transactionHash,
      );
      await this.#enqueue(
        client,
        operation,
        step.step_id,
        step.step_kind === "cleanup" ? "local-swap.reconciling" : "local-swap.state-changed",
        step.step_kind === "cleanup" ? "reconciling" : "broadcast",
        input.deliveredAt,
      );
    });
  }

  async rejectReplacement(input: {
    authorization: LocalSwapReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorization = await this.#lockAuthorization(
        client,
        input.authorization.operationId,
        input.authorization.stepId,
        input.authorization.generation,
      );
      if (authorization.state !== "pending") return;
      await client.query(
        `UPDATE local_swap_replacement_authorizations SET state = 'cancelled'
          WHERE authorization_id = $1`,
        [authorization.authorization_id],
      );
      const operation = await this.#lockOperation(client, authorization.operation_id);
      const step = stepFromPlan(operation.plan_payload, authorization.step_id);
      await this.#audit(
        client,
        operation,
        step,
        "swap.replacement-failed",
        `${input.retryable ? "RETRYABLE_" : ""}${input.code}`,
        input.failedAt,
        null,
      );
    });
  }

  async #applyTransition(
    client: PoolClient,
    operation: LockedOperationRow,
    step: LockedStepRow,
    decision: Extract<LocalSwapObservationDecision, { kind: "transition" }>,
    observedAt: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE local_swap_operation_steps SET state = $2, updated_at = $3 WHERE step_id = $1`,
      [step.step_id, decision.stepState, observedAt],
    );
    if (step.active_transaction_id && decision.stepState === "pending") {
      await client.query(
        `UPDATE local_swap_step_transactions SET state = 'pending', confirmed_at = NULL,
                updated_at = $2 WHERE transaction_id = $1`,
        [step.active_transaction_id, observedAt],
      );
    } else if (step.active_transaction_id && decision.stepState === "dropped") {
      await client.query(
        `UPDATE local_swap_step_transactions SET state = 'dropped', updated_at = $2
          WHERE transaction_id = $1`,
        [step.active_transaction_id, observedAt],
      );
    }
    await client.query(
      `UPDATE local_swap_operations
          SET state = $2,
              reconciliation_reason = CASE WHEN $2 = 'reconciling' THEN $3 ELSE NULL END,
              updated_at = $4 WHERE operation_id = $1`,
      [operation.operation_id, decision.operationState, decision.reason, observedAt],
    );
    if (decision.operationState === "reconciling") {
      await this.#openReconciliation(
        client,
        operation.operation_id,
        step.step_id,
        decision.reason ?? "LOCAL_SWAP_RECONCILIATION_REQUIRED",
        observedAt,
      );
    }
    await this.#audit(
      client,
      operation,
      stepFromPlan(operation.plan_payload, step.step_id),
      `swap.${decision.stepState}`,
      decision.reason ?? decision.stepState.toUpperCase(),
      observedAt,
      null,
      decision.operationState === "reconciling",
    );
  }

  async #applyReceiptDecision(
    client: PoolClient,
    operation: LockedOperationRow,
    step: LockedStepRow,
    transactionId: string,
    decision: Extract<LocalSwapObservationDecision, { kind: "receipt" }>,
    observedAt: Date,
  ): Promise<void> {
    const planStep = stepFromPlan(operation.plan_payload, step.step_id);
    const txState =
      decision.stepState === "confirmed" || decision.stepState === "succeeded"
        ? "confirmed"
        : decision.stepState === "failed"
          ? "failed"
          : "pending";
    await client.query(
      `UPDATE local_swap_step_transactions
          SET state = $2,
              confirmed_at = CASE WHEN $2 = 'confirmed' THEN $3::timestamptz ELSE NULL END,
              updated_at = $3 WHERE transaction_id = $1`,
      [transactionId, txState, observedAt],
    );
    await client.query(
      `UPDATE local_swap_operation_steps
          SET state = $2, failure_code = $3, active_transaction_id = $4, updated_at = $5
        WHERE step_id = $1`,
      [step.step_id, decision.stepState, decision.failureCode, transactionId, observedAt],
    );
    if (decision.stepState === "confirmed") {
      await client.query(
        `UPDATE local_swap_operations
            SET state = $2,
                reconciliation_reason = CASE WHEN $2 = 'reconciling'
                  THEN 'ALLOWANCE_CLEANUP_REQUIRED' ELSE reconciliation_reason END,
                updated_at = $3 WHERE operation_id = $1`,
        [operation.operation_id, decision.operationState, observedAt],
      );
      await this.#finishAndRequeueCurrent(client, operation, step.step_id, observedAt, true);
      return;
    }
    if (decision.next === "advance") {
      await this.#recordConfirmedNonce(client, operation.wallet_id, planStep.nonce, observedAt);
      const nextStep = operation.plan_payload.steps[planStep.ordinal + 1];
      if (!nextStep || nextStep.kind === "cleanup") {
        throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
      }
      await client.query(
        `UPDATE local_swap_operation_steps SET state = 'queued', updated_at = $2 WHERE step_id = $1`,
        [nextStep.stepId, observedAt],
      );
      await client.query(
        `UPDATE local_swap_operations
            SET state = 'pending', failure_code = NULL, reconciliation_reason = NULL,
                updated_at = $2 WHERE operation_id = $1`,
        [operation.operation_id, observedAt],
      );
      await this.#resolveReconciliation(client, operation.operation_id, observedAt);
      await this.#enqueue(
        client,
        operation,
        nextStep.stepId,
        "local-swap.step-ready",
        "pending",
        observedAt,
      );
    } else if (decision.next === "complete-success") {
      await this.#recordConfirmedNonce(client, operation.wallet_id, planStep.nonce, observedAt);
      await this.#releaseSkippedCleanupNonce(client, operation, observedAt);
      await client.query(
        `UPDATE local_swap_operation_steps SET state = 'skipped', updated_at = $2
          WHERE operation_id = $1 AND step_kind = 'cleanup' AND state = 'blocked'`,
        [operation.operation_id, observedAt],
      );
      await client.query(
        `UPDATE local_swap_operations
            SET state = 'succeeded', failure_code = NULL, reconciliation_reason = NULL,
                updated_at = $2 WHERE operation_id = $1`,
        [operation.operation_id, observedAt],
      );
      await this.#resolveReconciliation(client, operation.operation_id, observedAt);
    } else if (decision.next === "cleanup-required") {
      await this.#recordConfirmedNonce(client, operation.wallet_id, planStep.nonce, observedAt);
      await this.#queueCleanup(
        client,
        operation,
        step,
        decision.failureCode ?? decision.reason ?? "SWAP_FAILED",
        observedAt,
      );
    } else if (decision.next === "complete-failed") {
      await this.#recordConfirmedNonce(client, operation.wallet_id, planStep.nonce, observedAt);
      await client.query(
        `UPDATE local_swap_operations
            SET state = 'failed', failure_code = $2, reconciliation_reason = NULL,
                updated_at = $3 WHERE operation_id = $1`,
        [
          operation.operation_id,
          decision.failureCode ?? operation.failure_code ?? "SWAP_FAILED",
          observedAt,
        ],
      );
      await this.#resolveReconciliation(client, operation.operation_id, observedAt);
    } else {
      await client.query(
        `UPDATE local_swap_operations
            SET state = 'reconciling', reconciliation_reason = $2,
                failure_code = COALESCE($3, failure_code), updated_at = $4
          WHERE operation_id = $1`,
        [
          operation.operation_id,
          decision.reason ?? "LOCAL_SWAP_RECONCILIATION_REQUIRED",
          decision.failureCode,
          observedAt,
        ],
      );
      await this.#openReconciliation(
        client,
        operation.operation_id,
        step.step_id,
        decision.reason ?? "LOCAL_SWAP_RECONCILIATION_REQUIRED",
        observedAt,
      );
      await this.#enqueue(
        client,
        operation,
        step.step_id,
        "local-swap.reconciling",
        "reconciling",
        new Date(observedAt.getTime() + this.#pollMilliseconds),
      );
    }
    await this.#audit(
      client,
      operation,
      planStep,
      `swap.${decision.stepState}`,
      decision.reason ?? decision.failureCode ?? decision.next.toUpperCase(),
      observedAt,
      decision.receipt.transactionHash,
      decision.operationState === "reconciling",
    );
  }

  async #appendReceipt(
    client: PoolClient,
    operation: LockedOperationRow,
    step: LockedStepRow,
    receipt: LocalSwapReceiptObservation,
    transactionId: string,
    observedAt: Date,
    claim: LocalSwapWorkClaim,
  ): Promise<void> {
    const transaction = claim.operation.transactionLineage.find(
      (candidate) =>
        candidate.transactionId === transactionId &&
        candidate.transactionHash === receipt.transactionHash,
    );
    if (!transaction) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_LINEAGE_INVALID");
    const evidenceDigest = sha256(receipt);
    const delta =
      receipt.ownerOutputBefore !== null && receipt.ownerOutputAfter !== null
        ? (BigInt(receipt.ownerOutputAfter) - BigInt(receipt.ownerOutputBefore)).toString()
        : null;
    await client.query(
      `INSERT INTO local_swap_receipt_evidence (
         evidence_id, transaction_id, operation_id, step_id, transaction_hash,
         block_hash, block_number, canonical, receipt_status,
         owner_output_before, owner_output_after, owner_output_delta, min_out_base_unit,
         plan_executed_event, swap_executed_event, helper_plan_replay_state,
         owner_to_spender_allowance, helper_to_adapter_allowance,
         adapter_to_router_allowance, helper_input_dust, helper_output_dust,
         evidence_digest, observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (transaction_id, block_hash, evidence_digest) DO NOTHING`,
      [
        this.#uuid().toLowerCase(),
        transactionId,
        operation.operation_id,
        step.step_id,
        receipt.transactionHash,
        receipt.blockHash,
        receipt.blockNumber,
        receipt.blockCanonical,
        receipt.receiptStatus,
        receipt.ownerOutputBefore,
        receipt.ownerOutputAfter,
        delta,
        receipt.minOutBaseUnit,
        receipt.planExecutedEvent,
        receipt.swapExecutedEvent,
        receipt.planReplayRecorded,
        receipt.ownerToSpenderAllowance,
        receipt.helperToAdapterAllowance,
        receipt.adapterToRouterAllowance,
        receipt.helperInputDust,
        receipt.helperOutputDust,
        evidenceDigest,
        observedAt,
      ],
    );
  }

  async #queueCleanup(
    client: PoolClient,
    operation: LockedOperationRow,
    failedStep: LockedStepRow,
    failureCode: string,
    when: Date,
  ): Promise<void> {
    const cleanup = operation.plan_payload.steps.find(({ kind }) => kind === "cleanup");
    if (!cleanup) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
    await client.query(
      `UPDATE local_swap_operation_steps
          SET state = 'failed', failure_code = $2, updated_at = $3 WHERE step_id = $1`,
      [failedStep.step_id, failureCode.slice(0, 120), when],
    );
    await client.query(
      `UPDATE local_swap_operation_steps
          SET state = 'queued', failure_code = NULL, updated_at = $2
        WHERE step_id = $1 AND state IN ('blocked', 'reconciling')`,
      [cleanup.stepId, when],
    );
    await client.query(
      `UPDATE local_swap_operations
          SET state = 'reconciling', failure_code = $2,
              reconciliation_reason = 'ALLOWANCE_CLEANUP_REQUIRED', updated_at = $3
        WHERE operation_id = $1`,
      [operation.operation_id, failureCode.slice(0, 120), when],
    );
    await this.#openReconciliation(
      client,
      operation.operation_id,
      cleanup.stepId,
      "ALLOWANCE_CLEANUP_REQUIRED",
      when,
    );
    await this.#enqueue(
      client,
      operation,
      cleanup.stepId,
      "local-swap.cleanup-required",
      "reconciling",
      when,
    );
  }

  async #finishAndRequeueCurrent(
    client: PoolClient,
    operation: LockedOperationRow,
    stepId: string,
    when: Date,
    confirmed: boolean,
  ): Promise<void> {
    await this.#enqueue(
      client,
      operation,
      stepId,
      "local-swap.state-changed",
      "pending",
      new Date(
        when.getTime() + (confirmed ? this.#confirmedPollMilliseconds : this.#pollMilliseconds),
      ),
    );
  }

  async #recordConfirmedNonce(
    client: PoolClient,
    walletId: string,
    nonce: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_nonce_ledgers
          SET last_confirmed_nonce = GREATEST(COALESCE(last_confirmed_nonce, $2), $2),
              reconciliation_reason = NULL, updated_at = $3
        WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId, nonce, when],
    );
  }

  async #releaseUnusedNonces(
    client: PoolClient,
    operation: LockedOperationRow,
    when: Date,
  ): Promise<void> {
    const firstNonce = BigInt(operation.plan_payload.steps[0]!.nonce);
    const reservedEnd = firstNonce + BigInt(operation.plan_payload.steps.length);
    await client.query(
      `UPDATE local_swap_operation_steps s
          SET state = 'skipped', updated_at = $2
        WHERE s.operation_id = $1 AND s.active_transaction_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM local_swap_step_transactions t WHERE t.step_id = s.step_id
          )`,
      [operation.operation_id, when],
    );
    const result = await client.query(
      `UPDATE wallet_nonce_ledgers
          SET next_nonce = $2, fencing_token = fencing_token + 1, updated_at = $3
        WHERE chain_id = 31337 AND wallet_id = $1 AND next_nonce = $4`,
      [operation.wallet_id, firstNonce.toString(), when, reservedEnd.toString()],
    );
    if (result.rowCount !== 1) {
      throw new LocalSwapWorkerError("NONCE_RECONCILIATION_REQUIRED", true);
    }
  }

  async #releaseSkippedCleanupNonce(
    client: PoolClient,
    operation: LockedOperationRow,
    when: Date,
  ): Promise<void> {
    const cleanup = operation.plan_payload.steps.at(-1);
    if (!cleanup || cleanup.kind !== "cleanup") {
      throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
    }
    const result = await client.query(
      `UPDATE wallet_nonce_ledgers
          SET next_nonce = $2, fencing_token = fencing_token + 1, updated_at = $3
        WHERE chain_id = 31337 AND wallet_id = $1
          AND next_nonce = $2::numeric + 1`,
      [operation.wallet_id, cleanup.nonce, when],
    );
    if (result.rowCount !== 1) {
      throw new LocalSwapWorkerError("NONCE_RECONCILIATION_REQUIRED", true);
    }
  }

  async #openReconciliation(
    client: PoolClient,
    operationId: string,
    stepId: string,
    why: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_swap_reconciliation_cases (
         reconciliation_id, operation_id, step_id, reason, status,
         provider_evidence_digest, opened_at, resolved_at
       ) VALUES ($1, $2, $3, $4, 'open', NULL, $5, NULL)
       ON CONFLICT (operation_id) WHERE status = 'open'
       DO UPDATE SET reason = EXCLUDED.reason, step_id = EXCLUDED.step_id`,
      [this.#uuid().toLowerCase(), operationId, stepId, why.slice(0, 120), when],
    );
  }

  async #resolveReconciliation(client: PoolClient, operationId: string, when: Date): Promise<void> {
    await client.query(
      `UPDATE local_swap_reconciliation_cases
          SET status = 'resolved', resolved_at = $2
        WHERE operation_id = $1 AND status = 'open'`,
      [operationId, when],
    );
  }

  async #enqueue(
    client: PoolClient,
    operation: LockedOperationRow,
    stepId: string,
    eventType:
      | "local-swap.cleanup-required"
      | "local-swap.reconciling"
      | "local-swap.state-changed"
      | "local-swap.step-ready",
    state: string,
    availableAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_swap_operation_outbox (
         event_id, aggregate_id, step_id, event_type, payload, state,
         attempt_count, available_at, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, $6, $7)`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        stepId,
        eventType,
        JSON.stringify({
          chainId: 31_337,
          operationId: operation.operation_id,
          state,
          walletId: operation.wallet_id,
        }),
        availableAt,
        availableAt,
      ],
    );
  }

  async #audit(
    client: PoolClient,
    operation: LockedOperationRow,
    step: LocalSwapPlanStep,
    action: string,
    code: string,
    when: Date,
    transactionHash: `0x${string}` | null,
    reconciled = false,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_swap_audit_events (
         tenant_id, actor_user_id, session_id, operation_id, step_id, wallet_id,
         nonce, transaction_hash, plan_digest, action, outcome, result_code,
         request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        operation.tenant_id,
        operation.user_id,
        operation.reauthenticated_session_id,
        operation.operation_id,
        step.stepId,
        operation.wallet_id,
        step.nonce,
        transactionHash,
        operation.plan_digest,
        action,
        reconciled ? "reconciled" : "allowed",
        code.slice(0, 120),
        `worker:${operation.operation_id}`,
        when,
      ],
    );
  }

  async #lockClaim(client: PoolClient, claim: LocalSwapWorkClaim): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT aggregate_id::text, step_id::text, state, attempt_count, lease_token::text
         FROM local_swap_operation_outbox WHERE event_id = $1 FOR UPDATE`,
      [claim.outboxEventId],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.aggregate_id !== claim.operation.operationId ||
      row.step_id !== claim.operation.step.stepId ||
      row.state !== "leased" ||
      row.lease_token !== claim.leaseToken
    ) {
      throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_LEASE_INVALID");
    }
    return row;
  }

  async #lockOperation(client: PoolClient, operationId: string): Promise<LockedOperationRow> {
    const result = await client.query<LockedOperationRow>(
      `SELECT operation_id::text, tenant_id, user_id::text, wallet_id::text, state,
              failure_code, reconciliation_reason, plan_digest, plan_payload,
              reauthenticated_session_id::text
         FROM local_swap_operations WHERE operation_id = $1 FOR UPDATE`,
      [operationId],
    );
    const row = result.rows[0];
    if (!row) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_OPERATION_MISSING");
    if (
      row.plan_payload.planDigest !== row.plan_digest ||
      localSwapExecutionPlanDigest(row.plan_payload) !== row.plan_digest
    ) {
      throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
    }
    return row;
  }

  async #lockStep(client: PoolClient, stepId: string): Promise<LockedStepRow> {
    const result = await client.query<LockedStepRow>(
      `SELECT step_id::text, ordinal, step_kind, state, nonce::text,
              active_transaction_id::text
         FROM local_swap_operation_steps WHERE step_id = $1 FOR UPDATE`,
      [stepId],
    );
    const row = result.rows[0];
    if (!row) throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_STEP_MISSING");
    return row;
  }

  async #lockTransaction(client: PoolClient, transactionId: string): Promise<TransactionRow> {
    const result = await client.query<TransactionRow>(
      `SELECT operation_id::text, transaction_id::text, active, generation,
              transaction_hash, nonce::text, plan_digest, semantic_digest,
              transaction_to, transaction_data_digest,
              max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, updated_at
         FROM local_swap_step_transactions WHERE transaction_id = $1 FOR UPDATE`,
      [transactionId],
    );
    const row = result.rows[0];
    if (!row || !row.transaction_hash) {
      throw new LocalSwapWorkerError("ACTIVE_TRANSACTION_MISSING");
    }
    return row;
  }

  async #lockAuthorization(
    client: PoolClient,
    operationId: string,
    stepId: string,
    generation: number,
  ): Promise<AuthorizationRow> {
    const result = await client.query<AuthorizationRow>(
      `SELECT authorization_id::text, operation_id::text, step_id::text,
              replaced_transaction_id::text, generation, plan_digest,
              semantic_digest, transaction_to, transaction_data_digest,
              nonce::text, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, reason, state, expires_at
         FROM local_swap_replacement_authorizations
        WHERE operation_id = $1 AND step_id = $2 AND generation = $3 FOR UPDATE`,
      [operationId, stepId, generation],
    );
    const row = result.rows[0];
    if (!row) throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_AUTHORIZATION_INVALID");
    return row;
  }

  async #finishClaim(client: PoolClient, claim: LocalSwapWorkClaim, when: Date): Promise<void> {
    await client.query(
      `UPDATE local_swap_operation_outbox
          SET state = 'delivered', delivered_at = $2, lease_owner = NULL,
              lease_token = NULL, lease_expires_at = NULL
        WHERE event_id = $1`,
      [claim.outboxEventId, when],
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
