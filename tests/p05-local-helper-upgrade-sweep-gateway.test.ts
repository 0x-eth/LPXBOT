import { describe, expect, it, vi } from "vitest";

import { LocalHelperUpgradeSweepGateway } from "../apps/api/src/local-helper-upgrade-sweep-gateway.js";
import type { LocalHelperSweepApplication } from "../apps/api/src/local-helper-sweeps.js";
import type { WalletDirectory } from "../apps/api/src/wallets.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import type { LocalHelperResidualSnapshot } from "../packages/domain/src/local-helper-sweep.js";

const walletId = "9c000000-0000-4000-8000-000000000071";
const userId = "9c000000-0000-4000-8000-000000000072";
const sessionId = "9c000000-0000-4000-8000-000000000073";
const bindingId = "9c000000-0000-4000-8000-000000000074";
const operationId = "9c000000-0000-4000-8000-000000000075";
const batchId = "9c000000-0000-4000-8000-000000000076";
const walletAddress = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
const helperAddress = `0x${"22".repeat(20)}` as const;
const runtimeCodeHash = `0x${"33".repeat(32)}` as const;
const now = "2026-08-21T01:00:00.000Z";

const wallet = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
  createdAt: now,
  envelopeVersion: 1,
  lockStatus: "ready" as const,
  mode: "server-kek" as const,
  name: "P05-09 sweep bridge",
  revision: 1,
  updatedAt: now,
  walletId,
};

function residual(
  input: {
    allowance?: string;
    bindingState?: "active" | "degraded";
    identityMatches?: boolean;
  } = {},
): LocalHelperResidualSnapshot {
  const allowance = input.allowance ?? "0";
  const identityMatches = input.identityMatches ?? true;
  return {
    allowances: [
      {
        amountBaseUnit: allowance,
        assetId: "allowance:test",
        spenderAddress: P05_HELPER_DEPLOYMENT_REGISTRY.components[0]!.address,
        spenderRole: "adapter",
        tokenAddress: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0]!.address,
      },
    ],
    balances: [
      {
        amountBaseUnit: "5",
        assetId: "native:31337",
        dustBaseUnit: "1",
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
    ],
    binding: {
      adapterAddress: P05_HELPER_DEPLOYMENT_REGISTRY.components[0]!.address,
      bindingId,
      deploymentRegistryVersion: "p05-local-helper-deployment-v2",
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: walletAddress,
      permit2Address: P05_HELPER_DEPLOYMENT_REGISTRY.components[1]!.address,
      runtimeCodeHash,
      state: input.bindingState ?? "degraded",
      verifiedBlockNumber: "8",
      walletId,
    },
    block: { hash: `0x${"44".repeat(32)}`, number: "9", timestamp: now },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons:
      allowance !== "0" ? ["nonzero-allowance", "residual-above-dust"] : ["residual-above-dust"],
    expiresAt: "2026-08-21T01:05:00.000Z",
    identity: {
      bindingMatches: identityMatches,
      componentsMatch: true,
      observedOwner: walletAddress,
      observedRuntimeCodeHash: runtimeCodeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: allowance !== "0",
    nftCustody: [],
    observedAt: now,
    registry: {
      digest: P05_LOCAL_HELPER_UPGRADE_REGISTRY.sweep.registryDigest,
      version: "p05-local-helper-sweep-v2",
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"55".repeat(32)}`,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: [],
    wallet: { address: walletAddress, walletId },
  };
}

function operation(sweepBatchId: string | null = null) {
  return {
    operationId,
    plan: {
      source: { bindingId, helperAddress },
      wallet: { address: walletAddress, walletId },
    },
    reauthenticatedSessionId: sessionId,
    sweepBatchId,
    tenantId: "tenant-fixture-01",
    userId,
  };
}

function fixture(snapshot = residual()) {
  const scan = vi.fn(async () => structuredClone(snapshot));
  const preview = vi.fn(async () => ({
    previewDigest: `sha256:${"66".repeat(32)}`,
    previewToken: "A".repeat(43),
  }));
  const sweep = vi.fn(async () => ({
    batch: {
      batchId,
      chainId: 31_337,
      createdAt: now,
      helperAddress,
      operations: [{}],
      registryVersion: "p05-local-helper-sweep-v2",
      snapshotDigest: snapshot.snapshotDigest,
      state: "queued",
      updatedAt: now,
      walletId,
    },
  }));
  const getBatch = vi.fn(async () => ({
    batchId,
    chainId: 31_337,
    createdAt: now,
    helperAddress,
    operations: [{}],
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest: snapshot.snapshotDigest,
    state: "succeeded",
    updatedAt: now,
    walletId,
  }));
  const gateway = new LocalHelperUpgradeSweepGateway({
    idempotencyKey: () => "upgrade-rescan-idempotency-0001",
    sweeps: { getBatch, preview, scan, sweep } as unknown as LocalHelperSweepApplication,
    wallets: { getWallet: async () => wallet } as unknown as WalletDirectory,
  });
  return { gateway, getBatch, preview, scan, sweep };
}

describe("P05-09 local Helper upgrade sweep bridge", () => {
  it("sweeps a V1 binding degraded only by allowlisted residual balance", async () => {
    const value = fixture();
    await expect(value.gateway.sweep(operation())).resolves.toEqual({
      batchId,
      kind: "pending",
    });
    expect(value.preview).toHaveBeenCalledOnce();
    expect(value.sweep).toHaveBeenCalledOnce();
    expect(value.sweep).toHaveBeenCalledWith(
      expect.objectContaining({ upgradeOperationId: operationId }),
    );
  });

  it("routes nonzero allowance to manual recovery before preview or calldata", async () => {
    const value = fixture(residual({ allowance: "1" }));
    await expect(value.gateway.sweep(operation())).resolves.toMatchObject({
      batchId: null,
      blockers: expect.arrayContaining(["NON_ZERO_ALLOWANCE"]),
      kind: "manual-recovery-required",
    });
    expect(value.preview).not.toHaveBeenCalled();
    expect(value.sweep).not.toHaveBeenCalled();
  });

  it("rejects identity degradation instead of treating it as residual-only", async () => {
    const value = fixture(residual({ identityMatches: false }));
    await expect(value.gateway.sweep(operation())).rejects.toMatchObject({
      code: "HELPER_UPGRADE_SWEEP_PREFLIGHT_CHANGED",
      retryable: true,
    });
    expect(value.preview).not.toHaveBeenCalled();
  });

  it("loads a persisted successful batch after restart without rescanning or replaying", async () => {
    const value = fixture();
    await expect(value.gateway.sweep(operation(batchId))).resolves.toEqual({
      batchId,
      kind: "completed",
    });
    expect(value.getBatch).toHaveBeenCalledOnce();
    expect(value.scan).not.toHaveBeenCalled();
    expect(value.preview).not.toHaveBeenCalled();
    expect(value.sweep).not.toHaveBeenCalled();
  });
});
