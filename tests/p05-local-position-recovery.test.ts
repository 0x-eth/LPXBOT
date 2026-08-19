import { createHash } from "node:crypto";

import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  localPositionAccounting,
  localPositionExecutionPlanDigest,
  localPositionSnapshotDigest,
  localPositionStepSemanticDigest,
  type LocalPositionExecutionPlan,
  type LocalPositionPlanStep,
  type LocalPositionSnapshot,
} from "../packages/domain/src/local-position-execution.js";
import {
  decideLocalPositionObservation,
  LocalPositionRecoveryWorker,
  LocalPositionWorkerError,
  type LocalPositionObservation,
  type LocalPositionReceiptObservation,
  type LocalPositionStepSignerGateway,
  type LocalPositionStepWorkOperation,
  type LocalPositionTransactionReference,
  type LocalPositionWorkClaim,
  type LocalPositionWorkRepository,
} from "../apps/worker/src/local-position-worker.js";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-20T07:00:00.000Z");
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const wallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  walletId: "a7200000-0000-4000-8000-000000000001",
} as const;

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function snapshot(): LocalPositionSnapshot {
  const value: LocalPositionSnapshot = {
    block: { hash: `0x${"12".repeat(32)}`, number: "8", timestamp: now.toISOString() },
    chainId: 31_337,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    manager: structuredClone(registry.manager),
    observedAt: now.toISOString(),
    position: {
      approval: { approvedAddress: null, approvedForAll: false, operator: null },
      liquidity: "101",
      owner: wallet.address,
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
    schemaVersion: 2,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: registry.snapshotVersion,
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
    wallet,
  };
  value.snapshotDigest = localPositionSnapshotDigest(value);
  return value;
}

function planStep(ordinal: number, kind: "decrease" | "collect" | "burn"): LocalPositionPlanStep {
  const selector =
    kind === "decrease"
      ? registry.manager.selectors.decreaseLiquidity
      : registry.manager.selectors[kind];
  const value: LocalPositionPlanStep = {
    feeLimit: {
      feeCapBaseUnit: "400000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: String(ordinal + 1),
    kind,
    nonce: String(8 + ordinal),
    ordinal,
    runCondition: "always",
    semanticDigest: `sha256:${"00".repeat(32)}`,
    stepId: `a7200000-0000-4000-8000-00000000001${ordinal}`,
    transaction: {
      data: `${selector}${"00".repeat(32)}`,
      dataDigest: digest(`${kind}-data`),
      to: registry.manager.address,
      valueBaseUnit: "0",
    },
  };
  value.semanticDigest = localPositionStepSemanticDigest(value);
  return value;
}

function plan(): LocalPositionExecutionPlan {
  const state = snapshot();
  const action = {
    burnIfEmpty: true,
    kind: "remove-liquidity",
    percent: 100,
    slippageBps: 100,
  } as const;
  const value: LocalPositionExecutionPlan = {
    accounting: localPositionAccounting(state, action),
    action,
    chainId: 31_337,
    deadline: new Date(now.getTime() + 600_000).toISOString(),
    manager: structuredClone(registry.manager),
    operationId: "a7200000-0000-4000-8000-000000000020",
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: registry.planVersion,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    serviceFeeBps: 0,
    snapshot: state,
    steps: [planStep(0, "decrease"), planStep(1, "collect"), planStep(2, "burn")],
    wallet,
  };
  value.planDigest = localPositionExecutionPlanDigest(value);
  return value;
}

function transaction(value: LocalPositionExecutionPlan, ordinal: number) {
  const step = value.steps[ordinal]!;
  return {
    active: true,
    dataDigest: step.transaction.dataDigest,
    fee: { maxFeePerGasBaseUnit: "2", maxPriorityFeePerGasBaseUnit: "1" },
    generation: 0,
    nonce: step.nonce,
    planDigest: value.planDigest,
    semanticDigest: step.semanticDigest,
    target: step.transaction.to,
    transactionHash: `0x${String(ordinal + 1)
      .padStart(2, "0")
      .repeat(32)}`,
    transactionId: `a7200000-0000-4000-8000-00000000003${ordinal}`,
    updatedAt: new Date(now.getTime() - 2_000).toISOString(),
  } as LocalPositionTransactionReference;
}

function operation(value: LocalPositionExecutionPlan, ordinal: number, state = "pending") {
  const step = value.steps[ordinal]!;
  const active = state === "queued" ? null : transaction(value, ordinal);
  return {
    activeTransaction: active,
    operationId: value.operationId,
    operationState: state === "queued" ? "queued" : "pending",
    plan: value,
    planDigest: value.planDigest,
    priorSucceededStepIds: value.steps.slice(0, ordinal).map(({ stepId }) => stepId),
    reauthenticatedSessionId: null,
    step,
    stepState: state,
    tenantId: "local-position-recovery",
    transactionLineage: active ? [active] : [],
    userId: "a7200000-0000-4000-8000-000000000040",
  } as LocalPositionStepWorkOperation;
}

function receipt(
  value: LocalPositionExecutionPlan,
  ordinal: number,
  overrides: Partial<LocalPositionReceiptObservation> = {},
): LocalPositionReceiptObservation {
  const step = value.steps[ordinal]!;
  const tx = transaction(value, ordinal);
  const common = {
    blockCanonical: true,
    blockHash: `0x${"55".repeat(32)}` as const,
    blockNumber: String(20 + ordinal),
    burnEvent: false,
    collectAmount0: null,
    collectAmount1: null,
    collectRecipient: null,
    confirmations: "1",
    decreaseAmount0: null,
    decreaseAmount1: null,
    decreaseLiquidityDelta: null,
    managerRuntimeCodeHash: value.manager.runtimeCodeHash,
    ownerBefore: wallet.address,
    receiptStatus: "success" as const,
    transactionHash: tx.transactionHash,
  };
  const beforeWallet0 = "500";
  const beforeWallet1 = "500";
  if (step.kind === "decrease") {
    return {
      ...common,
      decreaseAmount0: "1001",
      decreaseAmount1: "2003",
      decreaseLiquidityDelta: "101",
      liquidityAfter: "0",
      liquidityBefore: "101",
      ownerAfter: wallet.address,
      reserve0After: "0",
      reserve0Before: "1001",
      reserve1After: "0",
      reserve1Before: "2003",
      tokensOwed0After: "1012",
      tokensOwed0Before: "11",
      tokensOwed1After: "2016",
      tokensOwed1Before: "13",
      walletToken0After: beforeWallet0,
      walletToken0Before: beforeWallet0,
      walletToken0Delta: "0",
      walletToken1After: beforeWallet1,
      walletToken1Before: beforeWallet1,
      walletToken1Delta: "0",
      ...overrides,
    };
  }
  if (step.kind === "collect") {
    return {
      ...common,
      collectAmount0: "1012",
      collectAmount1: "2016",
      collectRecipient: wallet.address,
      liquidityAfter: "0",
      liquidityBefore: "0",
      ownerAfter: wallet.address,
      reserve0After: "0",
      reserve0Before: "0",
      reserve1After: "0",
      reserve1Before: "0",
      tokensOwed0After: "0",
      tokensOwed0Before: "1012",
      tokensOwed1After: "0",
      tokensOwed1Before: "2016",
      walletToken0After: "1512",
      walletToken0Before: beforeWallet0,
      walletToken0Delta: "1012",
      walletToken1After: "2516",
      walletToken1Before: beforeWallet1,
      walletToken1Delta: "2016",
      ...overrides,
    };
  }
  return {
    ...common,
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
    walletToken0After: beforeWallet0,
    walletToken0Before: beforeWallet0,
    walletToken0Delta: "0",
    walletToken1After: beforeWallet1,
    walletToken1Before: beforeWallet1,
    walletToken1Delta: "0",
    ...overrides,
  };
}

function observation(
  value: LocalPositionReceiptObservation | null,
  nonce: string,
): LocalPositionObservation {
  return {
    providers: [
      {
        latestNonce: nonce,
        pendingNonce: nonce,
        providerId: "anvil-primary",
        receipt: value,
        transactionFound: value !== null,
      },
    ],
  };
}

function decide(
  value: LocalPositionExecutionPlan,
  ordinal: number,
  result: LocalPositionReceiptObservation | null,
) {
  const current = operation(value, ordinal);
  return decideLocalPositionObservation({
    dropAfterMilliseconds: 1_000,
    now,
    observation: observation(result, String(9 + ordinal)),
    operation: current,
    requiredConfirmations: 1,
  });
}

describe("P05-07 local position recovery", () => {
  it("advances decrease and collect exactly once before completing burn", () => {
    const value = plan();
    expect(decide(value, 0, receipt(value, 0))).toMatchObject({
      next: "advance",
      operationState: "pending",
      stepState: "succeeded",
    });
    expect(decide(value, 1, receipt(value, 1))).toMatchObject({
      next: "advance",
      operationState: "pending",
      stepState: "succeeded",
    });
    expect(decide(value, 2, receipt(value, 2))).toMatchObject({
      next: "complete-success",
      operationState: "succeeded",
      stepState: "succeeded",
    });
  });

  it("rejects proceeds, recipient and burn postcondition mismatches", () => {
    const value = plan();
    expect(decide(value, 0, receipt(value, 0, { walletToken0Delta: "1001" }))).toMatchObject({
      next: "reconciling",
      reason: "DECREASE_POSTCONDITION_MISMATCH",
    });
    expect(
      decide(value, 1, receipt(value, 1, { collectRecipient: registry.manager.address })),
    ).toMatchObject({ next: "reconciling", reason: "COLLECT_POSTCONDITION_MISMATCH" });
    expect(decide(value, 2, receipt(value, 2, { burnEvent: false }))).toMatchObject({
      next: "reconciling",
      reason: "BURN_POSTCONDITION_MISMATCH",
    });
  });

  it("moves reorg and provider divergence to reconciliation and marks an absent tx dropped", () => {
    const value = plan();
    expect(decide(value, 1, receipt(value, 1, { blockCanonical: false }))).toMatchObject({
      operationState: "reconciling",
      reason: "REORG_BLOCK_NONCANONICAL",
    });
    const current = operation(value, 1);
    expect(
      decideLocalPositionObservation({
        dropAfterMilliseconds: 1_000,
        now,
        observation: {
          providers: [
            ...observation(receipt(value, 1), "10").providers,
            {
              ...observation(receipt(value, 1, { confirmations: "2" }), "10").providers[0]!,
              providerId: "anvil-secondary",
            },
          ],
        },
        operation: current,
        requiredConfirmations: 1,
      }),
    ).toMatchObject({ operationState: "reconciling", reason: "PROVIDER_DIVERGENCE" });
    expect(
      decideLocalPositionObservation({
        dropAfterMilliseconds: 1_000,
        now,
        observation: observation(null, current.step.nonce),
        operation: current,
        requiredConfirmations: 1,
      }),
    ).toMatchObject({ operationState: "pending", stepState: "dropped" });
  });

  it.each([
    ["collect", 1],
    ["burn", 2],
  ] as const)(
    "restarts from the %s cursor after a transient signer failure",
    async (_name, ordinal) => {
      const value = plan();
      const claim: LocalPositionWorkClaim = {
        leaseToken: "a7200000-0000-4000-8000-000000000050",
        operation: operation(value, ordinal, "queued"),
        outboxEventId: "a7200000-0000-4000-8000-000000000051",
      };
      const failClaim = vi.fn<LocalPositionWorkRepository["failClaim"]>();
      const completeBroadcast = vi.fn<LocalPositionWorkRepository["completeBroadcast"]>();
      const repository = {
        applyObservation: vi.fn(),
        claimDue: vi.fn(async () => [claim]),
        completeBroadcast,
        completeReplacement: vi.fn(),
        failClaim,
        prepareReplacement: vi.fn(),
        rejectReplacement: vi.fn(),
      } as unknown as LocalPositionWorkRepository;
      const unavailable: LocalPositionStepSignerGateway = {
        async signAndDeliver() {
          throw new LocalPositionWorkerError("SIGNER_UNAVAILABLE", true);
        },
      };
      const first = new LocalPositionRecoveryWorker({
        now: () => now,
        observer: {
          async observe() {
            return { providers: [] };
          },
        },
        repository,
        signer: unavailable,
        workerId: "position-worker-1",
      });
      await expect(first.processBatch()).resolves.toMatchObject({ retried: 1 });
      expect(failClaim).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));

      const signer = {
        signAndDeliver: vi.fn(async () => ({
          deliveryId: "anvil-delivery-1",
          generation: 0,
          planDigest: value.planDigest,
          status: "accepted" as const,
          stepId: value.steps[ordinal]!.stepId,
          transactionHash: `0x${"77".repeat(32)}` as const,
        })),
      };
      const restarted = new LocalPositionRecoveryWorker({
        now: () => now,
        observer: {
          async observe() {
            return { providers: [] };
          },
        },
        repository,
        signer,
        workerId: "position-worker-2",
      });
      await expect(restarted.processBatch()).resolves.toMatchObject({ broadcast: 1 });
      expect(signer.signAndDeliver).toHaveBeenCalledWith(
        expect.objectContaining({ stepId: value.steps[ordinal]!.stepId }),
      );
      expect(signer.signAndDeliver).not.toHaveBeenCalledWith(
        expect.objectContaining({ stepId: value.steps[0]!.stepId }),
      );
      expect(completeBroadcast).toHaveBeenCalledOnce();
    },
  );

  it("replaces only the active collect lineage with higher fees", async () => {
    const value = plan();
    const selected = value.steps[1]!;
    const previous = transaction(value, 1);
    const authorization = {
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      generation: 1,
      next: {
        ...previous,
        fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
      },
      operationId: value.operationId,
      plan: value,
      previous,
      reauthenticatedSessionId: null,
      stepId: selected.stepId,
      tenantId: "local-position-recovery",
      userId: "a7200000-0000-4000-8000-000000000040",
    };
    const completeReplacement = vi.fn();
    const repository = {
      prepareReplacement: vi.fn(async () => authorization),
      completeReplacement,
      rejectReplacement: vi.fn(),
    } as unknown as LocalPositionWorkRepository;
    const signer = {
      signAndDeliver: vi.fn(async () => ({
        deliveryId: "anvil-replacement-1",
        generation: 1,
        planDigest: value.planDigest,
        status: "accepted" as const,
        stepId: selected.stepId,
        transactionHash: `0x${"88".repeat(32)}` as const,
      })),
    };
    const worker = new LocalPositionRecoveryWorker({
      now: () => now,
      observer: {
        async observe() {
          return { providers: [] };
        },
      },
      repository,
      signer,
      workerId: "position-worker-1",
    });
    await expect(
      worker.replace({
        fee: authorization.next.fee,
        operationId: value.operationId,
        reason: "dropped from local mempool",
        stepId: selected.stepId,
      }),
    ).resolves.toMatchObject({ generation: 1 });
    expect(signer.signAndDeliver).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: 1,
        maxFeePerGasBaseUnit: "3",
        stepId: selected.stepId,
      }),
    );
    expect(completeReplacement).toHaveBeenCalledOnce();
  });
});
