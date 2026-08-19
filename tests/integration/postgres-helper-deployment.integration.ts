import { randomUUID } from "node:crypto";

import {
  HelperDeploymentService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  type HelperDeploymentChainReader,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresHelperDeploymentPlanAuthorizer,
  type HelperDeploymentPlanChainVerifier,
} from "../../apps/signer/src/index.js";
import {
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const now = new Date();
const tenantId = "tenant-fixture-01";
const userId = "9d000000-0000-4000-8000-000000000001";
const walletId = "9d000000-0000-4000-8000-000000000011";
const sessionId = "9d000000-0000-4000-8000-000000000021";
const walletAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;

class ChainFixture implements HelperDeploymentChainReader {
  nonce = "7";
  runtimeHash = `0x${"91".repeat(32)}` as `0x${string}`;

  async nonceSnapshot() {
    return {
      blockHash: `0x${"81".repeat(32)}` as const,
      blockNumber: "7",
      blockTimestamp: now.toISOString(),
      chainId: 31_337,
      views: [
        { latest: this.nonce, pending: this.nonce, providerId: "anvil-a" },
        { latest: this.nonce, pending: this.nonce, providerId: "anvil-b" },
      ],
    };
  }

  async inspectDeployment() {
    return {
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
        runtimeCodeHash: component.runtimeCodeHash,
      })),
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: this.runtimeHash,
      feeLimit: {
        feeCapBaseUnit: "2400000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      tokenCode: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

class SignerChainFixture implements HelperDeploymentPlanChainVerifier {
  adapterHash = helperDeploymentComponent("adapter").runtimeCodeHash;
  expectedAddressCode: `0x${string}` = "0x";

  async verify(plan: Parameters<HelperDeploymentPlanChainVerifier["verify"]>[0]) {
    return {
      blockNumber: "7",
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
        runtimeCodeHash:
          component.role === "adapter" ? this.adapterHash : component.runtimeCodeHash,
      })),
      expectedAddressCode: this.expectedAddressCode,
      expectedRuntimeCodeHash: plan.deployment.expectedRuntimeCodeHash,
      tokenCode: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Helper deployment fixture', $2, $2)`,
    [userId, now],
  );
  await new PostgresCustodyWalletStore(pool).create({
    auditAction: "wallet.import",
    envelope: {
      aadVersion: 1,
      algorithm: "AES-256-GCM",
      ciphertext: Buffer.alloc(32, 1),
      createdAt: now,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "local-v1",
      nonce: Buffer.alloc(12, 2),
      tag: Buffer.alloc(16, 3),
      wrappedDek: Buffer.alloc(60, 4),
    },
    wallet: {
      address: walletAddress,
      addressLower: walletAddress,
      createdAt: now,
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "Helper deployment fixture",
      revision: 1,
      tenantId,
      updatedAt: now,
      userId,
      walletId,
    },
  });
  await pool.query(
    `INSERT INTO wallet_nonce_ledgers (
       chain_id, wallet_id, next_nonce, last_confirmed_nonce,
       fencing_token, reconciliation_reason, created_at, updated_at
     ) VALUES (31337, $1, 7, 6, 9, NULL, $2, $2)`,
    [walletId, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P05-05 PostgreSQL Helper deployment persistence", () => {
  it("shares the P04 nonce ledger and survives store restart with strict ownership", async () => {
    const chain = new ChainFixture();
    let previewByte = 9;
    const wallet = {
      address: walletAddress,
      createdAt: now.toISOString(),
      envelopeVersion: 1,
      lockStatus: "ready" as const,
      mode: "server-kek" as const,
      name: "Helper deployment fixture",
      revision: 1,
      updatedAt: now.toISOString(),
      walletId,
    };
    const service = new HelperDeploymentService({
      chain,
      now: () => now,
      operations: new PostgresHelperDeploymentOperationStore(pool, { now: () => now }),
      previews: new PostgresHelperDeploymentPreviewStore(pool),
      randomBytes: () => new Uint8Array(32).fill(previewByte++),
    });
    const request = {
      chainId: 31_337 as const,
      helperVersion: "WalletHelperV1" as const,
      walletId,
    };
    const preview = await service.preview({ request, tenantId, userId, wallet });

    const restartedService = new HelperDeploymentService({
      chain,
      now: () => now,
      operations: new PostgresHelperDeploymentOperationStore(pool, { now: () => now }),
      previews: new PostgresHelperDeploymentPreviewStore(pool),
    });
    const submitted = await restartedService.submit({
      idempotencyKey: "helper-postgres-key-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "helper-postgres-request-1",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    expect(submitted).toMatchObject({
      created: true,
      operation: { nonce: "7", state: "queued", walletId },
    });

    const ledger = await pool.query<{ fencing_token: string; next_nonce: string }>(
      `SELECT fencing_token::text, next_nonce::text
         FROM wallet_nonce_ledgers
        WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId],
    );
    expect(ledger.rows).toEqual([{ fencing_token: "10", next_nonce: "8" }]);
    const stored = await new PostgresHelperDeploymentOperationStore(pool).get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    expect(stored).toMatchObject({ operationId: submitted.operation.operationId, state: "queued" });
    expect(
      await new PostgresHelperDeploymentOperationStore(pool).get({
        operationId: submitted.operation.operationId,
        tenantId: "tenant-other",
        userId,
      }),
    ).toBeNull();

    const signerChain = new SignerChainFixture();
    const authorizer = new PostgresHelperDeploymentPlanAuthorizer({
      chain: signerChain,
      now: () => now,
      pool,
    });
    const authorization = {
      plan: stored!.plan,
      planDigest: stored!.planDigest,
      tenantId,
      userId,
    };
    expect(await authorizer.authorize(authorization)).toBe(true);
    signerChain.adapterHash = `0x${"ff".repeat(32)}`;
    expect(await authorizer.authorize(authorization)).toBe(false);
    signerChain.adapterHash = helperDeploymentComponent("adapter").runtimeCodeHash;
    signerChain.expectedAddressCode = "0x6000";
    expect(await authorizer.authorize(authorization)).toBe(false);
    signerChain.expectedAddressCode = "0x";
    await pool.query(
      `UPDATE wallet_nonce_ledgers SET reconciliation_reason = 'NONCE_DRIFT'
        WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId],
    );
    expect(await authorizer.authorize(authorization)).toBe(false);
    await pool.query(
      `UPDATE wallet_nonce_ledgers SET reconciliation_reason = NULL
        WHERE chain_id = 31337 AND wallet_id = $1`,
      [walletId],
    );
    expect(
      await new PostgresHelperDeploymentOperationStore(pool).get({
        operationId: submitted.operation.operationId,
        tenantId,
        userId: randomUUID(),
      }),
    ).toBeNull();

    const duplicate = await restartedService.submit({
      idempotencyKey: "helper-postgres-key-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "helper-postgres-request-2",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    expect(duplicate).toEqual({ created: false, operation: submitted.operation });

    chain.runtimeHash = `0x${"92".repeat(32)}`;
    chain.nonce = "8";
    const changed = await service.preview({ request, tenantId, userId, wallet });
    await expect(
      restartedService.submit({
        idempotencyKey: "helper-postgres-key-0001",
        request: {
          ...request,
          previewDigest: changed.previewDigest,
          previewToken: changed.previewToken,
        },
        requestId: "helper-postgres-request-3",
        sessionId,
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    await expect(
      restartedService.submit({
        idempotencyKey: "helper-postgres-key-0002",
        request: {
          ...request,
          previewDigest: changed.previewDigest,
          previewToken: changed.previewToken,
        },
        requestId: "helper-postgres-request-4",
        sessionId,
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "HELPER_DEPLOYMENT_IN_PROGRESS" });

    const rows = await pool.query<{
      adapter_address: string;
      binding_count: string;
      operation_count: string;
      owner_address: string;
      permit2_address: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM chain_operations WHERE wallet_id = $1) AS operation_count,
         (SELECT count(*)::text FROM wallet_helper_deployment_bindings
           WHERE wallet_id = $1) AS binding_count,
         b.owner_address, b.adapter_address, b.permit2_address
       FROM wallet_helper_deployment_bindings b
       WHERE b.wallet_id = $1`,
      [walletId],
    );
    expect(rows.rows).toEqual([
      {
        adapter_address: helperDeploymentComponent("adapter").address,
        binding_count: "1",
        operation_count: "1",
        owner_address: walletAddress,
        permit2_address: helperDeploymentComponent("permit2").address,
      },
    ]);
  });
});
