import { createHash, randomUUID } from "node:crypto";

import {
  assertLocalHelperUpgradeCursorTransition,
  assertWalletHelperV2Verification,
  localHelperUpgradePlanDigest,
  localHelperUpgradeReplacementCandidate,
  localHelperV1SupersedeDecision,
  validateLocalHelperUpgradeReplacement,
  type LocalHelperUpgradePlan,
  type WalletHelperV2Verification,
} from "@lpbot/domain/local-helper-upgrade";
import {
  localHelperResidualSnapshotDigest,
  type LocalHelperResidualSnapshot,
} from "@lpbot/domain/local-helper-sweep";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  LocalHelperUpgradeWorkerError,
  localHelperUpgradeInitialFee,
  validateLocalHelperUpgradeWorkPlan,
  type LocalHelperUpgradeDeploymentDecision,
  type LocalHelperUpgradeReplacementAuthorization,
  type LocalHelperUpgradeSignerResult,
  type LocalHelperUpgradeSweepResult,
  type LocalHelperUpgradeWorkClaim,
  type LocalHelperUpgradeWorkOperation,
  type LocalHelperUpgradeWorkRepository,
} from "./local-helper-upgrade-worker.js";

interface ClaimedEventRow extends QueryResultRow {
  attempt_count: number;
  event_id: string;
  operation_id: string;
}

interface EventRow extends QueryResultRow {
  attempt_count: number;
  cursor: LocalHelperUpgradeWorkOperation["cursor"];
  lease_token: string | null;
  operation_id: string;
  state: "dead" | "delivered" | "leased" | "pending";
}

interface OperationRow extends QueryResultRow {
  active_transaction_id: string | null;
  cursor: LocalHelperUpgradeWorkOperation["cursor"] | "completed";
  manual_recovery_blockers: string[];
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalHelperUpgradePlan;
  reauthenticated_session_id: string;
  source_binding_id: string;
  source_helper_address: `0x${string}`;
  state: "queued" | "running" | "manual-recovery-required" | "failed" | "completed";
  sweep_batch_id: string | null;
  tenant_id: string;
  user_id: string;
  wallet_id: string;
}

interface TransactionRow extends QueryResultRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  state: LocalHelperUpgradeWorkOperation["transactions"][number]["state"];
  transaction_hash: `0x${string}` | null;
  transaction_id: string;
  updated_at: Date;
}

interface AuthorizationRow extends QueryResultRow {
  authorization_id: string;
  expires_at: Date;
  generation: number;
  init_code_hash: `0x${string}`;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  owner_address: `0x${string}`;
  plan_digest: `sha256:${string}`;
  reason: string;
  replaced_transaction_id: string;
  state: "cancelled" | "consumed" | "pending";
  target_helper_address: `0x${string}`;
  target_version: "WalletHelperV2";
}

const operationColumns = `
  operation_id::text, tenant_id, user_id::text, wallet_id::text, state, cursor,
  source_binding_id::text, source_helper_address, plan_digest, plan_payload,
  reauthenticated_session_id::text, sweep_batch_id::text,
  active_transaction_id::text, manual_recovery_blockers`;

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
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex")}`;
}

function bounded(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized.length > 0 ? normalized : fallback;
}

function retryDelay(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
}

function rollback(client: PoolClient): Promise<void> {
  return client.query("ROLLBACK").then(
    () => undefined,
    () => undefined,
  );
}

export class PostgresLocalHelperUpgradeRecoveryRepository
  implements LocalHelperUpgradeWorkRepository
{
  readonly #pollMilliseconds: number;
  readonly #uuid: () => string;

  constructor(
    readonly pool: Pool,
    input: { pollMilliseconds?: number; uuid?: () => string } = {},
  ) {
    this.#pollMilliseconds = input.pollMilliseconds ?? 1_000;
    if (this.#pollMilliseconds < 100 || this.#pollMilliseconds > 60_000) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_POLL_INVALID");
    }
    this.#uuid = input.uuid ?? randomUUID;
  }

  async claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalHelperUpgradeWorkClaim[]> {
    return this.#transaction(async (client) => {
      await client.query(
        `UPDATE local_helper_upgrade_outbox
            SET state = 'pending', lease_owner = NULL, lease_token = NULL,
                lease_expires_at = NULL, available_at = $1
          WHERE state = 'leased' AND lease_expires_at <= $1 AND attempt_count < 20`,
        [input.now],
      );
      const events = await client.query<ClaimedEventRow>(
        `SELECT event.event_id::text, event.operation_id::text, event.attempt_count
           FROM local_helper_upgrade_outbox event
           JOIN local_helper_upgrade_operations operation
             ON operation.operation_id = event.operation_id
          WHERE event.state = 'pending' AND event.available_at <= $1
            AND event.attempt_count < 20
            AND operation.state IN ('queued', 'running')
            AND operation.cursor = event.cursor
          ORDER BY event.available_at, event.created_at, event.event_id
          FOR UPDATE OF event SKIP LOCKED LIMIT $2`,
        [input.now, input.limit],
      );
      const claims: LocalHelperUpgradeWorkClaim[] = [];
      for (const event of events.rows) {
        const leaseToken = this.#uuid().toLowerCase();
        const leased = await client.query(
          `UPDATE local_helper_upgrade_outbox
              SET state = 'leased', attempt_count = attempt_count + 1,
                  lease_owner = $2, lease_token = $3, lease_expires_at = $4,
                  last_error_code = NULL
            WHERE event_id = $1 AND state = 'pending'`,
          [
            event.event_id,
            input.workerId,
            leaseToken,
            new Date(input.now.getTime() + input.leaseMilliseconds),
          ],
        );
        if (leased.rowCount !== 1) continue;
        await client.query(
          `UPDATE local_helper_upgrade_steps step
              SET state = 'running', updated_at = $2
             FROM local_helper_upgrade_operations operation
            WHERE operation.operation_id = $1 AND step.operation_id = operation.operation_id
              AND step.cursor = operation.cursor AND step.state = 'pending'`,
          [event.operation_id, input.now],
        );
        claims.push({
          leaseToken,
          operation: await this.#loadOperation(client, event.operation_id),
          outboxEventId: event.event_id,
        });
      }
      return claims;
    });
  }

  async advance(input: Parameters<LocalHelperUpgradeWorkRepository["advance"]>[0]): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      await this.#advance(client, input.claim, operation, input.next, input.completedAt);
    });
  }

  async completeBroadcast(input: {
    claim: LocalHelperUpgradeWorkClaim;
    deliveredAt: Date;
    result: LocalHelperUpgradeSignerResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (
        operation.cursor !== "deploy-v2" ||
        operation.state !== "running" ||
        operation.active_transaction_id !== null ||
        input.result.generation !== 0 ||
        input.result.operationId !== operation.operation_id ||
        input.result.planDigest !== operation.plan_digest
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BROADCAST_CONFLICT");
      }
      const existing = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM local_helper_upgrade_transactions
          WHERE operation_id = $1`,
        [operation.operation_id],
      );
      if (existing.rows[0]?.count !== "0") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BROADCAST_CONFLICT");
      }
      const fee = localHelperUpgradeInitialFee(operation.plan_payload);
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO local_helper_upgrade_transactions (
           transaction_id, operation_id, generation, state, active, nonce,
           plan_digest, init_code_hash, target_version, owner_address,
           target_helper_address, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash, delivery_id,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, 0, 'broadcast', true, $3, $4, $5, 'WalletHelperV2',
                   $6, $7, $8, $9, $10, $11, NULL, NULL, NULL,
                   $12, $12, $12, $12, NULL)`,
        [
          transactionId,
          operation.operation_id,
          operation.plan_payload.nonce,
          operation.plan_digest,
          operation.plan_payload.transaction.dataHash,
          operation.plan_payload.target.owner,
          operation.plan_payload.target.expectedAddress,
          fee.maxFeePerGasBaseUnit,
          fee.maxPriorityFeePerGasBaseUnit,
          input.result.transactionHash,
          input.result.deliveryId,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_helper_upgrade_operations
            SET active_transaction_id = $2, failure_code = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await this.#audit(
        client,
        operation,
        "helper-upgrade.deploy-broadcast",
        "BROADCAST",
        input.deliveredAt,
        input.result.transactionHash,
      );
      await this.#rescheduleClaim(client, input.claim, input.deliveredAt, this.#pollMilliseconds);
    });
  }

  async applyDeploymentObservation(input: {
    claim: LocalHelperUpgradeWorkClaim;
    decision: LocalHelperUpgradeDeploymentDecision;
    observedAt: Date;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.cursor !== "deploy-v2" || operation.state !== "running") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_OBSERVATION_CONFLICT");
      }
      if (input.decision.kind === "defer") {
        await client.query(
          `UPDATE local_helper_upgrade_transactions
              SET state = $2, updated_at = $3
            WHERE transaction_id = $1 AND active`,
          [
            operation.active_transaction_id,
            input.decision.state === "confirmed" ? "confirmed" : "pending",
            input.observedAt,
          ],
        );
        await this.#rescheduleClaim(client, input.claim, input.observedAt, this.#pollMilliseconds);
        return;
      }
      if (input.decision.kind === "transition") {
        await client.query(
          `UPDATE local_helper_upgrade_transactions
              SET state = $2, updated_at = $3
            WHERE transaction_id = $1 AND active`,
          [
            operation.active_transaction_id,
            input.decision.state === "dropped" ? "dropped" : "pending",
            input.observedAt,
          ],
        );
        await client.query(
          `UPDATE local_helper_upgrade_operations
              SET failure_code = $2, updated_at = $3 WHERE operation_id = $1`,
          [operation.operation_id, input.decision.reason, input.observedAt],
        );
        await this.#rescheduleClaim(client, input.claim, input.observedAt, this.#pollMilliseconds);
        return;
      }
      const receiptDecision = input.decision;
      const transaction = input.claim.operation.transactions.find(
        ({ transactionId, transactionHash }) =>
          transactionId === receiptDecision.transactionId &&
          transactionHash === receiptDecision.receipt.transactionHash,
      );
      if (!transaction) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LINEAGE_INVALID");
      }
      await client.query(
        `INSERT INTO local_helper_upgrade_deployment_receipt_evidence (
           evidence_id, operation_id, transaction_id, transaction_hash,
           block_number, block_hash, canonical, confirmations, receipt_status,
           contract_address, runtime_code_hash, transaction_reconciled,
           evidence_digest, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (transaction_id, block_hash, evidence_digest) DO NOTHING`,
        [
          this.#uuid().toLowerCase(),
          operation.operation_id,
          transaction.transactionId,
          input.decision.receipt.transactionHash,
          input.decision.receipt.blockNumber,
          input.decision.receipt.blockHash,
          input.decision.receipt.blockCanonical,
          input.decision.receipt.confirmations,
          input.decision.receipt.receiptStatus,
          input.decision.receipt.contractAddress,
          input.decision.receipt.runtimeCodeHash,
          input.decision.receipt.transactionReconciled,
          digest(input.decision.receipt),
          input.observedAt,
        ],
      );
      if (input.decision.state === "failed") {
        await client.query(
          `UPDATE local_helper_upgrade_transactions
              SET state = 'failed', active = false, updated_at = $2
            WHERE transaction_id = $1`,
          [transaction.transactionId, input.observedAt],
        );
        await this.#terminalFailure(
          client,
          input.claim,
          operation,
          input.decision.reason ?? "DEPLOYMENT_FAILED",
          input.observedAt,
        );
        return;
      }
      if (input.decision.state === "reconciling") {
        await client.query(
          `UPDATE local_helper_upgrade_operations
              SET failure_code = $2, updated_at = $3 WHERE operation_id = $1`,
          [operation.operation_id, input.decision.reason, input.observedAt],
        );
        await this.#rescheduleClaim(client, input.claim, input.observedAt, this.#pollMilliseconds);
        return;
      }
      await client.query(
        `UPDATE local_helper_upgrade_transactions
            SET active = false,
                state = CASE WHEN transaction_id = $2 THEN 'confirmed' ELSE 'replaced' END,
                updated_at = $3,
                confirmed_at = CASE WHEN transaction_id = $2 THEN $3::timestamptz ELSE confirmed_at END
          WHERE operation_id = $1 AND active`,
        [operation.operation_id, transaction.transactionId, input.observedAt],
      );
      await client.query(
        `UPDATE local_helper_upgrade_transactions SET active = true
          WHERE transaction_id = $1`,
        [transaction.transactionId],
      );
      await client.query(
        `UPDATE local_helper_upgrade_operations SET active_transaction_id = $2
          WHERE operation_id = $1`,
        [operation.operation_id, transaction.transactionId],
      );
      await this.#advance(client, input.claim, operation, "verify-v2", input.observedAt);
    });
  }

  async completeVerification(input: {
    claim: LocalHelperUpgradeWorkClaim;
    verifiedAt: Date;
    verification: WalletHelperV2Verification;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.cursor !== "verify-v2" || operation.state !== "running") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_VERIFICATION_CONFLICT");
      }
      const transaction = await this.#activeTransaction(client, operation);
      if (transaction.state !== "confirmed" || !transaction.transaction_hash) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_VERIFICATION_CONFLICT");
      }
      this.#assertVerification(operation.plan_payload, input.verification);
      await client.query(
        `INSERT INTO local_helper_upgrade_v2_verification_evidence (
           evidence_id, operation_id, transaction_id, block_number, block_hash,
           verification_payload, evidence_digest, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (operation_id, block_hash, evidence_digest) DO NOTHING`,
        [
          this.#uuid().toLowerCase(),
          operation.operation_id,
          transaction.transaction_id,
          input.verification.observedAtBlock,
          input.verification.blockHash,
          JSON.stringify(input.verification),
          digest(input.verification),
          input.verifiedAt,
        ],
      );
      const binding = await client.query(
        `UPDATE wallet_helper_deployment_bindings
            SET deployment_transaction_hash = $2, verified_block_number = $3,
                failure_code = NULL, updated_at = $4
          WHERE upgrade_operation_id = $1 AND helper_version = 'WalletHelperV2'
            AND state = 'deploying'`,
        [
          operation.operation_id,
          transaction.transaction_hash,
          input.verification.observedAtBlock,
          input.verifiedAt,
        ],
      );
      if (binding.rowCount !== 1) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_VERIFICATION_CONFLICT");
      }
      await this.#advance(client, input.claim, operation, "sweep-v1", input.verifiedAt);
    });
  }

  async applySweepResult(input: {
    claim: LocalHelperUpgradeWorkClaim;
    observedAt: Date;
    result: LocalHelperUpgradeSweepResult;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.cursor !== "sweep-v1" || operation.state !== "running") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SWEEP_CONFLICT");
      }
      if (
        operation.sweep_batch_id !== null &&
        input.result.batchId !== null &&
        operation.sweep_batch_id !== input.result.batchId
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SWEEP_CONFLICT");
      }
      if (input.result.batchId !== null && operation.sweep_batch_id === null) {
        await client.query(
          `UPDATE local_helper_upgrade_operations SET sweep_batch_id = $2, updated_at = $3
            WHERE operation_id = $1 AND sweep_batch_id IS NULL`,
          [operation.operation_id, input.result.batchId, input.observedAt],
        );
      }
      if (input.result.kind === "pending") {
        await this.#rescheduleClaim(client, input.claim, input.observedAt, this.#pollMilliseconds);
        return;
      }
      if (input.result.kind === "manual-recovery-required") {
        await this.#manualRecovery(
          client,
          input.claim,
          operation,
          input.result.blockers,
          input.observedAt,
        );
        return;
      }
      await this.#advance(client, input.claim, operation, "final-rescan-v1", input.observedAt);
    });
  }

  async completeFinalRescan(input: {
    claim: LocalHelperUpgradeWorkClaim;
    observedAt: Date;
    snapshot: LocalHelperResidualSnapshot;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.cursor !== "final-rescan-v1" || operation.state !== "running") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_RESCAN_CONFLICT");
      }
      const decision = this.#rescanDecision(operation, input.snapshot);
      await this.#appendRescanEvidence(client, operation, input.snapshot, decision, input.observedAt);
      if (decision.manualRecoveryRequired) {
        await this.#manualRecovery(
          client,
          input.claim,
          operation,
          decision.blockers,
          input.observedAt,
        );
        return;
      }
      if (!decision.eligible) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_FINAL_RESCAN_NOT_CLEAN", true);
      }
      await this.#advance(client, input.claim, operation, "atomic-binding-switch", input.observedAt);
    });
  }

  async completeAtomicBindingSwitch(input: {
    claim: LocalHelperUpgradeWorkClaim;
    completedAt: Date;
    snapshot: LocalHelperResidualSnapshot;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      if (operation.cursor !== "atomic-binding-switch" || operation.state !== "running") {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BINDING_SWITCH_CONFLICT");
      }
      const decision = this.#rescanDecision(operation, input.snapshot);
      await this.#appendRescanEvidence(client, operation, input.snapshot, decision, input.completedAt);
      if (decision.manualRecoveryRequired) {
        await this.#manualRecovery(
          client,
          input.claim,
          operation,
          decision.blockers,
          input.completedAt,
        );
        return;
      }
      if (!decision.eligible) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_FINAL_RESCAN_NOT_CLEAN", true);
      }
      const verificationResult = await client.query<{
        verification_payload: WalletHelperV2Verification;
      }>(
        `SELECT verification_payload FROM local_helper_upgrade_v2_verification_evidence
          WHERE operation_id = $1 ORDER BY observed_at DESC, evidence_id DESC LIMIT 1`,
        [operation.operation_id],
      );
      const verification = verificationResult.rows[0]?.verification_payload;
      if (!verification) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_VERIFICATION_MISSING");
      }
      this.#assertVerification(operation.plan_payload, verification);
      const wallet = await client.query(
        `SELECT wallet_id FROM custody_wallets
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 FOR UPDATE`,
        [operation.tenant_id, operation.user_id, operation.wallet_id],
      );
      if (wallet.rowCount !== 1) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BINDING_SWITCH_CONFLICT");
      }
      const live = await this.#liveExternalOperationIds(client, operation);
      if (live.length > 0) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LIVE_OPERATION", true);
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
        [operation.source_binding_id, operation.operation_id],
      );
      const source = bindings.rows.find(({ helper_version }) => helper_version === "WalletHelperV1");
      const target = bindings.rows.find(({ helper_version }) => helper_version === "WalletHelperV2");
      if (
        !source ||
        source.state !== "active" ||
        !target ||
        target.state !== "deploying" ||
        target.verified_block_number === null
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BINDING_SWITCH_CONFLICT");
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
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BINDING_SWITCH_CONFLICT");
      }
      await client.query(
        `UPDATE local_helper_upgrade_steps
            SET state = 'succeeded', failure_code = NULL, updated_at = $2
          WHERE operation_id = $1 AND cursor IN ('atomic-binding-switch', 'completed')`,
        [operation.operation_id, input.completedAt],
      );
      const completed = await client.query(
        `UPDATE local_helper_upgrade_operations
            SET state = 'completed', cursor = 'completed', failure_code = NULL,
                manual_recovery_blockers = '[]'::jsonb, updated_at = $2
          WHERE operation_id = $1 AND state = 'running' AND cursor = 'atomic-binding-switch'`,
        [operation.operation_id, input.completedAt],
      );
      if (completed.rowCount !== 1) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_BINDING_SWITCH_CONFLICT");
      }
      await this.#finishClaim(client, input.claim, input.completedAt, "delivered");
      await this.#audit(
        client,
        operation,
        "helper-upgrade.completed",
        "COMPLETED",
        input.completedAt,
        null,
      );
    }, "SERIALIZABLE");
  }

  async failClaim(input: {
    claim: LocalHelperUpgradeWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const event = await this.#lockClaim(client, input.claim);
      const operation = await this.#lockOperation(client, input.claim.operation.operationId);
      const code = bounded(input.code, "HELPER_UPGRADE_WORKER_UNAVAILABLE");
      if (input.retryable && event.attempt_count < 20) {
        await client.query(
          `UPDATE local_helper_upgrade_outbox
              SET state = 'pending', available_at = $2, lease_owner = NULL,
                  lease_token = NULL, lease_expires_at = NULL, last_error_code = $3
            WHERE event_id = $1`,
          [
            input.claim.outboxEventId,
            new Date(input.failedAt.getTime() + retryDelay(event.attempt_count)),
            code,
          ],
        );
        await client.query(
          `UPDATE local_helper_upgrade_operations
              SET failure_code = $2, updated_at = $3 WHERE operation_id = $1`,
          [operation.operation_id, code, input.failedAt],
        );
        return;
      }
      await this.#terminalFailure(client, input.claim, operation, code, input.failedAt);
    });
  }

  async prepareReplacement(input: {
    fee: LocalHelperUpgradeReplacementAuthorization["fee"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<LocalHelperUpgradeReplacementAuthorization> {
    return this.#transaction(async (client) => {
      const operation = await this.#lockOperation(client, input.operationId);
      if (
        operation.cursor !== "deploy-v2" ||
        operation.state !== "running" ||
        !operation.active_transaction_id
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_REPLACEMENT_INVALID");
      }
      const transaction = await this.#activeTransaction(client, operation);
      if (
        !transaction.active ||
        !transaction.transaction_hash ||
        !["broadcast", "pending", "dropped"].includes(transaction.state)
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_REPLACEMENT_INVALID");
      }
      const plan = operation.plan_payload;
      const previousFee = {
        maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
        maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
      };
      validateLocalHelperUpgradeReplacement(
        plan,
        localHelperUpgradeReplacementCandidate(plan, previousFee),
        localHelperUpgradeReplacementCandidate(plan, input.fee),
      );
      const generation = transaction.generation + 1;
      const expiresAt = new Date(Math.min(Date.parse(plan.deadline), input.now.getTime() + 5 * 60_000));
      if (expiresAt <= input.now) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_PLAN_EXPIRED");
      }
      await client.query(
        `INSERT INTO local_helper_upgrade_replacement_authorizations (
           authorization_id, operation_id, replaced_transaction_id, generation,
           plan_digest, init_code_hash, target_version, nonce, owner_address,
           target_helper_address, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, reason, state, expires_at,
           created_at, consumed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'WalletHelperV2', $7, $8, $9,
                   $10, $11, $12, 'pending', $13, $14, NULL)`,
        [
          this.#uuid().toLowerCase(),
          operation.operation_id,
          transaction.transaction_id,
          generation,
          plan.planDigest,
          plan.transaction.dataHash,
          plan.nonce,
          plan.target.owner,
          plan.target.expectedAddress,
          input.fee.maxFeePerGasBaseUnit,
          input.fee.maxPriorityFeePerGasBaseUnit,
          bounded(input.reason, "FEE_BUMP"),
          expiresAt,
          input.now,
        ],
      );
      return {
        fee: structuredClone(input.fee),
        generation,
        operationId: operation.operation_id,
        plan: structuredClone(plan),
        planDigest: plan.planDigest,
        previousFee,
        reauthenticatedSessionId: operation.reauthenticated_session_id,
        replacedTransactionId: transaction.transaction_id,
        tenantId: operation.tenant_id,
        userId: operation.user_id,
      };
    });
  }

  async completeReplacement(input: {
    authorization: LocalHelperUpgradeReplacementAuthorization;
    deliveredAt: Date;
    result: LocalHelperUpgradeSignerResult;
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
        input.result.generation !== authorization.generation ||
        input.result.planDigest !== authorization.plan_digest
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_REPLACEMENT_INVALID");
      }
      const operation = await this.#lockOperation(client, authorization.operation_id);
      if (operation.active_transaction_id !== authorization.replaced_transaction_id) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_REPLACEMENT_INVALID");
      }
      const old = await this.#activeTransaction(client, operation);
      const transactionId = this.#uuid().toLowerCase();
      await client.query(
        `INSERT INTO local_helper_upgrade_transactions (
           transaction_id, operation_id, generation, state, active, nonce,
           plan_digest, init_code_hash, target_version, owner_address,
           target_helper_address, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, transaction_hash, delivery_id,
           replaces_transaction_id, replaced_by_transaction_id, replacement_reason,
           created_at, updated_at, signed_at, broadcast_at, confirmed_at
         ) VALUES ($1, $2, $3, 'broadcast', false, $4, $5, $6, 'WalletHelperV2',
                   $7, $8, $9, $10, $11, $12, $13, NULL, $14,
                   $15, $15, $15, $15, NULL)`,
        [
          transactionId,
          operation.operation_id,
          authorization.generation,
          operation.plan_payload.nonce,
          operation.plan_digest,
          operation.plan_payload.transaction.dataHash,
          operation.plan_payload.target.owner,
          operation.plan_payload.target.expectedAddress,
          authorization.max_fee_per_gas_base_unit,
          authorization.max_priority_fee_per_gas_base_unit,
          input.result.transactionHash,
          input.result.deliveryId,
          old.transaction_id,
          authorization.reason,
          input.deliveredAt,
        ],
      );
      await client.query(
        `UPDATE local_helper_upgrade_transactions
            SET active = false, state = 'replaced', replaced_by_transaction_id = $2,
                replacement_reason = $3, updated_at = $4
          WHERE transaction_id = $1 AND active`,
        [old.transaction_id, transactionId, authorization.reason, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_helper_upgrade_transactions SET active = true WHERE transaction_id = $1`,
        [transactionId],
      );
      await client.query(
        `UPDATE local_helper_upgrade_operations
            SET active_transaction_id = $2, failure_code = NULL, updated_at = $3
          WHERE operation_id = $1`,
        [operation.operation_id, transactionId, input.deliveredAt],
      );
      await client.query(
        `UPDATE local_helper_upgrade_replacement_authorizations
            SET state = 'consumed', consumed_at = $3
          WHERE authorization_id = $1 AND state = 'pending' AND generation = $2`,
        [authorization.authorization_id, authorization.generation, input.deliveredAt],
      );
      await this.#audit(
        client,
        operation,
        "helper-upgrade.replacement-broadcast",
        "REPLACED",
        input.deliveredAt,
        input.result.transactionHash,
      );
    });
  }

  async rejectReplacement(input: {
    authorization: LocalHelperUpgradeReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const operation = await this.#lockOperation(client, input.authorization.operationId);
      await client.query(
        `UPDATE local_helper_upgrade_replacement_authorizations
            SET state = 'cancelled'
          WHERE operation_id = $1 AND generation = $2 AND state = 'pending'`,
        [input.authorization.operationId, input.authorization.generation],
      );
      await this.#audit(
        client,
        operation,
        "helper-upgrade.replacement-failed",
        bounded(`${input.retryable ? "RETRYABLE_" : ""}${input.code}`, "REPLACEMENT_FAILED"),
        input.failedAt,
        null,
      );
    });
  }

  async #advance(
    client: PoolClient,
    claim: LocalHelperUpgradeWorkClaim,
    operation: OperationRow,
    next: Exclude<LocalHelperUpgradeWorkOperation["cursor"], "preflight">,
    when: Date,
  ): Promise<void> {
    if (operation.cursor === "completed") {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_CURSOR_CONFLICT");
    }
    assertLocalHelperUpgradeCursorTransition(operation.cursor, next);
    await client.query(
      `UPDATE local_helper_upgrade_steps
          SET state = 'succeeded', failure_code = NULL, updated_at = $3
        WHERE operation_id = $1 AND cursor = $2`,
      [operation.operation_id, operation.cursor, when],
    );
    const updated = await client.query(
      `UPDATE local_helper_upgrade_operations
          SET state = 'running', cursor = $2, failure_code = NULL, updated_at = $3
        WHERE operation_id = $1 AND cursor = $4 AND state IN ('queued', 'running')`,
      [operation.operation_id, next, when, operation.cursor],
    );
    if (updated.rowCount !== 1) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_CURSOR_CONFLICT");
    }
    await this.#finishClaim(client, claim, when, "delivered");
    await this.#enqueue(client, operation.operation_id, next, when);
    await this.#audit(
      client,
      operation,
      `helper-upgrade.${operation.cursor}-completed`,
      "SUCCEEDED",
      when,
      null,
    );
  }

  async #appendRescanEvidence(
    client: PoolClient,
    operation: OperationRow,
    snapshot: LocalHelperResidualSnapshot,
    decision: ReturnType<typeof localHelperV1SupersedeDecision>,
    observedAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_upgrade_final_rescan_evidence (
         evidence_id, operation_id, snapshot_digest, snapshot_payload,
         eligible_for_supersede, manual_recovery_required, blockers, observed_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)
       ON CONFLICT (operation_id, snapshot_digest) DO NOTHING`,
      [
        this.#uuid().toLowerCase(),
        operation.operation_id,
        snapshot.snapshotDigest,
        JSON.stringify(snapshot),
        decision.eligible,
        decision.manualRecoveryRequired,
        JSON.stringify(decision.blockers),
        observedAt,
      ],
    );
  }

  #rescanDecision(
    operation: OperationRow,
    snapshot: LocalHelperResidualSnapshot,
  ): ReturnType<typeof localHelperV1SupersedeDecision> {
    if (
      snapshot.snapshotDigest !== localHelperResidualSnapshotDigest(snapshot) ||
      snapshot.binding.bindingId !== operation.source_binding_id ||
      snapshot.binding.helperAddress !== operation.source_helper_address ||
      snapshot.wallet.walletId !== operation.wallet_id ||
      snapshot.wallet.address !== operation.plan_payload.wallet.address
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_RESCAN_IDENTITY_INVALID");
    }
    return localHelperV1SupersedeDecision(snapshot);
  }

  async #manualRecovery(
    client: PoolClient,
    claim: LocalHelperUpgradeWorkClaim,
    operation: OperationRow,
    blockers: readonly string[],
    when: Date,
  ): Promise<void> {
    const values = [...new Set(blockers.map((value) => bounded(value, "MANUAL_RECOVERY_REQUIRED")))].sort();
    if (values.length === 0) values.push("MANUAL_RECOVERY_REQUIRED");
    await client.query(
      `UPDATE local_helper_upgrade_steps
          SET state = 'manual-recovery-required', failure_code = 'MANUAL_RECOVERY_REQUIRED',
              updated_at = $3
        WHERE operation_id = $1 AND cursor = $2`,
      [operation.operation_id, operation.cursor, when],
    );
    await client.query(
      `UPDATE local_helper_upgrade_operations
          SET state = 'manual-recovery-required', failure_code = 'MANUAL_RECOVERY_REQUIRED',
              manual_recovery_blockers = $2::jsonb, updated_at = $3
        WHERE operation_id = $1`,
      [operation.operation_id, JSON.stringify(values), when],
    );
    await this.#finishClaim(client, claim, when, "delivered");
    await this.#audit(
      client,
      operation,
      "helper-upgrade.manual-recovery-required",
      "MANUAL_RECOVERY_REQUIRED",
      when,
      null,
    );
  }

  async #terminalFailure(
    client: PoolClient,
    claim: LocalHelperUpgradeWorkClaim,
    operation: OperationRow,
    code: string,
    when: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE local_helper_upgrade_steps
          SET state = 'failed', failure_code = $3, updated_at = $4
        WHERE operation_id = $1 AND cursor = $2`,
      [operation.operation_id, operation.cursor, code, when],
    );
    await client.query(
      `UPDATE local_helper_upgrade_operations
          SET state = 'failed', failure_code = $2,
              manual_recovery_blockers = '[]'::jsonb, updated_at = $3
        WHERE operation_id = $1`,
      [operation.operation_id, code, when],
    );
    await client.query(
      `UPDATE wallet_helper_deployment_bindings
          SET state = 'degraded', failure_code = $2, updated_at = $3
        WHERE upgrade_operation_id = $1 AND state = 'deploying'`,
      [operation.operation_id, code, when],
    );
    await this.#finishClaim(client, claim, when, "dead", code);
    await this.#audit(client, operation, "helper-upgrade.failed", code, when, null);
  }

  async #loadOperation(client: PoolClient, operationId: string): Promise<LocalHelperUpgradeWorkOperation> {
    const operationResult = await client.query<OperationRow>(
      `SELECT ${operationColumns} FROM local_helper_upgrade_operations
        WHERE operation_id = $1`,
      [operationId],
    );
    const operation = operationResult.rows[0];
    if (
      !operation ||
      operation.cursor === "completed" ||
      (operation.state !== "queued" && operation.state !== "running")
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_RECOVERY_STATE_INVALID");
    }
    validateLocalHelperUpgradeWorkPlan(
      operation.plan_payload,
      new Date(Date.parse(operation.plan_payload.deadline) - 1),
    );
    if (
      operation.plan_payload.planDigest !== operation.plan_digest ||
      localHelperUpgradePlanDigest(operation.plan_payload) !== operation.plan_digest
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_RECOVERY_PLAN_INVALID");
    }
    const [transactions, verification, finalSnapshot] = await Promise.all([
      client.query<TransactionRow>(
        `SELECT transaction_id::text, generation, state, active,
                max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
                transaction_hash, updated_at
           FROM local_helper_upgrade_transactions WHERE operation_id = $1
          ORDER BY generation, transaction_id`,
        [operationId],
      ),
      client.query<{ verification_payload: WalletHelperV2Verification }>(
        `SELECT verification_payload FROM local_helper_upgrade_v2_verification_evidence
          WHERE operation_id = $1 ORDER BY observed_at DESC, evidence_id DESC LIMIT 1`,
        [operationId],
      ),
      client.query<{ snapshot_payload: LocalHelperResidualSnapshot }>(
        `SELECT snapshot_payload FROM local_helper_upgrade_final_rescan_evidence
          WHERE operation_id = $1 AND eligible_for_supersede
          ORDER BY observed_at DESC, evidence_id DESC LIMIT 1`,
        [operationId],
      ),
    ]);
    return {
      cursor: operation.cursor,
      finalSnapshot: finalSnapshot.rows[0]?.snapshot_payload ?? null,
      operationId: operation.operation_id,
      plan: structuredClone(operation.plan_payload),
      planDigest: operation.plan_digest,
      reauthenticatedSessionId: operation.reauthenticated_session_id,
      state: operation.state,
      sweepBatchId: operation.sweep_batch_id,
      tenantId: operation.tenant_id,
      transactions: transactions.rows.map((transaction) => ({
        active: transaction.active,
        generation: transaction.generation,
        maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
        maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
        state: transaction.state,
        transactionHash: transaction.transaction_hash,
        transactionId: transaction.transaction_id,
        updatedAt: transaction.updated_at.toISOString(),
      })),
      userId: operation.user_id,
      verification: verification.rows[0]?.verification_payload ?? null,
    };
  }

  async #lockOperation(client: PoolClient, operationId: string): Promise<OperationRow> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns} FROM local_helper_upgrade_operations
        WHERE operation_id = $1 FOR UPDATE`,
      [operationId],
    );
    if (!result.rows[0]) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_NOT_FOUND");
    }
    return result.rows[0];
  }

  async #lockClaim(client: PoolClient, claim: LocalHelperUpgradeWorkClaim): Promise<EventRow> {
    const result = await client.query<EventRow>(
      `SELECT event_id::text, operation_id::text, cursor, state, attempt_count,
              lease_token::text
         FROM local_helper_upgrade_outbox WHERE event_id = $1 FOR UPDATE`,
      [claim.outboxEventId],
    );
    const event = result.rows[0];
    if (
      !event ||
      event.state !== "leased" ||
      event.operation_id !== claim.operation.operationId ||
      event.cursor !== claim.operation.cursor ||
      event.lease_token !== claim.leaseToken
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LEASE_LOST", true);
    }
    return event;
  }

  async #activeTransaction(client: PoolClient, operation: OperationRow): Promise<TransactionRow> {
    if (!operation.active_transaction_id) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_ACTIVE_TRANSACTION_MISSING");
    }
    const result = await client.query<TransactionRow>(
      `SELECT transaction_id::text, generation, state, active,
              max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
              transaction_hash, updated_at
         FROM local_helper_upgrade_transactions
        WHERE transaction_id = $1 AND operation_id = $2 FOR UPDATE`,
      [operation.active_transaction_id, operation.operation_id],
    );
    if (!result.rows[0] || !result.rows[0].active) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_ACTIVE_TRANSACTION_MISSING");
    }
    return result.rows[0];
  }

  async #lockAuthorization(
    client: PoolClient,
    operationId: string,
    generation: number,
  ): Promise<AuthorizationRow> {
    const result = await client.query<AuthorizationRow>(
      `SELECT authorization_id::text, operation_id::text, replaced_transaction_id::text,
              generation, plan_digest, init_code_hash, target_version, nonce::text,
              owner_address, target_helper_address, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, reason, state, expires_at
         FROM local_helper_upgrade_replacement_authorizations
        WHERE operation_id = $1 AND generation = $2 FOR UPDATE`,
      [operationId, generation],
    );
    if (!result.rows[0]) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_REPLACEMENT_INVALID");
    }
    return result.rows[0];
  }

  async #enqueue(
    client: PoolClient,
    operationId: string,
    cursor: LocalHelperUpgradeWorkOperation["cursor"],
    when: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_upgrade_outbox (
         event_id, operation_id, cursor, event_type, state, attempt_count,
         available_at, created_at
       ) VALUES ($1, $2, $3, 'helper-upgrade.cursor-ready', 'pending', 0, $4, $4)`,
      [this.#uuid().toLowerCase(), operationId, cursor, when],
    );
  }

  async #rescheduleClaim(
    client: PoolClient,
    claim: LocalHelperUpgradeWorkClaim,
    when: Date,
    delay: number,
  ): Promise<void> {
    await client.query(
      `UPDATE local_helper_upgrade_outbox
          SET state = 'pending', available_at = $2, lease_owner = NULL,
              lease_token = NULL, lease_expires_at = NULL
        WHERE event_id = $1 AND state = 'leased'`,
      [claim.outboxEventId, new Date(when.getTime() + delay)],
    );
  }

  async #finishClaim(
    client: PoolClient,
    claim: LocalHelperUpgradeWorkClaim,
    when: Date,
    state: "dead" | "delivered",
    code: string | null = null,
  ): Promise<void> {
    await client.query(
      `UPDATE local_helper_upgrade_outbox
          SET state = $2, delivered_at = CASE WHEN $2 = 'delivered' THEN $3 ELSE NULL END,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              last_error_code = $4
        WHERE event_id = $1 AND state = 'leased'`,
      [claim.outboxEventId, state, when, code],
    );
  }

  async #liveExternalOperationIds(
    client: PoolClient,
    operation: OperationRow,
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
          AND operation_id <> $4 AND state IN ('queued', 'running', 'manual-recovery-required')`,
      [operation.tenant_id, operation.user_id, operation.wallet_id, operation.operation_id],
    );
    return result.rows.map(({ operation_id }) => operation_id);
  }

  #assertVerification(plan: LocalHelperUpgradePlan, verification: WalletHelperV2Verification): void {
    assertWalletHelperV2Verification(verification, {
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
  }

  async #audit(
    client: PoolClient,
    operation: OperationRow,
    action: string,
    resultCode: string,
    when: Date,
    transactionHash: `0x${string}` | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO local_helper_upgrade_audit_events (
         tenant_id, actor_user_id, session_id, operation_id, wallet_id,
         cursor, state, action, result_code, transaction_hash, plan_digest, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        operation.tenant_id,
        operation.user_id,
        operation.reauthenticated_session_id,
        operation.operation_id,
        operation.wallet_id,
        operation.cursor,
        operation.state,
        action,
        bounded(resultCode, "UNKNOWN"),
        transactionHash,
        operation.plan_digest,
        when,
      ],
    );
  }

  async #transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
    isolation: "READ COMMITTED" | "SERIALIZABLE" = "READ COMMITTED",
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const value = await callback(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await rollback(client);
      if (["40001", "40P01"].includes((error as { code?: string }).code ?? "")) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SERIALIZATION_RETRY", true, {
          cause: error,
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
