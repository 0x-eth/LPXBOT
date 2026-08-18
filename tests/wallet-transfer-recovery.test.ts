import type { WalletTransferFeeLimit } from "../packages/api-contract/src/index.js";
import {
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "../packages/domain/src/wallet-transfer.js";
import {
  WalletTransferRecoveryWorker,
  WalletTransferWorkerError,
  decideWalletTransferObservation,
  replacementTransferPlan,
  type WalletTransferObservationDecision,
  type WalletTransferReplacementAuthorization,
  type WalletTransferSignerResult,
  type WalletTransferWorkClaim,
  type WalletTransferWorkRepository,
} from "../apps/worker/src/wallet-transfer-worker.js";
import {
  ResilientRawTransactionDelivery,
  type RawTransactionBroadcastPort,
} from "../apps/signer/src/resilient-raw-transaction-delivery.js";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-18T12:00:00.000Z");
const walletAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf" as const;
const recipient = "0x1111111111111111111111111111111111111111" as const;
const transactionHash = `0x${"a".repeat(64)}` as const;
const blockHash = `0x${"b".repeat(64)}` as const;
const policyDigest = `sha256:${"c".repeat(64)}` as const;

const plan: WalletTransferPlan = {
  amountBaseUnit: "1000",
  asset: { kind: "native" },
  chainId: 31_337,
  deadline: "2026-08-18T13:00:00.000Z",
  feeLimit: {
    feeCapBaseUnit: "42000",
    gasLimit: "21000",
    maxFeePerGasBaseUnit: "2",
    maxPriorityFeePerGasBaseUnit: "1",
  },
  fencingToken: "7",
  nonce: "3",
  operationId: "54000000-0000-4000-8000-000000000100",
  policyDigest,
  recipient,
  transactionData: "0x",
  transactionTarget: recipient,
  transactionValueBaseUnit: "1000",
  walletAddress,
  walletId: "54000000-0000-4000-8000-000000000011",
};

function workClaim(
  state: WalletTransferWorkClaim["operation"]["state"] = "pending",
): WalletTransferWorkClaim {
  return {
    eventId: "54000000-0000-4000-8000-000000000200",
    leaseToken: "54000000-0000-4000-8000-000000000201",
    operation: {
      activeTransaction:
        state === "queued"
          ? null
          : {
              generation: 0,
              maxFeePerGasBaseUnit: "2",
              maxPriorityFeePerGasBaseUnit: "1",
              state: state === "reconciling" ? "pending" : state,
              transactionHash,
              transactionId: "54000000-0000-4000-8000-000000000300",
              updatedAt: "2026-08-18T11:50:00.000Z",
            },
      assetKind: "native",
      operationId: plan.operationId,
      plan,
      planDigest: walletTransferPlanDigest(plan),
      state,
      tenantId: "tenant-fixture-01",
      userId: "54000000-0000-4000-8000-000000000001",
    },
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return {
    latestNonce: "3",
    pendingNonce: "4",
    providerId: "local-anvil-a",
    receipt: null,
    transactionFound: true,
    ...overrides,
  };
}

function signerResult(status: "accepted" | "already-known" = "accepted"):
  WalletTransferSignerResult {
  return {
    deliveryId: "local-adapter:aaaaaaaaaaaaaaaa",
    planDigest: walletTransferPlanDigest(plan),
    status,
    transactionHash,
  };
}

class MemoryRecoveryRepository implements WalletTransferWorkRepository {
  readonly broadcasts: WalletTransferSignerResult[] = [];
  readonly decisions: WalletTransferObservationDecision[] = [];
  readonly failures: Array<{ code: string; retryable: boolean }> = [];
  readonly replacements: WalletTransferSignerResult[] = [];
  claims: WalletTransferWorkClaim[];

  constructor(claims: WalletTransferWorkClaim[]) {
    this.claims = claims;
  }

  async claimDue() {
    return this.claims.splice(0);
  }

  async applyObservation(input: { decision: WalletTransferObservationDecision }) {
    this.decisions.push(input.decision);
  }

  async completeBroadcast(input: { result: WalletTransferSignerResult }) {
    this.broadcasts.push(input.result);
  }

  async failClaim(input: {
    claim: WalletTransferWorkClaim;
    code: string;
    retryable: boolean;
  }) {
    this.failures.push(input);
    if (input.retryable) this.claims.push(input.claim);
  }

  async prepareReplacement(input: {
    feeLimit: WalletTransferFeeLimit;
    now: Date;
    operationId: string;
  }): Promise<WalletTransferReplacementAuthorization> {
    const replacement = replacementTransferPlan({ feeLimit: input.feeLimit, now: input.now, plan });
    return {
      generation: 1,
      operationId: input.operationId,
      plan: replacement,
      planDigest: walletTransferPlanDigest(replacement),
      replacedTransactionId: "54000000-0000-4000-8000-000000000300",
      tenantId: "tenant-fixture-01",
      userId: "54000000-0000-4000-8000-000000000001",
    };
  }

  async completeReplacement(input: { result: WalletTransferSignerResult }) {
    this.replacements.push(input.result);
  }

  async rejectReplacement(input: { code: string; retryable: boolean }) {
    this.failures.push(input);
  }
}

describe("P04-06 transfer recovery decisions", () => {
  it("quarantines provider divergence and does not blindly rebroadcast", () => {
    const decision = decideWalletTransferObservation({
      dropAfterMilliseconds: 60_000,
      now,
      observation: {
        providers: [provider(), provider({ pendingNonce: "5", providerId: "local-anvil-b" })],
      },
      operation: workClaim().operation,
    });
    expect(decision).toEqual({
      kind: "transition",
      reason: "NONCE_PROVIDER_DIVERGENCE",
      state: "reconciling",
    });
  });

  it("marks a stale missing hash dropped and distinguishes a consumed nonce", () => {
    expect(
      decideWalletTransferObservation({
        dropAfterMilliseconds: 60_000,
        now,
        observation: {
          providers: [provider({ latestNonce: "4", pendingNonce: "4", transactionFound: false })],
        },
        operation: workClaim().operation,
      }),
    ).toEqual({
      kind: "transition",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
      state: "dropped",
    });
  });

  it("requires canonical identity, balance evidence, and ERC-20 Transfer logs", () => {
    const erc20Claim = workClaim();
    erc20Claim.operation.assetKind = "erc20";
    const receipt = {
      balanceReconciled: true,
      blockCanonical: true,
      blockHash,
      blockNumber: "10",
      from: walletAddress,
      nonce: "3",
      receiptStatus: "success" as const,
      tokenTransferLogReconciled: false,
      transactionHash,
      transactionTarget: recipient,
    };
    expect(
      decideWalletTransferObservation({
        dropAfterMilliseconds: 60_000,
        now,
        observation: { providers: [provider({ receipt })] },
        operation: erc20Claim.operation,
      }),
    ).toMatchObject({
      kind: "receipt",
      reason: "TRANSFER_LOG_RECONCILIATION_PENDING",
      state: "reconciling",
    });
    receipt.tokenTransferLogReconciled = true;
    expect(
      decideWalletTransferObservation({
        dropAfterMilliseconds: 60_000,
        now,
        observation: { providers: [provider({ receipt })] },
        operation: erc20Claim.operation,
      }),
    ).toMatchObject({ kind: "receipt", reason: null, state: "confirmed" });
  });

  it("rolls a confirmed projection into reconciliation when its receipt disappears", () => {
    expect(
      decideWalletTransferObservation({
        dropAfterMilliseconds: 60_000,
        now,
        observation: { providers: [provider({ receipt: null, transactionFound: false })] },
        operation: workClaim("confirmed").operation,
      }),
    ).toEqual({
      kind: "transition",
      reason: "REORG_RECEIPT_REMOVED",
      state: "reconciling",
    });
  });
});

describe("P04-06 transfer recovery worker", () => {
  it("recovers a queued operation after a retryable process restart and accepts already-known", async () => {
    const repository = new MemoryRecoveryRepository([workClaim("queued")]);
    const signer = {
      signAndDeliver: vi
        .fn()
        .mockRejectedValueOnce(new WalletTransferWorkerError("TRANSFER_DELIVERY_UNAVAILABLE", true))
        .mockResolvedValueOnce(signerResult("already-known")),
    };
    const worker = new WalletTransferRecoveryWorker({
      now: () => now,
      observer: { observe: vi.fn() },
      repository,
      signer,
      workerId: "transfer-worker-fixture",
    });
    await expect(worker.processBatch()).resolves.toMatchObject({ claimed: 1, retried: 1 });
    expect(repository.broadcasts).toHaveLength(0);

    const restarted = new WalletTransferRecoveryWorker({
      now: () => now,
      observer: { observe: vi.fn() },
      repository,
      signer,
      workerId: "transfer-worker-restarted",
    });
    await expect(restarted.processBatch()).resolves.toMatchObject({ broadcast: 1, claimed: 1 });
    expect(repository.broadcasts).toEqual([signerResult("already-known")]);
  });

  it("builds a replacement by changing only higher fee fields", async () => {
    const repository = new MemoryRecoveryRepository([]);
    const signer = {
      signAndDeliver: vi.fn(async (input: { plan: WalletTransferPlan; planDigest: `sha256:${string}` }) => ({
        ...signerResult(),
        planDigest: input.planDigest,
      })),
    };
    const worker = new WalletTransferRecoveryWorker({
      now: () => now,
      observer: { observe: vi.fn() },
      repository,
      signer,
      workerId: "transfer-worker-fixture",
    });
    const feeLimit = {
      feeCapBaseUnit: "63000",
      gasLimit: "21000",
      maxFeePerGasBaseUnit: "3",
      maxPriorityFeePerGasBaseUnit: "2",
    };
    await expect(
      worker.replace({ feeLimit, operationId: plan.operationId, reason: "pending-fee-bump" }),
    ).resolves.toMatchObject({ transactionHash });
    const replacement = signer.signAndDeliver.mock.calls[0]![0].plan;
    expect({ ...replacement, feeLimit: plan.feeLimit }).toEqual(plan);
    expect(repository.replacements).toHaveLength(1);
    expect(() =>
      replacementTransferPlan({ feeLimit: plan.feeLimit, now, plan }),
    ).toThrowError("TRANSFER_REPLACEMENT_FEE_INVALID");
  });
});

describe("P04-06 resilient raw transaction delivery", () => {
  it("queries the precomputed hash after timeout and returns already-known without exposing raw bytes", async () => {
    const rawTransaction = Uint8Array.of(1, 2, 3, 4);
    const broadcast: RawTransactionBroadcastPort = {
      broadcast: vi.fn(async () => {
        throw new Error("timeout");
      }),
      transactionKnown: vi.fn(async () => true),
    };
    const delivery = new ResilientRawTransactionDelivery({
      adapterId: "local-anvil",
      broadcast,
    });
    await expect(
      delivery.deliver({
        chainId: 31_337,
        operationId: plan.operationId,
        rawTransaction,
        transactionHash,
      }),
    ).resolves.toEqual({
      deliveryId: "local-anvil:aaaaaaaaaaaaaaaa",
      status: "already-known",
    });
    expect(broadcast.transactionKnown).toHaveBeenCalledWith({
      chainId: 31_337,
      transactionHash,
    });
    expect(rawTransaction).toEqual(Uint8Array.of(1, 2, 3, 4));
  });

  it("keeps an unconfirmed ambiguous broadcast retryable", async () => {
    const delivery = new ResilientRawTransactionDelivery({
      adapterId: "local-anvil",
      broadcast: {
        broadcast: vi.fn(async () => {
          throw new Error("timeout");
        }),
        transactionKnown: vi.fn(async () => false),
      },
    });
    await expect(
      delivery.deliver({
        chainId: 31_337,
        operationId: plan.operationId,
        rawTransaction: Uint8Array.of(1),
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_DELIVERY_UNAVAILABLE", retryable: true });
  });
});
