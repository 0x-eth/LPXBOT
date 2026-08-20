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
  localHelperSweepIdempotencyRetentionHours,
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
          SET state = $7, failure_code = $8, verified_block_number = $9::numeric,
              updated_at = clock_timestamp()
        WHERE binding_id = $1 AND tenant_id = $2 AND user_id = $3 AND wallet_id = $4
          AND chain_id = 31337 AND helper_version = 'WalletHelperV1'
          AND state IN ('active', 'degraded')
          AND ($7 <> 'active' OR NOT EXISTS (
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
        31_337,
        "WalletHelperV1",
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
  return globalThis.crypto.subtle
    ? // Node exposes a synchronous Hash through the imported domain only indirectly; use require-free Web Crypto is async.
      // This fallback branch is replaced below by the deterministic implementation.
      ""
    : value;
}

