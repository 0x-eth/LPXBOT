import { randomUUID } from "node:crypto";

import { PostgresWalletTransferOperationStore } from "../../apps/api/src/index.js";
import { PostgresWalletTransferPlanAuthorizer } from "../../apps/signer/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import { PostgresWalletTransferRecoveryRepository } from "../../apps/worker/src/index.js";
import { walletTransferPlanDigest, type WalletTransferPlan } from "../../packages/domain/src/wallet-transfer.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const baseTime = new Date();
const userId = randomUUID();
const walletId = randomUUID();
const sessionId = randomUUID();
const walletAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" as const;
const recipientA = "0x1111111111111111111111111111111111111111" as const;
const recipientB = "0x2222222222222222222222222222222222222222" as const;
const policyDigest = `sha256:${"a".repeat(64)}` as const;
const previewDigest = `sha256:${"b".repeat(64)}` as const;

function walletDraft() {
  return {
    auditAction: "wallet.import" as const,
    envelope: {
      aadVersion: 1 as const,
      algorithm: "AES-256-GCM" as const,
      ciphertext: Buffer.alloc(32, 1),
      createdAt: baseTime,
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
      createdAt: baseTime,
      envelopeVersion: 1,
      lockStatus: "ready" as const,
      mode: "server-kek" as const,
      name: "Transfer PostgreSQL fixture",
      revision: 1,
      tenantId: "tenant-fixture-01",
      updatedAt: baseTime,
      userId,
      walletId,
    },
  };
}

function createInput(input: {
  idempotencyKey: string;
  recipient: typeof recipientA | typeof recipientB;
  requestHash: `sha256:${string}`;
}) {
  return {
    addressClassification: "known-external" as const,
    amountBaseUnit: "1000",
    asset: { kind: "native" as const },
    buildPlan: ({
      fencingToken,
      nonce,
      operationId,
    }: {
      fencingToken: string;
      nonce: string;
      operationId: string;
    }): WalletTransferPlan => ({
      amountBaseUnit: "1000",
      asset: { kind: "native" },
      chainId: 31_337,
      deadline: new Date(baseTime.getTime() + 60 * 60 * 1_000).toISOString(),
      feeLimit: {
        feeCapBaseUnit: "42000",
        gasLimit: "21000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      fencingToken,
      nonce,
      operationId,
      policyDigest,
      recipient: input.recipient,
      transactionData: "0x",
      transactionTarget: input.recipient,
      transactionValueBaseUnit: "1000",
      walletAddress,
      walletId,
    }),
    chainId: 31_337,
    executionMode: "local-auto" as const,
    feeLimit: {
      feeCapBaseUnit: "42000",
      gasLimit: "21000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    idempotencyKey: input.idempotencyKey,
    nonceViews: [
      { latest: "0", pending: "0", providerId: "anvil-a" },
      { latest: "0", pending: "0", providerId: "anvil-b" },
    ],
    policyDigest,
    policyVersion: "local-policy-v1",
    previewDigest,
    recipient: input.recipient,
    registryVersion: "local-registry-v1",
    requestHash: input.requestHash,
    requestId: `postgres-transfer-${input.idempotencyKey}`,
    securityPasswordVersion: null,
    sessionId,
    userId,
    walletAddress,
    walletId,
  };
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Transfer fixture', $2, $2)`,
    [userId, baseTime],
  );
  await new PostgresCustodyWalletStore(pool).create(walletDraft());
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P04-06 PostgreSQL nonce and transfer recovery", () => {
  it("serializes nonce allocation, preserves idempotency, and closes recovery plus replacement", async () => {
    const store = new PostgresWalletTransferOperationStore(pool, { now: () => baseTime });
    const inputA = createInput({
      idempotencyKey: "postgres-transfer-key-0001",
      recipient: recipientA,
      requestHash: `sha256:${"c".repeat(64)}`,
    });
    const inputB = createInput({
      idempotencyKey: "postgres-transfer-key-0002",
      recipient: recipientB,
      requestHash: `sha256:${"d".repeat(64)}`,
    });
    const results = await Promise.all([store.create(inputA), store.create(inputA), store.create(inputB)]);
    expect(results.filter(({ kind }) => kind === "created")).toHaveLength(2);
    expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(1);
    const operationA = results.find(({ operation }) => operation.recipient === recipientA)!.operation;
    const operationB = results.find(({ operation }) => operation.recipient === recipientB)!.operation;
    expect(new Set([operationA.nonce, operationB.nonce])).toEqual(new Set(["0", "1"]));
    await expect(
      store.create({ ...inputA, requestHash: `sha256:${"e".repeat(64)}` }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const atomicRows = await pool.query<{
      idempotency: string;
      operations: string;
      outbox: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM wallet_transfer_operations WHERE user_id = $1) AS operations,
         (SELECT count(*)::text FROM wallet_transfer_idempotency WHERE user_id = $1) AS idempotency,
         (SELECT count(*)::text FROM wallet_transfer_outbox o
           JOIN wallet_transfer_operations t ON t.operation_id = o.aggregate_id
          WHERE t.user_id = $1) AS outbox`,
      [userId],
    );
    expect(atomicRows.rows).toEqual([{ idempotency: "2", operations: "2", outbox: "2" }]);

    const authorizer = new PostgresWalletTransferPlanAuthorizer({
      localChainIds: [31_337],
      pool,
    });
    expect(
      await authorizer.authorize({
        plan: operationA.plan!,
        planDigest: operationA.planDigest,
        tenantId: "tenant-fixture-01",
        userId,
      }),
    ).toBe(true);

    const uuidValues = Array.from({ length: 30 }, () => randomUUID());
    const repository = new PostgresWalletTransferRecoveryRepository(pool, {
      pollMilliseconds: 1_000,
      confirmedPollMilliseconds: 1_000,
      uuid: () => uuidValues.shift()!,
    });
    const claims = await repository.claimDue({
      leaseMilliseconds: 10_000,
      limit: 10,
      now: baseTime,
      workerId: "postgres-transfer-worker",
    });
    expect(claims).toHaveLength(2);
    const claimA = claims.find(({ operation }) => operation.operationId === operationA.operationId)!;
    const claimB = claims.find(({ operation }) => operation.operationId === operationB.operationId)!;
    const hashA = `0x${"1".repeat(64)}` as const;
    const hashB = `0x${"2".repeat(64)}` as const;
    await repository.completeBroadcast({
      claim: claimA,
      deliveredAt: baseTime,
      result: {
        deliveryId: "postgres-fixture:a",
        planDigest: operationA.planDigest,
        status: "accepted",
        transactionHash: hashA,
      },
    });
    await repository.completeBroadcast({
      claim: claimB,
      deliveredAt: baseTime,
      result: {
        deliveryId: "postgres-fixture:b",
        planDigest: operationB.planDigest,
        status: "already-known",
        transactionHash: hashB,
      },
    });

    const pendingClaims = await repository.claimDue({
        leaseMilliseconds: 10_000,
        limit: 10,
        now: baseTime,
        workerId: "postgres-transfer-worker",
      });
    const pendingClaim = pendingClaims.find(
      ({ operation }) => operation.operationId === operationA.operationId,
    )!;
    await repository.applyObservation({
      claim: pendingClaim,
      decision: { kind: "transition", reason: null, state: "pending" },
      observedAt: new Date(baseTime.getTime() + 1),
    });
    const confirmationClaims = await repository.claimDue({
        leaseMilliseconds: 10_000,
        limit: 10,
        now: new Date(baseTime.getTime() + 2_000),
        workerId: "postgres-transfer-worker",
      });
    const confirmationClaim = confirmationClaims.find(
      ({ operation }) => operation.operationId === operationA.operationId,
    )!;
    const confirmedHash = confirmationClaim.operation.activeTransaction!.transactionHash;
    await repository.applyObservation({
      claim: confirmationClaim,
      decision: {
        kind: "receipt",
        reason: null,
        receipt: {
          balanceReconciled: true,
          blockCanonical: true,
          blockHash: `0x${"3".repeat(64)}`,
          blockNumber: "10",
          from: walletAddress,
          nonce: confirmationClaim.operation.plan.nonce,
          receiptStatus: "success",
          tokenTransferLogReconciled: true,
          transactionHash: confirmedHash,
          transactionTarget: confirmationClaim.operation.plan.transactionTarget,
        },
        state: "confirmed",
      },
      observedAt: new Date(baseTime.getTime() + 2_001),
    });
    const reorgClaims = await repository.claimDue({
        leaseMilliseconds: 10_000,
        limit: 10,
        now: new Date(baseTime.getTime() + 4_000),
        workerId: "postgres-transfer-worker",
      });
    const reorgClaim = reorgClaims.find(
      ({ operation }) => operation.operationId === operationA.operationId,
    )!;
    await repository.applyObservation({
      claim: reorgClaim,
      decision: { kind: "transition", reason: "REORG_RECEIPT_REMOVED", state: "reconciling" },
      observedAt: new Date(baseTime.getTime() + 4_001),
    });
    const reconciled = await store.get({
      operationId: reorgClaim.operation.operationId,
      userId,
    });
    expect(reconciled).toMatchObject({
      reconciliationReason: "REORG_RECEIPT_REMOVED",
      state: "reconciling",
    });

    const replacement = await repository.prepareReplacement({
      feeLimit: {
        feeCapBaseUnit: "63000",
        gasLimit: "21000",
        maxFeePerGasBaseUnit: "3",
        maxPriorityFeePerGasBaseUnit: "2",
      },
      now: new Date(baseTime.getTime() + 5_000),
      operationId: operationB.operationId,
      reason: "pending-fee-bump",
    });
    expect(replacement.plan.nonce).toBe(operationB.plan!.nonce);
    expect(replacement.plan.recipient).toBe(operationB.plan!.recipient);
    expect(replacement.plan.amountBaseUnit).toBe(operationB.plan!.amountBaseUnit);
    expect(walletTransferPlanDigest(replacement.plan)).toBe(replacement.planDigest);
    expect(
      await authorizer.authorize({
        plan: replacement.plan,
        planDigest: replacement.planDigest,
        tenantId: replacement.tenantId,
        userId,
      }),
    ).toBe(true);
    expect(
      await authorizer.authorize({
        plan: { ...replacement.plan, recipient: recipientA, transactionTarget: recipientA },
        planDigest: replacement.planDigest,
        tenantId: replacement.tenantId,
        userId,
      }),
    ).toBe(false);
    await repository.completeReplacement({
      authorization: replacement,
      deliveredAt: new Date(baseTime.getTime() + 5_001),
      result: {
        deliveryId: "postgres-fixture:replacement",
        planDigest: replacement.planDigest,
        status: "accepted",
        transactionHash: `0x${"4".repeat(64)}`,
      },
    });
    const lineage = await pool.query<{
      active: boolean;
      generation: number;
      state: string;
    }>(
      `SELECT generation, state, active
         FROM wallet_transfer_transactions
        WHERE operation_id = $1
        ORDER BY generation`,
      [operationB.operationId],
    );
    expect(lineage.rows).toEqual([
      { active: false, generation: 0, state: "replaced" },
      { active: true, generation: 1, state: "broadcast" },
    ]);
    expect(lineage.rows.filter(({ active }) => active)).toHaveLength(1);

    const evidence = await pool.query<{ evidence_id: string }>(
      `SELECT evidence_id::text FROM wallet_transfer_receipt_evidence
        WHERE transaction_hash = $1`,
      [confirmedHash],
    );
    expect(evidence.rows).toHaveLength(1);
    await expect(
      pool.query(
        "UPDATE wallet_transfer_receipt_evidence SET canonical = false WHERE evidence_id = $1",
        [evidence.rows[0]!.evidence_id],
      ),
    ).rejects.toThrow(/append-only/u);
  });
});
