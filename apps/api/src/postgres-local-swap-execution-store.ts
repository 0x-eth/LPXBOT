import { createHash, randomUUID } from "node:crypto";

import type { LocalSwapOperationStep, LocalSwapStepTransactionView } from "@lpbot/api-contract";
import type { LocalSwapQuote } from "@lpbot/chain-adapters";
import { localSwapExecutionPlanDigest, type LocalSwapExecutionPlan } from "@lpbot/domain/local-swap-execution";
import type { Pool, PoolClient } from "pg";

import {
  LocalSwapExecutionError,
  localSwapIdempotencyRetentionHours,
  type LocalSwapHelperBinding,
  type LocalSwapHelperBindingStore,
  type LocalSwapIdempotencyRecord,
  type LocalSwapNonceView,
  type LocalSwapOperationStore,
  type LocalSwapPreviewStore,
  type LocalSwapQuoteStore,
  type StoredLocalSwapOperation,
  type StoredLocalSwapPreview,
} from "./local-swap-executions.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

function retryableDatabaseError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
  return code === "40001" || code === "40P01";
}

function consensusNonce(views: readonly LocalSwapNonceView[]): bigint {
  if (views.length < 1 || views.length > 4) {
    throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
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
      throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providers.add(view.providerId);
    identities.add(`${view.latest}:${view.pending}`);
  }
  if (identities.size !== 1) {
    throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return BigInt(views[0]!.pending);
}

export class PostgresLocalSwapQuoteStore implements LocalSwapQuoteStore {
  constructor(readonly pool: Pool) {}

  async append(input: { quote: Readonly<LocalSwapQuote>; tenantId: string; userId: string }): Promise<void> {
    const quote = input.quote;
    await this.pool.query(
      `INSERT INTO local_swap_quote_snapshots (
         tenant_id, user_id, wallet_id, wallet_address, chain_id, quote_digest,
         quote_version, registry_version, registry_digest, token_in, token_out,
         amount_in_base_unit, amount_out_base_unit, min_out_base_unit, slippage_bps,
         service_fee_bps, observed_block_number, observed_block_hash, max_block_number,
         quoted_at, expires_at, deadline, execution_enabled, quote_payload
       ) VALUES (
         $1, $2, $3, $4, 31337, $5, $6, $7, $8, $9, $10,
         $11::numeric, $12::numeric, $13::numeric, $14, 0, $15::numeric, $16,
         $17::numeric, $18, $19, $20, true, $21::jsonb
       ) ON CONFLICT (tenant_id, user_id, wallet_id, quote_digest) DO NOTHING`,
      [
        input.tenantId,
        input.userId,
        quote.walletId,
        quote.walletAddress,
        quote.quoteDigest,
        quote.quoteVersion,
        quote.registryVersion,
        quote.registryDigest,
        quote.tokenIn,
        quote.tokenOut,
        quote.amountInBaseUnit,
        quote.amountOutBaseUnit,
        quote.minOutBaseUnit,
        quote.slippageBps,
        quote.blockNumber,
        quote.blockHash,
        quote.maxBlockNumber,
        quote.quotedAt,
        quote.expiresAt,
        quote.deadline,
        JSON.stringify(quote),
      ],
    );
  }

  async get(input: {
    quoteDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalSwapQuote> | null> {
    const result = await this.pool.query<{ quote_payload: LocalSwapQuote }>(
      `SELECT quote_payload
         FROM local_swap_quote_snapshots
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND quote_digest = $4`,
      [input.tenantId, input.userId, input.walletId, input.quoteDigest],
    );
    return result.rows[0] ? structuredClone(result.rows[0].quote_payload) : null;
  }
}

export class PostgresLocalSwapPreviewStore implements LocalSwapPreviewStore {
  constructor(readonly pool: Pool) {}

  async get(token: string): Promise<StoredLocalSwapPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const result = await this.pool.query<{
      created_at: Date;
      facts_payload: StoredLocalSwapPreview["facts"];
      preview_digest: `sha256:${string}`;
      request_payload: StoredLocalSwapPreview["request"];
      tenant_id: string;
      token_digest: string;
      user_id: string;
    }>(
      `SELECT token_digest, tenant_id, user_id::text, preview_digest,
              request_payload, facts_payload, created_at
         FROM local_swap_execution_previews
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

  async put(preview: StoredLocalSwapPreview): Promise<void> {
    await this.pool.query(
      `INSERT INTO local_swap_execution_previews (
         token_digest, tenant_id, user_id, wallet_id, quote_digest, preview_digest,
         request_payload, facts_payload, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (token_digest) DO NOTHING`,
      [
        preview.tokenDigest,
        preview.tenantId,
        preview.userId,
        preview.request.walletId,
        preview.request.quoteDigest,
        preview.previewDigest,
        JSON.stringify(preview.request),
        JSON.stringify(preview.facts),
        preview.createdAt,
        preview.facts.expiresAt,
      ],
    );
  }
}

export class PostgresLocalSwapHelperBindingStore implements LocalSwapHelperBindingStore {
  constructor(readonly pool: Pool) {}

  async getActive(input: { tenantId: string; userId: string; walletId: string }): Promise<LocalSwapHelperBinding | null> {
    const result = await this.pool.query<{
      adapter_address: LocalSwapHelperBinding["adapterAddress"];
      binding_id: string;
      helper_address: LocalSwapHelperBinding["helperAddress"];
      helper_version: "WalletHelperV1";
      owner_address: LocalSwapHelperBinding["ownerAddress"];
      permit2_address: LocalSwapHelperBinding["permit2Address"];
      registry_version: "p05-local-helper-deployment-v2";
      runtime_code_hash: LocalSwapHelperBinding["runtimeCodeHash"];
      verified_block_number: string;
      wallet_id: string;
    }>(
      `SELECT binding_id::text, wallet_id::text, helper_version, helper_address,
              owner_address, adapter_address, permit2_address, runtime_code_hash,
              registry_version, verified_block_number::text
         FROM wallet_helper_deployment_bindings
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
          AND chain_id = 31337 AND helper_version = 'WalletHelperV1' AND state = 'active'`,
      [input.tenantId, input.userId, input.walletId],
    );
    const row = result.rows[0];
    return row
      ? {
          adapterAddress: row.adapter_address,
          bindingId: row.binding_id,
          chainId: 31_337,
          helperAddress: row.helper_address,
          helperVersion: row.helper_version,
          ownerAddress: row.owner_address,
          permit2Address: row.permit2_address,
          registryVersion: row.registry_version,
          runtimeCodeHash: row.runtime_code_hash,
          state: "active",
          verifiedBlockNumber: row.verified_block_number,
          walletId: row.wallet_id,
        }
      : null;
  }
}

interface OperationRow {
  authorization_mode: StoredLocalSwapOperation["authorizationMode"];
  created_at: Date;
  failure_code: string | null;
  helper_address: StoredLocalSwapOperation["helperAddress"];
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalSwapExecutionPlan;
  preview_digest: `sha256:${string}`;
  quote_digest: `sha256:${string}`;
  reauthenticated_session_id: string;
  reconciliation_reason: string | null;
  registry_version: StoredLocalSwapOperation["registryVersion"];
  request_hash: `sha256:${string}`;
  state: StoredLocalSwapOperation["state"];
  tenant_id: string;
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
  state: LocalSwapOperationStep["state"];
  step_id: string;
  step_kind: LocalSwapOperationStep["kind"];
}

interface TransactionRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  state: LocalSwapStepTransactionView["state"];
  transaction_hash: `0x${string}` | null;
}

const operationColumns = `
  o.operation_id::text, o.tenant_id, o.user_id::text, o.wallet_id::text,
  o.state, o.authorization_mode, o.quote_digest, o.helper_address,
  o.registry_version, o.preview_digest, o.request_hash, o.plan_digest,
  o.plan_payload, o.reauthenticated_session_id::text, o.failure_code,
  o.reconciliation_reason, o.created_at, o.updated_at`;

export class PostgresLocalSwapOperationStore implements LocalSwapOperationStore {
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
  }): Promise<LocalSwapIdempotencyRecord | null> {
    const result = await this.pool.query<OperationRow & { idempotency_hash: `sha256:${string}` }>(
      `SELECT ${operationColumns}, i.request_hash AS idempotency_hash
         FROM local_swap_operation_idempotency i
         JOIN local_swap_operations o ON o.operation_id = i.operation_id
        WHERE i.tenant_id = $1 AND i.user_id = $2 AND i.wallet_id = $3
          AND i.command_type = 'swap.execute' AND i.idempotency_key = $4`,
      [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? { operation: await this.#operation(this.pool, row), requestHash: row.idempotency_hash }
      : null;
  }

  async get(input: { operationId: string; tenantId: string; userId: string }): Promise<StoredLocalSwapOperation | null> {
    const result = await this.pool.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM local_swap_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [input.operationId, input.tenantId, input.userId],
    );
    return result.rows[0] ? this.#operation(this.pool, result.rows[0]) : null;
  }

  async create(input: Parameters<LocalSwapOperationStore["create"]>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#createOnce(input);
      } catch (error) {
        if (error instanceof LocalSwapExecutionError) throw error;
        if (uniqueViolation(error)) {
          const duplicate = await this.findIdempotency(input);
          if (duplicate) {
            if (duplicate.requestHash !== input.requestHash) {
              throw new LocalSwapExecutionError("IDEMPOTENCY_CONFLICT");
            }
            return { kind: "duplicate" as const, operation: duplicate.operation };
          }
          throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true, { cause: error });
        }
        if (!retryableDatabaseError(error) || attempt === 2) {
          throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true, { cause: error });
        }
      }
    }
    throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
  }

  async #createOnce(input: Parameters<LocalSwapOperationStore["create"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const duplicate = await client.query<{ operation_id: string; request_hash: `sha256:${string}` }>(
        `SELECT operation_id::text, request_hash
           FROM local_swap_operation_idempotency
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND command_type = 'swap.execute' AND idempotency_key = $4
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== input.requestHash) {
          throw new LocalSwapExecutionError("IDEMPOTENCY_CONFLICT");
        }
        const loaded = await this.#load(client, duplicate.rows[0].operation_id, input);
        if (!loaded) throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { kind: "duplicate" as const, operation: loaded };
      }

      const wallet = await client.query<{ address_lower: string; lifecycle_status: string; lock_status: string }>(
        `SELECT address_lower, lifecycle_status, lock_status
           FROM custody_wallets
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId],
      );
      const walletRow = wallet.rows[0];
      if (!walletRow || walletRow.address_lower !== input.walletAddress) {
        throw new LocalSwapExecutionError("WALLET_NOT_FOUND");
      }
      if (walletRow.lifecycle_status !== "active" || walletRow.lock_status !== "ready") {
        throw new LocalSwapExecutionError("WALLET_LOCKED");
      }
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
      if (!ledger) throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
      const providerNonce = consensusNonce(input.nonceViews);
      const nextNonce = ledger.next_nonce === null ? providerNonce : BigInt(ledger.next_nonce);
      if (providerNonce !== BigInt(input.expectedNonce) || nextNonce !== BigInt(input.expectedNonce)) {
        throw new LocalSwapExecutionError("NONCE_DRIFT");
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
        [input.walletId, (nextNonce + BigInt(reservations.length)).toString(), fencingToken.toString(), now],
      );
      const operationId = this.#uuid().toLowerCase();
      const plan = input.buildPlan({ operationId, reservations });
      if (
        plan.operationId !== operationId ||
        plan.wallet.walletId !== input.walletId ||
        plan.wallet.address !== input.walletAddress ||
        plan.quote.quoteDigest !== input.quoteDigest ||
        plan.steps.length !== reservations.length ||
        plan.planDigest !== localSwapExecutionPlanDigest(plan) ||
        plan.steps.some(
          (step, index) =>
            step.stepId !== reservations[index]!.stepId ||
            step.nonce !== reservations[index]!.nonce ||
            step.fencingToken !== reservations[index]!.fencingToken ||
            step.kind !== reservations[index]!.kind,
        )
      ) {
        throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
      }
      const binding = await client.query<{ binding_id: string }>(
        `SELECT binding_id::text
           FROM wallet_helper_deployment_bindings
          WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4
            AND chain_id = 31337 AND state = 'active' AND helper_version = 'WalletHelperV1'
            AND helper_address = $5 AND owner_address = $6 AND adapter_address = $7
            AND permit2_address = $8 AND runtime_code_hash = $9
            AND registry_version = 'p05-local-helper-deployment-v2'
          FOR UPDATE`,
        [
          plan.helper.bindingId,
          input.tenantId,
          input.userId,
          input.walletId,
          plan.helper.address,
          plan.helper.owner,
          plan.helper.adapter,
          plan.helper.permit2,
          plan.helper.runtimeCodeHash,
        ],
      );
      if (!binding.rows[0]) throw new LocalSwapExecutionError("HELPER_BINDING_MISMATCH");
      await client.query(
        `INSERT INTO local_swap_operations (
           operation_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
           operation_kind, state, authorization_mode, quote_digest, helper_binding_id,
           helper_address, helper_plan_digest, registry_version, registry_digest,
           preview_digest, request_hash, plan_digest, plan_deadline, plan_payload,
           reauthenticated_session_id, failure_code, reconciliation_reason, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 31337, 'local-swap', 'queued', $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, NULL, NULL, $19, $19)`,
        [
          operationId,
          input.tenantId,
          input.userId,
          input.walletId,
          input.walletAddress,
          plan.authorization.mode,
          input.quoteDigest,
          plan.helper.bindingId,
          plan.helper.address,
          plan.helperPlanDigest,
          plan.registry.version,
          plan.registry.digest,
          input.previewDigest,
          input.requestHash,
          plan.planDigest,
          plan.deadline,
          JSON.stringify(plan),
          input.sessionId,
          now,
        ],
      );
      for (const [ordinal, step] of plan.steps.entries()) {
        await client.query(
          `INSERT INTO local_swap_operation_steps (
             step_id, operation_id, tenant_id, user_id, wallet_id, chain_id,
             ordinal, step_kind, run_condition, state, nonce, fencing_token,
             semantic_digest, transaction_to, transaction_value_base_unit,
             transaction_data, transaction_data_digest, gas_limit,
             max_fee_per_gas_base_unit, max_priority_fee_per_gas_base_unit,
             fee_cap_base_unit, active_transaction_id, failure_code, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, 31337, $6, $7, $8, $9, $10, $11, $12, $13,
             0, $14, $15, $16, $17, $18, $19, NULL, NULL, $20, $20)`,
          [
            step.stepId,
            operationId,
            input.tenantId,
            input.userId,
            input.walletId,
            ordinal,
            step.kind,
            step.runCondition,
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
        `INSERT INTO local_swap_operation_idempotency (
           tenant_id, user_id, wallet_id, command_type, idempotency_key,
           request_hash, operation_id, created_at, expires_at
         ) VALUES ($1, $2, $3, 'swap.execute', $4, $5, $6, $7, $8)`,
        [
          input.tenantId,
          input.userId,
          input.walletId,
          input.idempotencyKey,
          input.requestHash,
          operationId,
          now,
          new Date(now.getTime() + localSwapIdempotencyRetentionHours * 60 * 60 * 1_000),
        ],
      );
      await client.query(
        `INSERT INTO local_swap_operation_outbox (
           event_id, aggregate_id, step_id, event_type, payload, state,
           attempt_count, available_at, created_at
         ) VALUES ($1, $2, $3, 'local-swap.queued', $4::jsonb, 'pending', 0, $5, $5)`,
        [
          this.#uuid().toLowerCase(),
          operationId,
          plan.steps[0]!.stepId,
          JSON.stringify({ chainId: 31_337, operationId, state: "queued", walletId: input.walletId }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO local_swap_audit_events (
           tenant_id, actor_user_id, session_id, operation_id, step_id, wallet_id,
           nonce, transaction_hash, plan_digest, action, outcome, result_code,
           request_id, created_at
         ) VALUES ($1, $2, $3, $4, NULL, $5, NULL, NULL, $6,
                   'swap.submitted', 'allowed', 'ACCEPTED', $7, $8)`,
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
      if (!stored) throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
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
  ): Promise<StoredLocalSwapOperation | null> {
    const result = await client.query<OperationRow>(
      `SELECT ${operationColumns}
         FROM local_swap_operations o
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [operationId, owner.tenantId, owner.userId],
    );
    return result.rows[0] ? this.#operation(client, result.rows[0]) : null;
  }

  async #operation(
    client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    row: OperationRow,
  ): Promise<StoredLocalSwapOperation> {
    const plan = row.plan_payload;
    if (
      plan.planDigest !== row.plan_digest ||
      localSwapExecutionPlanDigest(plan) !== row.plan_digest ||
      plan.operationId !== row.operation_id ||
      plan.wallet.walletId !== row.wallet_id ||
      plan.quote.quoteDigest !== row.quote_digest
    ) {
      throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
    }
    const stepsResult = await client.query<StepRow>(
      `SELECT step_id::text, ordinal, step_kind, state, nonce::text, failure_code,
              gas_limit::text, max_fee_per_gas_base_unit::text,
              max_priority_fee_per_gas_base_unit::text, fee_cap_base_unit::text
         FROM local_swap_operation_steps
        WHERE operation_id = $1 ORDER BY ordinal`,
      [row.operation_id],
    );
    const steps: LocalSwapOperationStep[] = [];
    for (const step of stepsResult.rows) {
      const transactions = await client.query<TransactionRow>(
        `SELECT active, generation, state, transaction_hash,
                max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text
           FROM local_swap_step_transactions
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
      throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
    }
    return {
      authorizationMode: row.authorization_mode,
      chainId: 31_337,
      createdAt: row.created_at.toISOString(),
      failureCode: row.failure_code,
      helperAddress: row.helper_address,
      operationId: row.operation_id,
      operationKind: "local-swap",
      plan,
      planDigest: row.plan_digest,
      previewDigest: row.preview_digest,
      quoteDigest: row.quote_digest,
      reconciliationReason: row.reconciliation_reason,
      registryVersion: row.registry_version,
      requestHash: row.request_hash,
      sessionId: row.reauthenticated_session_id,
      state: row.state,
      steps,
      tenantId: row.tenant_id,
      updatedAt: row.updated_at.toISOString(),
      userId: row.user_id,
      walletId: row.wallet_id,
    };
  }
}
