import { createHash, randomUUID } from "node:crypto";

import {
  validateLocalHelperSweepReplacement,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepPlan,
} from "@lpbot/domain/local-helper-sweep";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  LocalHelperSweepWorkerError,
  localHelperSweepReplacementCandidate,
  type LocalHelperSweepObservationDecision,
  type LocalHelperSweepReceiptObservation,
  type LocalHelperSweepReplacementAuthorization,
  type LocalHelperSweepSignerResult,
  type LocalHelperSweepTransactionReference,
  type LocalHelperSweepWorkClaim,
  type LocalHelperSweepWorkOperation,
  type LocalHelperSweepWorkRepository,
} from "./local-helper-sweep-worker.js";

interface ClaimedEventRow extends QueryResultRow {
  batch_id: string;
  event_id: string;
  event_type: string;
  operation_id: string | null;
}

interface EventRow extends QueryResultRow {
  attempt_count: number;
  batch_id: string;
  event_id: string;
  event_type: string;
  lease_token: string;
  operation_id: string | null;
  state: string;
}

interface BatchRow extends QueryResultRow {
  batch_id: string;
  chain_id: number;
  helper_address: `0x${string}`;
  reauthenticated_session_id: string;
  state: string;
  tenant_id: string;
  user_id: string;
  wallet_address: `0x${string}`;
  wallet_id: string;
}

interface OperationRow extends QueryResultRow {
  active_transaction_id: string | null;
  batch_id: string;
  failure_code: string | null;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalHelperSweepPlan;
  reauthenticated_session_id: string;
  reconciliation_reason: string | null;
  state: LocalHelperSweepWorkOperation["state"];
  tenant_id: string;
  user_id: string;
  wallet_id: string;
}

interface TransactionRow extends QueryResultRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  state: string;
  transaction_hash: `0x${string}` | null;
  transaction_id: string;
  updated_at: Date;
}

interface AuthorizationRow extends QueryResultRow {
  amount_base_unit: string;
  authorization_id: string;
  expires_at: Date;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  operation_id: string;
  reason: string;
  recipient: `0x${string}`;
  replaced_transaction_id: string;
  state: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")}`;
}

function bounded(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized.length > 0 ? normalized : fallback;
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresLocalHelperSweepRecoveryRepository implements LocalHelperSweepWorkRepository {
  readonly #pollMilliseconds: number;
  readonly #uuid: () => string;

  constructor(
    readonly pool: Pool,
    input: { pollMilliseconds?: number; uuid?: () => string } = {},
  ) {
    this.#pollMilliseconds = input.pollMilliseconds ?? 1_000;
    if (this.#pollMilliseconds < 100 || this.#pollMilliseconds > 60_000) {
      throw new RangeError("LOCAL_HELPER_SWEEP_POLL_INVALID");
    }
    this.#uuid = input.uuid ?? randomUUID;
  }

  async claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalHelperSweepWorkClaim[]> {
    return this.#transaction(async (client) => {
      await client.query(
        `UPDATE local_helper_sweep_outbox
            SET state = 'pending', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, available_at = $1
          WHERE state = 'leased' AND lease_expires_at <= $1 AND attempt_count < 20`,
        [input.now],
      );
      const due = await client.query<ClaimedEventRow>(
        `SELECT e.event_id::text, e.batch_id::text, e.operation_id::text, e.event_type
           FROM local_helper_sweep_outbox e
           JOIN local_helper_sweep_batches b ON b.batch_id = e.batch_id
           LEFT JOIN local_helper_sweep_operations o ON o.operation_id = e.operation_id
          WHERE e.state = 'pending' AND e.available_at <= $1 AND e.attempt_count < 20
            AND (
              (e.event_type = 'helper-sweep.batch-rescan-required'
                AND e.operation_id IS NULL AND b.state = 'reconciling'
                AND b.rescan_state IN ('pending', 'running'))
              OR
              (e.operation_id IS NOT NULL
                AND o.state IN ('queued', 'broadcast', 'pending', 'confirmed', 'dropped', 'reconciling'))
            )
          ORDER BY e.available_at, e.created_at, e.event_id
          FOR UPDATE OF e SKIP LOCKED
          LIMIT $2`,
        [input.now, input.limit],
      );
      const claims: LocalHelperSweepWorkClaim[] = [];
      for (const row of due.rows) {
        const leaseToken = this.#uuid().toLowerCase();
        await client.query(
          `UPDATE local_helper_sweep_outbox
              SET state = 'leased', attempt_count = attempt_count + 1,
                  lease_owner = $2, lease_token = $3,
                  lease_expires_at = $4, last_error_code = NULL
            WHERE event_id = $1 AND state = 'pending'`,
          [
            row.event_id,
            input.workerId,
            leaseToken,
            new Date(input.now.getTime() + input.leaseMilliseconds),
          ],
        );
        if (row.event_type === "helper-sweep.batch-rescan-required") {
          const batch = await this.#lockBatch(client, row.batch_id);
          await client.query(
            `UPDATE local_helper_sweep_batches
                SET rescan_state = 'running', updated_at = $2 WHERE batch_id = $1`,
            [batch.batch_id, input.now],
          );
          claims.push({
            batch: {
              batchId: batch.batch_id,
              helperAddress: batch.helper_address,
              tenantId: batch.tenant_id,
              userId: batch.user_id,
              walletAddress: batch.wallet_address,
              walletId: batch.wallet_id,
            },
            kind: "rescan",
            leaseToken,
            outboxEventId: row.event_id,
          });
          continue;
        }
        if (!row.operation_id) {
          throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_OUTBOX_INVALID");
        }
        claims.push({
          kind: "operation",
          leaseToken,
          operation: await this.#loadOperation(client, row.operation_id),
          outboxEventId: row.event_id,
        });
      }
      return claims;
    });
  }

  async completeBroadcast(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>;
    deliveredAt: Date;
    result: LocalHelperSweepSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockEvent(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (
        operation.state !== "queued" ||
        operation.active_transaction_id !== null ||
        input.result.generation !== 0 ||
        input.result.operationId !== operation.operation_id ||
        input.result.planDigest !== operation.plan_digest
      ) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_BROADCAST_CONFLICT");
      }
      const plan = operation.plan_payload;
      if (input.result.planDigest !== plan.planDigest) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO local_helper_sweep_transactions (
           transaction_id, operation_id, batch_id, generation, state, active,
           nonce, plan_digest, semantic_digest, transaction_to,
           transaction_data_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash, delivery_id,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, 0, 'broadcast', true, $4, $5, $6, $7, $8,
                   $9, $10, $11, $12, NULL, NULL, NULL, $13, $13, $13, $13, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.batch_id,
          plan.nonce,
          plan.planDigest,
          plan.semanticDigest,
          plan.transaction.to,
          plan.transaction.dataDigest,
          this.#initialMaxFee(plan),
          this.#initialPriorityFee(plan),
          input.result.transactionHash,
          input.result.deliveryId,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_helper_sweep_operations
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_helper_sweep_batches
            SET state = 'running', updated_at = $2 WHERE batch_id = $1`,
        [operation.batch_id, input.deliveredAt],
      );
      await this.#finishEvent(client, input.claim, input.deliveredAt);
      await this.#audit(
        client,
        operation,
        "helper-sweep.broadcast",
        "BROADCAST",
        input.deliveredAt,
        input.result.transactionHash,
      );
      await this.#enqueueOperation(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async applyObservation(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>;
    decision: LocalHelperSweepObservationDecision;
    observedAt: Date;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockEvent(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (input.decision.kind === "receipt") {
        await this.#appendReceipt(
          client,
          operation,
          input.claim,
          input.decision.receipt,
          input.decision.transactionId,
          input.observedAt,
          input.decision.operationState === "succeeded",
        );
      }
      await this.#finishEvent(client, input.claim, input.observedAt);
      if (input.decision.kind === "defer") {
        await this.#setOperationState(
          client,
          operation,
          input.decision.operationState,
          input.decision.reason,
          null,
          input.observedAt,
        );
        await this.#enqueueOperation(
          client,
          operation,
          input.decision.operationState,
          new Date(input.observedAt.getTime() + this.#pollMilliseconds),
        );
        return;
      }
      if (input.decision.kind === "transition") {
        await this.#applyTransition(client, operation, input.decision, input.observedAt);
        return;
      }
      await this.#applyReceipt(client, operation, input.decision, input.observedAt);
    });
  }

  async prepareReplacement(
    input: Parameters<LocalHelperSweepWorkRepository["prepareReplacement"]>[0],
  ): Promise<LocalHelperSweepReplacementAuthorization> {
    return this.#transaction(async (client) => {
      const operation = await this.#lockOperation(client, input.operationId);
      if (
        !operation.active_transaction_id ||
        !["broadcast", "pending", "dropped"].includes(operation.state)
      ) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const transaction = await this.#lockTransaction(client, operation.active_transaction_id);
      if (!transaction.transaction_hash || !transaction.active) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const work = await this.#loadOperation(client, operation.operation_id);
      const previous = work.transactionLineage.find(
        ({ transactionId }) => transactionId === transaction.transaction_id,
      );
      if (!previous) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const next = localHelperSweepReplacementCandidate(work, structuredClone(input.fee));
      validateLocalHelperSweepReplacement(operation.plan_payload, previous, next);
      const generation = transaction.generation + 1;
      const expiresAt = new Date(
        Math.min(Date.parse(operation.plan_payload.deadline), input.now.getTime() + 5 * 60 * 1_000),
      );
      if (expiresAt <= input.now) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_PLAN_EXPIRED");
      }
      await client.query(
        `INSERT INTO local_helper_sweep_replacement_authorizations (
           authorization_id, operation_id, replaced_transaction_id, generation,
           plan_digest, semantic_digest, transaction_data_digest,
           amount_base_unit, recipient, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, reason, state, expires_at,
           created_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13, 'pending', $14, $15, NULL)`,
        [
          this.#uuid().toLowerCase(),
          operation.operation_id,
          transaction.transaction_id,
          generation,
          operation.plan_digest,
          operation.plan_payload.semanticDigest,
          operation.plan_payload.transaction.dataDigest,
          operation.plan_payload.asset.amountBaseUnit,
          operation.plan_payload.recipient,
          operation.plan_payload.feeLimit.gasLimit,
          input.fee.maxFeePerGasBaseUnit,
          input.fee.maxPriorityFeePerGasBaseUnit,
          bounded(input.reason, "FEE_BUMP"),
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
        tenantId: operation.tenant_id,
        userId: operation.user_id,
      };
    });
  }

  async completeReplacement(input: {
    authorization: LocalHelperSweepReplacementAuthorization;
    deliveredAt: Date;
    result: LocalHelperSweepSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorization = await this.#lockAuthorization(
        client,
        input.authorization.operationId,
        input.authorization.generation,
      );
      if (
        authorization.state !== "pending" ||
        authorization.expires_at <= input.deliveredAt ||
        input.result.operationId !== authorization.operation_id ||
        input.result.generation !== authorization.generation
      ) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const operation = await this.#lockOperation(client, authorization.operation_id);
      if (operation.active_transaction_id !== authorization.replaced_transaction_id) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
      }
      const plan = operation.plan_payload;
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO local_helper_sweep_transactions (
           transaction_id, operation_id, batch_id, generation, state, active,
           nonce, plan_digest, semantic_digest, transaction_to,
           transaction_data_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash, delivery_id,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, $4, 'broadcast', false, $5, $6, $7, $8, $9,
                   $10, $11, $12, $13, $14, NULL, $15, $16, $16, $16, $16, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.batch_id,
          authorization.generation,
          plan.nonce,
          plan.planDigest,
          plan.semanticDigest,
          plan.transaction.to,
          plan.transaction.dataDigest,
          authorization.max_fee_per_gas_base_unit,
          authorization.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          input.result.deliveryId,
          authorization.replaced_transaction_id,
          authorization.reason,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_helper_sweep_transactions
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
        `UPDATE local_helper_sweep_transactions SET active = true WHERE transaction_id = $1`,
        [transactionId],
      );
      await client.query(
        `UPDATE local_helper_sweep_operations
            SET state = 'broadcast', active_transaction_id = $2,
                reconciliation_reason = NULL, updated_at = $3 WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_helper_sweep_replacement_authorizations
            SET state = 'consumed', consumed_at = $2 WHERE authorization_id = $1`,
        [authorization.authorization_id, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_helper_sweep_outbox
            SET state = 'delivered', delivered_at = $2
          WHERE operation_id = $1 AND state = 'pending'`,
        [operation.operation_id, input.deliveredAt],
      );
      await this.#audit(
        client,
        operation,
        "helper-sweep.replaced",
        "REPLACEMENT_BROADCAST",
        input.deliveredAt,
        input.result.transactionHash,
      );
      await this.#enqueueOperation(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async rejectReplacement(input: {
    authorization: LocalHelperSweepReplacementAuthorization;
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
        `UPDATE local_helper_sweep_replacement_authorizations
            SET state = 'cancelled' WHERE authorization_id = $1`,
        [authorization.authorization_id],
      );
      const operation = await this.#lockOperation(client, authorization.operation_id);
      await this.#audit(
        client,
        operation,
        "helper-sweep.replacement-failed",
        `${input.retryable ? "RETRYABLE_" : ""}${bounded(input.code, "SIGNER_FAILURE")}`,
        input.failedAt,
        null,
        "denied",
      );
    });
  }

  async completeRescan(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "rescan" }>;
    completedAt: Date;
    outcome: "active" | "degraded" | "manual-recovery-required";
    snapshot: Readonly<LocalHelperResidualSnapshot>;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockEvent(client, input.claim);
      if (event.event_type !== "helper-sweep.batch-rescan-required") {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
      }
      const batch = await this.#lockBatch(client, input.claim.batch.batchId);
      const snapshot = await client.query<{
        binding_id: string;
        helper_address: `0x${string}`;
        snapshot_payload: LocalHelperResidualSnapshot;
      }>(
        `SELECT binding_id::text, helper_address, snapshot_payload
           FROM local_helper_residual_snapshots
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND snapshot_digest = $4`,
        [batch.tenant_id, batch.user_id, batch.wallet_id, input.snapshot.snapshotDigest],
      );
      const stored = snapshot.rows[0];
      if (
        !stored ||
        stored.helper_address !== batch.helper_address ||
        digest(stored.snapshot_payload) !== digest(input.snapshot)
      ) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
      }
      const binding = await client.query<{ state: string }>(
        `SELECT state FROM wallet_helper_deployment_bindings
          WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4`,
        [stored.binding_id, batch.tenant_id, batch.user_id, batch.wallet_id],
      );
      if (binding.rows[0]?.state !== input.snapshot.binding.state) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
      }
      const counts = await client.query<{ succeeded: string; total: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE state = 'succeeded')::text AS succeeded
           FROM local_helper_sweep_operations WHERE batch_id = $1`,
        [batch.batch_id],
      );
      const succeeded = BigInt(counts.rows[0]?.succeeded ?? "0");
      const total = BigInt(counts.rows[0]?.total ?? "0");
      const batchState =
        input.outcome === "manual-recovery-required"
          ? "manual-recovery-required"
          : input.outcome === "active" && succeeded === total
            ? "succeeded"
            : succeeded > 0n
              ? "partial"
              : "failed";
      const rescanState =
        input.outcome === "active"
          ? "passed"
          : input.outcome === "manual-recovery-required"
            ? "manual-recovery-required"
            : "failed";
      await client.query(
        `UPDATE local_helper_sweep_batches
            SET state = $2, rescan_state = $3, rescan_snapshot_digest = $4,
                updated_at = $5 WHERE batch_id = $1`,
        [batch.batch_id, batchState, rescanState, input.snapshot.snapshotDigest, input.completedAt],
      );
      await this.#finishEvent(client, input.claim, input.completedAt);
      await this.#auditBatch(
        client,
        batch,
        "helper-sweep.rescan",
        input.outcome.toUpperCase().replaceAll("-", "_"),
        input.completedAt,
      );
    });
  }

  async failClaim(input: {
    claim: LocalHelperSweepWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockEvent(client, input.claim);
      const code = bounded(input.code, "LOCAL_HELPER_SWEEP_WORKER_UNAVAILABLE");
      if (input.retryable && event.attempt_count < 20) {
        const delay = Math.min(60_000, this.#pollMilliseconds * 2 ** (event.attempt_count - 1));
        await client.query(
          `UPDATE local_helper_sweep_outbox
              SET state = 'pending', available_at = $2, lease_owner = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error_code = $3
            WHERE event_id = $1`,
          [event.event_id, new Date(input.failedAt.getTime() + delay), code],
        );
        if (input.claim.kind === "rescan") {
          await client.query(
            `UPDATE local_helper_sweep_batches
                SET rescan_state = 'pending', updated_at = $2 WHERE batch_id = $1`,
            [input.claim.batch.batchId, input.failedAt],
          );
        }
        return;
      }
      await client.query(
        `UPDATE local_helper_sweep_outbox
            SET state = 'dead', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, last_error_code = $2
          WHERE event_id = $1`,
        [event.event_id, code],
      );
      if (input.claim.kind === "rescan") {
        const batch = await this.#lockBatch(client, input.claim.batch.batchId);
        await client.query(
          `UPDATE local_helper_sweep_batches
              SET state = 'failed', rescan_state = 'failed', updated_at = $2
            WHERE batch_id = $1`,
          [batch.batch_id, input.failedAt],
        );
        return;
      }
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      await this.#setOperationState(client, operation, "reconciling", code, code, input.failedAt);
      await this.#openReconciliation(client, operation.operation_id, code, input.failedAt);
      await this.#audit(
        client,
        operation,
        "helper-sweep.worker-failed",
        code,
        input.failedAt,
        null,
        "denied",
      );
    });
  }

  async #applyTransition(
    client: PoolClient,
    operation: OperationRow,
    decision: Extract<LocalHelperSweepObservationDecision, { kind: "transition" }>,
    observedAt: Date,
  ): Promise<void> {
    if (operation.active_transaction_id) {
      await client.query(
        `UPDATE local_helper_sweep_transactions
            SET state = $2, updated_at = $3,
                confirmed_at = CASE WHEN $2 = 'confirmed' THEN $3::timestamptz ELSE NULL END
          WHERE transaction_id = $1`,
        [
          operation.active_transaction_id,
          decision.operationState === "dropped" ? "dropped" : "pending",
          observedAt,
        ],
      );
    }
    await this.#setOperationState(
      client,
      operation,
      decision.operationState,
      decision.reason,
      null,
      observedAt,
    );
    if (decision.operationState === "reconciling") {
      await this.#openReconciliation(
        client,
        operation.operation_id,
        decision.reason ?? "LOCAL_HELPER_SWEEP_RECONCILIATION_REQUIRED",
        observedAt,
      );
    }
    await this.#audit(
      client,
      operation,
      `helper-sweep.${decision.operationState}`,
      decision.reason ?? decision.operationState.toUpperCase(),
      observedAt,
      null,
      decision.operationState === "reconciling" ? "reconciled" : "allowed",
    );
    await this.#enqueueOperation(
      client,
      operation,
      decision.operationState,
      new Date(observedAt.getTime() + this.#pollMilliseconds),
    );
  }

  async #applyReceipt(
    client: PoolClient,
    operation: OperationRow,
    decision: Extract<LocalHelperSweepObservationDecision, { kind: "receipt" }>,
    observedAt: Date,
  ): Promise<void> {
    const transactionState =
      decision.operationState === "failed"
        ? "failed"
        : decision.operationState === "succeeded" || decision.operationState === "confirmed"
          ? "confirmed"
          : "pending";
    await client.query(
      `UPDATE local_helper_sweep_transactions
          SET active = false,
              state = CASE
                WHEN state IN ('signed', 'broadcast', 'pending', 'confirmed') THEN 'replaced'
                ELSE state
              END,
              updated_at = $3
        WHERE operation_id = $1 AND active AND transaction_id <> $2`,
      [operation.operation_id, decision.transactionId, observedAt],
    );
    await client.query(
      `UPDATE local_helper_sweep_transactions
          SET state = $2, active = true, updated_at = $3,
              confirmed_at = CASE WHEN $2 = 'confirmed' THEN $3::timestamptz ELSE NULL END
        WHERE transaction_id = $1`,
      [decision.transactionId, transactionState, observedAt],
    );
    await client.query(
      `UPDATE local_helper_sweep_operations
          SET active_transaction_id = $2 WHERE operation_id = $1`,
      [operation.operation_id, decision.transactionId],
    );
    await this.#setOperationState(
      client,
      operation,
      decision.operationState,
      decision.reason,
      decision.failureCode,
      observedAt,
    );
    if (decision.operationState === "confirmed") {
      await this.#enqueueOperation(
        client,
        operation,
        "confirmed",
        new Date(observedAt.getTime() + this.#pollMilliseconds),
      );
      return;
    }
    if (decision.operationState === "reconciling") {
      await this.#openReconciliation(
        client,
        operation.operation_id,
        decision.reason ?? "LOCAL_HELPER_SWEEP_RECONCILIATION_REQUIRED",
        observedAt,
      );
      await this.#enqueueOperation(
        client,
        operation,
        "reconciling",
        new Date(observedAt.getTime() + this.#pollMilliseconds),
      );
    } else {
      await this.#recordConfirmedNonce(
        client,
        operation.wallet_id,
        operation.plan_payload.nonce,
        observedAt,
      );
      await this.#resolveReconciliation(client, operation.operation_id, observedAt);
      await this.#finishBatchIfReady(client, operation.batch_id, observedAt);
    }
    await this.#audit(
      client,
      operation,
      `helper-sweep.${decision.operationState}`,
      decision.reason ?? decision.failureCode ?? decision.operationState.toUpperCase(),
      observedAt,
      decision.receipt.transactionHash,
      decision.operationState === "reconciling" ? "reconciled" : "allowed",
    );
  }

  async #appendReceipt(
    client: PoolClient,
    operation: OperationRow,
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>,
    receipt: LocalHelperSweepReceiptObservation,
    transactionId: string,
    observedAt: Date,
    reconciled: boolean,
  ): Promise<void> {
    const transaction = claim.operation.transactionLineage.find(
      (candidate) =>
        candidate.transactionId === transactionId &&
        candidate.transactionHash === receipt.transactionHash,
    );
    if (!transaction) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_LINEAGE_INVALID");
    }
    const plan = operation.plan_payload;
    await client.query(
      `INSERT INTO local_helper_sweep_receipt_evidence (
         evidence_id, operation_id, transaction_id, transaction_hash,
         block_hash, block_number, canonical, confirmations, receipt_status,
         asset_kind, token_address, amount_base_unit, transfer_from, transfer_to,
         transfer_amount_base_unit, helper_balance_before, helper_balance_after,
         owner_balance_before, owner_balance_after, gas_used, effective_gas_price,
         swept_event, plan_executed_event, helper_runtime_code_hash, observed_owner,
         reconciled, evidence_digest, observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
                 $24, $25, $26, $27, $28)
       ON CONFLICT (transaction_id, block_hash, evidence_digest) DO NOTHING`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        transactionId,
        receipt.transactionHash,
        receipt.blockHash,
        receipt.blockNumber,
        receipt.blockCanonical,
        receipt.confirmations,
        receipt.receiptStatus,
        plan.asset.kind,
        receipt.tokenAddress,
        plan.asset.amountBaseUnit,
        receipt.transferFrom,
        receipt.transferTo,
        receipt.transferAmountBaseUnit,
        receipt.helperBalanceBefore,
        receipt.helperBalanceAfter,
        receipt.ownerBalanceBefore,
        receipt.ownerBalanceAfter,
        receipt.gasUsed,
        receipt.effectiveGasPrice,
        receipt.sweptEvent,
        receipt.planExecutedEvent,
        receipt.helperRuntimeCodeHash,
        receipt.observedOwner,
        reconciled,
        digest(receipt),
        observedAt,
      ],
    );
  }

  async #finishBatchIfReady(client: PoolClient, batchId: string, when: Date): Promise<void> {
    const counts = await client.query<{ active: string; terminal: string; total: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE state IN ('succeeded', 'failed'))::text AS terminal,
              count(*) FILTER (WHERE state NOT IN ('succeeded', 'failed'))::text AS active
         FROM local_helper_sweep_operations WHERE batch_id = $1`,
      [batchId],
    );
    const value = counts.rows[0];
    if (!value || value.total === "0" || value.active !== "0" || value.terminal !== value.total) {
      await client.query(
        `UPDATE local_helper_sweep_batches SET state = 'running', updated_at = $2
          WHERE batch_id = $1 AND state <> 'reconciling'`,
        [batchId, when],
      );
      return;
    }
    await client.query(
      `UPDATE local_helper_sweep_batches
          SET state = 'reconciling', rescan_state = 'pending', updated_at = $2
        WHERE batch_id = $1`,
      [batchId, when],
    );
    await client.query(
      `INSERT INTO local_helper_sweep_outbox (
         event_id, batch_id, operation_id, event_type, payload, state,
         attempt_count, available_at, created_at
       ) SELECT $1, $2, NULL, 'helper-sweep.batch-rescan-required', $3::jsonb,
                'pending', 0, $4, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM local_helper_sweep_outbox
            WHERE batch_id = $2 AND event_type = 'helper-sweep.batch-rescan-required'
              AND state IN ('pending', 'leased', 'delivered')
         )`,
      [
        this.#uuid().toLowerCase(),
        batchId,
        JSON.stringify({ batchId, chainId: 31_337, state: "reconciling" }),
        when,
      ],
    );
  }

  async #setOperationState(
    client: PoolClient,
    operation: OperationRow,
    state: string,
    reason: string | null,
    failureCode: string | null,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE local_helper_sweep_operations
          SET state = $2, reconciliation_reason = $3, failure_code = $4, updated_at = $5
        WHERE operation_id = $1`,
      [operation.operation_id, state, reason, failureCode, when],
    );
  }

  async #enqueueOperation(
    client: PoolClient,
    operation: OperationRow,
    state: string,
    availableAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_sweep_outbox (
         event_id, batch_id, operation_id, event_type, payload, state,
         attempt_count, available_at, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', 0, $6, $7)`,
      [
        this.#uuid().toLowerCase(),
        operation.batch_id,
        operation.operation_id,
        state === "reconciling"
          ? "helper-sweep.operation-reconciling"
          : "helper-sweep.operation-state-changed",
        JSON.stringify({
          batchId: operation.batch_id,
          chainId: 31_337,
          operationId: operation.operation_id,
          state,
          walletId: operation.wallet_id,
        }),
        availableAt,
        new Date(),
      ],
    );
  }

  async #finishEvent(
    client: PoolClient,
    claim: LocalHelperSweepWorkClaim,
    when: Date,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE local_helper_sweep_outbox
          SET state = 'delivered', delivered_at = $3, lease_owner = NULL,
              lease_token = NULL, lease_expires_at = NULL
        WHERE event_id = $1 AND state = 'leased' AND lease_token = $2`,
      [claim.outboxEventId, claim.leaseToken, when],
    );
    if (result.rowCount !== 1) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_LEASE_LOST", true);
    }
  }

  async #recordConfirmedNonce(
    client: PoolClient,
    walletId: string,
    nonce: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_nonce_ledgers
          SET last_confirmed_nonce = GREATEST(COALESCE(last_confirmed_nonce, -1), $2::numeric),
              updated_at = $3
        WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId, nonce, when],
    );
  }

  async #openReconciliation(
    client: PoolClient,
    operationId: string,
    reason: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_sweep_reconciliation_cases (
         reconciliation_id, operation_id, reason, status,
         provider_evidence_digest, opened_at, resolved_at
       ) SELECT $1, $2, $3, 'open', NULL, $4, NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM local_helper_sweep_reconciliation_cases
            WHERE operation_id = $2 AND status = 'open'
         )`,
      [this.#uuid().toLowerCase(), operationId, bounded(reason, "RECONCILIATION_REQUIRED"), when],
    );
  }

  async #resolveReconciliation(client: PoolClient, operationId: string, when: Date): Promise<void> {
    await client.query(
      `UPDATE local_helper_sweep_reconciliation_cases
          SET status = 'resolved', resolved_at = $2
        WHERE operation_id = $1 AND status = 'open'`,
      [operationId, when],
    );
  }

  async #loadOperation(
    client: PoolClient,
    operationId: string,
  ): Promise<LocalHelperSweepWorkOperation> {
    const operation = await this.#lockOperation(client, operationId);
    const transactions = await client.query<TransactionRow>(
      `SELECT transaction_id::text, generation, state, active,
              max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text,
              transaction_hash, updated_at
         FROM local_helper_sweep_transactions
        WHERE operation_id = $1 AND transaction_hash IS NOT NULL
        ORDER BY generation`,
      [operationId],
    );
    const plan = structuredClone(operation.plan_payload);
    const lineage = transactions.rows.map((transaction): LocalHelperSweepTransactionReference => ({
      active: transaction.active,
      amountBaseUnit: plan.asset.amountBaseUnit,
      assetId: plan.asset.assetId,
      dataDigest: plan.transaction.dataDigest,
      fee: {
        maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
        maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
      },
      generation: transaction.generation,
      nonce: plan.nonce,
      planDigest: plan.planDigest,
      recipient: plan.recipient,
      semanticDigest: plan.semanticDigest,
      target: plan.transaction.to,
      transactionHash: transaction.transaction_hash!,
      transactionId: transaction.transaction_id,
      updatedAt: transaction.updated_at.toISOString(),
    }));
    return {
      activeTransaction:
        lineage.find(({ transactionId }) => transactionId === operation.active_transaction_id) ??
        null,
      batchId: operation.batch_id,
      operationId: operation.operation_id,
      plan,
      planDigest: operation.plan_digest,
      reauthenticatedSessionId: operation.reauthenticated_session_id,
      state: operation.state,
      tenantId: operation.tenant_id,
      transactionLineage: lineage,
      userId: operation.user_id,
    };
  }

  async #lockEvent(client: PoolClient, claim: LocalHelperSweepWorkClaim): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT event_id::text, batch_id::text, operation_id::text, event_type,
              state, lease_token::text, attempt_count
         FROM local_helper_sweep_outbox
        WHERE event_id = $1 FOR UPDATE`,
      [claim.outboxEventId],
    );
    const row = result.rows[0];
    if (!row || row.state !== "leased" || row.lease_token !== claim.leaseToken) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_LEASE_LOST", true);
    }
    return row;
  }

  async #lockBatch(client: PoolClient, batchId: string): Promise<BatchRow> {
    const result = await client.query<BatchRow>(
      `SELECT batch_id::text, tenant_id, user_id::text, wallet_id::text,
              wallet_address, chain_id::integer, helper_address, state,
              reauthenticated_session_id::text
         FROM local_helper_sweep_batches WHERE batch_id = $1 FOR UPDATE`,
      [batchId],
    );
    if (!result.rows[0]) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_BATCH_MISSING");
    }
    return result.rows[0];
  }

  async #lockOperation(client: PoolClient, operationId: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `SELECT o.operation_id::text, o.batch_id::text, o.wallet_id::text,
              o.state, o.plan_digest, o.plan_payload, o.active_transaction_id::text,
              o.failure_code, o.reconciliation_reason, o.tenant_id, o.user_id::text,
              b.reauthenticated_session_id::text
         FROM local_helper_sweep_operations o
         JOIN local_helper_sweep_batches b ON b.batch_id = o.batch_id
        WHERE o.operation_id = $1 FOR UPDATE OF o`,
      [operationId],
    );
    if (!result.rows[0]) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_OPERATION_MISSING");
    }
    return result.rows[0];
  }

  async #lockTransaction(client: PoolClient, transactionId: string): Promise<TransactionRow> {
    const result = await client.query<TransactionRow>(
      `SELECT transaction_id::text, generation, state, active,
              max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text,
              transaction_hash, updated_at
         FROM local_helper_sweep_transactions
        WHERE transaction_id = $1 FOR UPDATE`,
      [transactionId],
    );
    if (!result.rows[0]) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_TRANSACTION_MISSING");
    }
    return result.rows[0];
  }

  async #lockAuthorization(
    client: PoolClient,
    operationId: string,
    generation: number,
  ): Promise<AuthorizationRow> {
    const result = await client.query<AuthorizationRow>(
      `SELECT authorization_id::text, operation_id::text,
              replaced_transaction_id::text, generation, amount_base_unit::text,
              recipient, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, reason, state, expires_at
         FROM local_helper_sweep_replacement_authorizations
        WHERE operation_id = $1 AND generation = $2 FOR UPDATE`,
      [operationId, generation],
    );
    if (!result.rows[0]) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID");
    }
    return result.rows[0];
  }

  async #audit(
    client: PoolClient,
    operation: OperationRow,
    action: string,
    resultCode: string,
    when: Date,
    transactionHash: `0x${string}` | null,
    outcome: "allowed" | "denied" | "reconciled" = "allowed",
  ): Promise<void> {
    const plan = operation.plan_payload;
    await client.query(
      `INSERT INTO local_helper_sweep_audit_events (
         tenant_id, actor_user_id, session_id, batch_id, operation_id,
         wallet_id, chain_id, asset_id, nonce, transaction_hash, plan_digest,
         action, outcome, result_code, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 31337, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15)`,
      [
        operation.tenant_id,
        operation.user_id,
        operation.reauthenticated_session_id,
        operation.batch_id,
        operation.operation_id,
        operation.wallet_id,
        plan.asset.assetId,
        plan.nonce,
        transactionHash,
        operation.plan_digest,
        action,
        outcome,
        bounded(resultCode, "UNKNOWN"),
        `worker:${operation.operation_id}`,
        when,
      ],
    );
  }

  async #auditBatch(
    client: PoolClient,
    batch: BatchRow,
    action: string,
    resultCode: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_sweep_audit_events (
         tenant_id, actor_user_id, session_id, batch_id, operation_id,
         wallet_id, chain_id, asset_id, nonce, transaction_hash, plan_digest,
         action, outcome, result_code, request_id, created_at
       ) VALUES ($1, $2, $3, $4, NULL, $5, 31337, NULL, NULL, NULL, NULL,
                 $6, 'reconciled', $7, $8, $9)`,
      [
        batch.tenant_id,
        batch.user_id,
        batch.reauthenticated_session_id,
        batch.batch_id,
        batch.wallet_id,
        action,
        bounded(resultCode, "UNKNOWN"),
        `worker:${batch.batch_id}`,
        when,
      ],
    );
  }

  #initialMaxFee(plan: LocalHelperSweepPlan): string {
    const max = BigInt(plan.feeLimit.maxFeePerGasBaseUnit);
    return (max > 1n ? max / 2n : max).toString();
  }

  #initialPriorityFee(plan: LocalHelperSweepPlan): string {
    const priority = BigInt(plan.feeLimit.maxPriorityFeePerGasBaseUnit);
    return (priority > 1n ? priority / 2n : priority).toString();
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
