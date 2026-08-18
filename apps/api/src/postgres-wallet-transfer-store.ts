import { createHash, randomUUID } from "node:crypto";

import type {
  EvmAddress,
  WalletTransferAddressClassification,
  WalletTransferState,
  WalletTransferTransactionView,
} from "@lpbot/api-contract";
import {
  canonicalBaseUnit,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "@lpbot/domain/wallet-transfer";
import type { Pool, PoolClient } from "pg";

import {
  walletTransferIdempotencyRetentionHours,
  WalletTransferError,
  type StoredWalletTransferOperation,
  type WalletTransferCreateInput,
  type WalletTransferCreateResult,
  type WalletTransferIdempotencyRecord,
  type WalletTransferNonceView,
  type WalletTransferOperationStore,
} from "./wallet-transfers.js";

interface OperationRow {
  active_transaction_id: string | null;
  address_classification: WalletTransferAddressClassification;
  amount_base_unit: string;
  asset_kind: "erc20" | "native";
  chain_id: string;
  created_at: Date;
  failure_code: string | null;
  fee_cap_base_unit: string;
  fencing_token: string | null;
  gas_limit: string;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string | null;
  operation_id: string;
  plan_deadline: Date | null;
  plan_digest: `sha256:${string}`;
  policy_digest: `sha256:${string}`;
  recipient: EvmAddress;
  reconciliation_reason: string | null;
  request_hash: `sha256:${string}`;
  security_password_version: string | null;
  state: WalletTransferState;
  token_address: EvmAddress | null;
  transaction_data: `0x${string}` | null;
  transaction_target: EvmAddress | null;
  transaction_value_base_unit: string | null;
  updated_at: Date;
  user_id: string;
  wallet_address: EvmAddress;
  wallet_id: string;
}

interface TransactionRow {
  active: boolean;
  created_at: Date;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  replaced_by_transaction_id: string | null;
  replaces_transaction_id: string | null;
  state: WalletTransferTransactionView["state"];
  transaction_hash: `0x${string}` | null;
  transaction_id: string;
}

interface LedgerRow {
  fencing_token: string;
  last_confirmed_nonce: string | null;
  next_nonce: string | null;
}

const operationColumns = `
  operation_id::text, user_id::text, wallet_id::text, chain_id::text, state,
  address_classification, asset_kind, token_address, recipient, wallet_address,
  amount_base_unit::text, nonce::text, fencing_token::text,
  transaction_target, transaction_value_base_unit::text, transaction_data,
  gas_limit::text, max_fee_per_gas_base_unit::text,
  max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text,
  request_hash, plan_digest, policy_digest, plan_deadline,
  security_password_version::text, active_transaction_id::text,
  failure_code, reconciliation_reason, created_at, updated_at`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function approvalPlanDigest(previewDigest: string): `sha256:${string}` {
  return `sha256:${sha256(`wallet-transfer-approval/v1\n${previewDigest}`)}`;
}

function databaseRetryable(error: unknown): boolean {
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

function transaction(row: TransactionRow): WalletTransferTransactionView {
  return {
    active: row.active,
    createdAt: row.created_at.toISOString(),
    generation: row.generation,
    maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
    maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
    nonce: row.nonce,
    replacedByTransactionId: row.replaced_by_transaction_id,
    replacesTransactionId: row.replaces_transaction_id,
    state: row.state,
    transactionHash: row.transaction_hash,
    transactionId: row.transaction_id,
  };
}

function plan(row: OperationRow): WalletTransferPlan | null {
  if (
    row.nonce === null ||
    row.fencing_token === null ||
    row.transaction_target === null ||
    row.transaction_value_base_unit === null ||
    row.transaction_data === null ||
    row.plan_deadline === null
  ) {
    return null;
  }
  return {
    amountBaseUnit: row.amount_base_unit,
    asset:
      row.asset_kind === "native"
        ? { kind: "native" }
        : { kind: "erc20", tokenAddress: row.token_address! },
    chainId: Number(row.chain_id),
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
}

function operation(
  row: OperationRow,
  transactions: WalletTransferTransactionView[],
): StoredWalletTransferOperation {
  const transferPlan = plan(row);
  if (transferPlan) validateWalletTransferPlan(transferPlan, new Date(0));
  const chainId = Number(row.chain_id);
  const securityPasswordVersion =
    row.security_password_version === null ? null : Number(row.security_password_version);
  if (
    !Number.isSafeInteger(chainId) ||
    chainId < 1 ||
    (securityPasswordVersion !== null &&
      (!Number.isSafeInteger(securityPasswordVersion) || securityPasswordVersion < 1))
  ) {
    throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
  }
  return {
    activeTransactionId: row.active_transaction_id,
    addressClassification: row.address_classification,
    amountBaseUnit: row.amount_base_unit,
    asset:
      row.asset_kind === "native"
        ? { kind: "native" }
        : { kind: "erc20", tokenAddress: row.token_address! },
    chainId,
    createdAt: row.created_at.toISOString(),
    failureCode: row.failure_code,
    feeLimit: {
      feeCapBaseUnit: row.fee_cap_base_unit,
      gasLimit: row.gas_limit,
      maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
      maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
    },
    fencingToken: row.fencing_token,
    nonce: row.nonce,
    operationId: row.operation_id,
    plan: transferPlan,
    planDigest: row.plan_digest,
    policyDigest: row.policy_digest,
    recipient: row.recipient,
    reconciliationReason: row.reconciliation_reason,
    requestHash: row.request_hash,
    securityPasswordVersion,
    state: row.state,
    transactions,
    updatedAt: row.updated_at.toISOString(),
    userId: row.user_id,
    walletId: row.wallet_id,
  };
}

function nonceDecision(
  ledger: LedgerRow,
  views: readonly WalletTransferNonceView[],
):
  | { kind: "reconciling"; reason: string }
  | { fencingToken: string; kind: "reserved"; nonce: string; nextNonce: string } {
  if (views.length < 1) return { kind: "reconciling", reason: "NONCE_PROVIDER_UNAVAILABLE" };
  let parsed: Array<{ latest: bigint; pending: bigint }>;
  try {
    parsed = views.map((view) => ({
      latest: BigInt(canonicalBaseUnit(view.latest)),
      pending: BigInt(canonicalBaseUnit(view.pending)),
    }));
  } catch {
    return { kind: "reconciling", reason: "NONCE_PROVIDER_INVALID" };
  }
  if (
    new Set(parsed.map(({ latest }) => latest.toString())).size !== 1 ||
    new Set(parsed.map(({ pending }) => pending.toString())).size !== 1
  ) {
    return { kind: "reconciling", reason: "NONCE_PROVIDER_DIVERGENCE" };
  }
  const latest = parsed[0]!.latest;
  const pending = parsed[0]!.pending;
  if (pending < latest) return { kind: "reconciling", reason: "NONCE_PENDING_BEHIND_LATEST" };
  const nextNonce = ledger.next_nonce === null ? pending : BigInt(ledger.next_nonce);
  if (pending > nextNonce) return { kind: "reconciling", reason: "NONCE_GAP_DETECTED" };
  if (latest > nextNonce) {
    return { kind: "reconciling", reason: "NONCE_LEDGER_BEHIND_LATEST" };
  }
  const fencingToken = BigInt(ledger.fencing_token) + 1n;
  return {
    fencingToken: fencingToken.toString(),
    kind: "reserved",
    nextNonce: (nextNonce + 1n).toString(),
    nonce: nextNonce.toString(),
  };
}

export class PostgresWalletTransferOperationStore implements WalletTransferOperationStore {
  readonly #now: () => Date;
  readonly #pool: Pool;
  readonly #uuid: () => string;

  constructor(pool: Pool, input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#pool = pool;
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    commandType: "wallet.transfer";
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferIdempotencyRecord | null> {
    const result = await this.#pool.query<OperationRow & { idempotency_request_hash: `sha256:${string}` }>(
      `SELECT ${operationColumns}, i.request_hash AS idempotency_request_hash
         FROM wallet_transfer_idempotency i
         JOIN wallet_transfer_operations o ON o.operation_id = i.operation_id
        WHERE i.user_id = $1 AND i.command_type = $2
          AND i.wallet_id = $3 AND i.idempotency_key = $4`,
      [input.userId, input.commandType, input.walletId, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      operation: operation(row, await this.#transactions(row.operation_id)),
      requestHash: row.idempotency_request_hash,
    };
  }

  async get(input: {
    operationId: string;
    userId: string;
  }): Promise<StoredWalletTransferOperation | null> {
    const result = await this.#pool.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM wallet_transfer_operations
        WHERE operation_id = $1 AND user_id = $2`,
      [input.operationId, input.userId],
    );
    const row = result.rows[0];
    return row ? operation(row, await this.#transactions(row.operation_id)) : null;
  }

  async create(input: WalletTransferCreateInput): Promise<WalletTransferCreateResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#createOnce(input);
      } catch (error) {
        if (uniqueViolation(error)) {
          const existing = await this.findIdempotency({
            commandType: "wallet.transfer",
            idempotencyKey: input.idempotencyKey,
            userId: input.userId,
            walletId: input.walletId,
          });
          if (!existing) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true, { cause: error });
          if (existing.requestHash !== input.requestHash) {
            throw new WalletTransferError("IDEMPOTENCY_CONFLICT");
          }
          return { kind: "duplicate", operation: existing.operation };
        }
        if (!databaseRetryable(error) || attempt === 2) throw error;
      }
    }
    throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
  }

  async #createOnce(input: WalletTransferCreateInput): Promise<WalletTransferCreateResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const existing = await client.query<{ operation_id: string; request_hash: `sha256:${string}` }>(
        `SELECT operation_id::text, request_hash
           FROM wallet_transfer_idempotency
          WHERE user_id = $1 AND command_type = 'wallet.transfer'
            AND wallet_id = $2 AND idempotency_key = $3
          FOR UPDATE`,
        [input.userId, input.walletId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== input.requestHash) {
          throw new WalletTransferError("IDEMPOTENCY_CONFLICT");
        }
        const operation = await this.#load(client, existing.rows[0].operation_id, input.userId);
        if (!operation) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { kind: "duplicate", operation };
      }

      const operationId = this.#uuid().toLowerCase();
      const eventId = this.#uuid().toLowerCase();
      const now = this.#now();
      let nonce: string | null = null;
      let fencingToken: string | null = null;
      let transferPlan: WalletTransferPlan | null = null;
      let reconciliationReason: string | null = null;
      let state: WalletTransferState =
        input.executionMode === "approval-required" ? "ready-for-approval" : "queued";

      if (input.executionMode === "local-auto") {
        await client.query(
          `INSERT INTO wallet_nonce_ledgers (
             chain_id, wallet_id, next_nonce, last_confirmed_nonce,
             fencing_token, reconciliation_reason, created_at, updated_at
           ) VALUES ($1, $2, NULL, NULL, 0, NULL, $3, $3)
           ON CONFLICT (chain_id, wallet_id) DO NOTHING`,
          [input.chainId, input.walletId, now],
        );
        const ledgerResult = await client.query<LedgerRow>(
          `SELECT next_nonce::text, last_confirmed_nonce::text, fencing_token::text
             FROM wallet_nonce_ledgers
            WHERE chain_id = $1 AND wallet_id = $2
            FOR UPDATE`,
          [input.chainId, input.walletId],
        );
        const ledger = ledgerResult.rows[0];
        if (!ledger) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
        const decision = nonceDecision(ledger, input.nonceViews);
        if (decision.kind === "reconciling") {
          state = "reconciling";
          reconciliationReason = decision.reason;
          await client.query(
            `UPDATE wallet_nonce_ledgers
                SET reconciliation_reason = $3, updated_at = $4
              WHERE chain_id = $1 AND wallet_id = $2`,
            [input.chainId, input.walletId, decision.reason, now],
          );
        } else {
          nonce = decision.nonce;
          fencingToken = decision.fencingToken;
          await client.query(
            `UPDATE wallet_nonce_ledgers
                SET next_nonce = $3, fencing_token = $4,
                    reconciliation_reason = NULL, updated_at = $5
              WHERE chain_id = $1 AND wallet_id = $2`,
            [input.chainId, input.walletId, decision.nextNonce, decision.fencingToken, now],
          );
          transferPlan = input.buildPlan({ fencingToken, nonce, operationId });
          validateWalletTransferPlan(transferPlan, now);
        }
      }

      const planDigest = transferPlan
        ? walletTransferPlanDigest(transferPlan)
        : approvalPlanDigest(input.previewDigest);
      await client.query(
        `INSERT INTO wallet_transfer_operations (
           operation_id, user_id, wallet_id, chain_id, state, address_classification,
           asset_kind, token_address, recipient, wallet_address, amount_base_unit,
           nonce, fencing_token, transaction_target, transaction_value_base_unit,
           transaction_data, gas_limit, max_fee_per_gas_base_unit,
           max_priority_fee_per_gas_base_unit, fee_cap_base_unit,
           preview_digest, request_hash, plan_digest, policy_digest,
           registry_version, policy_version, plan_deadline, security_password_version,
           active_transaction_id, failure_code, reconciliation_reason, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18,
           $19, $20,
           $21, $22, $23, $24,
           $25, $26, $27, $28,
           NULL, NULL, $29, $30, $30
         )`,
        [
          operationId,
          input.userId,
          input.walletId,
          input.chainId,
          state,
          input.addressClassification,
          input.asset.kind,
          input.asset.kind === "erc20" ? input.asset.tokenAddress : null,
          input.recipient,
          input.walletAddress,
          input.amountBaseUnit,
          nonce,
          fencingToken,
          transferPlan?.transactionTarget ?? null,
          transferPlan?.transactionValueBaseUnit ?? null,
          transferPlan?.transactionData ?? null,
          input.feeLimit.gasLimit,
          input.feeLimit.maxFeePerGasBaseUnit,
          input.feeLimit.maxPriorityFeePerGasBaseUnit,
          input.feeLimit.feeCapBaseUnit,
          input.previewDigest,
          input.requestHash,
          planDigest,
          input.policyDigest,
          input.registryVersion,
          input.policyVersion,
          transferPlan?.deadline ?? null,
          input.securityPasswordVersion,
          reconciliationReason,
          now,
        ],
      );
      await client.query(
        `INSERT INTO wallet_transfer_idempotency (
           user_id, command_type, wallet_id, idempotency_key,
           request_hash, operation_id, created_at, expires_at
         ) VALUES ($1, 'wallet.transfer', $2, $3, $4, $5, $6, $7)`,
        [
          input.userId,
          input.walletId,
          input.idempotencyKey,
          input.requestHash,
          operationId,
          now,
          new Date(now.getTime() + walletTransferIdempotencyRetentionHours * 60 * 60 * 1_000),
        ],
      );
      const eventType =
        state === "queued"
          ? "wallet-transfer.queued"
          : state === "ready-for-approval"
            ? "wallet-transfer.ready-for-approval"
            : "wallet-transfer.reconciling";
      await client.query(
        `INSERT INTO wallet_transfer_outbox (
           event_id, aggregate_id, event_type, payload, state,
           attempt_count, available_at, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, 'pending', 0, $5, $5)`,
        [
          eventId,
          operationId,
          eventType,
          JSON.stringify({
            chainId: input.chainId,
            operationId,
            state,
            walletId: input.walletId,
          }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO wallet_transfer_audit_events (
           actor_user_id, session_id, operation_id, wallet_id, chain_id,
           nonce, transaction_hash, plan_digest, state, action,
           outcome, result_code, request_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8,
                   'transfer.submitted', 'allowed', $9, $10, $11)`,
        [
          input.userId,
          input.sessionId,
          operationId,
          input.walletId,
          input.chainId,
          nonce,
          planDigest,
          state,
          state === "reconciling" ? reconciliationReason : "ACCEPTED",
          input.requestId,
          now,
        ],
      );
      if (nonce !== null) {
        await client.query(
          `INSERT INTO wallet_transfer_audit_events (
             actor_user_id, session_id, operation_id, wallet_id, chain_id,
             nonce, transaction_hash, plan_digest, state, action,
             outcome, result_code, request_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8,
                     'transfer.nonce-reserved', 'allowed', 'RESERVED', $9, $10)`,
          [
            input.userId,
            input.sessionId,
            operationId,
            input.walletId,
            input.chainId,
            nonce,
            planDigest,
            state,
            input.requestId,
            now,
          ],
        );
      }
      if (reconciliationReason) {
        await client.query(
          `INSERT INTO wallet_transfer_reconciliation_cases (
             reconciliation_id, operation_id, chain_id, wallet_id,
             reason, status, provider_evidence_digest, opened_at, resolved_at
           ) VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, NULL)`,
          [
            this.#uuid().toLowerCase(),
            operationId,
            input.chainId,
            input.walletId,
            reconciliationReason,
            `sha256:${sha256(JSON.stringify(input.nonceViews))}`,
            now,
          ],
        );
      }
      const stored = await this.#load(client, operationId, input.userId);
      if (!stored) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
      await client.query("COMMIT");
      return { kind: "created", operation: stored };
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
    userId: string,
  ): Promise<StoredWalletTransferOperation | null> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM wallet_transfer_operations
        WHERE operation_id = $1 AND user_id = $2`,
      [operationId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const transactions = await client.query<TransactionRow>(
      `SELECT transaction_id::text, active, created_at, generation,
              max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
              nonce::text, replaced_by_transaction_id::text, replaces_transaction_id::text,
              state, transaction_hash
         FROM wallet_transfer_transactions
        WHERE operation_id = $1
        ORDER BY generation, transaction_id`,
      [operationId],
    );
    return operation(row, transactions.rows.map(transaction));
  }

  async #transactions(operationId: string): Promise<WalletTransferTransactionView[]> {
    const result = await this.#pool.query<TransactionRow>(
      `SELECT transaction_id::text, active, created_at, generation,
              max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
              nonce::text, replaced_by_transaction_id::text, replaces_transaction_id::text,
              state, transaction_hash
         FROM wallet_transfer_transactions
        WHERE operation_id = $1
        ORDER BY generation, transaction_id`,
      [operationId],
    );
    return result.rows.map(transaction);
  }
}
