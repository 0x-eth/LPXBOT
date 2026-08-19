import {
  decideLocalSwapObservation,
  type LocalSwapObservation,
  type LocalSwapReceiptObservation,
  type LocalSwapStepWorkOperation,
  type LocalSwapTransactionReference,
} from "../apps/worker/src/local-swap-worker.js";
import type { LocalSwapPlanStep } from "../packages/domain/src/local-swap-execution.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T04:00:00.000Z");
const transaction: LocalSwapTransactionReference = {
  active: true,
  dataDigest: `sha256:${"11".repeat(32)}`,
  fee: { maxFeePerGasBaseUnit: "10", maxPriorityFeePerGasBaseUnit: "1" },
  generation: 0,
  nonce: "8",
  planDigest: `sha256:${"22".repeat(32)}`,
  semanticDigest: `sha256:${"33".repeat(32)}`,
  target: "0x0165878a594ca255338adfa4d48449f69242eb8f",
  transactionHash: `0x${"44".repeat(32)}`,
  transactionId: "a6300000-0000-4000-8000-000000000001",
  updatedAt: new Date(now.getTime() - 2_000).toISOString(),
};

function step(kind: LocalSwapPlanStep["kind"]): LocalSwapPlanStep {
  return {
    feeLimit: {
      feeCapBaseUnit: "2000000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "20",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "1",
    kind,
    nonce: "8",
    ordinal: kind === "cleanup" ? 2 : kind === "swap" ? 1 : 0,
    runCondition: kind === "cleanup" ? "swap-failed-after-approval" : "always",
    semanticDigest: transaction.semanticDigest,
    stepId: "a6300000-0000-4000-8000-000000000002",
    transaction: {
      data: kind === "swap" ? "0x5a547e89" : "0x095ea7b3",
      dataDigest: transaction.dataDigest,
      to: transaction.target,
      valueBaseUnit: "0",
    },
  };
}

function operation(kind: LocalSwapPlanStep["kind"]): LocalSwapStepWorkOperation {
  const current = step(kind);
  return {
    activeTransaction: transaction,
    approvalSucceeded: kind === "swap" || kind === "cleanup",
    operationId: "a6300000-0000-4000-8000-000000000003",
    operationState: "pending",
    plan: {
      quote: { amountInBaseUnit: "1000", minOutBaseUnit: "990" },
      steps: [current],
    } as unknown as LocalSwapStepWorkOperation["plan"],
    planDigest: transaction.planDigest,
    reauthenticatedSessionId: null,
    step: current,
    stepState: "pending",
    tenantId: "local-fixture",
    transactionLineage: [transaction],
    userId: "a6300000-0000-4000-8000-000000000004",
  };
}

function receipt(
  overrides: Partial<LocalSwapReceiptObservation> = {},
): LocalSwapReceiptObservation {
  return {
    adapterToRouterAllowance: "0",
    blockCanonical: true,
    blockHash: `0x${"55".repeat(32)}`,
    blockNumber: "9",
    confirmations: "1",
    helperInputDust: "0",
    helperOutputDust: "0",
    helperToAdapterAllowance: "0",
    minOutBaseUnit: "990",
    ownerOutputAfter: "2000",
    ownerOutputBefore: "1000",
    ownerToSpenderAllowance: "0",
    planExecutedEvent: true,
    planReplayRecorded: true,
    receiptStatus: "success",
    swapExecutedEvent: true,
    transactionHash: transaction.transactionHash,
    ...overrides,
  };
}

function observation(value: LocalSwapReceiptObservation | null): LocalSwapObservation {
  return {
    providers: [
      {
        latestNonce: "9",
        pendingNonce: "9",
        providerId: "anvil-primary",
        receipt: value,
        transactionFound: value !== null,
      },
    ],
  };
}

function decide(kind: LocalSwapPlanStep["kind"], value: LocalSwapReceiptObservation | null) {
  return decideLocalSwapObservation({
    approvalSucceeded: kind === "swap" || kind === "cleanup",
    dropAfterMilliseconds: 1_000,
    now,
    observation: observation(value),
    operation: operation(kind),
    requiredConfirmations: 1,
  });
}

describe("P05-06 local Swap recovery decisions", () => {
  it("advances exact approval and closes a fully reconciled Swap", () => {
    expect(decide("approve", receipt({ ownerToSpenderAllowance: "1000" }))).toMatchObject({
      next: "advance",
      operationState: "pending",
      stepState: "succeeded",
    });
    expect(decide("swap", receipt())).toMatchObject({
      next: "complete-success",
      operationState: "succeeded",
      stepState: "succeeded",
    });
  });

  it("queues cleanup and stays reconciling when Swap reverts after approval", () => {
    expect(decide("swap", receipt({ receiptStatus: "reverted" }))).toMatchObject({
      failureCode: "SWAP_REVERTED",
      next: "cleanup-required",
      operationState: "reconciling",
      reason: "ALLOWANCE_CLEANUP_REQUIRED",
    });
  });

  it("finishes the failed operation only after canonical cleanup proves allowance zero", () => {
    expect(decide("cleanup", receipt())).toMatchObject({
      failureCode: "SWAP_REVERTED",
      next: "complete-failed",
      operationState: "failed",
    });
    expect(decide("cleanup", receipt({ ownerToSpenderAllowance: "1" }))).toMatchObject({
      next: "reconciling",
      operationState: "reconciling",
      reason: "ALLOWANCE_NOT_ZERO",
    });
  });

  it("keeps an unconfirmed cleanup in reconciling", () => {
    expect(
      decide("cleanup", receipt({ confirmations: "0", ownerToSpenderAllowance: "0" })),
    ).toMatchObject({
      operationState: "reconciling",
      reason: "ALLOWANCE_CLEANUP_REQUIRED",
      stepState: "confirmed",
    });
    expect(decide("cleanup", null)).toMatchObject({
      operationState: "reconciling",
      reason: "ALLOWANCE_CLEANUP_REQUIRED",
    });
  });

  it.each([
    ["minOut", { ownerOutputAfter: "1989" }, "SWAP_MIN_OUT_MISMATCH"],
    ["event", { swapExecutedEvent: false }, "SWAP_EVENT_OR_REPLAY_MISMATCH"],
    ["allowance", { helperToAdapterAllowance: "1" }, "SWAP_ALLOWANCE_NOT_ZERO"],
    ["dust", { helperInputDust: "2" }, "SWAP_HELPER_DUST_EXCEEDED"],
  ] as const)(
    "reconciles %s postcondition mismatch and requests cleanup",
    (_name, changed, reason) => {
      expect(decide("swap", receipt(changed))).toMatchObject({
        next: "cleanup-required",
        operationState: "reconciling",
        reason,
      });
    },
  );

  it("moves reorged canonical evidence to reconciling", () => {
    expect(decide("swap", receipt({ blockCanonical: false }))).toMatchObject({
      next: "reconciling",
      operationState: "reconciling",
      reason: "REORG_BLOCK_NONCANONICAL",
    });
  });
});
