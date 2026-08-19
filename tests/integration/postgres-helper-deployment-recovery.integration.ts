import { randomUUID } from "node:crypto";

import {
  HelperDeploymentService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  type HelperDeploymentChainReader,
  type StoredHelperDeploymentOperation,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresHelperDeploymentRecoveryRepository,
  type HelperDeploymentReceiptObservation,
  type HelperDeploymentWorkClaim,
} from "../../apps/worker/src/index.js";
import { P05_HELPER_DEPLOYMENT_REGISTRY } from "../../packages/chain-registry/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const baseTime = new Date();
const tenantId = "tenant-fixture-01";
const userId = randomUUID();
const sessionId = randomUUID();

class ChainFixture implements HelperDeploymentChainReader {
  constructor(
    readonly nonce: string,
    readonly timestamp: Date,
    readonly runtimeHash = `0x${"91".repeat(32)}` as `0x${string}`,
  ) {}

  async nonceSnapshot() {
    return {
      blockHash: `0x${"81".repeat(32)}` as const,
      blockNumber: this.nonce,
      blockTimestamp: this.timestamp.toISOString(),
      chainId: 31_337 as const,
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

async function createWallet(address: `0x${string}`, createdAt: Date): Promise<string> {
  const walletId = randomUUID();
  await new PostgresCustodyWalletStore(pool).create({
    auditAction: "wallet.import",
    envelope: {
      aadVersion: 1,
      algorithm: "AES-256-GCM",
      ciphertext: Buffer.alloc(32, 1),
      createdAt,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "local-v1",
      nonce: Buffer.alloc(12, 2),
      tag: Buffer.alloc(16, 3),
      wrappedDek: Buffer.alloc(60, 4),
    },
    wallet: {
      address,
      addressLower: address,
      createdAt,
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: `Helper recovery ${walletId.slice(0, 8)}`,
      revision: 1,
      tenantId,
      updatedAt: createdAt,
      userId,
      walletId,
    },
  });
  return walletId;
}

async function submitOperation(input: {
  address: `0x${string}`;
  idempotencyKey: string;
  nonce: string;
  now: Date;
  walletId: string;
}): Promise<StoredHelperDeploymentOperation> {
  const chain = new ChainFixture(input.nonce, input.now);
  const wallet = {
    address: input.address,
    createdAt: input.now.toISOString(),
    envelopeVersion: 1 as const,
    lockStatus: "ready" as const,
    mode: "server-kek" as const,
    name: "Helper recovery fixture",
    revision: 1,
    updatedAt: input.now.toISOString(),
    walletId: input.walletId,
  };
  const operations = new PostgresHelperDeploymentOperationStore(pool, { now: () => input.now });
  const service = new HelperDeploymentService({
    chain,
    now: () => input.now,
    operations,
    previews: new PostgresHelperDeploymentPreviewStore(pool),
  });
  const request = {
    chainId: 31_337 as const,
    helperVersion: "WalletHelperV1" as const,
    walletId: input.walletId,
  };
  const preview = await service.preview({ request, tenantId, userId, wallet });
  const submitted = await service.submit({
    idempotencyKey: input.idempotencyKey,
    request: {
      ...request,
      previewDigest: preview.previewDigest,
      previewToken: preview.previewToken,
    },
    requestId: `request-${input.idempotencyKey}`,
    sessionId,
    tenantId,
    userId,
    wallet,
  });
  expect(submitted.created).toBe(true);
  const stored = await operations.get({
    operationId: submitted.operation.operationId,
    tenantId,
    userId,
  });
  if (!stored) throw new Error(`Operation ${submitted.operation.operationId} was not stored`);
  return stored;
}

async function claimOperation(
  repository: PostgresHelperDeploymentRecoveryRepository,
  operationId: string,
  now: Date,
  workerId: string,
): Promise<HelperDeploymentWorkClaim> {
  const claims = await repository.claimDue({
    leaseMilliseconds: 10_000,
    limit: 20,
    now,
    workerId,
  });
  const claim = claims.find(({ operation }) => operation.operationId === operationId);
  if (!claim) throw new Error(`No due claim for ${operationId}`);
  return claim;
}

function receipt(
  claim: HelperDeploymentWorkClaim,
  input: {
    blockHash: `0x${string}`;
    blockNumber: string;
    confirmations: string;
    status?: "reverted" | "success";
    transactionHash?: `0x${string}`;
  },
): HelperDeploymentReceiptObservation {
  const plan = claim.operation.plan;
  const status = input.status ?? "success";
  return {
    blockCanonical: true,
    blockHash: input.blockHash,
    blockNumber: input.blockNumber,
    confirmations: input.confirmations,
    constructorReconciled: status === "success",
    contractAddress: status === "success" ? plan.deployment.expectedAddress : null,
    contractAddressReconciled: status === "success",
    observedAdapter: status === "success" ? plan.deployment.adapter : null,
    observedOwner: status === "success" ? plan.deployment.owner : null,
    observedPermit2: status === "success" ? plan.deployment.permit2 : null,
    ownerReconciled: status === "success",
    receiptStatus: status,
    runtimeCodeHash: status === "success" ? plan.deployment.expectedRuntimeCodeHash : null,
    runtimeCodeReconciled: status === "success",
    transactionHash: input.transactionHash ?? claim.operation.activeTransaction!.transactionHash,
  };
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Helper recovery fixture', $2, $2)`,
    [userId, baseTime],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P05-05 PostgreSQL Helper deployment recovery", () => {
  it("persists broadcast, reconciliation, confirmation, verification, and append-only evidence", async () => {
    const now = new Date(baseTime.getTime() + 60_000);
    const address = "0x1000000000000000000000000000000000000001" as const;
    const walletId = await createWallet(address, now);
    const operation = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-success-0001",
      nonce: "0",
      now,
      walletId,
    });
    const repository = new PostgresHelperDeploymentRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });
    const queued = await claimOperation(repository, operation.operationId, now, "helper-worker-a");
    const transactionHash = `0x${"11".repeat(32)}` as const;
    await repository.completeBroadcast({
      claim: queued,
      deliveredAt: new Date(now.getTime() + 1),
      result: {
        deliveryId: "helper-recovery-success",
        planDigest: operation.planDigest,
        status: "accepted",
        transactionHash,
      },
    });

    const broadcast = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 2_000),
      "helper-worker-a",
    );
    await repository.applyObservation({
      claim: broadcast,
      decision: { kind: "transition", reason: null, state: "pending" },
      observedAt: new Date(now.getTime() + 2_001),
    });
    const pending = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 4_000),
      "helper-worker-a",
    );
    await repository.applyObservation({
      claim: pending,
      decision: {
        kind: "transition",
        reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
        state: "reconciling",
      },
      observedAt: new Date(now.getTime() + 4_001),
    });
    const reconciling = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 6_000),
      "helper-worker-a",
    );
    const observedReceipt = receipt(reconciling, {
      blockHash: `0x${"21".repeat(32)}`,
      blockNumber: "10",
      confirmations: "1",
    });
    await repository.applyObservation({
      claim: reconciling,
      decision: {
        kind: "receipt",
        reason: "CONFIRMATIONS_PENDING",
        receipt: observedReceipt,
        state: "confirmed",
        transactionId: reconciling.operation.activeTransaction!.transactionId,
      },
      observedAt: new Date(now.getTime() + 6_001),
    });
    const confirmed = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 8_000),
      "helper-worker-a",
    );
    await repository.applyObservation({
      claim: confirmed,
      decision: {
        kind: "receipt",
        reason: null,
        receipt: { ...observedReceipt, confirmations: "2" },
        state: "succeeded",
        transactionId: confirmed.operation.activeTransaction!.transactionId,
      },
      observedAt: new Date(now.getTime() + 8_001),
    });

    const stored = await new PostgresHelperDeploymentOperationStore(pool).get({
      operationId: operation.operationId,
      tenantId,
      userId,
    });
    expect(stored).toMatchObject({
      state: "succeeded",
      transactions: [{ active: true, generation: 0, state: "confirmed", transactionHash }],
    });
    const closure = await pool.query<{
      audit_count: string;
      binding_state: string;
      evidence_count: string;
      open_reconciliations: string;
      resolved_reconciliations: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM chain_operation_audit_events WHERE operation_id = $1)
           AS audit_count,
         (SELECT state FROM wallet_helper_deployment_bindings WHERE operation_id = $1)
           AS binding_state,
         (SELECT count(*)::text FROM chain_operation_receipt_evidence e
           JOIN chain_operation_transactions t ON t.transaction_id = e.transaction_id
          WHERE t.operation_id = $1) AS evidence_count,
         (SELECT count(*)::text FROM chain_operation_reconciliation_cases
          WHERE operation_id = $1 AND status = 'open') AS open_reconciliations,
         (SELECT count(*)::text FROM chain_operation_reconciliation_cases
          WHERE operation_id = $1 AND status = 'resolved') AS resolved_reconciliations`,
      [operation.operationId],
    );
    expect(closure.rows).toEqual([
      {
        audit_count: "8",
        binding_state: "active",
        evidence_count: "1",
        open_reconciliations: "0",
        resolved_reconciliations: "1",
      },
    ]);
    await expect(
      pool.query(
        `UPDATE chain_operation_receipt_evidence SET canonical = false
          WHERE transaction_hash = $1`,
        [transactionHash],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      pool.query(`DELETE FROM chain_operation_audit_events WHERE operation_id = $1`, [
        operation.operationId,
      ]),
    ).rejects.toThrow(/append-only/u);
  });

  it("recovers an expired lease and rolls back an unbroadcast nonce for a clean retry", async () => {
    const now = new Date(baseTime.getTime() + 120_000);
    const address = "0x2000000000000000000000000000000000000002" as const;
    const walletId = await createWallet(address, now);
    const operation = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-lease-0001",
      nonce: "0",
      now,
      walletId,
    });
    const firstRepository = new PostgresHelperDeploymentRecoveryRepository(pool);
    const firstClaim = await claimOperation(
      firstRepository,
      operation.operationId,
      now,
      "helper-worker-first",
    );
    expect(
      await new PostgresHelperDeploymentRecoveryRepository(pool).claimDue({
        leaseMilliseconds: 10_000,
        limit: 20,
        now: new Date(now.getTime() + 500),
        workerId: "helper-worker-early",
      }),
    ).toEqual([]);
    const restartedRepository = new PostgresHelperDeploymentRecoveryRepository(pool);
    const recoveredClaim = await claimOperation(
      restartedRepository,
      operation.operationId,
      new Date(now.getTime() + 10_001),
      "helper-worker-restarted",
    );
    expect(recoveredClaim.eventId).toBe(firstClaim.eventId);
    expect(recoveredClaim.leaseToken).not.toBe(firstClaim.leaseToken);
    await restartedRepository.failClaim({
      claim: recoveredClaim,
      code: "HELPER_PLAN_REJECTED",
      failedAt: new Date(now.getTime() + 10_002),
      retryable: false,
    });
    const rolledBack = await pool.query<{
      binding_count: string;
      fencing_token: string;
      next_nonce: string;
      state: string;
    }>(
      `SELECT o.state, l.next_nonce::text, l.fencing_token::text,
              (SELECT count(*)::text FROM wallet_helper_deployment_bindings b
                WHERE b.operation_id = o.operation_id) AS binding_count
         FROM chain_operations o
         JOIN wallet_nonce_ledgers l ON l.chain_id = o.chain_id AND l.wallet_id = o.wallet_id
        WHERE o.operation_id = $1`,
      [operation.operationId],
    );
    expect(rolledBack.rows).toEqual([
      { binding_count: "0", fencing_token: "2", next_nonce: "0", state: "failed" },
    ]);

    const retry = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-lease-0002",
      nonce: "0",
      now: new Date(now.getTime() + 11_000),
      walletId,
    });
    expect(retry).toMatchObject({ fencingToken: "3", nonce: "0", state: "queued" });
    const retryClaim = await claimOperation(
      restartedRepository,
      retry.operationId,
      new Date(now.getTime() + 11_000),
      "helper-worker-retry",
    );
    await restartedRepository.failClaim({
      claim: retryClaim,
      code: "HELPER_PLAN_REJECTED",
      failedAt: new Date(now.getTime() + 11_001),
      retryable: false,
    });
  });

  it("switches the active lineage when a dropped original wins after replacement", async () => {
    const now = new Date(baseTime.getTime() + 180_000);
    const address = "0x3000000000000000000000000000000000000003" as const;
    const walletId = await createWallet(address, now);
    const operation = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-replacement-0001",
      nonce: "0",
      now,
      walletId,
    });
    const repository = new PostgresHelperDeploymentRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });
    const originalHash = `0x${"31".repeat(32)}` as const;
    const queued = await claimOperation(repository, operation.operationId, now, "helper-worker-r");
    await repository.completeBroadcast({
      claim: queued,
      deliveredAt: new Date(now.getTime() + 1),
      result: {
        deliveryId: "helper-original",
        planDigest: operation.planDigest,
        status: "accepted",
        transactionHash: originalHash,
      },
    });
    const broadcast = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 2_000),
      "helper-worker-r",
    );
    await repository.applyObservation({
      claim: broadcast,
      decision: { kind: "transition", reason: null, state: "dropped" },
      observedAt: new Date(now.getTime() + 2_001),
    });
    const replacement = await repository.prepareReplacement({
      feeLimit: {
        feeCapBaseUnit: "3600000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "3",
        maxPriorityFeePerGasBaseUnit: "2",
      },
      now: new Date(now.getTime() + 2_002),
      operationId: operation.operationId,
      reason: "pending-fee-bump",
    });
    expect(replacement.plan.transaction).toEqual(operation.plan.transaction);
    expect(replacement.plan.deployment).toEqual(operation.plan.deployment);
    await repository.completeReplacement({
      authorization: replacement,
      deliveredAt: new Date(now.getTime() + 2_003),
      result: {
        deliveryId: "helper-replacement",
        planDigest: replacement.planDigest,
        status: "accepted",
        transactionHash: `0x${"32".repeat(32)}`,
      },
    });
    const claims = await repository.claimDue({
      leaseMilliseconds: 10_000,
      limit: 20,
      now: new Date(now.getTime() + 5_000),
      workerId: "helper-worker-r",
    });
    const lineageClaims = claims.filter(
      ({ operation: claimed }) => claimed.operationId === operation.operationId,
    );
    expect(lineageClaims.length).toBeGreaterThanOrEqual(1);
    const winnerClaim = lineageClaims[0]!;
    expect(winnerClaim.operation.transactionLineage).toHaveLength(2);
    const historical = winnerClaim.operation.transactionLineage.find(
      ({ generation }) => generation === 0,
    )!;
    const historicalReceipt = receipt(winnerClaim, {
      blockHash: `0x${"33".repeat(32)}`,
      blockNumber: "12",
      confirmations: "2",
      transactionHash: historical.transactionHash,
    });
    const decision = {
      kind: "receipt" as const,
      reason: null,
      receipt: historicalReceipt,
      state: "succeeded" as const,
      transactionId: historical.transactionId,
    };
    await repository.applyObservation({
      claim: winnerClaim,
      decision,
      observedAt: new Date(now.getTime() + 5_001),
    });
    for (const staleClaim of lineageClaims.slice(1)) {
      await repository.applyObservation({
        claim: staleClaim,
        decision,
        observedAt: new Date(now.getTime() + 5_002),
      });
    }
    const stored = await new PostgresHelperDeploymentOperationStore(pool).get({
      operationId: operation.operationId,
      tenantId,
      userId,
    });
    expect(stored).toMatchObject({
      state: "succeeded",
      transactions: [
        { active: true, generation: 0, state: "confirmed", transactionHash: originalHash },
        { active: false, generation: 1, state: "dropped" },
      ],
    });
    expect(stored!.transactions.filter(({ active }) => active)).toHaveLength(1);
    const binding = await pool.query<{
      deployment_transaction_hash: string;
      state: string;
    }>(
      `SELECT state, deployment_transaction_hash
         FROM wallet_helper_deployment_bindings WHERE operation_id = $1`,
      [operation.operationId],
    );
    expect(binding.rows).toEqual([{ deployment_transaction_hash: originalHash, state: "active" }]);
  });

  it("degrades a reverted instance and permits the next nonce to retry", async () => {
    const now = new Date(baseTime.getTime() + 240_000);
    const address = "0x4000000000000000000000000000000000000004" as const;
    const walletId = await createWallet(address, now);
    const operation = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-revert-0001",
      nonce: "0",
      now,
      walletId,
    });
    const repository = new PostgresHelperDeploymentRecoveryRepository(pool, {
      pollMilliseconds: 1_000,
    });
    const queued = await claimOperation(repository, operation.operationId, now, "helper-worker-v");
    await repository.completeBroadcast({
      claim: queued,
      deliveredAt: new Date(now.getTime() + 1),
      result: {
        deliveryId: "helper-reverted",
        planDigest: operation.planDigest,
        status: "accepted",
        transactionHash: `0x${"41".repeat(32)}`,
      },
    });
    const broadcast = await claimOperation(
      repository,
      operation.operationId,
      new Date(now.getTime() + 2_000),
      "helper-worker-v",
    );
    const revertedReceipt = receipt(broadcast, {
      blockHash: `0x${"42".repeat(32)}`,
      blockNumber: "13",
      confirmations: "1",
      status: "reverted",
    });
    await repository.applyObservation({
      claim: broadcast,
      decision: {
        kind: "receipt",
        reason: "HELPER_DEPLOYMENT_REVERTED",
        receipt: revertedReceipt,
        state: "failed",
        transactionId: broadcast.operation.activeTransaction!.transactionId,
      },
      observedAt: new Date(now.getTime() + 2_001),
    });
    const degraded = await pool.query<{ last_confirmed_nonce: string; state: string }>(
      `SELECT b.state, l.last_confirmed_nonce::text
         FROM wallet_helper_deployment_bindings b
         JOIN wallet_nonce_ledgers l ON l.chain_id = b.chain_id AND l.wallet_id = b.wallet_id
        WHERE b.operation_id = $1`,
      [operation.operationId],
    );
    expect(degraded.rows).toEqual([{ last_confirmed_nonce: "0", state: "degraded" }]);

    const retry = await submitOperation({
      address,
      idempotencyKey: "helper-recovery-revert-0002",
      nonce: "1",
      now: new Date(now.getTime() + 3_000),
      walletId,
    });
    expect(retry).toMatchObject({ nonce: "1", state: "queued" });
    const retryClaim = await claimOperation(
      repository,
      retry.operationId,
      new Date(now.getTime() + 3_000),
      "helper-worker-v",
    );
    await repository.failClaim({
      claim: retryClaim,
      code: "HELPER_PLAN_REJECTED",
      failedAt: new Date(now.getTime() + 3_001),
      retryable: false,
    });
  });
});
