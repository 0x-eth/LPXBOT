import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  type LocalHelperSweepComponentRole,
} from "../packages/chain-registry/src/index.js";
import type { LocalHelperSweepBinding } from "../packages/domain/src/local-helper-sweep.js";
import {
  LocalHelperSweepError,
  LocalHelperSweepService,
  MemoryLocalHelperResidualSnapshotStore,
  MemoryLocalHelperSweepBindingStore,
  MemoryLocalHelperSweepOperationStore,
  MemoryLocalHelperSweepPreviewStore,
  parseLocalHelperSweepPreview,
  parseLocalHelperSweepSubmit,
  type LocalHelperResidualChainInspection,
} from "../apps/api/src/local-helper-sweeps.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T08:30:00.000Z");
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const tenantId = "p05-local-helper-sweep";
const userId = "a8100000-0000-4000-8000-000000000001";
const otherUserId = "a8100000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Synthetic Sweep Wallet",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a8100000-0000-4000-8000-000000000003",
};
const binding: LocalHelperSweepBinding = {
  adapterAddress: registry.components.find(({ role }) => role === "adapter")!.address,
  bindingId: "a8100000-0000-4000-8000-000000000004",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2",
  helperAddress: "0x1234567890123456789012345678901234567890",
  helperVersion: "WalletHelperV1",
  ownerAddress: wallet.address,
  permit2Address: registry.components.find(({ role }) => role === "permit2")!.address,
  runtimeCodeHash: `0x${"aa".repeat(32)}`,
  state: "active",
  verifiedBlockNumber: "7",
  walletId: wallet.walletId,
};

function inspection(
  overrides: Partial<LocalHelperResidualChainInspection> = {},
): LocalHelperResidualChainInspection {
  const allowances = registry.tokens.flatMap((token) =>
    registry.components.map((component) => ({
      amountBaseUnit: "0",
      spenderAddress: component.address,
      spenderRole: component.role,
      tokenAddress: token.address,
    })),
  );
  return {
    allowances,
    block: {
      hash: `0x${"12".repeat(32)}`,
      number: "8",
      timestamp: new Date(now.getTime() - 1_000).toISOString(),
    },
    componentCode: registry.components.map(({ address, role, runtimeCodeHash }) => ({
      address,
      role,
      runtimeCodeHash,
    })),
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    feeLimits: [
      "native:31337",
      ...registry.tokens.map(({ address }) => `token:${address}`),
    ].map((assetId) => ({
      assetId,
      feeLimit: {
        feeCapBaseUnit: "400000",
        gasLimit: "100000",
        maxFeePerGasBaseUnit: "4",
        maxPriorityFeePerGasBaseUnit: "2",
      },
    })),
    headBlockNumber: "8",
    helper: { owner: wallet.address, runtimeCodeHash: binding.runtimeCodeHash },
    nativeBalanceBaseUnit: "2000",
    nftCustody: [],
    nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
    referencedBlockHash: `0x${"12".repeat(32)}`,
    tokenBalances: registry.tokens.map((token, index) => ({
      address: token.address,
      amountBaseUnit: index === 0 ? "20" : "30",
      runtimeCodeHash: token.runtimeCodeHash,
    })),
    unknownTokens: [],
    ...overrides,
  };
}

function fixture(initial = inspection()) {
  let observed = structuredClone(initial);
  let sequence = 10;
  let previewSequence = 8;
  const bindings = new MemoryLocalHelperSweepBindingStore([
    { ...binding, tenantId, userId },
  ]);
  const operations = new MemoryLocalHelperSweepOperationStore({
    now: () => now,
    uuid: () => `a8100000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  const service = new LocalHelperSweepService({
    bindings,
    chain: {
      async inspect() {
        return structuredClone(observed);
      },
    },
    now: () => now,
    operations,
    previews: new MemoryLocalHelperSweepPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(previewSequence++),
    snapshots: new MemoryLocalHelperResidualSnapshotStore(),
  });
  return {
    bindings,
    operations,
    service,
    setInspection(value: LocalHelperResidualChainInspection) {
      observed = structuredClone(value);
    },
  };
}

async function scanned(api: ReturnType<typeof fixture>) {
  return api.service.scan({
    idempotencyKey: "local-helper-scan-0001",
    tenantId,
    userId,
    wallet,
  });
}

describe("P05-08 local Helper sweep API", () => {
  it("accepts only wallet, chain, assets and snapshot fields", () => {
    const request = {
      assetIds: ["native:31337"],
      chainId: 31_337,
      snapshotDigest: `sha256:${"11".repeat(32)}`,
      walletId: wallet.walletId,
    } as const;
    expect(parseLocalHelperSweepPreview(request)).toEqual(request);
    for (const field of [
      "helper",
      "token",
      "target",
      "selector",
      "calldata",
      "amount",
      "recipient",
      "fee",
      "feeLimit",
    ]) {
      expect(() => parseLocalHelperSweepPreview({ ...request, [field]: "injected" })).toThrow(
        "PREVIEW_INVALID",
      );
    }
    expect(() =>
      parseLocalHelperSweepPreview({
        ...request,
        assetIds: ["native:31337", "native:31337"],
      }),
    ).toThrow("DUPLICATE_ASSET_ID");
    expect(() =>
      parseLocalHelperSweepSubmit({
        ...request,
        amount: "2000",
        previewDigest: `sha256:${"22".repeat(32)}`,
        previewToken: "A".repeat(43),
      }),
    ).toThrow("PREVIEW_INVALID");
  });

  it("scans, degrades, previews and creates independent mixed-asset operations", async () => {
    const api = fixture();
    const snapshot = await scanned(api);
    expect(snapshot).toMatchObject({
      binding: { state: "degraded" },
      degradationReasons: ["residual-above-dust"],
      manualRecoveryRequired: false,
    });
    expect((await api.bindings.get({ tenantId, userId, walletId: wallet.walletId }))?.state).toBe(
      "degraded",
    );
    const request = {
      assetIds: ["native:31337", `token:${registry.tokens[0].address}`],
      chainId: 31_337 as const,
      snapshotDigest: snapshot.snapshotDigest,
      walletId: wallet.walletId,
    };
    const preview = await api.service.preview({ request, tenantId, userId, wallet });
    expect(preview).toMatchObject({
      feeLimitTotalBaseUnit: "800000",
      helperAddress: binding.helperAddress,
      recipient: wallet.address,
    });
    const submission = {
      idempotencyKey: "local-helper-sweep-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "request-1",
      sessionId: "a8100000-0000-4000-8000-000000000090",
      tenantId,
      userId,
      wallet,
    };
    const first = await api.service.sweep(submission);
    const duplicate = await api.service.sweep(submission);
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.batch.operations).toHaveLength(2);
    expect(first.batch.operations.map(({ nonce }) => nonce)).toEqual(["8", "9"]);
    expect(new Set(first.batch.operations.map(({ operationId }) => operationId)).size).toBe(2);
    expect(new Set(first.batch.operations.map(({ planDigest }) => planDigest)).size).toBe(2);
    expect(first.batch.operations.every(({ recipient }) => recipient === wallet.address)).toBe(true);
    expect(api.operations.outbox).toHaveLength(2);
    await expect(
      api.service.getBatch({ batchId: first.batch.batchId, tenantId, userId: otherUserId }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_NOT_FOUND" });
    await expect(
      api.service.getOperation({
        operationId: first.batch.operations[0]!.operationId,
        tenantId,
        userId: otherUserId,
      }),
    ).rejects.toMatchObject({ code: "LOCAL_HELPER_SWEEP_NOT_FOUND" });
  });

  it.each([
    ["TestOnlyERC20", `token:${registry.tokens[0].address}`],
    ["WBNB", `token:${registry.tokens[1].address}`],
    ["native", "native:31337"],
  ])("previews a single %s sweep", async (_name, assetId) => {
    const api = fixture();
    const snapshot = await scanned(api);
    await expect(
      api.service.preview({
        request: {
          assetIds: [assetId],
          chainId: 31_337,
          snapshotDigest: snapshot.snapshotDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({ assets: [{ assetId }] });
  });

  it("rejects changed and reorged snapshots", async () => {
    const api = fixture();
    const snapshot = await scanned(api);
    api.setInspection(
      inspection({
        tokenBalances: inspection().tokenBalances.map((token, index) => ({
          ...token,
          amountBaseUnit: index === 0 ? "21" : token.amountBaseUnit,
        })),
      }),
    );
    await expect(
      api.service.preview({
        request: {
          assetIds: [`token:${registry.tokens[0].address}`],
          chainId: 31_337,
          snapshotDigest: snapshot.snapshotDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_CHANGED" });

    api.setInspection(inspection({ referencedBlockHash: `0x${"44".repeat(32)}` }));
    await expect(
      api.service.preview({
        request: {
          assetIds: ["native:31337"],
          chainId: 31_337,
          snapshotDigest: snapshot.snapshotDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_REORGED" });
  });

  it("returns manual recovery for allowance, NFT and unknown token custody", async () => {
    const manager = registry.components.find(({ role }) => role === "manager")!;
    const scenarios: LocalHelperResidualChainInspection[] = [
      inspection({
        allowances: inspection().allowances.map((allowance, index) => ({
          ...allowance,
          amountBaseUnit: index === 0 ? "1" : "0",
        })),
      }),
      inspection({ nftCustody: [{ managerAddress: manager.address, tokenId: "1" }] }),
      inspection({
        unknownTokens: [
          {
            address: "0x9999999999999999999999999999999999999999",
            amountBaseUnit: "9",
            runtimeCodeHash: `0x${"99".repeat(32)}`,
          },
        ],
      }),
    ];
    for (const [index, observed] of scenarios.entries()) {
      const api = fixture(observed);
      const snapshot = await api.service.scan({
        idempotencyKey: `local-helper-manual-${index}`,
        tenantId,
        userId,
        wallet,
      });
      expect(snapshot.manualRecoveryRequired).toBe(true);
      await expect(
        api.service.preview({
          request: {
            assetIds: ["native:31337"],
            chainId: 31_337,
            snapshotDigest: snapshot.snapshotDigest,
            walletId: wallet.walletId,
          },
          tenantId,
          userId,
          wallet,
        }),
      ).rejects.toMatchObject({ code: "MANUAL_RECOVERY_REQUIRED" });
    }
  });

  it("rejects zero/dust assets, owner/runtime mismatch and provider nonce divergence", async () => {
    const dustApi = fixture(inspection({ nativeBalanceBaseUnit: "1000" }));
    const dustSnapshot = await scanned(dustApi);
    await expect(
      dustApi.service.preview({
        request: {
          assetIds: ["native:31337"],
          chainId: 31_337,
          snapshotDigest: dustSnapshot.snapshotDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "ZERO_BALANCE" });

    for (const helper of [
      { owner: registry.tokens[0].address, runtimeCodeHash: binding.runtimeCodeHash },
      { owner: wallet.address, runtimeCodeHash: `0x${"77".repeat(32)}` as const },
    ]) {
      const api = fixture(inspection({ helper }));
      const snapshot = await api.service.scan({
        idempotencyKey: `local-helper-identity-${helper.owner.slice(2, 6)}-${helper.runtimeCodeHash?.slice(2, 6)}`,
        tenantId,
        userId,
        wallet,
      });
      expect(snapshot.degradationReasons).toContain("identity-mismatch");
      await expect(
        api.service.preview({
          request: {
            assetIds: ["native:31337"],
            chainId: 31_337,
            snapshotDigest: snapshot.snapshotDigest,
            walletId: wallet.walletId,
          },
          tenantId,
          userId,
          wallet,
        }),
      ).rejects.toMatchObject({ code: "HELPER_BINDING_MISMATCH" });
    }

    const nonceApi = fixture(
      inspection({
        nonceViews: [
          { latest: "8", pending: "8", providerId: "anvil-primary" },
          { latest: "8", pending: "9", providerId: "anvil-secondary" },
        ],
      }),
    );
    const nonceSnapshot = await scanned(nonceApi);
    await expect(
      nonceApi.service.preview({
        request: {
          assetIds: ["native:31337"],
          chainId: 31_337,
          snapshotDigest: nonceSnapshot.snapshotDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "NONCE_RECONCILIATION_REQUIRED" });
  });

  it("rejects a live second batch and conflicting idempotency payload", async () => {
    const api = fixture();
    const snapshot = await scanned(api);
    const firstRequest = {
      assetIds: ["native:31337"],
      chainId: 31_337 as const,
      snapshotDigest: snapshot.snapshotDigest,
      walletId: wallet.walletId,
    };
    const firstPreview = await api.service.preview({ request: firstRequest, tenantId, userId, wallet });
    const common = {
      idempotencyKey: "local-helper-conflict-0001",
      requestId: "request-conflict",
      sessionId: "a8100000-0000-4000-8000-000000000090",
      tenantId,
      userId,
      wallet,
    };
    await api.service.sweep({
      ...common,
      request: {
        ...firstRequest,
        previewDigest: firstPreview.previewDigest,
        previewToken: firstPreview.previewToken,
      },
    });
    const tokenRequest = {
      ...firstRequest,
      assetIds: [`token:${registry.tokens[0].address}`],
    };
    const tokenPreview = await api.service.preview({ request: tokenRequest, tenantId, userId, wallet });
    await expect(
      api.service.sweep({
        ...common,
        request: {
          ...tokenRequest,
          previewDigest: tokenPreview.previewDigest,
          previewToken: tokenPreview.previewToken,
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      api.service.sweep({
        ...common,
        idempotencyKey: "local-helper-live-batch-0002",
        request: {
          ...tokenRequest,
          previewDigest: tokenPreview.previewDigest,
          previewToken: tokenPreview.previewToken,
        },
      }),
    ).rejects.toMatchObject({ code: "BATCH_IN_PROGRESS" });
  });
});
