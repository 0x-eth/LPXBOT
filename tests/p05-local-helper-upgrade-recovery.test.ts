import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  localHelperUpgradePlanDigest,
  localHelperUpgradeSelectorSetHash,
  type LocalHelperUpgradePlan,
  type WalletHelperV2Verification,
} from "../packages/domain/src/local-helper-upgrade.js";
import {
  LocalHelperUpgradeRecoveryWorker,
  LocalHelperUpgradeWorkerError,
  type LocalHelperUpgradeObserver,
  type LocalHelperUpgradeSignerGateway,
  type LocalHelperUpgradeSweepGateway,
  type LocalHelperUpgradeWorkClaim,
  type LocalHelperUpgradeWorkOperation,
  type LocalHelperUpgradeWorkRepository,
} from "../apps/worker/src/local-helper-upgrade-worker.js";
import { getContractAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-21T02:00:00.000Z");
const tenantId = "helper-upgrade-recovery";
const userId = "9d000000-0000-4000-8000-000000000001";
const walletId = "9d000000-0000-4000-8000-000000000002";
const operationId = "9d000000-0000-4000-8000-000000000003";
const sessionId = "9d000000-0000-4000-8000-000000000004";
const bindingId = "9d000000-0000-4000-8000-000000000005";
const owner = `0x${"11".repeat(20)}` as const;
const sourceHelper = `0x${"22".repeat(20)}` as const;
const sourceRuntime = `0x${"33".repeat(32)}` as const;
const transactionHash = `0x${"44".repeat(32)}` as const;

function plan(): LocalHelperUpgradePlan {
  const registry = P05_LOCAL_HELPER_UPGRADE_REGISTRY;
  const material = buildWalletHelperV2DeploymentMaterial(owner, registry);
  const expectedAddress = getContractAddress({ from: owner, nonce: 7n }).toLowerCase() as `0x${string}`;
  const value: LocalHelperUpgradePlan = {
    chainId: 31_337,
    deadline: new Date(now.getTime() + 10 * 60_000).toISOString(),
    feeLimit: {
      feeCapBaseUnit: "4000000",
      gasLimit: "1000000",
      maxFeePerGasBaseUnit: "4",
      maxPriorityFeePerGasBaseUnit: "2",
    },
    fencingToken: "9",
    nonce: "7",
    operationId,
    planDigest: `sha256:${"00".repeat(32)}`,
    planVersion: "p05-local-helper-upgrade-plan-v3",
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 3,
    snapshot: {
      blockHash: `0x${"55".repeat(32)}`,
      blockNumber: "10",
      digest: `sha256:${"66".repeat(32)}`,
    },
    source: {
      bindingId,
      helperAddress: sourceHelper,
      helperVersion: "WalletHelperV1",
      runtimeCodeHash: sourceRuntime,
    },
    target: {
      abiHash: registry.target.abiHash,
      adapter: P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "adapter")!
        .address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.target.creationCodeHash,
      expectedAddress,
      expectedRuntimeCodeHash: `0x${"77".repeat(32)}`,
      helperVersion: "WalletHelperV2",
      owner,
      permit2: P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "permit2")!
        .address,
      selectorSetHash: localHelperUpgradeSelectorSetHash(registry.target.selectors),
      tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
      tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
    },
    transaction: {
      data: material.initCode,
      dataHash: material.initCodeHash,
      to: null,
      valueBaseUnit: "0",
    },
    wallet: { address: owner, walletId },
  };
  value.planDigest = localHelperUpgradePlanDigest(value);
  return value;
}

function transaction(): LocalHelperUpgradeWorkOperation["transactions"][number] {
  return {
    active: true,
    generation: 0,
    maxFeePerGasBaseUnit: "2",
    maxPriorityFeePerGasBaseUnit: "1",
    state: "confirmed",
    transactionHash,
    transactionId: "9d000000-0000-4000-8000-000000000006",
    updatedAt: now.toISOString(),
  };
}

function operation(
  cursor: LocalHelperUpgradeWorkOperation["cursor"],
  value = plan(),
): LocalHelperUpgradeWorkOperation {
  return {
    cursor,
    finalSnapshot: null,
    operationId,
    plan: value,
    planDigest: value.planDigest,
    reauthenticatedSessionId: sessionId,
    state: cursor === "preflight" ? "queued" : "running",
    sweepBatchId: cursor === "final-rescan-v1" ? "9d000000-0000-4000-8000-000000000007" : null,
    tenantId,
    transactions: cursor === "preflight" || cursor === "deploy-v2" ? [] : [transaction()],
    userId,
    verification: cursor === "preflight" || cursor === "deploy-v2" || cursor === "verify-v2" ? null : verification(value),
  };
}

function claim(
  cursor: LocalHelperUpgradeWorkOperation["cursor"],
  value = plan(),
): LocalHelperUpgradeWorkClaim {
  return {
    leaseToken: "9d000000-0000-4000-8000-000000000008",
    operation: operation(cursor, value),
    outboxEventId: "9d000000-0000-4000-8000-000000000009",
  };
}

function verification(value: LocalHelperUpgradePlan): WalletHelperV2Verification {
  return {
    abiHash: value.target.abiHash,
    adapter: value.target.adapter,
    atomicLiquidityExecutionEnabled: false,
    blockHash: `0x${"88".repeat(32)}`,
    helperAddress: value.target.expectedAddress,
    observedAtBlock: "12",
    owner: value.target.owner,
    permit2: value.target.permit2,
    runtimeCodeHash: value.target.expectedRuntimeCodeHash,
    selectorSetHash: value.target.selectorSetHash,
    tokenA: value.target.tokenA,
    tokenB: value.target.tokenB,
  };
}

function repository(
  due: () => LocalHelperUpgradeWorkClaim[],
  overrides: Partial<LocalHelperUpgradeWorkRepository> = {},
): LocalHelperUpgradeWorkRepository {
  return {
    advance: vi.fn(),
    applyDeploymentObservation: vi.fn(),
    applySweepResult: vi.fn(),
    claimDue: vi.fn(async () => due()),
    completeAtomicBindingSwitch: vi.fn(),
    completeBroadcast: vi.fn(),
    completeFinalRescan: vi.fn(),
    completeReplacement: vi.fn(),
    completeVerification: vi.fn(),
    failClaim: vi.fn(),
    prepareReplacement: vi.fn(),
    rejectReplacement: vi.fn(),
    ...overrides,
  } as LocalHelperUpgradeWorkRepository;
}

function idleObserver(overrides: Partial<LocalHelperUpgradeObserver> = {}): LocalHelperUpgradeObserver {
  return {
    async observeDeployment() {
      throw new Error("deployment observation was not expected");
    },
    async verifyV2({ plan: value }) {
      return verification(value);
    },
    ...overrides,
  };
}

function idleSweeper(overrides: Partial<LocalHelperUpgradeSweepGateway> = {}): LocalHelperUpgradeSweepGateway {
  return {
    async finalRescan() {
      throw new Error("final rescan was not expected");
    },
    async sweep() {
      throw new Error("sweep was not expected");
    },
    ...overrides,
  };
}

function worker(input: {
  observer?: LocalHelperUpgradeObserver;
  repository: LocalHelperUpgradeWorkRepository;
  signer?: LocalHelperUpgradeSignerGateway;
  sweeper?: LocalHelperUpgradeSweepGateway;
}): LocalHelperUpgradeRecoveryWorker {
  return new LocalHelperUpgradeRecoveryWorker({
    now: () => now,
    observer: input.observer ?? idleObserver(),
    repository: input.repository,
    signer:
      input.signer ??
      ({
        async signAndDeliver() {
          throw new Error("signer was not expected");
        },
      } satisfies LocalHelperUpgradeSignerGateway),
    sweeper: input.sweeper ?? idleSweeper(),
    workerId: "helper-upgrade-recovery-fixture",
  });
}

describe("P05-09 local Helper upgrade crash recovery", () => {
  it("retries the same deterministic deployment after delivery succeeds but persistence crashes", async () => {
    const value = plan();
    const queued = claim("deploy-v2", value);
    let persisted = false;
    let broadcastCount = 0;
    let deliveryAttempts = 0;
    const signAndDeliver = vi.fn<LocalHelperUpgradeSignerGateway["signAndDeliver"]>(async (input) => {
      const status = deliveryAttempts === 0 ? "accepted" : "already-known";
      deliveryAttempts += 1;
      if (status === "accepted") broadcastCount += 1;
      return {
        deliveryId: "helper-upgrade-recovery-delivery",
        generation: input.generation,
        operationId: input.operationId,
        planDigest: input.planDigest,
        status,
        transactionHash,
      };
    });
    const completeBroadcast = vi.fn(async () => {
      if (!persisted) {
        persisted = true;
        throw new LocalHelperUpgradeWorkerError("DATABASE_UNAVAILABLE", true);
      }
    });
    const failClaim = vi.fn<LocalHelperUpgradeWorkRepository["failClaim"]>();
    const store = repository(() => [queued], { completeBroadcast, failClaim });

    await expect(
      worker({ repository: store, signer: { signAndDeliver } }).processBatch(),
    ).resolves.toMatchObject({ retried: 1 });
    await expect(
      worker({ repository: store, signer: { signAndDeliver } }).processBatch(),
    ).resolves.toMatchObject({ broadcast: 1 });

    expect(signAndDeliver).toHaveBeenCalledTimes(2);
    expect(signAndDeliver.mock.calls[1]?.[0]).toEqual(signAndDeliver.mock.calls[0]?.[0]);
    expect(broadcastCount).toBe(1);
    expect(completeBroadcast).toHaveBeenCalledTimes(2);
    expect(failClaim).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DATABASE_UNAVAILABLE", retryable: true }),
    );
  });

  it("continues at verify-v2 without signing or observing an already-confirmed deployment", async () => {
    const current = claim("verify-v2");
    const completeVerification = vi.fn<LocalHelperUpgradeWorkRepository["completeVerification"]>();
    const store = repository(() => [current], { completeVerification });
    const signer = { signAndDeliver: vi.fn() } as unknown as LocalHelperUpgradeSignerGateway;
    const observeDeployment = vi.fn();

    await expect(
      worker({
        observer: idleObserver({ observeDeployment }),
        repository: store,
        signer,
      }).processBatch(),
    ).resolves.toMatchObject({ completed: 1 });

    expect(signer.signAndDeliver).not.toHaveBeenCalled();
    expect(observeDeployment).not.toHaveBeenCalled();
    expect(completeVerification).toHaveBeenCalledOnce();
  });

  it("continues at final-rescan-v1 without replaying an already-confirmed sweep batch", async () => {
    const current = claim("final-rescan-v1");
    const snapshot = {} as Awaited<ReturnType<LocalHelperUpgradeSweepGateway["finalRescan"]>>;
    const sweep = vi.fn<LocalHelperUpgradeSweepGateway["sweep"]>();
    const finalRescan = vi.fn<LocalHelperUpgradeSweepGateway["finalRescan"]>(async () => snapshot);
    const completeFinalRescan = vi.fn<LocalHelperUpgradeWorkRepository["completeFinalRescan"]>();
    const store = repository(() => [current], { completeFinalRescan });

    await expect(
      worker({ repository: store, sweeper: idleSweeper({ finalRescan, sweep }) }).processBatch(),
    ).resolves.toMatchObject({ completed: 1 });

    expect(sweep).not.toHaveBeenCalled();
    expect(finalRescan).toHaveBeenCalledOnce();
    expect(completeFinalRescan).toHaveBeenCalledWith(
      expect.objectContaining({ claim: current, snapshot }),
    );
  });

  it("resumes from the persisted preflight cursor and advances exactly one step", async () => {
    const current = claim("preflight");
    const advance = vi.fn<LocalHelperUpgradeWorkRepository["advance"]>();
    const store = repository(() => [current], { advance });

    await expect(worker({ repository: store }).processBatch()).resolves.toMatchObject({ completed: 1 });

    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({ claim: current, next: "deploy-v2" }),
    );
  });
});
