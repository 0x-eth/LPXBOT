import { randomUUID } from "node:crypto";

import {
  HelperDeploymentService,
  LocalHelperSweepApplicationRescanner,
  LocalHelperSweepService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  PostgresLocalHelperResidualSnapshotStore,
  PostgresLocalHelperSweepBindingStore,
  PostgresLocalHelperSweepOperationStore,
  PostgresLocalHelperSweepPreviewStore,
  PostgresLocalSwapHelperBindingStore,
  PostgresWalletDirectory,
  type HelperDeploymentChainReader,
  type LocalHelperResidualChainInspection,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresLocalHelperSweepPlanAuthorizer,
  type LocalHelperSweepPlanChainVerifier,
} from "../../apps/signer/src/postgres-local-helper-sweep-plan-authorizer.js";
import {
  PostgresLocalHelperSweepRecoveryRepository,
  type LocalHelperSweepReceiptObservation,
  type LocalHelperSweepWorkClaim,
} from "../../apps/worker/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import type { LocalHelperSweepPlan } from "../../packages/domain/src/local-helper-sweep.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const tenantId = "tenant-fixture-01";
const userId = randomUUID();
const otherUserId = randomUUID();
const sessionId = randomUUID();
const walletAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const startedAt = new Date(Date.now() - 60_000);
let clock = new Date(startedAt);

class DeploymentChainFixture implements HelperDeploymentChainReader {
  async nonceSnapshot() {
    return {
      blockHash: `0x${"71".repeat(32)}` as const,
      blockNumber: "7",
      blockTimestamp: new Date(clock.getTime() - 1_000).toISOString(),
      chainId: 31_337 as const,
      views: [{ latest: "0", pending: "0", providerId: "anvil-primary" }],
    };
  }

  async inspectDeployment() {
    return {
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
        runtimeCodeHash: component.runtimeCodeHash,
      })),
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.helperTemplate.runtimeTemplateHash,
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

class ResidualChainFixture {
  blockHash = `0x${"81".repeat(32)}` as `0x${string}`;
  blockNumber = "8";
  nativeBalance = "5000";
  nonce = "1";
  tokenBalances = ["20", "0"];

  constructor(
    readonly helperAddress: `0x${string}`,
    readonly runtimeCodeHash: `0x${string}`,
  ) {}

  clean(): void {
    this.blockHash = `0x${"82".repeat(32)}`;
    this.blockNumber = "9";
    this.nativeBalance = "0";
    this.nonce = "3";
    this.tokenBalances = ["0", "0"];
  }

  async inspect(input: {
    referencedBlockNumber: string | null;
  }): Promise<LocalHelperResidualChainInspection> {
    const allowances = registry.tokens.flatMap((token) =>
      registry.components.map((component) => ({
        amountBaseUnit: "0",
        spenderAddress: component.address,
        spenderRole: component.role,
        tokenAddress: token.address,
      })),
    );
    return {
      allowances,
      block: {
        hash: this.blockHash,
        number: this.blockNumber,
        timestamp: new Date(clock.getTime() - 1_000).toISOString(),
      },
      componentCode: registry.components.map(({ address, role, runtimeCodeHash }) => ({
        address,
        role,
        runtimeCodeHash,
      })),
      coverage: {
        allowancesComplete: true,
        complete: true,
        helperIdentityComplete: true,
        nftCustodyComplete: true,
        tokenInventoryComplete: true,
      },
      feeLimits: ["native:31337", ...registry.tokens.map(({ address }) => `token:${address}`)].map(
        (assetId) => ({
          assetId,
          feeLimit: {
            feeCapBaseUnit: "400000",
            gasLimit: "100000",
            maxFeePerGasBaseUnit: "4",
            maxPriorityFeePerGasBaseUnit: "2",
          },
        }),
      ),
      headBlockNumber: this.blockNumber,
      helper: { owner: walletAddress, runtimeCodeHash: this.runtimeCodeHash },
      nativeBalanceBaseUnit: this.nativeBalance,
      nftCustody: [],
      nonceViews: [{ latest: this.nonce, pending: this.nonce, providerId: "anvil-primary" }],
      referencedBlockHash:
        input.referencedBlockNumber === null || input.referencedBlockNumber === this.blockNumber
          ? this.blockHash
          : (`0x${"00".repeat(32)}` as const),
      tokenBalances: registry.tokens.map((token, index) => ({
        address: token.address,
        amountBaseUnit: this.tokenBalances[index]!,
        runtimeCodeHash: token.runtimeCodeHash,
      })),
      unknownTokens: [],
    };
  }
}

class SweepVerifierFixture implements LocalHelperSweepPlanChainVerifier {
  async verify(plan: LocalHelperSweepPlan) {
    return {
      canonicalSnapshotBlockHash: plan.snapshot.blockHash,
      componentCode: registry.components.map(({ address, role, runtimeCodeHash }) => ({
        address,
        role,
        runtimeCodeHash,
      })),
      headBlockNumber: plan.snapshot.blockNumber,
      helper: {
        adapter: plan.helper.adapterAddress,
        executed: false,
        owner: plan.recipient,
        permit2: plan.helper.permit2Address,
        runtimeCodeHash: plan.helper.runtimeCodeHash,
      },
      tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

async function createWallet(): Promise<string> {
  const walletId = randomUUID();
  await new PostgresCustodyWalletStore(pool).create({
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
      address: walletAddress,
      addressLower: walletAddress,
      createdAt: clock,
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "P05-08 sweep fixture",
      revision: 1,
      tenantId,
      updatedAt: clock,
      userId,
      walletId,
    },
  });
  return walletId;
}

async function deployHelper(walletId: string) {
  const wallet = {
    address: walletAddress,
    createdAt: clock.toISOString(),
    envelopeVersion: 1 as const,
    lockStatus: "ready" as const,
    mode: "server-kek" as const,
    name: "P05-08 sweep fixture",
    revision: 1,
    updatedAt: clock.toISOString(),
    walletId,
  };
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
    walletId,
  };
  const preview = await service.preview({ request, tenantId, userId, wallet });
  const submitted = await service.submit({
    idempotencyKey: "p05-08-helper-deploy-0001",
    request: {
      ...request,
      previewDigest: preview.previewDigest,
      previewToken: preview.previewToken,
    },
    requestId: "p05-08-helper-deploy-request",
    sessionId,
    tenantId,
    userId,
    wallet,
  });
  await pool.query(
    `UPDATE wallet_helper_deployment_bindings
        SET state = 'active', deployment_transaction_hash = $2,
            verified_block_number = 7, failure_code = NULL, updated_at = $3
      WHERE operation_id = $1`,
    [submitted.operation.operationId, `0x${"70".repeat(32)}`, clock],
  );
  return { helperAddress: submitted.operation.expectedAddress, wallet };
}

async function claimOperations(
  repository: PostgresLocalHelperSweepRecoveryRepository,
  operationIds: readonly string[],
  now: Date,
) {
  const claims = await repository.claimDue({
    leaseMilliseconds: 10_000,
    limit: 20,
    now,
    workerId: "p05-08-worker",
  });
  return operationIds.map((operationId) => {
    const claim = claims.find(
      (candidate): candidate is Extract<LocalHelperSweepWorkClaim, { kind: "operation" }> =>
        candidate.kind === "operation" && candidate.operation.operationId === operationId,
    );
    if (!claim) throw new Error(`No due sweep claim for ${operationId}`);
    return claim;
  });
}

function receipt(
  claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>,
  transactionHash: `0x${string}`,
  blockNumber: string,
): LocalHelperSweepReceiptObservation {
  const plan = claim.operation.plan;
  const amount = BigInt(plan.asset.amountBaseUnit);
  const gasUsed = 100n;
  const gasPrice = 2n;
  const ownerBefore = 10_000n;
  return {
    blockCanonical: true,
    blockHash: `0x${blockNumber.padStart(64, "0")}`,
    blockNumber,
    confirmations: "2",
    effectiveGasPrice: gasPrice.toString(),
    gasUsed: gasUsed.toString(),
    helperBalanceAfter: "0",
    helperBalanceBefore: amount.toString(),
    helperRuntimeCodeHash: plan.helper.runtimeCodeHash,
    observedOwner: plan.recipient,
    ownerBalanceAfter:
      plan.asset.kind === "token"
        ? (ownerBefore + amount).toString()
        : (ownerBefore + amount - gasUsed * gasPrice).toString(),
    ownerBalanceBefore: ownerBefore.toString(),
    planExecutedEvent: true,
    receiptStatus: "success",
    sweptEvent: true,
    tokenAddress: plan.asset.tokenAddress,
    transactionHash,
    transferAmountBaseUnit: plan.asset.kind === "token" ? amount.toString() : null,
    transferFrom: plan.asset.kind === "token" ? plan.helper.helperAddress : null,
    transferTo: plan.asset.kind === "token" ? plan.recipient : null,
  };
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'P05-08 sweep fixture', $3, $3),
            ($2, 'user', 'normal', 'active', 'P05-08 other user', $3, $3)`,
    [userId, otherUserId, startedAt],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userId, otherUserId]]);
  await pool.end();
});

describe("P05-08 PostgreSQL local Helper sweep lifecycle", () => {
  it("closes mixed-asset replacement and canonical-rescan recovery without replay", async () => {
    const walletId = await createWallet();
    const deployment = await deployHelper(walletId);
    const chain = new ResidualChainFixture(
      deployment.helperAddress,
      P05_HELPER_DEPLOYMENT_REGISTRY.helperTemplate.runtimeTemplateHash,
    );
    const operations = new PostgresLocalHelperSweepOperationStore(pool, { now: () => clock });
    const service = new LocalHelperSweepService({
      bindings: new PostgresLocalHelperSweepBindingStore(pool),
      chain,
      now: () => clock,
      operations,
      previews: new PostgresLocalHelperSweepPreviewStore(pool),
      snapshots: new PostgresLocalHelperResidualSnapshotStore(pool),
    });

    const snapshot = await service.scan({
      idempotencyKey: "p05-08-initial-residual-scan",
      tenantId,
      userId,
      wallet: deployment.wallet,
    });
    expect(snapshot).toMatchObject({
      degradationReasons: ["residual-above-dust"],
      manualRecoveryRequired: false,
      binding: { state: "degraded" },
    });
    const swapBindings = new PostgresLocalSwapHelperBindingStore(pool);
    await expect(swapBindings.getActive({ tenantId, userId, walletId })).resolves.toBeNull();
    const assetIds = [`token:${registry.tokens[0].address}`, "native:31337"];
    const preview = await service.preview({
      request: {
        assetIds,
        chainId: 31_337,
        snapshotDigest: snapshot.snapshotDigest,
        walletId,
      },
      tenantId,
      userId,
      wallet: deployment.wallet,
    });
    const submitted = await service.sweep({
      idempotencyKey: "p05-08-mixed-sweep-0001",
      request: {
        assetIds,
        chainId: 31_337,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
        snapshotDigest: snapshot.snapshotDigest,
        walletId,
      },
      requestId: "p05-08-mixed-sweep-request",
      sessionId,
      tenantId,
      userId,
      wallet: deployment.wallet,
    });
    expect(submitted).toMatchObject({
      created: true,
      batch: {
        helperAddress: deployment.helperAddress,
        operations: [
          { assetKind: "native", nonce: "1", state: "queued" },
          { assetKind: "token", nonce: "2", state: "queued" },
        ],
        state: "queued",
        walletId,
      },
    });

    const authorizer = new PostgresLocalHelperSweepPlanAuthorizer(
      pool,
      new SweepVerifierFixture(),
      { now: () => clock },
    );
    for (const operation of submitted.batch.operations) {
      const stored = await operations.getOperation({
        operationId: operation.operationId,
        tenantId,
        userId,
      });
      expect(stored).not.toBeNull();
      expect(
        await authorizer.authorize({
          generation: 0,
          maxFeePerGasBaseUnit: "2",
          maxPriorityFeePerGasBaseUnit: "1",
          operationId: operation.operationId,
          plan: stored!.plan,
          planDigest: stored!.planDigest,
          tenantId,
          userId,
        }),
      ).toBe(true);
    }

    const repository = new PostgresLocalHelperSweepRecoveryRepository(pool, {
      pollMilliseconds: 100,
    });
    const operationIds = submitted.batch.operations.map(({ operationId }) => operationId);
    let claims = await claimOperations(repository, operationIds, clock);
    const nativeOriginalHash = `0x${"91".repeat(32)}` as const;
    const tokenOriginalHash = `0x${"92".repeat(32)}` as const;
    for (const [index, claim] of claims.entries()) {
      await repository.completeBroadcast({
        claim,
        deliveredAt: new Date(clock.getTime() + 1),
        result: {
          deliveryId: `p05-08-original-${index}`,
          generation: 0,
          operationId: claim.operation.operationId,
          planDigest: claim.operation.planDigest,
          status: "accepted",
          transactionHash:
            claim.operation.plan.asset.kind === "native" ? nativeOriginalHash : tokenOriginalHash,
        },
      });
    }

    clock = new Date(clock.getTime() + 1_000);
    claims = await claimOperations(repository, operationIds, clock);
    const tokenClaim = claims.find(({ operation }) => operation.plan.asset.kind === "token")!;
    const nativeClaim = claims.find(({ operation }) => operation.plan.asset.kind === "native")!;
    await repository.applyObservation({
      claim: tokenClaim,
      decision: {
        failureCode: null,
        kind: "receipt",
        operationState: "succeeded",
        reason: null,
        receipt: receipt(tokenClaim, tokenOriginalHash, "10"),
        transactionId: tokenClaim.operation.activeTransaction!.transactionId,
      },
      observedAt: new Date(clock.getTime() + 1),
    });
    await repository.applyObservation({
      claim: nativeClaim,
      decision: { kind: "transition", operationState: "dropped", reason: null },
      observedAt: new Date(clock.getTime() + 2),
    });

    const replacement = await repository.prepareReplacement({
      fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "2" },
      now: new Date(clock.getTime() + 3),
      operationId: nativeClaim.operation.operationId,
      reason: "DROPPED_FEE_BUMP",
    });
    expect(replacement.next).toMatchObject({
      amountBaseUnit: nativeClaim.operation.plan.asset.amountBaseUnit,
      dataDigest: nativeClaim.operation.plan.transaction.dataDigest,
      recipient: walletAddress,
      target: deployment.helperAddress,
    });
    expect(
      await authorizer.authorize({
        generation: 1,
        maxFeePerGasBaseUnit: "3",
        maxPriorityFeePerGasBaseUnit: "2",
        operationId: replacement.operationId,
        plan: replacement.plan,
        planDigest: replacement.plan.planDigest,
        tenantId,
        userId,
      }),
    ).toBe(true);

    await expect(
      repository.completeReplacement({
        authorization: replacement,
        deliveredAt: new Date(clock.getTime() + 4),
        result: {
          deliveryId: "p05-08-wrong-replacement",
          generation: 1,
          operationId: replacement.operationId,
          planDigest: `sha256:${"ff".repeat(32)}`,
          status: "accepted",
          transactionHash: `0x${"93".repeat(32)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_REPLACEMENT_INVALID" });
    expect(
      await authorizer.authorize({
        generation: 1,
        maxFeePerGasBaseUnit: "3",
        maxPriorityFeePerGasBaseUnit: "2",
        operationId: replacement.operationId,
        plan: replacement.plan,
        planDigest: replacement.plan.planDigest,
        tenantId,
        userId,
      }),
    ).toBe(true);

    const replacementHash = `0x${"94".repeat(32)}` as const;
    await repository.completeReplacement({
      authorization: replacement,
      deliveredAt: new Date(clock.getTime() + 5),
      result: {
        deliveryId: "p05-08-replacement",
        generation: 1,
        operationId: replacement.operationId,
        planDigest: replacement.plan.planDigest,
        status: "accepted",
        transactionHash: replacementHash,
      },
    });

    clock = new Date(clock.getTime() + 1_000);
    const [replacementClaim] = await claimOperations(
      repository,
      [nativeClaim.operation.operationId],
      clock,
    );
    const historical = replacementClaim.operation.transactionLineage.find(
      ({ generation }) => generation === 0,
    )!;
    await repository.applyObservation({
      claim: replacementClaim,
      decision: {
        failureCode: null,
        kind: "receipt",
        operationState: "succeeded",
        reason: null,
        receipt: receipt(replacementClaim, historical.transactionHash, "11"),
        transactionId: historical.transactionId,
      },
      observedAt: new Date(clock.getTime() + 1),
    });

    const completedNative = await operations.getOperation({
      operationId: nativeClaim.operation.operationId,
      tenantId,
      userId,
    });
    expect(completedNative).toMatchObject({
      state: "succeeded",
      transactions: [
        { active: true, generation: 0, state: "confirmed", transactionHash: nativeOriginalHash },
        { active: false, generation: 1, state: "replaced", transactionHash: replacementHash },
      ],
    });

    clock = new Date(clock.getTime() + 1_000);
    const due = await repository.claimDue({
      leaseMilliseconds: 10_000,
      limit: 20,
      now: clock,
      workerId: "p05-08-rescan-worker",
    });
    expect(due.filter((candidate) => candidate.kind === "operation")).toEqual([]);
    const rescanClaim = due.find(
      (candidate): candidate is Extract<LocalHelperSweepWorkClaim, { kind: "rescan" }> =>
        candidate.kind === "rescan" && candidate.batch.batchId === submitted.batch.batchId,
    );
    expect(rescanClaim).toBeDefined();

    chain.clean();
    clock = new Date(clock.getTime() + 1_000);
    const rescanner = new LocalHelperSweepApplicationRescanner(
      service,
      new PostgresWalletDirectory(pool),
    );
    const cleanSnapshot = await rescanner.rescan(rescanClaim!.batch);
    expect(cleanSnapshot).toMatchObject({
      allowances: expect.arrayContaining([]),
      binding: { state: "active" },
      degradationReasons: [],
      manualRecoveryRequired: false,
      nftCustody: [],
      unknownTokens: [],
    });
    expect(cleanSnapshot.balances.every(({ amountBaseUnit }) => amountBaseUnit === "0")).toBe(true);
    await expect(swapBindings.getActive({ tenantId, userId, walletId })).resolves.toBeNull();
    await repository.completeRescan({
      claim: rescanClaim!,
      completedAt: new Date(clock.getTime() + 1),
      outcome: "active",
      snapshot: cleanSnapshot,
    });
    await expect(swapBindings.getActive({ tenantId, userId, walletId })).resolves.toMatchObject({
      helperAddress: deployment.helperAddress,
      state: "active",
    });

    await expect(
      service.getBatch({ batchId: submitted.batch.batchId, tenantId, userId }),
    ).resolves.toMatchObject({ state: "succeeded" });
    await expect(
      service.getBatch({ batchId: submitted.batch.batchId, tenantId, userId: otherUserId }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_NOT_FOUND" });
    await expect(
      service.getOperation({
        operationId: tokenClaim.operation.operationId,
        tenantId: "tenant-other",
        userId,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_NOT_FOUND" });

    const closure = await pool.query<{
      active_transactions: string;
      binding_state: string;
      receipt_count: string;
      rescan_state: string;
      succeeded_operations: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM local_helper_sweep_operations
           WHERE batch_id = $1 AND state = 'succeeded') AS succeeded_operations,
         (SELECT count(*)::text FROM local_helper_sweep_transactions tx
           JOIN local_helper_sweep_operations operation
             ON operation.operation_id = tx.operation_id
          WHERE operation.batch_id = $1 AND tx.active) AS active_transactions,
         (SELECT count(*)::text FROM local_helper_sweep_receipt_evidence evidence
           JOIN local_helper_sweep_operations operation
             ON operation.operation_id = evidence.operation_id
          WHERE operation.batch_id = $1 AND evidence.reconciled) AS receipt_count,
         (SELECT rescan_state FROM local_helper_sweep_batches WHERE batch_id = $1)
           AS rescan_state,
         (SELECT state FROM wallet_helper_deployment_bindings
           WHERE helper_address = $2) AS binding_state`,
      [submitted.batch.batchId, deployment.helperAddress],
    );
    expect(closure.rows).toEqual([
      {
        active_transactions: "2",
        binding_state: "active",
        receipt_count: "2",
        rescan_state: "passed",
        succeeded_operations: "2",
      },
    ]);
  });
});
