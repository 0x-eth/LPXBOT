import { randomUUID } from "node:crypto";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "../../packages/chain-registry/src/index.js";
import {
  buildLocalPositionSnapshot,
  LocalPositionExecutionService,
  PostgresLocalPositionOperationStore,
  PostgresLocalPositionPreviewStore,
  PostgresLocalPositionSnapshotStore,
  type LocalPositionChainInspection,
} from "../../apps/api/src/index.js";
import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import {
  PostgresLocalPositionRecoveryRepository,
  type LocalPositionReceiptObservation,
  type LocalPositionWorkClaim,
} from "../../apps/worker/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const tenantId = "tenant-position-recovery";
const userId = randomUUID();
const sessionId = randomUUID();
const walletId = randomUUID();
const pricingId = randomUUID();
const walletAddress = "0x1000000000000000000000000000000000000077" as const;
let clock = new Date("2026-08-20T08:00:00.000Z");

async function createWallet(): Promise<CustodyWallet> {
  const store = new PostgresCustodyWalletStore(pool);
  return store.create({
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
      name: "Local Position recovery fixture",
      revision: 1,
      tenantId,
      updatedAt: clock,
      userId,
      walletId,
    },
  });
}

async function createPricingPosition(): Promise<void> {
  const stateEventId = randomUUID();
  await pool.query(
    `INSERT INTO pricing_positions (
       pricing_id, tenant_id, user_id, wallet_id, wallet_address, chain_id,
       platform_id, position_manager, token_id, pool_address, pool_id, token0, token1,
       cost_amount0_base_unit, cost_amount1_base_unit, cost_usd_value_decimal,
       cost_price_observed_at, cost_price_source, cost_price_status, imported_at
     ) VALUES (
       $1, $2, $3, $4, $5, 56, 1, $6, 1, $7, NULL, $8, $9,
       1001, 2003, NULL, NULL, NULL, 'missing', $10
     )`,
    [
      pricingId,
      tenantId,
      userId,
      walletId,
      walletAddress,
      registry.manager.address,
      "0x0000000000000000000000000000000000001234",
      registry.tokenPolicy.tokens[0]!.address,
      registry.tokenPolicy.tokens[1]!.address,
      clock,
    ],
  );
  await pool.query(
    `INSERT INTO pricing_position_state_events (
       state_event_id, pricing_id, tenant_id, user_id, revision, status, created_at
     ) VALUES ($1, $2, $3, $4, 1, 'active', $5)`,
    [stateEventId, pricingId, tenantId, userId, clock],
  );
}

async function claim(
  repository: PostgresLocalPositionRecoveryRepository,
  operationId: string,
): Promise<LocalPositionWorkClaim> {
  const claims = await repository.claimDue({
    leaseMilliseconds: 60_000,
    limit: 10,
    now: clock,
    workerId: "local-position-postgres",
  });
  const selected = claims.find(({ operation }) => operation.operationId === operationId);
  if (!selected) throw new Error(`No local position claim for ${operationId}`);
  return selected;
}

function receipt(
  claimValue: LocalPositionWorkClaim,
  block: number,
): LocalPositionReceiptObservation {
  const { plan, step } = claimValue.operation;
  const wallet0 = "500";
  const wallet1 = "700";
  const base = {
    blockCanonical: true,
    blockHash: `0x${block.toString(16).padStart(64, "0")}` as const,
    blockNumber: String(block),
    burnEvent: false,
    collectAmount0: null,
    collectAmount1: null,
    collectRecipient: null,
    confirmations: "2",
    decreaseAmount0: null,
    decreaseAmount1: null,
    decreaseLiquidityDelta: null,
    managerRuntimeCodeHash: plan.manager.runtimeCodeHash,
    ownerBefore: plan.wallet.address,
    receiptStatus: "success" as const,
    transactionHash: claimValue.operation.activeTransaction!.transactionHash,
  };
  if (step.kind === "decrease") {
    return {
      ...base,
      decreaseAmount0: plan.accounting.principal0BaseUnit,
      decreaseAmount1: plan.accounting.principal1BaseUnit,
      decreaseLiquidityDelta: plan.accounting.liquidityDelta,
      liquidityAfter: plan.accounting.remainingLiquidity,
      liquidityBefore: plan.snapshot.position.liquidity,
      ownerAfter: plan.wallet.address,
      reserve0After: "0",
      reserve0Before: plan.snapshot.position.reserve0BaseUnit,
      reserve1After: "0",
      reserve1Before: plan.snapshot.position.reserve1BaseUnit,
      tokensOwed0After: plan.accounting.collectTotal0BaseUnit,
      tokensOwed0Before: plan.snapshot.position.tokensOwed0BaseUnit,
      tokensOwed1After: plan.accounting.collectTotal1BaseUnit,
      tokensOwed1Before: plan.snapshot.position.tokensOwed1BaseUnit,
      walletToken0After: wallet0,
      walletToken0Before: wallet0,
      walletToken0Delta: "0",
      walletToken1After: wallet1,
      walletToken1Before: wallet1,
      walletToken1Delta: "0",
    };
  }
  if (step.kind === "collect") {
    return {
      ...base,
      collectAmount0: plan.accounting.collectTotal0BaseUnit,
      collectAmount1: plan.accounting.collectTotal1BaseUnit,
      collectRecipient: plan.wallet.address,
      liquidityAfter: "0",
      liquidityBefore: "0",
      ownerAfter: plan.wallet.address,
      reserve0After: "0",
      reserve0Before: "0",
      reserve1After: "0",
      reserve1Before: "0",
      tokensOwed0After: "0",
      tokensOwed0Before: plan.accounting.collectTotal0BaseUnit,
      tokensOwed1After: "0",
      tokensOwed1Before: plan.accounting.collectTotal1BaseUnit,
      walletToken0After: (
        BigInt(wallet0) + BigInt(plan.accounting.collectTotal0BaseUnit)
      ).toString(),
      walletToken0Before: wallet0,
      walletToken0Delta: plan.accounting.collectTotal0BaseUnit,
      walletToken1After: (
        BigInt(wallet1) + BigInt(plan.accounting.collectTotal1BaseUnit)
      ).toString(),
      walletToken1Before: wallet1,
      walletToken1Delta: plan.accounting.collectTotal1BaseUnit,
    };
  }
  return {
    ...base,
    burnEvent: true,
    liquidityAfter: null,
    liquidityBefore: "0",
    ownerAfter: null,
    reserve0After: null,
    reserve0Before: "0",
    reserve1After: null,
    reserve1Before: "0",
    tokensOwed0After: null,
    tokensOwed0Before: "0",
    tokensOwed1After: null,
    tokensOwed1Before: "0",
    walletToken0After: wallet0,
    walletToken0Before: wallet0,
    walletToken0Delta: "0",
    walletToken1After: wallet1,
    walletToken1Before: wallet1,
    walletToken1Delta: "0",
  };
}

async function broadcast(
  repository: PostgresLocalPositionRecoveryRepository,
  queued: LocalPositionWorkClaim,
  hashByte: string,
): Promise<void> {
  await repository.completeBroadcast({
    claim: queued,
    deliveredAt: new Date(clock.getTime() + 1),
    result: {
      deliveryId: `position-${queued.operation.step.kind}`,
      generation: 0,
      planDigest: queued.operation.planDigest,
      status: "accepted",
      stepId: queued.operation.step.stepId,
      transactionHash: `0x${hashByte.repeat(32)}`,
    },
  });
  clock = new Date(clock.getTime() + 1_000);
}

async function confirm(
  repository: PostgresLocalPositionRecoveryRepository,
  operationId: string,
  block: number,
): Promise<LocalPositionWorkClaim> {
  const current = await claim(repository, operationId);
  const complete = current.operation.step.ordinal === current.operation.plan.steps.length - 1;
  await repository.applyObservation({
    claim: current,
    decision: {
      failureCode: null,
      kind: "receipt",
      next: complete ? "complete-success" : "advance",
      operationState: complete ? "succeeded" : "pending",
      reason: null,
      receipt: receipt(current, block),
      stepState: "succeeded",
      transactionId: current.operation.activeTransaction!.transactionId,
    },
    observedAt: clock,
  });
  return current;
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Local Position recovery fixture', $2, $2)`,
    [userId, clock],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P05-07 PostgreSQL local position recovery", () => {
  it("recovers each cursor, persists replacement lineage and completes accounting/withdrawn", async () => {
    const wallet = await createWallet();
    await createPricingPosition();
    const snapshot = buildLocalPositionSnapshot({
      block: { hash: `0x${"71".repeat(32)}`, number: "8", timestamp: clock.toISOString() },
      chainId: 31_337,
      expiresAt: new Date(clock.getTime() + 30_000).toISOString(),
      manager: structuredClone(registry.manager),
      observedAt: clock.toISOString(),
      position: {
        approval: { approvedAddress: null, approvedForAll: false, operator: null },
        liquidity: "101",
        owner: walletAddress,
        platformId: 1,
        pool: {
          feePips: "3000",
          poolAddress: "0x0000000000000000000000000000000000001234",
          poolId: null,
          tickSpacing: "60",
          token0: registry.tokenPolicy.tokens[0]!.address,
          token1: registry.tokenPolicy.tokens[1]!.address,
        },
        reserve0BaseUnit: "1001",
        reserve1BaseUnit: "2003",
        ticks: { lower: "-120", upper: "120" },
        tokenId: "1",
        tokensOwed0BaseUnit: "11",
        tokensOwed1BaseUnit: "13",
      },
      registry: { digest: registry.registryDigest, version: registry.registryVersion },
      tokens: [
        {
          address: registry.tokenPolicy.tokens[0]!.address,
          runtimeCodeHash: registry.tokenPolicy.tokens[0]!.runtimeCodeHash,
        },
        {
          address: registry.tokenPolicy.tokens[1]!.address,
          runtimeCodeHash: registry.tokenPolicy.tokens[1]!.runtimeCodeHash,
        },
      ],
      wallet: { address: walletAddress, walletId },
    });
    const snapshots = new PostgresLocalPositionSnapshotStore(pool);
    await snapshots.append({ pricingId, snapshot, tenantId, userId });
    expect(await snapshots.listCurrent({ tenantId, userId, walletId })).toEqual([snapshot]);
    expect(await snapshots.listCurrent({ tenantId, userId: randomUUID(), walletId })).toEqual([]);
    const inspection: LocalPositionChainInspection = {
      blockHash: snapshot.block.hash,
      blockNumber: snapshot.block.number,
      headBlockNumber: "9",
      manager: {
        address: snapshot.manager.address,
        runtimeCodeHash: snapshot.manager.runtimeCodeHash,
      },
      nonceViews: [
        { latest: "0", pending: "0", providerId: "anvil-a" },
        { latest: "0", pending: "0", providerId: "anvil-b" },
      ],
      position: structuredClone(snapshot.position),
      tokenCode: snapshot.tokens.map((token) => ({ ...token })),
    };
    const operationStore = new PostgresLocalPositionOperationStore(pool, { now: () => clock });
    const service = new LocalPositionExecutionService({
      chain: {
        async inspect() {
          return structuredClone(inspection);
        },
      },
      now: () => clock,
      operations: operationStore,
      previews: new PostgresLocalPositionPreviewStore(pool),
      snapshots,
    });
    const request = {
      burnIfEmpty: true,
      percent: 100,
      platformId: 1 as const,
      slippageBps: 100,
      snapshotDigest: snapshot.snapshotDigest,
      tokenId: "1",
      walletId,
    };
    const preview = await service.previewRemoveLiquidity({ request, tenantId, userId, wallet });
    const submitted = await service.removeLiquidity({
      idempotencyKey: "postgres-position-remove-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "postgres-position-remove",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const operationId = submitted.operation.operationId;
    let repository = new PostgresLocalPositionRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });

    const decreaseQueued = await claim(repository, operationId);
    expect(decreaseQueued.operation.step.kind).toBe("decrease");
    await broadcast(repository, decreaseQueued, "21");
    await confirm(repository, operationId, 10);

    const collectQueued = await claim(repository, operationId);
    expect(collectQueued.operation.step.kind).toBe("collect");
    await repository.failClaim({
      claim: collectQueued,
      code: "SIGNER_UNAVAILABLE",
      failedAt: clock,
      retryable: true,
    });
    clock = new Date(clock.getTime() + 31_000);
    const collectRetry = await claim(repository, operationId);
    expect(collectRetry.operation.priorSucceededStepIds).toEqual([
      decreaseQueued.operation.step.stepId,
    ]);
    await broadcast(repository, collectRetry, "22");
    const authorization = await repository.prepareReplacement({
      fee: {
        maxFeePerGasBaseUnit: "3000000000",
        maxPriorityFeePerGasBaseUnit: "1500000000",
      },
      now: clock,
      operationId,
      reason: "fixture collect replacement",
      stepId: collectRetry.operation.step.stepId,
    });
    await repository.completeReplacement({
      authorization,
      deliveredAt: new Date(clock.getTime() + 1),
      result: {
        deliveryId: "position-collect-replacement",
        generation: 1,
        planDigest: authorization.plan.planDigest,
        status: "accepted",
        stepId: authorization.stepId,
        transactionHash: `0x${"23".repeat(32)}`,
      },
    });
    clock = new Date(clock.getTime() + 1_000);
    const collectConfirmed = await confirm(repository, operationId, 11);
    expect(collectConfirmed.operation.transactionLineage).toHaveLength(2);

    const burnQueued = await claim(repository, operationId);
    expect(burnQueued.operation.step.kind).toBe("burn");
    await repository.failClaim({
      claim: burnQueued,
      code: "SIGNER_UNAVAILABLE",
      failedAt: clock,
      retryable: true,
    });
    clock = new Date(clock.getTime() + 31_000);
    repository = new PostgresLocalPositionRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });
    const burnRestarted = await claim(repository, operationId);
    expect(burnRestarted.operation.priorSucceededStepIds).toEqual([
      decreaseQueued.operation.step.stepId,
      collectRetry.operation.step.stepId,
    ]);
    await broadcast(repository, burnRestarted, "24");
    await confirm(repository, operationId, 12);

    const completed = await operationStore.get({ operationId, tenantId, userId });
    expect(completed).toMatchObject({ state: "succeeded" });
    expect(completed?.steps.map(({ state }) => state)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    const evidence = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM local_position_receipt_evidence
        WHERE operation_id = $1`,
      [operationId],
    );
    const proceeds = await pool.query<{
      availability: string;
      classification: string;
      count: string;
    }>(
      `SELECT classification, availability, count(*)::text AS count
         FROM local_position_proceeds_events WHERE operation_id = $1
        GROUP BY classification, availability ORDER BY classification, availability`,
      [operationId],
    );
    const decreaseTransactions = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM local_position_step_transactions t
        JOIN local_position_operation_steps s ON s.step_id = t.step_id
       WHERE s.operation_id = $1 AND s.step_kind = 'decrease'`,
      [operationId],
    );
    const pricing = await pool.query<{ status: string }>(
      `SELECT status FROM pricing_position_state_events WHERE pricing_id = $1
        ORDER BY revision DESC LIMIT 1`,
      [pricingId],
    );
    const completion = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM local_position_pricing_completions
        WHERE operation_id = $1`,
      [operationId],
    );
    expect(evidence.rows[0]?.count).toBe("3");
    expect(proceeds.rows).toEqual([
      { availability: "available", classification: "fee", count: "2" },
      { availability: "available", classification: "principal", count: "2" },
      { availability: "pending-collect", classification: "principal", count: "2" },
    ]);
    expect(decreaseTransactions.rows[0]?.count).toBe("1");
    expect(pricing.rows[0]?.status).toBe("withdrawn");
    expect(completion.rows[0]?.count).toBe("1");

    await expect(pool.query("DELETE FROM users WHERE id = $1", [userId])).resolves.toMatchObject({
      rowCount: 1,
    });
  });
});
