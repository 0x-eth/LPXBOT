import { describe, expect, it } from "vitest";

import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  validateLocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import {
  assertLocalHelperUpgradeCursorTransition,
  compareLocalHelperVersions,
  localHelperUpgradePlanDigest,
  localHelperUpgradeReplacementCandidate,
  localHelperUpgradeSelectorSetHash,
  localHelperUpgradeSnapshotDigest,
  localHelperV1SupersedeDecision,
  nextLocalHelperUpgradeCursor,
  validateLocalHelperUpgradePlan,
  validateLocalHelperUpgradeReplacement,
  type LocalHelperUpgradePlan,
  type LocalHelperUpgradeSnapshot,
} from "@lpbot/domain/local-helper-upgrade";
import type {
  LocalHelperResidualSnapshot,
  LocalHelperSweepBinding,
} from "@lpbot/domain/local-helper-sweep";
import { getContractAddress } from "viem";

const now = new Date("2026-08-21T00:00:00.000Z");
const walletId = "9c000000-0000-4000-8000-000000000001";
const walletAddress = `0x${"11".repeat(20)}` as const;
const binding: LocalHelperSweepBinding = {
  adapterAddress: P05_HELPER_DEPLOYMENT_REGISTRY.components[0]!.address,
  bindingId: "9c000000-0000-4000-8000-000000000002",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2",
  helperAddress: `0x${"22".repeat(20)}`,
  helperVersion: "WalletHelperV1",
  ownerAddress: walletAddress,
  permit2Address: P05_HELPER_DEPLOYMENT_REGISTRY.components[1]!.address,
  runtimeCodeHash: `0x${"33".repeat(32)}`,
  state: "active",
  verifiedBlockNumber: "9",
  walletId,
};
const expectedRuntimeCodeHash = `0x${"44".repeat(32)}` as const;
const expectedAddress = getContractAddress({
  from: walletAddress,
  nonce: 7n,
}).toLowerCase() as `0x${string}`;

function snapshot(overrides: Partial<LocalHelperUpgradeSnapshot> = {}): LocalHelperUpgradeSnapshot {
  const value: LocalHelperUpgradeSnapshot = {
    blockers: [],
    chainId: 31_337,
    eligible: true,
    expiresAt: "2026-08-21T00:05:00.000Z",
    liveOperationIds: [],
    nonceConflict: false,
    observedAt: now.toISOString(),
    providers: [
      {
        blockHash: `0x${"55".repeat(32)}`,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-a",
      },
      {
        blockHash: `0x${"55".repeat(32)}`,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-b",
      },
    ],
    registry: {
      digest: P05_LOCAL_HELPER_UPGRADE_REGISTRY.registryDigest,
      version: "p05-local-helper-upgrade-v3",
    },
    schemaVersion: 3,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: "p05-local-helper-upgrade-snapshot-v3",
    sourceBinding: binding,
    sourceIdentity: {
      bindingMatches: true,
      observedOwner: walletAddress,
      observedRuntimeCodeHash: binding.runtimeCodeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
    },
    target: { expectedAddress, expectedRuntimeCodeHash, helperVersion: "WalletHelperV2" },
    v1Residual: {
      coverageComplete: true,
      manualRecoveryRequired: false,
      snapshotDigest: `sha256:${"66".repeat(32)}`,
    },
    wallet: { address: walletAddress, walletId },
    ...overrides,
  };
  value.snapshotDigest = localHelperUpgradeSnapshotDigest(value);
  return value;
}

function plan(): LocalHelperUpgradePlan {
  const registry = P05_LOCAL_HELPER_UPGRADE_REGISTRY;
  const material = buildWalletHelperV2DeploymentMaterial(walletAddress);
  const selectorSetHash = localHelperUpgradeSelectorSetHash(registry.target.selectors);
  const value: LocalHelperUpgradePlan = {
    chainId: 31_337,
    deadline: "2026-08-21T00:10:00.000Z",
    feeLimit: {
      feeCapBaseUnit: "2000000",
      gasLimit: "1000000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    fencingToken: "3",
    nonce: "7",
    operationId: "9c000000-0000-4000-8000-000000000003",
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
      digest: snapshot().snapshotDigest,
    },
    source: {
      bindingId: binding.bindingId,
      helperAddress: binding.helperAddress,
      helperVersion: "WalletHelperV1",
      runtimeCodeHash: binding.runtimeCodeHash,
    },
    target: {
      abiHash: registry.target.abiHash,
      adapter: binding.adapterAddress,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.target.creationCodeHash,
      expectedAddress,
      expectedRuntimeCodeHash,
      helperVersion: "WalletHelperV2",
      owner: walletAddress,
      permit2: binding.permit2Address,
      selectorSetHash,
      tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
      tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
    },
    transaction: {
      data: material.initCode,
      dataHash: material.initCodeHash,
      to: null,
      valueBaseUnit: "0",
    },
    wallet: { address: walletAddress, walletId },
  };
  value.planDigest = localHelperUpgradePlanDigest(value);
  return value;
}

describe("P05-09 local Helper deploy-new upgrade contracts", () => {
  it("freezes V1/V2 identities, all selectors, and local-only gates", () => {
    const registry = validateLocalHelperUpgradeRegistry();
    expect(registry.target.selectors).toHaveLength(18);
    expect(registry.target.selectors).toContainEqual({
      selector: "0xe25f4c85",
      signature:
        "executeAtomicLiquidity(bytes32,(uint8,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint16),(bool,((address,uint160,uint48,uint48),address,uint256),bytes))",
    });
    expect(registry.gates.local).toEqual({
      atomicLiquidity: "CLOSED",
      broadcasts: true,
      signatures: true,
      upgrade: "OPEN",
    });
    for (const environment of ["bsc", "testnet", "production"] as const) {
      expect(registry.gates[environment]).toMatchObject({
        broadcasts: false,
        signatures: false,
        upgrade: "CLOSED",
      });
    }
    expect(Object.values(registry.gates).every((gate) => gate.atomicLiquidity === "CLOSED")).toBe(
      true,
    );
  });

  it("validates typed deployment plans and fee-only replacement", () => {
    const value = plan();
    const registry = P05_LOCAL_HELPER_UPGRADE_REGISTRY;
    const material = buildWalletHelperV2DeploymentMaterial(walletAddress);
    expect(() =>
      validateLocalHelperUpgradePlan(
        value,
        {
          abiHash: registry.target.abiHash,
          adapter: binding.adapterAddress,
          constructorArgumentsHash: material.constructorArgumentsHash,
          creationCodeHash: registry.target.creationCodeHash,
          expectedAddress,
          expectedRuntimeCodeHash,
          initCode: material.initCode,
          initCodeHash: material.initCodeHash,
          owner: walletAddress,
          permit2: binding.permit2Address,
          registryDigest: registry.registryDigest,
          selectorSetHash: localHelperUpgradeSelectorSetHash(registry.target.selectors),
          sourceBinding: binding,
          tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
          tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
        },
        now,
      ),
    ).not.toThrow();
    const first = localHelperUpgradeReplacementCandidate(value, {
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    });
    const bumped = {
      ...first,
      fee: { maxFeePerGasBaseUnit: "3", maxPriorityFeePerGasBaseUnit: "1" },
    };
    expect(() => validateLocalHelperUpgradeReplacement(value, first, bumped)).not.toThrow();
    expect(() =>
      validateLocalHelperUpgradeReplacement(value, first, { ...bumped, nonce: "8" }),
    ).toThrow("LOCAL_HELPER_UPGRADE_REPLACEMENT_IDENTITY_CHANGED");
  });

  it("keeps the cursor ordered and version comparison explicit", () => {
    expect(nextLocalHelperUpgradeCursor("preflight")).toBe("deploy-v2");
    expect(nextLocalHelperUpgradeCursor("atomic-binding-switch")).toBe("completed");
    expect(() => assertLocalHelperUpgradeCursorTransition("verify-v2", "sweep-v1")).not.toThrow();
    expect(() => assertLocalHelperUpgradeCursorTransition("verify-v2", "completed")).toThrow();
    expect(compareLocalHelperVersions("WalletHelperV1", "WalletHelperV2")).toBe(-1);
  });

  it("requires manual recovery for allowance, NFT, or unknown Token residuals", () => {
    const residual = {
      allowances: [{ amountBaseUnit: "1" }],
      balances: [{ amountBaseUnit: "0", dustBaseUnit: "1" }],
      coverage: { complete: true },
      identity: { bindingMatches: true, ownerMatches: true, runtimeMatches: true },
      manualRecoveryRequired: true,
      nftCustody: [],
      unknownTokens: [],
    } as unknown as LocalHelperResidualSnapshot;
    expect(localHelperV1SupersedeDecision(residual)).toMatchObject({
      eligible: false,
      manualRecoveryRequired: true,
    });
  });
});
