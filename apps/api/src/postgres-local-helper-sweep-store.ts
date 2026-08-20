import { createHash, randomUUID } from "node:crypto";

import {
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  type LocalHelperSweepRegistry,
} from "@lpbot/chain-registry";
import {
  localHelperResidualSnapshotDigest,
  localHelperSweepPlanDigest,
  validateLocalHelperResidualSnapshot,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepBinding,
  type LocalHelperSweepPlan,
} from "@lpbot/domain/local-helper-sweep";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  LocalHelperSweepError,
  type LocalHelperResidualSnapshotStore,
  type LocalHelperSweepBindingStore,
  type LocalHelperSweepOperationStore,
  type LocalHelperSweepPreviewStore,
  type StoredLocalHelperSweepBatch,
  type StoredLocalHelperSweepOperation,
  type StoredLocalHelperSweepPreview,
} from "./local-helper-sweeps.js";

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

interface SnapshotRow extends QueryResultRow {
  idempotency_key: string;
  observed_at: Date;
  snapshot_payload: LocalHelperResidualSnapshot;
}

interface PreviewRow extends QueryResultRow {
  created_at: Date;
  facts_payload: StoredLocalHelperSweepPreview["facts"];
  preview_digest: `sha256:${string}`;
  request_payload: StoredLocalHelperSweepPreview["request"];
  tenant_id: string;
  token_digest: string;
  user_id: string;
}

interface BatchRow extends QueryResultRow {
  batch_id: string;
  chain_id: number;
  created_at: Date;
  helper_address: `0x${string}`;
  preview_digest: `sha256:${string}`;
  request_hash: `sha256:${string}`;
  reauthenticated_session_id: string;
  registry_version: "p05-local-helper-sweep-v2";
  snapshot_digest: `sha256:${string}`;
  state: StoredLocalHelperSweepBatch["state"];
  tenant_id: string;
  updated_at: Date;
  user_id: string;
  wallet_id: string;
}

interface OperationRow extends QueryResultRow {
  amount_base_unit: string;
  asset_id: string;
  asset_kind: "native" | "token";
  batch_id: string;
  chain_id: number;
  created_at: Date;
  dust_base_unit: string;
  failure_code: string | null;
  fee_cap_base_unit: string;
  gas_limit: string;
  helper_address: `0x${string}`;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  nonce: string;
  operation_id: string;
  plan_digest: `sha256:${string}`;
  plan_payload: LocalHelperSweepPlan;
  preview_digest: `sha256:${string}`;
  recipient: `0x${string}`;
  reconciliation_reason: string | null;
  reauthenticated_session_id: string;
  request_hash: `sha256:${string}`;
  snapshot_digest: `sha256:${string}`;
  state: StoredLocalHelperSweepOperation["state"];
  tenant_id: string;
  token_address: `0x${string}` | null;
  updated_at: Date;
  user_id: string;
  wallet_id: string;
}

interface TransactionRow extends QueryResultRow {
  active: boolean;
  generation: number;
  max_fee_per_gas_base_unit: string;
  max_priority_fee_per_gas_base_unit: string;
  operation_id: string;
  state: StoredLocalHelperSweepOperation["transactions"][number]["state"];
  transaction_hash: `0x${string}` | null;
}

const bindingColumns = `
  binding_id::text, wallet_id::text, helper_version, state, helper_address,
  owner_address, adapter_address, permit2_address, runtime_code_hash,
  registry_version, verified_block_number::text`;

function bindingFrom(row: BindingRow): LocalHelperSweepBinding {
  if (!row.verified_block_number) throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
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

export class PostgresLocalHelperSweepBindingStore implements LocalHelperSweepBindingStore {
  constructor(readonly pool: Pool) {}

  async get(input: { tenantId: string; userId: string; walletId: string }) {
    const result = await this.pool.query<BindingRow>(
      `SELECT ${bindingColumns}
         FROM wallet_helper_deployment_bindings
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
          AND chain_id = 31337 AND helper_version = 'WalletHelperV1'
          AND state IN ('active', 'degraded')
        ORDER BY (state = 'active') DESC, updated_at DESC, binding_id DESC
        LIMIT 1`,
      [input.tenantId, input.userId, input.walletId],
    );
    return result.rows[0] ? bindingFrom(result.rows[0]) : null;
  }

  async transition(input: Parameters<LocalHelperSweepBindingStore["transition"]>[0]) {
    const result = await this.pool.query<BindingRow>(
      `UPDATE wallet_helper_deployment_bindings
          SET state = $5, failure_code = $6, verified_block_number = $7::numeric,
              updated_at = clock_timestamp()
        WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4
          AND chain_id = 31337 AND helper_version = 'WalletHelperV1'
          AND state IN ('active', 'degraded')
          AND ($5 <> 'active' OR NOT EXISTS (
            SELECT 1 FROM local_helper_sweep_batches batch
             WHERE batch.helper_binding_id = wallet_helper_deployment_bindings.binding_id
               AND batch.state IN ('queued', 'running', 'reconciling')
          ))
        RETURNING ${bindingColumns}`,
      [
        input.bindingId,
        input.tenantId,
        input.userId,
        input.walletId,
        input.state,
        input.failureCode,
        input.verifiedBlockNumber,
      ],
    );
    if (!result.rows[0]) throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
    return bindingFrom(result.rows[0]);
  }
}

export class PostgresLocalHelperResidualSnapshotStore
  implements LocalHelperResidualSnapshotStore
{
  readonly #registry: LocalHelperSweepRegistry;

  constructor(
    readonly pool: Pool,
    input: { registry?: LocalHelperSweepRegistry } = {},
  ) {
    this.#registry = input.registry ?? P05_LOCAL_HELPER_SWEEP_REGISTRY;
  }

  async append(input: Parameters<LocalHelperResidualSnapshotStore["append"]>[0]) {
    const snapshot = input.snapshot;
    const inserted = await this.pool.query<SnapshotRow>(
      `INSERT INTO local_helper_residual_snapshots (
         tenant_id, user_id, wallet_id, binding_id, chain_id, helper_address,
         owner_address, runtime_code_hash, binding_state, idempotency_key,
         block_number, block_hash, block_timestamp, observed_at, expires_at,
         snapshot_version, snapshot_digest, registry_version, registry_digest,
         coverage_complete, manual_recovery_required, snapshot_payload
       ) VALUES (
         $1, $2, $3, $4, 31337, $5, $6, $7, $8, $9, $10::numeric, $11, $12,
         $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb
       )
       ON CONFLICT (tenant_id, user_id, wallet_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key, observed_at, snapshot_payload`,
      [
        input.tenantId,
        input.userId,
        snapshot.wallet.walletId,
        snapshot.binding.bindingId,
        snapshot.binding.helperAddress,
        snapshot.binding.ownerAddress,
        snapshot.binding.runtimeCodeHash,
        snapshot.binding.state,
        input.idempotencyKey,
        snapshot.block.number,
        snapshot.block.hash,
        snapshot.block.timestamp,
        snapshot.observedAt,
        snapshot.expiresAt,
        snapshot.snapshotVersion,
        snapshot.snapshotDigest,
        snapshot.registry.version,
        snapshot.registry.digest,
        snapshot.coverage.complete,
        snapshot.manualRecoveryRequired,
        JSON.stringify(snapshot),
      ],
    );
    if (inserted.rows[0]) return this.#snapshot(inserted.rows[0]);
    const existing = await this.findIdempotency({
      idempotencyKey: input.idempotencyKey,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: snapshot.wallet.walletId,
    });
    if (!existing) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
    return existing;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT idempotency_key, observed_at, snapshot_payload
         FROM local_helper_residual_snapshots
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND idempotency_key = $4`,
      [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
    );
    return result.rows[0] ? this.#snapshot(result.rows[0]) : null;
  }

  async get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT idempotency_key, observed_at, snapshot_payload
         FROM local_helper_residual_snapshots
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND snapshot_digest = $4`,
      [input.tenantId, input.userId, input.walletId, input.snapshotDigest],
    );
    return result.rows[0] ? this.#snapshot(result.rows[0]) : null;
  }

  async latest(input: { tenantId: string; userId: string; walletId: string }) {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT idempotency_key, observed_at, snapshot_payload
         FROM local_helper_residual_snapshots
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
        ORDER BY observed_at DESC, snapshot_id DESC LIMIT 1`,
      [input.tenantId, input.userId, input.walletId],
    );
    return result.rows[0] ? this.#snapshot(result.rows[0]) : null;
  }

  #snapshot(row: SnapshotRow): LocalHelperResidualSnapshot {
    const snapshot = structuredClone(row.snapshot_payload);
    const binding = snapshot.binding;
    if (snapshot.snapshotDigest !== localHelperResidualSnapshotDigest(snapshot)) {
      throw new LocalHelperSweepError("REGISTRY_MISMATCH");
    }
    validateLocalHelperResidualSnapshot(
      snapshot,
      {
        binding,
        nativeDustBaseUnit: this.#registry.dustPolicy.nativeDustBaseUnit,
        registryDigest: this.#registry.registryDigest,
        registryVersion: this.#registry.registryVersion,
        tokenPolicy: this.#registry.tokens,
        wallet: snapshot.wallet,
      },
      row.observed_at,
    );
    return snapshot;
  }
}

export class PostgresLocalHelperSweepPreviewStore implements LocalHelperSweepPreviewStore {
  constructor(readonly pool: Pool) {}

  async get(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const tokenDigest = createDigest(token);
    const result = await this.pool.query<PreviewRow>(
      `SELECT token_digest, tenant_id, user_id::text, preview_digest,
              request_payload, facts_payload, created_at
         FROM local_helper_sweep_previews WHERE token_digest = $1`,
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

  async put(preview: StoredLocalHelperSweepPreview): Promise<void> {
    await this.pool.query(
      `INSERT INTO local_helper_sweep_previews (
         token_digest, tenant_id, user_id, wallet_id, snapshot_digest,
         preview_digest, request_payload, facts_payload, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
       ON CONFLICT (token_digest) DO NOTHING`,
      [
        preview.tokenDigest,
        preview.tenantId,
        preview.userId,
        preview.request.walletId,
        preview.request.snapshotDigest,
        preview.previewDigest,
        JSON.stringify(preview.request),
        JSON.stringify(preview.facts),
        preview.createdAt,
        preview.facts.expiresAt,
      ],
    );
  }
}

function createDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function consensusNonce(views: readonly { latest: string; pending: string }[]): bigint {
  if (views.length < 1 || views.length > 4) {
    throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const values = new Set<string>();
  for (const view of views) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(view.latest) || !/^(?:0|[1-9][0-9]*)$/u.test(view.pending)) {
      throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    if (BigInt(view.pending) < BigInt(view.latest)) {
      throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    values.add(`${view.latest}:${view.pending}`);
  }
  if (values.size !== 1) throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
  return BigInt(views[0]!.pending);
}

export class PostgresLocalHelperSweepOperationStore implements LocalHelperSweepOperationStore {
  readonly #now: () => Date;
  readonly #uuid: () => string;

  constructor(
    readonly pool: Pool,
    input: { now?: () => Date; uuid?: () => string } = {},
  ) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async create(input: Parameters<LocalHelperSweepOperationStore["create"]>[0]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#createOnce(input);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if ((code === "40001" || code === "40P01") && attempt < 2) continue;
        throw error;
      }
    }
    throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
  }

  async getBatch(input: { batchId: string; tenantId: string; userId: string }) {
    return this.#load(this.pool, input.batchId, input);
  }

  async getOperation(input: { operationId: string; tenantId: string; userId: string }) {
    const result = await this.pool.query<{ batch_id: string }>(
      `SELECT batch_id::text FROM local_helper_sweep_operations
        WHERE operation_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [input.operationId, input.tenantId, input.userId],
    );
    const batchId = result.rows[0]?.batch_id;
    if (!batchId) return null;
    const batch = await this.#load(this.pool, batchId, input);
    return batch?.operations.find(({ operationId }) => operationId === input.operationId) ?? null;
  }

  async #createOnce(input: Parameters<LocalHelperSweepOperationStore["create"]>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const duplicate = await client.query<{ batch_id: string; request_hash: string }>(
        `SELECT batch_id::text, request_hash FROM local_helper_sweep_batches
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND idempotency_key = $4
          FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId, input.idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].request_hash !== input.requestHash) {
          throw new LocalHelperSweepError("IDEMPOTENCY_CONFLICT");
        }
        const batch = await this.#load(client, duplicate.rows[0].batch_id, input);
        if (!batch) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
        await client.query("COMMIT");
        return { batch, kind: "duplicate" as const };
      }

      const walletResult = await client.query<{
        address_lower: string;
        lifecycle_status: string;
        lock_status: string;
      }>(
        `SELECT address_lower, lifecycle_status, lock_status FROM custody_wallets
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 FOR UPDATE`,
        [input.tenantId, input.userId, input.walletId],
      );
      const wallet = walletResult.rows[0];
      if (!wallet || wallet.address_lower !== input.walletAddress) {
        throw new LocalHelperSweepError("WALLET_NOT_FOUND");
      }
      if (wallet.lifecycle_status !== "active" || wallet.lock_status !== "ready") {
        throw new LocalHelperSweepError("WALLET_LOCKED");
      }
      const snapshotResult = await client.query<{
        binding_id: string;
        helper_address: `0x${string}`;
        manual_recovery_required: boolean;
      }>(
        `SELECT binding_id::text, helper_address, manual_recovery_required
           FROM local_helper_residual_snapshots
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND snapshot_digest = $4 FOR SHARE`,
        [input.tenantId, input.userId, input.walletId, input.snapshotDigest],
      );
      const snapshot = snapshotResult.rows[0];
      if (!snapshot) throw new LocalHelperSweepError("SNAPSHOT_NOT_FOUND");
      if (snapshot.manual_recovery_required) {
        throw new LocalHelperSweepError("MANUAL_RECOVERY_REQUIRED");
      }
      if (snapshot.helper_address !== input.helperAddress) {
        throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
      }
      const bindingResult = await client.query<BindingRow>(
        `SELECT ${bindingColumns} FROM wallet_helper_deployment_bindings
          WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4
            AND state = 'degraded' FOR UPDATE`,
        [snapshot.binding_id, input.tenantId, input.userId, input.walletId],
      );
      const binding = bindingResult.rows[0] ? bindingFrom(bindingResult.rows[0]) : null;
      if (!binding || binding.helperAddress !== input.helperAddress) {
        throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
      }
      const live = await client.query(
        `SELECT 1 FROM local_helper_sweep_batches
          WHERE chain_id = 31337 AND wallet_id = $1
            AND state IN ('queued', 'running', 'reconciling') FOR UPDATE`,
        [input.walletId],
      );
      if (live.rows[0]) throw new LocalHelperSweepError("BATCH_IN_PROGRESS");
      const replay = await client.query(
        `SELECT 1 FROM local_helper_sweep_operations
          WHERE wallet_id = $1 AND snapshot_digest = $2 AND asset_id = ANY($3::text[])
            AND state = 'succeeded' LIMIT 1`,
        [input.walletId, input.snapshotDigest, input.assetIds],
      );
      if (replay.rows[0]) throw new LocalHelperSweepError("ASSET_ALREADY_CONFIRMED");

      const now = this.#now();
      await client.query(
        `INSERT INTO wallet_nonce_ledgers (
           chain_id, wallet_id, next_nonce, last_confirmed_nonce, fencing_token,
           reconciliation_reason, created_at, updated_at
         ) VALUES (31337, $1, NULL, NULL, 0, NULL, $2, $2)
         ON CONFLICT (chain_id, wallet_id) DO NOTHING`,
        [input.walletId, now],
      );
      const ledgerResult = await client.query<{ fencing_token: string; next_nonce: string | null }>(
        `SELECT next_nonce::text, fencing_token::text FROM wallet_nonce_ledgers
          WHERE chain_id = 31337 AND wallet_id = $1 FOR UPDATE`,
        [input.walletId],
      );
      const ledger = ledgerResult.rows[0];
      if (!ledger) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
      const providerNonce = consensusNonce(input.nonceViews);
      const nextNonce = ledger.next_nonce === null ? providerNonce : BigInt(ledger.next_nonce);
      if (providerNonce !== BigInt(input.expectedNonce) || nextNonce !== BigInt(input.expectedNonce)) {
        throw new LocalHelperSweepError("NONCE_DRIFT");
      }
      let fencingToken = BigInt(ledger.fencing_token);
      const reservations = input.assetIds.map((_, ordinal) => ({
        fencingToken: (++fencingToken).toString(),
        nonce: (nextNonce + BigInt(ordinal)).toString(),
        operationId: this.#uuid().toLowerCase(),
        ordinal,
      }));
      const batchId = this.#uuid().toLowerCase();
      const plans = [...input.buildPlans({ batchId, reservations })];
      if (
        plans.length !== input.assetIds.length ||
        plans.some(
          (plan, index) =>
            plan.batchId !== batchId ||
            plan.operationId !== reservations[index]!.operationId ||
            plan.nonce !== reservations[index]!.nonce ||
            plan.fencingToken !== reservations[index]!.fencingToken ||
            plan.asset.assetId !== input.assetIds[index] ||
            plan.wallet.walletId !== input.walletId ||
            plan.wallet.address !== input.walletAddress ||
            plan.helper.bindingId !== binding.bindingId ||
            plan.helper.helperAddress !== binding.helperAddress ||
            plan.snapshot.digest !== input.snapshotDigest ||
            plan.planDigest !== localHelperSweepPlanDigest(plan),
        )
      ) {
        throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
      }
      await client.query(
        `UPDATE wallet_nonce_ledgers
            SET next_nonce = $2::numeric, fencing_token = $3::bigint,
                reconciliation_reason = NULL, updated_at = $4
          WHERE chain_id = 31337 AND wallet_id = $1`,
        [
          input.walletId,
          (nextNonce + BigInt(reservations.length)).toString(),
          fencingToken.toString(),
          now,
        ],
      );
      await client.query(
        `INSERT INTO local_helper_sweep_batches (
           batch_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
           helper_binding_id, helper_address, state, snapshot_digest, registry_version,
           registry_digest, preview_digest, request_hash, idempotency_key,
           reauthenticated_session_id, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 31337, $6, $7, 'queued', $8,
           'p05-local-helper-sweep-v2', $9, $10, $11, $12, $13, $14, $14
         )`,
        [
          batchId,
          input.tenantId,
          input.userId,
          input.walletId,
          input.walletAddress,
          binding.bindingId,
          binding.helperAddress,
          input.snapshotDigest,
          plans[0]!.registry.digest,
          input.previewDigest,
          input.requestHash,
          input.idempotencyKey,
          input.sessionId,
          now,
        ],
      );
      for (const [ordinal, plan] of plans.entries()) {
        await client.query(
          `INSERT INTO local_helper_sweep_operations (
             operation_id, batch_id, tenant_id, user_id, wallet_id, chain_id, ordinal,
             operation_kind, state, asset_id, asset_kind, token_address, amount_base_unit,
             dust_base_unit, helper_address, recipient, snapshot_digest, nonce, fencing_token,
             semantic_digest, transaction_to, transaction_value_base_unit,
             transaction_selector, transaction_data, transaction_data_digest, gas_limit,
             max_fee_per_gas_base_unit, max_priority_fee_per_gas_base_unit,
             fee_cap_base_unit, plan_digest, plan_deadline, plan_payload,
             created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, 31337, $6, 'helper-residual-sweep', 'queued',
             $7, $8, $9, $10::numeric, $11::numeric, $12, $13, $14,
             $15::numeric, $16::bigint, $17, $18, 0, $19, $20, $21,
             $22::numeric, $23::numeric, $24::numeric, $25::numeric,
             $26, $27, $28::jsonb, $29, $29
           )`,
          [
            plan.operationId,
            batchId,
            input.tenantId,
            input.userId,
            input.walletId,
            ordinal,
            plan.asset.assetId,
            plan.asset.kind,
            plan.asset.tokenAddress,
            plan.asset.amountBaseUnit,
            plan.asset.dustBaseUnit,
            plan.helper.helperAddress,
            plan.recipient,
            plan.snapshot.digest,
            plan.nonce,
            plan.fencingToken,
            plan.semanticDigest,
            plan.transaction.to,
            plan.transaction.selector,
            plan.transaction.data,
            plan.transaction.dataDigest,
            plan.feeLimit.gasLimit,
            plan.feeLimit.maxFeePerGasBaseUnit,
            plan.feeLimit.maxPriorityFeePerGasBaseUnit,
            plan.feeLimit.feeCapBaseUnit,
            plan.planDigest,
            plan.deadline,
            JSON.stringify(plan),
            now,
          ],
        );
        await client.query(
          `INSERT INTO local_helper_sweep_outbox (
             event_id, batch_id, operation_id, event_type, payload, state,
             attempt_count, available_at, created_at
           ) VALUES ($1, $2, $3, 'helper-sweep.operation-queued', $4::jsonb,
             'pending', 0, $5, $5)`,
          [
            this.#uuid().toLowerCase(),
            batchId,
            plan.operationId,
            JSON.stringify({
              assetId: plan.asset.assetId,
              batchId,
              chainId: 31_337,
              operationId: plan.operationId,
              state: "queued",
              walletId: input.walletId,
            }),
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO local_helper_sweep_audit_events (
           tenant_id, actor_user_id, session_id, batch_id, wallet_id, chain_id,
           action, outcome, result_code, request_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, 31337,
           'helper-sweep.submit', 'allowed', 'QUEUED', $6, $7)`,
        [
          input.tenantId,
          input.userId,
          input.sessionId,
          batchId,
          input.walletId,
          input.requestId,
          now,
        ],
      );
      const batch = await this.#load(client, batchId, input);
      if (!batch) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true);
      await client.query("COMMIT");
      return { batch, kind: "created" as const };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #load(
    query: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    batchId: string,
    owner: { tenantId: string; userId: string },
  ): Promise<StoredLocalHelperSweepBatch | null> {
    const batchResult = await query.query<BatchRow>(
      `SELECT batch_id::text, tenant_id, user_id::text, wallet_id::text,
              chain_id::integer, helper_address, state, snapshot_digest,
              registry_version, preview_digest, request_hash,
              reauthenticated_session_id::text, created_at, updated_at
         FROM local_helper_sweep_batches
        WHERE batch_id = $1 AND tenant_id = $2 AND user_id = $3`,
      [batchId, owner.tenantId, owner.userId],
    );
    const batch = batchResult.rows[0];
    if (!batch) return null;
    const operationResult = await query.query<OperationRow>(
      `SELECT o.operation_id::text, o.batch_id::text, o.tenant_id, o.user_id::text,
              o.wallet_id::text, o.chain_id::integer, o.state, o.asset_id, o.asset_kind,
              o.token_address, o.amount_base_unit::text, o.dust_base_unit::text,
              o.helper_address, o.recipient, o.snapshot_digest, o.nonce::text,
              o.gas_limit::text, o.max_fee_per_gas_base_unit::text,
              o.max_priority_fee_per_gas_base_unit::text, o.fee_cap_base_unit::text,
              o.plan_digest, o.plan_payload, o.failure_code, o.reconciliation_reason,
              o.created_at, o.updated_at, b.preview_digest, b.request_hash,
              b.reauthenticated_session_id::text
         FROM local_helper_sweep_operations o
         JOIN local_helper_sweep_batches b ON b.batch_id = o.batch_id
        WHERE o.batch_id = $1 ORDER BY o.ordinal`,
      [batchId],
    );
    const transactionResult = await query.query<TransactionRow>(
      `SELECT operation_id::text, generation, state, active,
              max_fee_per_gas_base_unit::text, max_priority_fee_per_gas_base_unit::text,
              transaction_hash
         FROM local_helper_sweep_transactions
        WHERE batch_id = $1 ORDER BY operation_id, generation`,
      [batchId],
    );
    const transactions = new Map<string, TransactionRow[]>();
    for (const transaction of transactionResult.rows) {
      const values = transactions.get(transaction.operation_id) ?? [];
      values.push(transaction);
      transactions.set(transaction.operation_id, values);
    }
    const operations = operationResult.rows.map((row): StoredLocalHelperSweepOperation => {
      const plan = structuredClone(row.plan_payload);
      if (plan.planDigest !== row.plan_digest || localHelperSweepPlanDigest(plan) !== row.plan_digest) {
        throw new LocalHelperSweepError("REGISTRY_MISMATCH");
      }
      return {
        amountBaseUnit: row.amount_base_unit,
        assetId: row.asset_id,
        assetKind: row.asset_kind,
        batchId: row.batch_id,
        chainId: 31_337,
        createdAt: row.created_at.toISOString(),
        failureCode: row.failure_code,
        feeLimit: {
          feeCapBaseUnit: row.fee_cap_base_unit,
          gasLimit: row.gas_limit,
          maxFeePerGasBaseUnit: row.max_fee_per_gas_base_unit,
          maxPriorityFeePerGasBaseUnit: row.max_priority_fee_per_gas_base_unit,
        },
        helperAddress: row.helper_address,
        nonce: row.nonce,
        operationId: row.operation_id,
        operationKind: "helper-residual-sweep",
        plan,
        planDigest: row.plan_digest,
        previewDigest: row.preview_digest,
        recipient: row.recipient,
        reconciliationReason: row.reconciliation_reason,
        registryVersion: "p05-local-helper-sweep-v2",
        requestHash: row.request_hash,
        sessionId: row.reauthenticated_session_id,
        snapshotDigest: row.snapshot_digest,
        state: row.state,
        tenantId: row.tenant_id,
        tokenAddress: row.token_address,
        transactions: (transactions.get(row.operation_id) ?? []).map((transaction) => ({
          active: transaction.active,
          generation: transaction.generation,
          maxFeePerGasBaseUnit: transaction.max_fee_per_gas_base_unit,
          maxPriorityFeePerGasBaseUnit: transaction.max_priority_fee_per_gas_base_unit,
          state: transaction.state,
          transactionHash: transaction.transaction_hash,
        })),
        updatedAt: row.updated_at.toISOString(),
        userId: row.user_id,
        walletId: row.wallet_id,
      };
    });
    return {
      batchId: batch.batch_id,
      chainId: 31_337,
      createdAt: batch.created_at.toISOString(),
      helperAddress: batch.helper_address,
      operations,
      registryVersion: batch.registry_version,
      requestHash: batch.request_hash,
      sessionId: batch.reauthenticated_session_id,
      snapshotDigest: batch.snapshot_digest,
      state: batch.state,
      tenantId: batch.tenant_id,
      updatedAt: batch.updated_at.toISOString(),
      userId: batch.user_id,
      walletId: batch.wallet_id,
    };
  }
}
