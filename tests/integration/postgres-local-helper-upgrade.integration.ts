import { randomUUID } from "node:crypto";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import {
  localHelperResidualSnapshotDigest,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepBinding,
} from "../../packages/domain/src/local-helper-sweep.js";
import {
  HelperDeploymentService,
  LocalHelperUpgradeService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  PostgresLocalHelperUpgradeBindingStore,
  PostgresLocalHelperUpgradeOperationStore,
  PostgresLocalHelperUpgradePreviewStore,
  type HelperDeploymentChainReader,
  type LocalHelperUpgradeChainReader,
  type LocalHelperUpgradeResidualReader,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresLocalHelperUpgradeRecoveryRepository,
  type LocalHelperUpgradeWorkClaim,
} from "../../apps/worker/src/index.js";
import type { WalletHelperV2Verification } from "../../packages/domain/src/local-helper-upgrade.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const tenantId = "tenant-fixture-01";
const successUserId = randomUUID();
const manualUserId = randomUUID();
const startedAt = new Date();
let clock = new Date(startedAt);

class DeploymentChainFixture implements HelperDeploymentChainReader {
  async nonceSnapshot() {
    return {
      blockHash: `0x${"51".repeat(32)}` as const,
      blockNumber: "5",
      blockTimestamp: new Date(clock.getTime() - 1_000).toISOString(),
      chainId: 31_337 as const,
      views: [{ latest: "0", pending: "0", providerId: "anvil-primary" }],
    };
  }

  async inspectDeployment() {
    return {
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
      })),
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: `0x${"61".repeat(32)}` as const,
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

class UpgradeChainFixture implements LocalHelperUpgradeChainReader {
  async nonceSnapshot() {
    return [
      {
        blockHash: `0x${"71".repeat(32)}` as const,
        blockNumber: "10",
        latestNonce: "1",
        pendingNonce: "1",
        providerId: "anvil-primary",
      },
    ];
  }

  async inspect(input: Parameters<LocalHelperUpgradeChainReader["inspect"]>[0]) {
    return {
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: `0x${"81".repeat(32)}` as const,
      feeLimit: {
        feeCapBaseUnit: "4000000",
        gasLimit: "1000000",
        maxFeePerGasBaseUnit: "4",
        maxPriorityFeePerGasBaseUnit: "2",
      },
      sourceIdentity: {
        bindingMatches: true,
        observedOwner: input.walletAddress,
        observedRuntimeCodeHash: input.binding.runtimeCodeHash,
        ownerMatches: true,
        registryMatches: true,
        runtimeMatches: true,
      },
    };
  }
}

class UpgradeResidualFixture implements LocalHelperUpgradeResidualReader {
  async scan(input: Parameters<LocalHelperUpgradeResidualReader["scan"]>[0]) {
    return residualSnapshot(input.binding, input.wallet);
  }
}

async function createWallet(input: {
  address: `0x${string}`;
  name: string;
  userId: string;
}): Promise<CustodyWallet> {
  const walletId = randomUUID();
  return new PostgresCustodyWalletStore(pool).create({
    auditAction: "wallet.import",
    envelope: {
      aadVersion: 1,
      algorithm: "AES-256-GCM",
      ciphertext: Buffer.alloc(32, 1),
      createdAt: clock,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "local-v1",
      nonce: Buffer.alloc(12, 2),
      tag: Buffer.alloc(16, 3),
      wrappedDek: Buffer.alloc(60, 4),
    },
    wallet: {
      address: input.address,
      addressLower: input.address,
      createdAt: clock,
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: input.name,
      revision: 1,
      tenantId,
      updatedAt: clock,
      userId: input.userId,
      walletId,
    },
  });
}

async function deployV1(wallet: CustodyWallet, userId: string): Promise<LocalHelperSweepBinding> {
  const operations = new PostgresHelperDeploymentOperationStore(pool, { now: () => clock });
  const service = new HelperDeploymentService({
    chain: new DeploymentChainFixture(),
    now: () => clock,
    operations,
    previews: new PostgresHelperDeploymentPreviewStore(pool),
  });
  const request = {
    chainId: 31_337 as const,
    helperVersion: "WalletHelperV1" as const,
    walletId: wallet.walletId,
  };
  const preview = await service.preview({ request, tenantId, userId, wallet });
  const submitted = await service.submit({
    idempotencyKey: `p05-09-v1-${wallet.walletId}`,
    request: {
      ...request,
      previewDigest: preview.previewDigest,
      previewToken: preview.previewToken,
    },
    requestId: `p05-09-v1-request-${wallet.walletId}`,
    sessionId: randomUUID(),
    tenantId,
    userId,
    wallet,
  });
  await pool.query(
    `UPDATE chain_operations SET state = 'succeeded', updated_at = $2 WHERE operation_id = $1;
     UPDATE wallet_helper_deployment_bindings
        SET state = 'active', deployment_transaction_hash = $2,
            verified_block_number = 6, failure_code = NULL, updated_at = $3
      WHERE operation_id = $1`,
    [submitted.operation.operationId, `0x${"62".repeat(32)}`, clock],
  );
  const binding = await new PostgresLocalHelperUpgradeBindingStore(pool).getSource({
    tenantId,
    userId,
    walletId: wallet.walletId,
  });
  if (!binding) throw new Error("WalletHelperV1 binding was not activated");
  return binding;
}

function residualSnapshot(
  source: LocalHelperSweepBinding,
  wallet: CustodyWallet,
  input: { manual?: boolean } = {},
): LocalHelperResidualSnapshot {
  const manual = input.manual ?? false;
  const binding = { ...source, state: manual ? ("degraded" as const) : ("active" as const) };
  const manager = P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "manager")!;
  const unknownAddress = "0x9000000000000000000000000000000000000009" as const;
  const snapshot: LocalHelperResidualSnapshot = {
    allowances: manual
      ? [
          {
            amountBaseUnit: "1",
            assetId: `allowance:${P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[0]!.address}:${binding.adapterAddress}`,
            spenderAddress: binding.adapterAddress,
            spenderRole: "adapter",
            tokenAddress: P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens[0]!.address,
          },
        ]
      : [],
    balances: [
      {
        amountBaseUnit: "0",
        assetId: "native:31337",
        dustBaseUnit: P05_LOCAL_HELPER_SWEEP_REGISTRY.dustPolicy.nativeDustBaseUnit,
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
      ...P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens.map((token) => ({
        amountBaseUnit: "0",
        assetId: `token:${token.address}`,
        dustBaseUnit: token.dustBaseUnit,
        fixture: token.fixture,
        kind: "token" as const,
        runtimeCodeHash: token.runtimeCodeHash,
        tokenAddress: token.address,
      })),
    ],
    binding,
    block: {
      hash: `0x${manual ? "92" : "91"}`.padEnd(66, manual ? "92" : "91") as `0x${string}`,
      number: manual ? "14" : "13",
      timestamp: new Date(clock.getTime() - 1_000).toISOString(),
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons: manual ? ["nft-custody", "nonzero-allowance", "unknown-token"] : [],
    expiresAt: new Date(clock.getTime() + 5 * 60_000).toISOString(),
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner: wallet.address,
      observedRuntimeCodeHash: source.runtimeCodeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: manual,
    nftCustody: manual
      ? [
          {
            assetId: `nft:${manager.address}:7`,
            managerAddress: manager.address,
            tokenId: "7",
          },
        ]
      : [],
    observedAt: clock.toISOString(),
    registry: {
      digest: P05_LOCAL_HELPER_SWEEP_REGISTRY.registryDigest,
      version: "p05-local-helper-sweep-v2",
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: manual
      ? [
          {
            amountBaseUnit: "1",
            assetId: `unknown-token:${unknownAddress}`,
            runtimeCodeHash: `0x${"93".repeat(32)}`,
            tokenAddress: unknownAddress,
          },
        ]
      : [],
    wallet: { address: wallet.address, walletId: wallet.walletId },
  };
  snapshot.snapshotDigest = localHelperResidualSnapshotDigest(snapshot);
  return snapshot;
}

async function submitUpgrade(wallet: CustodyWallet, userId: string) {
  const operations = new PostgresLocalHelperUpgradeOperationStore(pool, { now: () => clock });
  const service = new LocalHelperUpgradeService({
    bindings: new PostgresLocalHelperUpgradeBindingStore(pool),
    chain: new UpgradeChainFixture(),
    now: () => clock,
    operations,
    previews: new PostgresLocalHelperUpgradePreviewStore(pool),
    residuals: new UpgradeResidualFixture(),
  });
  const request = { chainId: 31_337 as const, walletId: wallet.walletId };
  const preview = await service.preview({ request, tenantId, userId, wallet });
  expect(preview).toMatchObject({ upgradeable: true, versions: { comparison: "upgrade-available" } });
  const submitted = await service.submit({
    idempotencyKey: `p05-09-upgrade-${wallet.walletId}`,
    request: {
      ...request,
      previewDigest: preview.previewDigest,
      previewToken: preview.previewToken,
    },
    requestId: `p05-09-upgrade-request-${wallet.walletId}`,
    sessionId: randomUUID(),
    tenantId,
    userId,
    wallet,
  });
  return { operations, operation: submitted.operation };
}

async function claim(
  repository: PostgresLocalHelperUpgradeRecoveryRepository,
  operationId: string,
): Promise<LocalHelperUpgradeWorkClaim> {
  const claims = await repository.claimDue({
    leaseMilliseconds: 10_000,
    limit: 20,
    now: clock,
    workerId: "p05-09-postgres-worker",
  });
  const value = claims.find(({ operation }) => operation.operationId === operationId);
  if (!value) throw new Error(`No due Helper upgrade claim for ${operationId}`);
  return value;
}

function verification(claim: LocalHelperUpgradeWorkClaim): WalletHelperV2Verification {
  const { plan } = claim.operation;
  return {
    abiHash: plan.target.abiHash,
    adapter: plan.target.adapter,
    atomicLiquidityExecutionEnabled: false,
    blockHash: `0x${"a1".repeat(32)}`,
    helperAddress: plan.target.expectedAddress,
    observedAtBlock: "12",
    owner: plan.target.owner,
    permit2: plan.target.permit2,
    runtimeCodeHash: plan.target.expectedRuntimeCodeHash,
    selectorSetHash: plan.target.selectorSetHash,
    tokenA: plan.target.tokenA,
    tokenB: plan.target.tokenB,
  };
}

async function advanceThroughVerification(
  repository: PostgresLocalHelperUpgradeRecoveryRepository,
  operationId: string,
) {
  let current = await claim(repository, operationId);
  await repository.advance({ claim: current, completedAt: clock, next: "deploy-v2" });

  clock = new Date(clock.getTime() + 1);
  current = await claim(repository, operationId);
  const transactionHash = `0x${operationId.replaceAll("-", "").slice(0, 2).repeat(32)}` as const;
  await repository.completeBroadcast({
    claim: current,
    deliveredAt: clock,
    result: {
      deliveryId: `p05-09-${operationId}`,
      generation: 0,
      operationId,
      planDigest: current.operation.planDigest,
      status: "accepted",
      transactionHash,
    },
  });

  clock = new Date(clock.getTime() + 101);
  current = await claim(repository, operationId);
  const transaction = current.operation.transactions[0]!;
  await repository.applyDeploymentObservation({
    claim: current,
    decision: {
      kind: "receipt",
      reason: null,
      receipt: {
        blockCanonical: true,
        blockHash: `0x${"a0".repeat(32)}`,
        blockNumber: "11",
        confirmations: "2",
        contractAddress: current.operation.plan.target.expectedAddress,
        receiptStatus: "success",
        runtimeCodeHash: current.operation.plan.target.expectedRuntimeCodeHash,
        transactionHash,
        transactionReconciled: true,
      },
      state: "confirmed",
      transactionId: transaction.transactionId,
    },
    observedAt: clock,
  });

  clock = new Date(clock.getTime() + 1);
  current = await claim(repository, operationId);
  const verified = verification(current);
  await repository.completeVerification({ claim: current, verification: verified, verifiedAt: clock });
  return verified;
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'P05-09 success fixture', $3, $3),
            ($2, 'user', 'normal', 'active', 'P05-09 manual fixture', $3, $3)`,
    [successUserId, manualUserId, startedAt],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [successUserId, manualUserId],
  ]);
  await pool.end();
});

describe("P05-09 PostgreSQL local Helper deploy-new upgrade", () => {
  it("persists all seven cursors and atomically supersedes V1 while activating V2", async () => {
    const wallet = await createWallet({
      address: "0x1000000000000000000000000000000000000091",
      name: "P05-09 successful upgrade",
      userId: successUserId,
    });
    const source = await deployV1(wallet, successUserId);
    const { operation, operations } = await submitUpgrade(wallet, successUserId);
    const repository = new PostgresLocalHelperUpgradeRecoveryRepository(pool, {
      pollMilliseconds: 100,
    });
    await advanceThroughVerification(repository, operation.operationId);

    clock = new Date(clock.getTime() + 1);
    let current = await claim(repository, operation.operationId);
    await repository.applySweepResult({
      claim: current,
      observedAt: clock,
      result: { batchId: null, kind: "completed" },
    });

    clock = new Date(clock.getTime() + 1);
    current = await claim(repository, operation.operationId);
    const clean = residualSnapshot(source, wallet);
    await repository.completeFinalRescan({ claim: current, observedAt: clock, snapshot: clean });

    clock = new Date(clock.getTime() + 1);
    const switchClaim = await claim(repository, operation.operationId);
    await repository.completeAtomicBindingSwitch({
      claim: switchClaim,
      completedAt: clock,
      snapshot: clean,
    });

    await expect(
      operations.get({ operationId: operation.operationId, tenantId, userId: successUserId }),
    ).resolves.toMatchObject({
      cursor: "completed",
      state: "completed",
      steps: [
        { cursor: "preflight", state: "succeeded" },
        { cursor: "deploy-v2", state: "succeeded" },
        { cursor: "verify-v2", state: "succeeded" },
        { cursor: "sweep-v1", state: "succeeded" },
        { cursor: "final-rescan-v1", state: "succeeded" },
        { cursor: "atomic-binding-switch", state: "succeeded" },
        { cursor: "completed", state: "succeeded" },
      ],
      transactions: [{ active: true, generation: 0, state: "confirmed" }],
    });

    const bindings = await pool.query<{
      active_count: string;
      helper_version: string;
      state: string;
      superseded_by_binding_id: string | null;
    }>(
      `SELECT helper_version, state, superseded_by_binding_id::text,
              count(*) FILTER (WHERE state = 'active') OVER ()::text AS active_count
         FROM wallet_helper_deployment_bindings WHERE wallet_id = $1 ORDER BY helper_version`,
      [wallet.walletId],
    );
    expect(bindings.rows).toEqual([
      {
        active_count: "1",
        helper_version: "WalletHelperV1",
        state: "superseded",
        superseded_by_binding_id: expect.any(String),
      },
      {
        active_count: "1",
        helper_version: "WalletHelperV2",
        state: "active",
        superseded_by_binding_id: null,
      },
    ]);
    await expect(
      repository.completeAtomicBindingSwitch({ claim: switchClaim, completedAt: clock, snapshot: clean }),
    ).rejects.toMatchObject({ code: "HELPER_UPGRADE_LEASE_LOST" });
    await expect(
      pool.query(
        `UPDATE local_helper_upgrade_v2_verification_evidence
            SET verification_payload = verification_payload || '{"tampered":true}'::jsonb
          WHERE operation_id = $1`,
        [operation.operationId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("stops at manual recovery when V1 has allowance, NFT custody, and an unknown token", async () => {
    clock = new Date(clock.getTime() + 1_000);
    const wallet = await createWallet({
      address: "0x1000000000000000000000000000000000000092",
      name: "P05-09 manual recovery",
      userId: manualUserId,
    });
    const source = await deployV1(wallet, manualUserId);
    const { operation, operations } = await submitUpgrade(wallet, manualUserId);
    const repository = new PostgresLocalHelperUpgradeRecoveryRepository(pool, {
      pollMilliseconds: 100,
    });
    await advanceThroughVerification(repository, operation.operationId);

    clock = new Date(clock.getTime() + 1);
    let current = await claim(repository, operation.operationId);
    await repository.applySweepResult({
      claim: current,
      observedAt: clock,
      result: { batchId: null, kind: "completed" },
    });

    clock = new Date(clock.getTime() + 1);
    current = await claim(repository, operation.operationId);
    const blocked = residualSnapshot(source, wallet, { manual: true });
    await pool.query(
      `UPDATE wallet_helper_deployment_bindings
          SET state = 'degraded', failure_code = 'nonzero-allowance', updated_at = $2
        WHERE binding_id = $1`,
      [source.bindingId, clock],
    );
    await repository.completeFinalRescan({ claim: current, observedAt: clock, snapshot: blocked });

    await expect(
      operations.get({ operationId: operation.operationId, tenantId, userId: manualUserId }),
    ).resolves.toMatchObject({
      cursor: "final-rescan-v1",
      manualRecovery: {
        blockers: ["NFT_CUSTODY", "NON_ZERO_ALLOWANCE", "UNKNOWN_TOKEN", "V1_IDENTITY_MISMATCH"],
        required: true,
      },
      state: "manual-recovery-required",
    });
    const closure = await pool.query<{
      active_count: string;
      pending_outbox: string;
      transaction_count: string;
      v1_state: string;
      v2_state: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM wallet_helper_deployment_bindings
           WHERE wallet_id = $1 AND state = 'active') AS active_count,
         (SELECT state FROM wallet_helper_deployment_bindings
           WHERE wallet_id = $1 AND helper_version = 'WalletHelperV1') AS v1_state,
         (SELECT state FROM wallet_helper_deployment_bindings
           WHERE wallet_id = $1 AND helper_version = 'WalletHelperV2') AS v2_state,
         (SELECT count(*)::text FROM local_helper_upgrade_outbox
           WHERE operation_id = $2 AND state IN ('pending', 'leased')) AS pending_outbox,
         (SELECT count(*)::text FROM local_helper_upgrade_transactions
           WHERE operation_id = $2) AS transaction_count`,
      [wallet.walletId, operation.operationId],
    );
    expect(closure.rows).toEqual([
      {
        active_count: "0",
        pending_outbox: "0",
        transaction_count: "1",
        v1_state: "degraded",
        v2_state: "deploying",
      },
    ]);
  });
});
