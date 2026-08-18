import { createHash, randomUUID } from "node:crypto";

import type { WalletTransferState } from "@lpbot/api-contract";
import {
  assertWalletTransferTransition,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "@lpbot/domain/wallet-transfer";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  WalletTransferWorkerError,
  replacementTransferPlan,
  type WalletTransferObservationDecision,
  type WalletTransferReplacementAuthorization,
  type WalletTransferSignerResult,
  type WalletTransferTransactionHead,
  type WalletTransferWorkClaim,
  type WalletTransferWorkOperation,
  type WalletTransferWorkRepository,
} from "./wallet-transfer-worker.js";

interface ClaimedEventRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  event_id: string;
  lease_token: string;
}

interface EventLockRow extends QueryResultRow {
  aggregate_id: string;
  attempt_count: number;
  lease_token: string | null;
  state: "dead" | "delivered" | "leased" | "pending";
}

interface OperationRow extends QueryResultRow {
  active_created_at: Date | null;
  active_generation: number | null;
  active_max_fee_per_gas_base_unit: string | null;
  active_max_priority_fee_per_gas_base_unit: string | null;
  active_state: WalletTransferTransactionHead["state"] | "replaced" | null;
  active_transaction_hash: `0x${string}` | null;
  active_transaction_id: string | null;
  active_updated_at: Date | null;
  amount_base_unit: string;
  asset_kind: "erc20" | "native";
  chain_id: string;
  fee_cap_base_unit: string;
  fencing_token: string;
  gas_limit: string;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  plan_deadline: Date;
  plan_digest: `sha256:${string}`;
  policy_digest: `sha256:${string}`;
  recipient: `0x${string}`;
  state: WalletTransferState;
  tenant_id: string;
  token_address: `0x${string}` | null;
  transaction_data: `0x${string}`;
  transaction_target: `0x${string}`;
  transaction_value_base_unit: string;
  user_id: string;
  wallet_address: `0x${string}`;
  wallet_id: string;
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
  o.operation_id::text, o.user_id::text, o.wallet_id::text, o.chain_id::text,
  o.state, o.asset_kind, o.token_address, o.recipient, o.wallet_address,
  o.amount_base_unit::text, o.nonce::text, o.fencing_token::text,
  o.transaction_target, o.transaction_value_base_unit::text, o.transaction_data,
  o.gas_limit::text, o.max_fee_per_gas_base_unit::text,
  o.max_priority_fee_per_gas_base_unit::text, o.fee_cap_base_unit::text,
  o.plan_digest, o.policy_digest, o.plan_deadline, w.tenant_id,
  t.transaction_id::text AS active_transaction_id,
  t.generation AS active_generation, t.state AS active_state,
  t.transaction_hash AS active_transaction_hash,
  t.max_fee_per_gas_base_unit::text AS active_max_fee_per_gas_base_unit,
  t.max_priority_fee_per_gas_base_unit::text AS active_max_priority_fee_per_gas_base_unit,
  t.created_at AS active_created_at, t.updated_at AS active_updated_at`;

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function operationPlan(row: OperationRow): WalletTransferPlan {
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_PLAN_INVALID");
  }
  const plan: WalletTransferPlan = {
    amountBaseUnit: row.amount_base_unit,
    asset:
      row.asset_kind === "native"
        ? { kind: "native" }
        : { kind: "erc20", tokenAddress: row.token_address! },
    chainId,
    deadline: row.plan_deadline.toISOString(),
    feeLimit: {
      feeCapBaseUnit: row.fee_cap_base_unit,
      gasLimit: row.gas_limit,
      maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
      maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
    },
    fencingToken: row.fencing_token,
    nonce: row.nonce,
    operationId: row.operation_id,
    policyDigest: row.policy_digest,
    recipient: row.recipient,
    transactionData: row.transaction_data,
    transactionTarget: row.transaction_target,
    transactionValueBaseUnit: row.transaction_value_base_unit,
    walletAddress: row.wallet_address,
    walletId: row.wallet_id,
  };
  validateWalletTransferPlan(plan, new Date(0));
  if (walletTransferPlanDigest(plan) !== row.plan_digest) {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_PLAN_INVALID");
  }
  return plan;
}

function activeTransaction(row: OperationRow): WalletTransferTransactionHead | null {
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
    throw new WalletTransferWorkerError("ACTIVE_TRANSACTION_INVALID");
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

function workOperation(row: OperationRow): WalletTransferWorkOperation {
  if (row.state === "ready-for-approval" || row.state === "replaced") {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_STATE_INVALID");
  }
  return {
    activeTransaction: activeTransaction(row),
    assetKind: row.asset_kind,
    operationId: row.operation_id,
    plan: operationPlan(row),
    planDigest: row.plan_digest,
    state: row.state,
    tenantId: row.tenant_id,
    userId: row.user_id,
  };
}

function validReason(value: string): string {
  if (
    value.length < 1 ||
    value.length > 120 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_REASON_INVALID");
  }
  return value;
}

function retryDelayMilliseconds(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1_000);
}

function auditAction(state: WalletTransferState): string {
  switch (state) {
    case "broadcast":
      return "transfer.broadcast";
    case "confirmed":
      return "transfer.confirmed";
    case "dropped":
      return "transfer.dropped";
    case "failed":
      return "transfer.failed";
    case "pending":
      return "transfer.pending";
    case "reconciling":
      return "transfer.reconciled";
    case "replaced":
      return "transfer.replaced";
    case "signed":
      return "transfer.signed";
    default:
      return "transfer.reconciled";
  }
}

export class PostgresWalletTransferRecoveryRepository implements WalletTransferWorkRepository {
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
      throw new RangeError("wallet transfer recovery repository configuration is invalid");
    }
  }

  async claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<WalletTransferWorkClaim[]> {
    const client = await this.#pool.connect();
    const leaseToken = this.#uuid().toLowerCase();
    try {
      await client.query("BEGIN");
      const events = await client.query<ClaimedEventRow>(
        `WITH due AS (
           SELECT e.event_id
             FROM wallet_transfer_outbox e
             JOIN wallet_transfer_operations o ON o.operation_id = e.aggregate_id
            WHERE (
                    (e.state = 'pending' AND e.available_at <= $1)
                    OR (e.state = 'leased' AND e.lease_expires_at <= $1)
                  )
              AND e.attempt_count < $2
              AND o.state NOT IN ('ready-for-approval', 'replaced')
            ORDER BY e.available_at, e.created_at, e.event_id
            FOR UPDATE OF e SKIP LOCKED
            LIMIT $3
         )
         UPDATE wallet_transfer_outbox e
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
      const operations = await client.query<OperationRow>(
        `SELECT ${operationColumns}
           FROM wallet_transfer_operations o
           JOIN custody_wallets w
             ON w.wallet_id = o.wallet_id AND w.user_id = o.user_id
           LEFT JOIN wallet_transfer_transactions t
             ON t.transaction_id = o.active_transaction_id AND t.active
          WHERE o.operation_id = ANY($1::uuid[])`,
        [events.rows.map(({ aggregate_id }) => aggregate_id)],
      );
      const byId = new Map(operations.rows.map((row) => [row.operation_id, row]));
      const claims = events.rows.map((event) => {
        const row = byId.get(event.aggregate_id);
        if (!row) throw new WalletTransferWorkerError("TRANSFER_RECOVERY_OPERATION_MISSING");
        return {
          eventId: event.event_id,
          leaseToken: event.lease_token,
          operation: workOperation(row),
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
    claim: WalletTransferWorkClaim;
    deliveredAt: Date;
    result: WalletTransferSignerResult;
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
        `INSERT INTO wallet_transfer_transactions (
           transaction_id, operation_id, chain_id, wallet_id, nonce, generation,
           state, active, plan_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, $4, $5, 0, 'signed', true, $6, $7, $8, $9,
                   NULL, NULL, NULL, $10, $10, $10, NULL, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.chain_id,
          operation.wallet_id,
          operation.nonce,
          input.result.planDigest,
          operation.max_fee_per_gas_base_unit,
          operation.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          input.deliveredAt,
        ],
      );
      await this.#audit(client, {
        action: "transfer.signed",
        code: "SIGNED",
        operation,
        state: "signed",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await client.query(
        `UPDATE wallet_transfer_transactions
            SET state = 'broadcast', broadcast_at = $2, updated_at = $2
          WHERE transaction_id = $1`,
        [transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE wallet_transfer_operations
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await this.#audit(client, {
        action: "transfer.broadcast",
        code: input.result.status === "already-known" ? "ALREADY_KNOWN" : "BROADCAST_ACCEPTED",
        operation,
        state: "broadcast",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await this.#finishClaim(client, input.claim, input.deliveredAt);
      await this.#enqueue(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async applyObservation(input: {
    claim: WalletTransferWorkClaim;
    decision: WalletTransferObservationDecision;
    observedAt: Date;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (
        operation.state !== input.claim.operation.state ||
        operation.active_transaction_id !==
          input.claim.operation.activeTransaction?.transactionId
      ) {
        await this.#finishClaim(client, input.claim, input.observedAt);
        return;
      }
      const currentState = operation.state;
      const targetState = input.decision.state;
      assertWalletTransferTransition({ from: currentState, to: targetState });
      const transactionId = operation.active_transaction_id;
      if (!transactionId) {
        throw new WalletTransferWorkerError("ACTIVE_TRANSACTION_MISSING");
      }
      if (input.decision.kind === "receipt") {
        const receipt = input.decision.receipt;
        const evidenceDigest = sha256(
          JSON.stringify([
            receipt.transactionHash,
            receipt.blockHash,
            receipt.blockNumber,
            receipt.blockCanonical,
            receipt.receiptStatus,
            receipt.nonce,
            receipt.balanceReconciled,
            receipt.tokenTransferLogReconciled,
          ]),
        );
        await client.query(
          `INSERT INTO wallet_transfer_receipt_evidence (
             evidence_id, transaction_id, transaction_hash, block_hash, block_number,
             canonical, receipt_status, nonce_reconciled, balance_reconciled,
             transfer_log_reconciled, evidence_digest, observed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11)
           ON CONFLICT (transaction_id, block_hash, evidence_digest) DO NOTHING`,
          [
            this.#uuid().toLowerCase(),
            transactionId,
            receipt.transactionHash,
            receipt.blockHash,
            receipt.blockNumber,
            receipt.blockCanonical,
            receipt.receiptStatus,
            receipt.balanceReconciled,
            receipt.tokenTransferLogReconciled,
            evidenceDigest,
            input.observedAt,
          ],
        );
      }
      if (input.decision.kind !== "defer") {
        const reason = input.decision.reason;
        await client.query(
          `UPDATE wallet_transfer_operations
              SET state = $2, failure_code = CASE WHEN $2 = 'failed' THEN COALESCE($3, 'REVERTED') ELSE NULL END,
                  reconciliation_reason = CASE WHEN $2 = 'reconciling' THEN $3 ELSE NULL END,
                  updated_at = $4
            WHERE operation_id = $1`,
          [operation.operation_id, targetState, reason, input.observedAt],
        );
        if (targetState === "pending") {
          await client.query(
            `UPDATE wallet_transfer_transactions
                SET state = 'pending', confirmed_at = NULL, updated_at = $2
              WHERE transaction_id = $1`,
            [transactionId, input.observedAt],
          );
        } else if (targetState === "confirmed") {
          await client.query(
            `UPDATE wallet_transfer_transactions
                SET state = 'confirmed', confirmed_at = $2, updated_at = $2
              WHERE transaction_id = $1`,
            [transactionId, input.observedAt],
          );
          await client.query(
            `UPDATE wallet_nonce_ledgers
                SET last_confirmed_nonce = GREATEST(COALESCE(last_confirmed_nonce, $3), $3),
                    reconciliation_reason = NULL, updated_at = $4
              WHERE chain_id = $1 AND wallet_id = $2`,
            [operation.chain_id, operation.wallet_id, operation.nonce, input.observedAt],
          );
        } else if (targetState === "failed" || targetState === "dropped") {
          await client.query(
            `UPDATE wallet_transfer_transactions
                SET state = $2, updated_at = $3
              WHERE transaction_id = $1`,
            [transactionId, targetState, input.observedAt],
          );
        } else if (targetState === "reconciling" && currentState === "confirmed") {
          await client.query(
            `UPDATE wallet_transfer_transactions
                SET state = 'pending', confirmed_at = NULL, updated_at = $2
              WHERE transaction_id = $1`,
            [transactionId, input.observedAt],
          );
        }
        if (targetState === "reconciling") {
          await this.#openReconciliation(
            client,
            operation,
            reason ?? "TRANSFER_RECONCILIATION_REQUIRED",
            input.observedAt,
            input.decision,
          );
        } else {
          await this.#resolveReconciliation(client, operation.operation_id, input.observedAt);
        }
        await this.#audit(client, {
          action: auditAction(targetState),
          code: reason ?? targetState.toUpperCase(),
          operation,
          state: targetState,
          transactionHash: operation.active_transaction_hash,
          when: input.observedAt,
        });
      }
      await this.#finishClaim(client, input.claim, input.observedAt);
      if (targetState === "broadcast" || targetState === "pending" || targetState === "reconciling") {
        await this.#enqueue(
          client,
          operation,
          targetState,
          new Date(input.observedAt.getTime() + this.#pollMilliseconds),
        );
      } else if (targetState === "confirmed") {
        await this.#enqueue(
          client,
          operation,
          targetState,
          new Date(input.observedAt.getTime() + this.#confirmedPollMilliseconds),
        );
      }
    });
  }

  async failClaim(input: {
    claim: WalletTransferWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockClaim(client, input.claim);
      if (input.retryable && event.attempt_count < this.#maxAttempts) {
        await client.query(
          `UPDATE wallet_transfer_outbox
              SET state = 'pending', available_at = $3, lease_owner = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error_code = $2
            WHERE event_id = $1`,
          [
            input.claim.eventId,
            input.code,
            new Date(input.failedAt.getTime() + retryDelayMilliseconds(event.attempt_count)),
          ],
        );
        return;
      }
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      await client.query(
        `UPDATE wallet_transfer_outbox
            SET state = 'dead', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, last_error_code = $2
          WHERE event_id = $1`,
        [input.claim.eventId, input.code],
      );
      const targetState: "failed" | "reconciling" =
        !input.retryable && operation.state !== "confirmed" ? "failed" : "reconciling";
      assertWalletTransferTransition({ from: operation.state, to: targetState });
      await client.query(
        `UPDATE wallet_transfer_operations
            SET state = $2,
                failure_code = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
                reconciliation_reason = CASE WHEN $2 = 'reconciling' THEN $3 ELSE NULL END,
                updated_at = $4
          WHERE operation_id = $1`,
        [operation.operation_id, targetState, input.code, input.failedAt],
      );
      if (targetState === "reconciling") {
        await this.#openReconciliation(
          client,
          operation,
          input.code,
          input.failedAt,
          { kind: "transition", reason: input.code, state: "reconciling" },
        );
        await this.#enqueue(
          client,
          operation,
          targetState,
          new Date(input.failedAt.getTime() + this.#pollMilliseconds),
        );
      }
      await this.#audit(client, {
        action: auditAction(targetState),
        code: input.code,
        operation,
        state: targetState,
        transactionHash: operation.active_transaction_hash,
        when: input.failedAt,
      });
    });
  }

  async prepareReplacement(input: {
    feeLimit: WalletTransferPlan["feeLimit"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<WalletTransferReplacementAuthorization> {
    return this.#transaction(async (client) => {
      const reason = validReason(input.reason);
      const operation = await this.#lockOperation(client, input.operationId);
      if (
        operation.state !== "broadcast" &&
        operation.state !== "pending" &&
        operation.state !== "dropped"
      ) {
        throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_STATE_INVALID");
      }
      if (
        !operation.active_transaction_id ||
        operation.active_generation === null ||
        !operation.active_transaction_hash
      ) {
        throw new WalletTransferWorkerError("ACTIVE_TRANSACTION_MISSING");
      }
      const replacement = replacementTransferPlan({
        feeLimit: input.feeLimit,
        now: input.now,
        plan: operationPlan(operation),
      });
      const planDigest = walletTransferPlanDigest(replacement);
      const existing = await client.query<AuthorizationRow>(
        `SELECT authorization_id::text, operation_id::text, replaced_transaction_id::text,
                generation, plan_digest, gas_limit::text, max_fee_per_gas_base_unit::text,
                max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text,
                reason, state, expires_at, created_at
           FROM wallet_transfer_replacement_authorizations
          WHERE operation_id = $1 AND state = 'pending'
          FOR UPDATE`,
        [operation.operation_id],
      );
      const current = existing.rows[0];
      if (current) {
        if (
          current.plan_digest !== planDigest ||
          current.replaced_transaction_id !== operation.active_transaction_id
        ) {
          throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_CONFLICT");
        }
        return this.#authorization(operation, current, replacement);
      }
      const row: AuthorizationRow = {
        authorization_id: this.#uuid().toLowerCase(),
        consumed_at: undefined,
        created_at: input.now,
        expires_at: new Date(replacement.deadline),
        fee_cap_base_unit: replacement.feeLimit.feeCapBaseUnit,
        gas_limit: replacement.feeLimit.gasLimit,
        generation: operation.active_generation + 1,
        max_fee_per_gas_base_unit: replacement.feeLimit.maxFeePerGasBaseUnit,
        max_priority_fee_per_gas_base_unit:
          replacement.feeLimit.maxPriorityFeePerGasBaseUnit,
        operation_id: operation.operation_id,
        plan_digest: planDigest,
        reason,
        replaced_transaction_id: operation.active_transaction_id,
        state: "pending",
      } as AuthorizationRow;
      await client.query(
        `INSERT INTO wallet_transfer_replacement_authorizations (
           authorization_id, operation_id, replaced_transaction_id, generation,
           plan_digest, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, fee_cap_base_unit, reason,
           state, expires_at, created_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   'pending', $11, $12, NULL)`,
        [
          row.authorization_id,
          row.operation_id,
          row.replaced_transaction_id,
          row.generation,
          row.plan_digest,
          row.gas_limit,
          row.max_fee_per_gas_base_unit,
          row.max_priority_fee_per_gas_base_unit,
          row.fee_cap_base_unit,
          row.reason,
          row.expires_at,
          row.created_at,
        ],
      );
      return this.#authorization(operation, row, replacement);
    }, true);
  }

  async completeReplacement(input: {
    authorization: WalletTransferReplacementAuthorization;
    deliveredAt: Date;
    result: WalletTransferSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const authorizationResult = await client.query<AuthorizationRow>(
        `SELECT authorization_id::text, operation_id::text, replaced_transaction_id::text,
                generation, plan_digest, gas_limit::text, max_fee_per_gas_base_unit::text,
                max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text,
                reason, state, expires_at, created_at
           FROM wallet_transfer_replacement_authorizations
          WHERE operation_id = $1 AND generation = $2
          FOR UPDATE`,
        [input.authorization.operationId, input.authorization.generation],
      );
      const authorization = authorizationResult.rows[0];
      if (
        !authorization ||
        authorization.state !== "pending" ||
        authorization.plan_digest !== input.result.planDigest ||
        authorization.plan_digest !== input.authorization.planDigest ||
        authorization.replaced_transaction_id !== input.authorization.replacedTransactionId
      ) {
        throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_AUTHORIZATION_INVALID");
      }
      const operation = await this.#lockOperation(client, input.authorization.operationId);
      if (
        operation.active_transaction_id !== authorization.replaced_transaction_id ||
        (operation.state !== "broadcast" &&
          operation.state !== "pending" &&
          operation.state !== "dropped")
      ) {
        throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_CONFLICT");
      }
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO wallet_transfer_transactions (
           transaction_id, operation_id, chain_id, wallet_id, nonce, generation,
           state, active, plan_digest, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'signed', false, $7, $8, $9, $10,
                   $11, NULL, $12, $13, $13, $13, NULL, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.chain_id,
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
        `UPDATE wallet_transfer_transactions
            SET state = 'replaced', active = false, replaced_by_transaction_id = $2,
                updated_at = $3
          WHERE transaction_id = $1 AND active`,
        [authorization.replaced_transaction_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE wallet_transfer_transactions
            SET state = 'broadcast', active = true, broadcast_at = $2, updated_at = $2
          WHERE transaction_id = $1`,
        [transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE wallet_transfer_operations
            SET state = 'broadcast', active_transaction_id = $2,
                failure_code = NULL, reconciliation_reason = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE wallet_transfer_replacement_authorizations
            SET state = 'consumed', consumed_at = $2
          WHERE authorization_id = $1`,
        [authorization.authorization_id, input.deliveredAt],
      );
      await this.#audit(client, {
        action: "transfer.replaced",
        code: authorization.reason,
        operation,
        state: "replaced",
        transactionHash: operation.active_transaction_hash,
        when: input.deliveredAt,
      });
      await this.#audit(client, {
        action: "transfer.broadcast",
        code: input.result.status === "already-known" ? "ALREADY_KNOWN" : "REPLACEMENT_BROADCAST",
        operation,
        state: "broadcast",
        transactionHash: input.result.transactionHash,
        when: input.deliveredAt,
      });
      await this.#enqueue(client, operation, "broadcast", input.deliveredAt);
    });
  }

  async rejectReplacement(input: {
    authorization: WalletTransferReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    if (input.retryable) return;
    await this.#pool.query(
      `UPDATE wallet_transfer_replacement_authorizations
          SET state = 'cancelled'
        WHERE operation_id = $1 AND generation = $2 AND plan_digest = $3
          AND state = 'pending'`,
      [input.authorization.operationId, input.authorization.generation, input.authorization.planDigest],
    );
  }

  #authorization(
    operation: OperationRow,
    row: AuthorizationRow,
    plan: WalletTransferPlan,
  ): WalletTransferReplacementAuthorization {
    return {
      generation: row.generation,
      operationId: operation.operation_id,
      plan,
      planDigest: row.plan_digest,
      replacedTransactionId: row.replaced_transaction_id,
      tenantId: operation.tenant_id,
      userId: operation.user_id,
    };
  }

  async #audit(
    client: PoolClient,
    input: {
      action: string;
      code: string;
      operation: OperationRow;
      state: WalletTransferState;
      transactionHash: `0x${string}` | null;
      when: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO wallet_transfer_audit_events (
         actor_user_id, session_id, operation_id, wallet_id, chain_id,
         nonce, transaction_hash, plan_digest, state, action,
         outcome, result_code, request_id, created_at
       ) VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8,
                 'allowed', $9, $10, $11)`,
      [
        input.operation.operation_id,
        input.operation.wallet_id,
        input.operation.chain_id,
        input.operation.nonce,
        input.transactionHash,
        input.operation.plan_digest,
        input.state,
        input.action,
        input.code.slice(0, 120),
        `worker:${input.operation.operation_id}`,
        input.when,
      ],
    );
  }

  async #enqueue(
    client: PoolClient,
    operation: OperationRow,
    state: WalletTransferState,
    availableAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO wallet_transfer_outbox (
         event_id, aggregate_id, event_type, payload, state,
         attempt_count, available_at, created_at
       ) VALUES ($1, $2, 'wallet-transfer.state-changed', $3::jsonb,
                 'pending', 0, $4, $5)`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        JSON.stringify({
          chainId: Number(operation.chain_id),
          operationId: operation.operation_id,
          state,
          walletId: operation.wallet_id,
        }),
        availableAt,
        new Date(),
      ],
    );
  }

  async #finishClaim(
    client: PoolClient,
    claim: WalletTransferWorkClaim,
    deliveredAt: Date,
  ): Promise<void> {
    const result = await client.query(
      `UPDATE wallet_transfer_outbox
          SET state = 'delivered', delivered_at = $3,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE event_id = $1 AND state = 'leased' AND lease_token = $2`,
      [claim.eventId, claim.leaseToken, deliveredAt],
    );
    if (result.rowCount !== 1) throw new WalletTransferWorkerError("TRANSFER_WORK_LEASE_LOST", true);
  }

  async #lockClaim(client: PoolClient, claim: WalletTransferWorkClaim): Promise<EventLockRow> {
    const result = await client.query<EventLockRow>(
      `SELECT aggregate_id::text, state, attempt_count, lease_token::text
         FROM wallet_transfer_outbox
        WHERE event_id = $1
        FOR UPDATE`,
      [claim.eventId],
    );
    const event = result.rows[0];
    if (
      !event ||
      event.aggregate_id !== claim.operation.operationId ||
      event.state !== "leased" ||
      event.lease_token !== claim.leaseToken
    ) {
      throw new WalletTransferWorkerError("TRANSFER_WORK_LEASE_LOST", true);
    }
    return event;
  }

  async #lockOperation(client: PoolClient, operationId: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM wallet_transfer_operations o
         JOIN custody_wallets w
           ON w.wallet_id = o.wallet_id AND w.user_id = o.user_id
         LEFT JOIN wallet_transfer_transactions t
           ON t.transaction_id = o.active_transaction_id AND t.active
        WHERE o.operation_id = $1
        FOR UPDATE OF o`,
      [operationId],
    );
    const operation = result.rows[0];
    if (!operation) throw new WalletTransferWorkerError("TRANSFER_RECOVERY_OPERATION_MISSING");
    return operation;
  }

  async #openReconciliation(
    client: PoolClient,
    operation: OperationRow,
    reason: string,
    openedAt: Date,
    evidence: unknown,
  ): Promise<void> {
    await client.query(
      `INSERT INTO wallet_transfer_reconciliation_cases (
         reconciliation_id, operation_id, chain_id, wallet_id, reason,
         status, provider_evidence_digest, opened_at, resolved_at
       ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, NULL)
       ON CONFLICT (operation_id) WHERE status = 'open'
       DO UPDATE SET reason = EXCLUDED.reason,
                     provider_evidence_digest = EXCLUDED.provider_evidence_digest`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        operation.chain_id,
        operation.wallet_id,
        reason.slice(0, 120),
        sha256(JSON.stringify(evidence)),
        openedAt,
      ],
    );
    await client.query(
      `UPDATE wallet_nonce_ledgers
          SET reconciliation_reason = $3, updated_at = $4
        WHERE chain_id = $1 AND wallet_id = $2`,
      [operation.chain_id, operation.wallet_id, reason.slice(0, 120), openedAt],
    );
  }

  async #resolveReconciliation(
    client: PoolClient,
    operationId: string,
    resolvedAt: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_transfer_reconciliation_cases
          SET status = 'resolved', resolved_at = $2
        WHERE operation_id = $1 AND status = 'open'`,
      [operationId, resolvedAt],
    );
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>, serializable = false): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query(serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
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
