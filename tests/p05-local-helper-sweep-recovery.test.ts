import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepPlan,
} from "../packages/domain/src/local-helper-sweep.js";
import {
  decideLocalHelperSweepObservation,
  LocalHelperSweepRecoveryWorker,
  LocalHelperSweepWorkerError,
  type LocalHelperSweepObservation,
  type LocalHelperSweepReceiptObservation,
  type LocalHelperSweepSignerGateway,
  type LocalHelperSweepTransactionReference,
  type LocalHelperSweepWorkClaim,
  type LocalHelperSweepWorkOperation,
  type LocalHelperSweepWorkRepository,
} from "../apps/worker/src/local-helper-sweep-worker.js";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-20T08:00:00.000Z");
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const wallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  walletId: "a8080000-0000-4000-8000-000000000001",
} as const;
const helperAddress = "0x1000000000000000000000000000000000000001" as const;
const bindingId = "a8080000-0000-4000-8000-000000000002";

function plan(kind: "native" | "token" = "token"): LocalHelperSweepPlan {
  const token = registry.tokens[0]!;
  const value: LocalHelperSweepPlan = {
    asset:
      kind === "token"
        ? {
            amountBaseUnit: "10",
            assetId: `token:${token.address}`,
            dustBaseUnit: token.dustBaseUnit,
            fixture: token.fixture,
            kind,
            tokenAddress: token.address,
          }
        : {
            amountBaseUnit: "5000",
            assetId: "native:31337",
            dustBaseUnit: registry.dustPolicy.nativeDustBaseUnit,
            fixture: null,
            kind,
            tokenAddress: null,
          },
    batchId: "a8080000-0000-4000-8000-000000000010",
    chainId: 31_337,
    deadline: new Date(now.getTime() + 600_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "400000",
      gasLimit: "100000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "11",
    helper: {
      adapterAddress: registry.components.find(({ role }) => role === "adapter")!.address,
      bindingId,
      deploymentRegistryVersion: "p05-local-helper-deployment-v2",
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: wallet.address,
      permit2Address: registry.components.find(({ role }) => role === "permit2")!.address,
      runtimeCodeHash: registry.helper.runtimeTemplateHash,
      verifiedBlockNumber: "8",
      walletId: wallet.walletId,
    },
    nonce: "8",
    operationId: "a8080000-0000-4000-8000-000000000011",
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: registry.planVersion,
    recipient: wallet.address,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    semanticDigest: `sha256:${"00".repeat(32)}`,
    serviceFeeBps: 0,
    snapshot: {
      blockHash: `0x${"11".repeat(32)}`,
      blockNumber: "8",
      digest: `sha256:${"22".repeat(32)}`,
    },
    transaction: {
      data: "0x",
      dataDigest: `sha256:${"00".repeat(32)}`,
      selector:
        kind === "token"
          ? registry.helper.selectors.sweepToken
          : registry.helper.selectors.sweepNative,
      to: helperAddress,
      valueBaseUnit: "0",
    },
    wallet,
  };
  value.planDigest = localHelperSweepPlanDigest(value);
  value.transaction.data = localHelperSweepCalldata(value.planDigest, value.asset);
  value.transaction.dataDigest = localHelperSweepDataDigest(value.transaction.data);
  value.semanticDigest = localHelperSweepSemanticDigest(value);
  return value;
}

function transaction(value: LocalHelperSweepPlan): LocalHelperSweepTransactionReference {
  return {
    active: true,
    amountBaseUnit: value.asset.amountBaseUnit,
    assetId: value.asset.assetId,
    dataDigest: value.transaction.dataDigest,
    fee: { maxFeePerGasBaseUnit: "2", maxPriorityFeePerGasBaseUnit: "1" },
    generation: 0,
    nonce: value.nonce,
    planDigest: value.planDigest,
    recipient: value.recipient,
    semanticDigest: value.semanticDigest,
    target: value.transaction.to,
    transactionHash: `0x${"33".repeat(32)}`,
    transactionId: "a8080000-0000-4000-8000-000000000020",
    updatedAt: new Date(now.getTime() - 2_000).toISOString(),
  };
}

function operation(
  value: LocalHelperSweepPlan,
  state: LocalHelperSweepWorkOperation["state"] = "pending",
): LocalHelperSweepWorkOperation {
  const active = state === "queued" ? null : transaction(value);
  return {
    activeTransaction: active,
    batchId: value.batchId,
    operationId: value.operationId,
    plan: value,
    planDigest: value.planDigest,
    reauthenticatedSessionId: null,
    state,
    tenantId: "local-helper-sweep-fixture",
    transactionLineage: active ? [active] : [],
    userId: "a8080000-0000-4000-8000-000000000003",
  };
}

function receipt(
  value: LocalHelperSweepPlan,
  overrides: Partial<LocalHelperSweepReceiptObservation> = {},
): LocalHelperSweepReceiptObservation {
  const amount = BigInt(value.asset.amountBaseUnit);
  const gasUsed = 100n;
  const gasPrice = 2n;
  const ownerBefore = 10_000n;
  return {
    blockCanonical: true,
    blockHash: `0x${"44".repeat(32)}`,
    blockNumber: "9",
    confirmations: "2",
    effectiveGasPrice: gasPrice.toString(),
    gasUsed: gasUsed.toString(),
    helperBalanceAfter: "0",
    helperBalanceBefore: amount.toString(),
    helperRuntimeCodeHash: value.helper.runtimeCodeHash,
    observedOwner: value.recipient,
    ownerBalanceAfter:
      value.asset.kind === "token"
        ? (ownerBefore + amount).toString()
        : (ownerBefore + amount - gasUsed * gasPrice).toString(),
    ownerBalanceBefore: ownerBefore.toString(),
    planExecutedEvent: true,
    receiptStatus: "success",
    sweptEvent: true,
    tokenAddress: value.asset.tokenAddress,
    transactionHash: transaction(value).transactionHash,
    transferAmountBaseUnit: value.asset.kind === "token" ? amount.toString() : null,
    transferFrom: value.asset.kind === "token" ? value.helper.helperAddress : null,
    transferTo: value.asset.kind === "token" ? value.recipient : null,
    ...overrides,
  };
}

function observation(
  value: LocalHelperSweepReceiptObservation | null,
  nonce = "9",
): LocalHelperSweepObservation {
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
  value: LocalHelperSweepPlan,
  evidence: LocalHelperSweepReceiptObservation | null,
  requiredConfirmations = 2,
) {
  return decideLocalHelperSweepObservation({
    dropAfterMilliseconds: 1_000,
    now,
    observation: observation(evidence, evidence ? "9" : value.nonce),
    operation: operation(value),
    requiredConfirmations,
  });
}

describe("P05-08 local Helper sweep recovery", () => {
  it("reconciles TestOnly token Transfer and native gas-adjusted owner balances", () => {
    const tokenPlan = plan("token");
    expect(decide(tokenPlan, receipt(tokenPlan))).toMatchObject({
      kind: "receipt",
      operationState: "succeeded",
    });
    const nativePlan = plan("native");
    expect(decide(nativePlan, receipt(nativePlan))).toMatchObject({
      kind: "receipt",
      operationState: "succeeded",
    });
    expect(decide(nativePlan, receipt(nativePlan, { ownerBalanceAfter: "14999" }))).toMatchObject({
      operationState: "reconciling",
      reason: "NATIVE_OWNER_GAS_RECONCILIATION_MISMATCH",
    });
  });

  it("waits for canonical confirmations before finalizing a reverted receipt", () => {
    const value = plan();
    expect(
      decide(value, receipt(value, { confirmations: "1", receiptStatus: "reverted" })),
    ).toMatchObject({ operationState: "confirmed", reason: "CONFIRMATIONS_PENDING" });
    expect(decide(value, receipt(value, { receiptStatus: "reverted" }))).toMatchObject({
      failureCode: "SWEEP_REVERTED",
      operationState: "failed",
    });
  });

  it("moves dust, Transfer, identity, reorg and provider divergence mismatches to reconciliation", () => {
    const value = plan();
    expect(decide(value, receipt(value, { helperBalanceAfter: "2" }))).toMatchObject({
      reason: "HELPER_BALANCE_DELTA_MISMATCH",
    });
    expect(
      decide(value, receipt(value, { transferTo: registry.tokens[1]!.address })),
    ).toMatchObject({
      reason: "TOKEN_TRANSFER_MISMATCH",
    });
    expect(decide(value, receipt(value, { observedOwner: helperAddress }))).toMatchObject({
      reason: "HELPER_IDENTITY_MISMATCH",
    });
    expect(decide(value, receipt(value, { blockCanonical: false }))).toMatchObject({
      reason: "REORG_BLOCK_NONCANONICAL",
    });
    const current = operation(value);
    expect(
      decideLocalHelperSweepObservation({
        dropAfterMilliseconds: 1_000,
        now,
        observation: {
          providers: [
            ...observation(receipt(value)).providers,
            {
              ...observation(receipt(value, { confirmations: "3" })).providers[0]!,
              providerId: "anvil-secondary",
            },
          ],
        },
        operation: current,
        requiredConfirmations: 2,
      }),
    ).toMatchObject({ operationState: "reconciling", reason: "PROVIDER_DIVERGENCE" });
  });

  it("marks a missing transaction dropped without consuming a confirmed asset cursor", () => {
    const value = plan();
    expect(decide(value, null)).toEqual({
      kind: "transition",
      operationState: "dropped",
      reason: null,
    });
    expect(
      decideLocalHelperSweepObservation({
        dropAfterMilliseconds: 1_000,
        now,
        observation: observation(null, "9"),
        operation: operation(value),
        requiredConfirmations: 2,
      }),
    ).toMatchObject({
      operationState: "reconciling",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
    });
  });

  it("restarts at the failed asset and preserves plan-bound replacement semantics", async () => {
    const value = plan();
    const queued: LocalHelperSweepWorkClaim = {
      kind: "operation",
      leaseToken: "a8080000-0000-4000-8000-000000000030",
      operation: operation(value, "queued"),
      outboxEventId: "a8080000-0000-4000-8000-000000000031",
    };
    const failClaim = vi.fn<LocalHelperSweepWorkRepository["failClaim"]>();
    const completeBroadcast = vi.fn<LocalHelperSweepWorkRepository["completeBroadcast"]>();
    const repository = {
      applyObservation: vi.fn(),
      claimDue: vi.fn(async () => [queued]),
      completeBroadcast,
      completeReplacement: vi.fn(),
      completeRescan: vi.fn(),
      failClaim,
      prepareReplacement: vi.fn(),
      rejectReplacement: vi.fn(),
    } as unknown as LocalHelperSweepWorkRepository;
    const unavailable: LocalHelperSweepSignerGateway = {
      async signAndDeliver() {
        throw new LocalHelperSweepWorkerError("SIGNER_UNAVAILABLE", true);
      },
    };
    const worker = new LocalHelperSweepRecoveryWorker({
      now: () => now,
      observer: {
        async observe() {
          return { providers: [] };
        },
      },
      repository,
      rescanner: {
        async rescan() {
          throw new Error("not used");
        },
      },
      signer: unavailable,
      workerId: "helper-sweep-restart",
    });
    await expect(worker.processBatch()).resolves.toMatchObject({ retried: 1 });
    expect(failClaim).toHaveBeenCalledWith(
      expect.objectContaining({ claim: queued, retryable: true }),
    );

    const restarted = new LocalHelperSweepRecoveryWorker({
      now: () => now,
      observer: {
        async observe() {
          return { providers: [] };
        },
      },
      repository,
      rescanner: {
        async rescan() {
          throw new Error("not used");
        },
      },
      signer: {
        async signAndDeliver(input) {
          return {
            deliveryId: "helper-sweep-restart-delivery",
            generation: input.generation,
            operationId: input.operationId,
            planDigest: input.planDigest,
            status: "accepted",
            transactionHash: `0x${"55".repeat(32)}`,
          };
        },
      },
      workerId: "helper-sweep-restarted",
    });
    await expect(restarted.processBatch()).resolves.toMatchObject({ broadcast: 1 });
    expect(completeBroadcast).toHaveBeenCalledOnce();
  });

  it("requires a full clean rescan before recovering degraded binding state", async () => {
    const batch = {
      batchId: "a8080000-0000-4000-8000-000000000040",
      helperAddress,
      tenantId: "local-helper-sweep-fixture",
      userId: "a8080000-0000-4000-8000-000000000003",
      walletAddress: wallet.address,
      walletId: wallet.walletId,
    } as const;
    const claim: LocalHelperSweepWorkClaim = {
      batch,
      kind: "rescan",
      leaseToken: "a8080000-0000-4000-8000-000000000041",
      outboxEventId: "a8080000-0000-4000-8000-000000000042",
    };
    const completeRescan = vi.fn<LocalHelperSweepWorkRepository["completeRescan"]>();
    const clean = {
      allowances: [],
      balances: [{ amountBaseUnit: "0", dustBaseUnit: "0" }],
      binding: { helperAddress, state: "active" },
      chainId: 31_337,
      coverage: { complete: true },
      identity: {
        bindingMatches: true,
        componentsMatch: true,
        ownerMatches: true,
        registryMatches: true,
        runtimeMatches: true,
        tokensMatch: true,
      },
      manualRecoveryRequired: false,
      nftCustody: [],
      registry: { version: "p05-local-helper-sweep-v2" },
      unknownTokens: [],
      wallet,
    } as unknown as LocalHelperResidualSnapshot;
    const repository = {
      claimDue: vi.fn(async () => [claim]),
      completeRescan,
    } as unknown as LocalHelperSweepWorkRepository;
    const worker = new LocalHelperSweepRecoveryWorker({
      now: () => now,
      observer: {
        async observe() {
          return { providers: [] };
        },
      },
      repository,
      rescanner: {
        async rescan() {
          return clean;
        },
      },
      signer: {
        async signAndDeliver() {
          throw new Error("not used");
        },
      },
      workerId: "helper-sweep-rescan",
    });
    await expect(worker.processBatch()).resolves.toMatchObject({ rescanned: 1 });
    expect(completeRescan).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "active", snapshot: clean }),
    );
  });
});
