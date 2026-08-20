import { describe, expect, it } from "vitest";

import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import type { LocalHelperResidualSnapshot } from "../packages/domain/src/local-helper-sweep.js";
import {
  LocalHelperUpgradeError,
  LocalHelperUpgradeService,
  MemoryLocalHelperUpgradeBindingStore,
  MemoryLocalHelperUpgradeOperationStore,
  MemoryLocalHelperUpgradePreviewStore,
  parseLocalHelperUpgradePreview,
  parseLocalHelperUpgradeSubmit,
  type LocalHelperUpgradeChainReader,
  type LocalHelperUpgradeResidualReader,
} from "../apps/api/src/local-helper-upgrades.js";

const now = new Date("2026-08-21T01:00:00.000Z");
const tenantId = "tenant-a";
const userId = "9c000000-0000-4000-8000-000000000011";
const walletId = "9c000000-0000-4000-8000-000000000012";
const walletAddress = `0x${"11".repeat(20)}` as const;
const wallet = {
  address: walletAddress,
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready" as const,
  mode: "server-kek" as const,
  name: "Upgrade fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};
const binding = {
  adapterAddress: P05_HELPER_DEPLOYMENT_REGISTRY.components[0]!.address,
  bindingId: "9c000000-0000-4000-8000-000000000013",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2" as const,
  helperAddress: `0x${"22".repeat(20)}` as const,
  helperVersion: "WalletHelperV1" as const,
  ownerAddress: walletAddress,
  permit2Address: P05_HELPER_DEPLOYMENT_REGISTRY.components[1]!.address,
  runtimeCodeHash: `0x${"33".repeat(32)}` as const,
  state: "active" as const,
  verifiedBlockNumber: "8",
  walletId,
};

function residual(
  input: { allowance?: string; manual?: boolean } = {},
): LocalHelperResidualSnapshot {
  const allowance = input.allowance ?? "0";
  return {
    allowances: [
      {
        amountBaseUnit: allowance,
        assetId: `allowance:${P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].address}:${binding.adapterAddress}`,
        spenderAddress: binding.adapterAddress,
        spenderRole: "adapter",
        tokenAddress: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].address,
      },
    ],
    balances: [
      {
        amountBaseUnit: "1000",
        assetId: "native:31337",
        dustBaseUnit: "1000",
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
    ],
    binding,
    block: {
      hash: `0x${"44".repeat(32)}`,
      number: "9",
      timestamp: now.toISOString(),
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons: allowance === "0" ? [] : ["nonzero-allowance"],
    expiresAt: "2026-08-21T01:05:00.000Z",
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner: walletAddress,
      observedRuntimeCodeHash: binding.runtimeCodeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: input.manual ?? allowance !== "0",
    nftCustody: [],
    observedAt: now.toISOString(),
    registry: {
      digest: P05_LOCAL_HELPER_UPGRADE_REGISTRY.sweep.registryDigest,
      version: "p05-local-helper-sweep-v2",
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${(allowance === "0" ? "55" : "66").repeat(32)}`,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: [],
    wallet: { address: walletAddress, walletId },
  };
}

class ChainFixture implements LocalHelperUpgradeChainReader {
  divergent = false;
  runtime = `0x${"77".repeat(32)}` as const;

  async nonceSnapshot() {
    return [
      {
        blockHash: `0x${"88".repeat(32)}` as const,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-a",
      },
      {
        blockHash: `0x${(this.divergent ? "89" : "88").repeat(32)}` as `0x${string}`,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-b",
      },
    ];
  }

  async inspect() {
    return {
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: this.runtime,
      feeLimit: {
        feeCapBaseUnit: "2000000",
        gasLimit: "1000000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      sourceIdentity: {
        bindingMatches: true,
        observedOwner: walletAddress,
        observedRuntimeCodeHash: binding.runtimeCodeHash,
        ownerMatches: true,
        registryMatches: true,
        runtimeMatches: true,
      },
    };
  }
}

class ResidualFixture implements LocalHelperUpgradeResidualReader {
  value = residual();
  async scan() {
    return structuredClone(this.value);
  }
}

function fixture() {
  const bindings = new MemoryLocalHelperUpgradeBindingStore();
  bindings.seed({ binding, tenantId, userId });
  const chain = new ChainFixture();
  const operations = new MemoryLocalHelperUpgradeOperationStore({
    now: () => now,
    uuid: () => "9c000000-0000-4000-8000-000000000014",
  });
  const residuals = new ResidualFixture();
  const service = new LocalHelperUpgradeService({
    bindings,
    chain,
    now: () => now,
    operations,
    previews: new MemoryLocalHelperUpgradePreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(9),
    residuals,
  });
  return { bindings, chain, operations, residuals, service };
}

const request = { chainId: 31_337 as const, walletId };

describe("P05-09 local Helper upgrade API domain", () => {
  it("accepts only wallet/chain plus opaque preview confirmation", () => {
    expect(parseLocalHelperUpgradePreview(request)).toEqual(request);
    for (const key of [
      "bytecode",
      "helper",
      "target",
      "selector",
      "calldata",
      "recipient",
      "registryOverride",
      "feeOverride",
      "serviceFeeBps",
    ]) {
      expect(() => parseLocalHelperUpgradePreview({ ...request, [key]: "injected" })).toThrow(
        "PREVIEW_INVALID",
      );
    }
    expect(() =>
      parseLocalHelperUpgradeSubmit({
        ...request,
        previewDigest: `sha256:${"0".repeat(64)}`,
        previewToken: "A".repeat(43),
        target: `0x${"99".repeat(20)}`,
      }),
    ).toThrow("PREVIEW_INVALID");
    expect(() => parseLocalHelperUpgradePreview({ ...request, chainId: 56 })).toThrow(
      "CHAIN_NOT_ALLOWED",
    );
  });

  it("previews version/steps and creates one plan-bound operation idempotently", async () => {
    const { operations, service } = fixture();
    const preview = await service.preview({ request, tenantId, userId, wallet });
    expect(preview).toMatchObject({
      registryVersion: "p05-local-helper-upgrade-v3",
      sourceHelperAddress: binding.helperAddress,
      upgradeable: true,
      versions: {
        comparison: "upgrade-available",
        source: "WalletHelperV1",
        target: "WalletHelperV2",
      },
    });
    expect(preview.steps).toEqual([
      "preflight",
      "deploy-v2",
      "verify-v2",
      "sweep-v1",
      "final-rescan-v1",
      "atomic-binding-switch",
      "completed",
    ]);
    expect(preview).not.toHaveProperty("bytecode");
    expect(preview).not.toHaveProperty("calldata");

    const submitted = await service.submit({
      idempotencyKey: "helper-upgrade-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "request-1",
      sessionId: "9c000000-0000-4000-8000-000000000015",
      tenantId,
      userId,
      wallet,
    });
    expect(submitted).toMatchObject({
      created: true,
      operation: { cursor: "preflight", nonce: "7", state: "queued" },
    });
    const stored = await operations.get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    expect(stored?.plan.transaction).toMatchObject({ to: null, valueBaseUnit: "0" });
    expect(stored?.plan.target).toMatchObject({
      helperVersion: "WalletHelperV2",
      owner: walletAddress,
    });

    const duplicate = await service.submit({
      idempotencyKey: "helper-upgrade-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "request-2",
      sessionId: "9c000000-0000-4000-8000-000000000015",
      tenantId,
      userId,
      wallet,
    });
    expect(duplicate).toEqual({ created: false, operation: submitted.operation });
  });

  it("fails closed on provider divergence and degraded binding", async () => {
    const divergent = fixture();
    divergent.chain.divergent = true;
    await expect(divergent.service.preview({ request, tenantId, userId, wallet })).rejects.toThrow(
      "PROVIDER_DIVERGENCE",
    );

    const degraded = fixture();
    degraded.bindings.seed({
      binding: { ...binding, state: "degraded" },
      tenantId,
      userId,
    });
    const preview = await degraded.service.preview({ request, tenantId, userId, wallet });
    expect(preview.upgradeable).toBe(false);
    expect(preview.blockers).toContain("BINDING_DEGRADED");
  });

  it("returns manual recovery and never creates calldata for nonzero allowance", async () => {
    const { operations, residuals, service } = fixture();
    residuals.value = residual({ allowance: "1", manual: true });
    const preview = await service.preview({ request, tenantId, userId, wallet });
    expect(preview).toMatchObject({
      residual: { allowanceCount: 1 },
      upgradeable: false,
    });
    expect(preview.blockers).toContain("RESIDUAL_MANUAL_RECOVERY_REQUIRED");
    await expect(
      service.submit({
        idempotencyKey: "helper-upgrade-0002",
        request: {
          ...request,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
        },
        requestId: "request-3",
        sessionId: "9c000000-0000-4000-8000-000000000015",
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toThrow(LocalHelperUpgradeError);
    expect(operations.outbox).toHaveLength(0);
  });
});
