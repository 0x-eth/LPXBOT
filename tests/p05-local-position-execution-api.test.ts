import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "../packages/chain-registry/src/index.js";
import type { LocalPositionSnapshot } from "../packages/domain/src/local-position-execution.js";
import {
  buildLocalPositionSnapshot,
  LocalPositionExecutionError,
  LocalPositionExecutionService,
  MemoryLocalPositionOperationStore,
  MemoryLocalPositionPreviewStore,
  MemoryLocalPositionSnapshotStore,
  parseLocalPositionCollectFees,
  parseLocalPositionCollectFeesPreview,
  parseLocalPositionRemoveLiquidity,
  parseLocalPositionRemoveLiquidityPreview,
  type LocalPositionChainInspection,
} from "../apps/api/src/local-position-executions.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T06:30:00.000Z");
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const tenantId = "local-position-fixture";
const userId = "a7100000-0000-4000-8000-000000000001";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Synthetic Position Wallet",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a7100000-0000-4000-8000-000000000002",
};

function snapshot(): LocalPositionSnapshot {
  return buildLocalPositionSnapshot({
    block: { hash: `0x${"12".repeat(32)}`, number: "8", timestamp: now.toISOString() },
    chainId: 31_337,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    manager: {
      abiHash: registry.manager.abiHash,
      address: registry.manager.address,
      runtimeCodeHash: registry.manager.runtimeCodeHash,
    },
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
    wallet: { address: wallet.address, walletId: wallet.walletId },
  });
}

function inspection(
  state: LocalPositionSnapshot,
  overrides: Partial<LocalPositionChainInspection> = {},
): LocalPositionChainInspection {
  return {
    blockHash: state.block.hash,
    blockNumber: state.block.number,
    headBlockNumber: "9",
    manager: {
      address: state.manager.address,
      runtimeCodeHash: state.manager.runtimeCodeHash,
    },
    nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
    position: structuredClone(state.position),
    tokenCode: state.tokens.map((token) => ({ ...token })),
    ...overrides,
  };
}

function fixture(overrides: Partial<LocalPositionChainInspection> = {}) {
  const state = snapshot();
  const operations = new MemoryLocalPositionOperationStore({
    now: () => now,
    uuid: (() => {
      let sequence = 10;
      return () => `a7100000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;
    })(),
  });
  const service = new LocalPositionExecutionService({
    chain: {
      async inspect() {
        return inspection(state, overrides);
      },
    },
    now: () => now,
    operations,
    previews: new MemoryLocalPositionPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(7),
    snapshots: new MemoryLocalPositionSnapshotStore([{ snapshot: state, tenantId, userId }]),
  });
  return { operations, service, snapshot: state };
}

describe("P05-07 local position execution API service", () => {
  it("allows only position identity and user intent fields", () => {
    const state = snapshot();
    const collect = {
      platformId: 1,
      snapshotDigest: state.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    } as const;
    expect(parseLocalPositionCollectFeesPreview(collect)).toEqual(collect);
    const remove = {
      ...collect,
      burnIfEmpty: false,
      percent: 25,
      slippageBps: 100,
    } as const;
    expect(parseLocalPositionRemoveLiquidityPreview(remove)).toEqual(remove);
    for (const field of [
      "manager",
      "target",
      "selector",
      "calldata",
      "recipient",
      "liquidityDelta",
      "amount0Max",
      "amount1Max",
      "amount0Min",
      "amount1Min",
      "fee",
    ]) {
      expect(() =>
        parseLocalPositionRemoveLiquidityPreview({ ...remove, [field]: "injected" }),
      ).toThrow("PREVIEW_INVALID");
    }
    expect(() =>
      parseLocalPositionCollectFees({
        ...collect,
        calldata: "0xdeadbeef",
        previewDigest: `sha256:${"22".repeat(32)}`,
        previewToken: "A".repeat(43),
      }),
    ).toThrow("PREVIEW_INVALID");
    expect(() =>
      parseLocalPositionRemoveLiquidity({
        ...remove,
        recipient: wallet.address,
        previewDigest: `sha256:${"22".repeat(32)}`,
        previewToken: "A".repeat(43),
      }),
    ).toThrow("PREVIEW_INVALID");
  });

  it("previews and submits canonical collect including zero-fee collect idempotently", async () => {
    const api = fixture();
    const request = {
      platformId: 1 as const,
      snapshotDigest: api.snapshot.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    };
    const preview = await api.service.previewCollectFees({ request, tenantId, userId, wallet });
    expect(preview).toMatchObject({
      expectedToken0DeltaBaseUnit: "11",
      expectedToken1DeltaBaseUnit: "13",
      liquidityDelta: "0",
      operationKind: "position-collect-fees",
      remainingLiquidity: "101",
      serviceFeeBps: 0,
    });
    const submission = {
      idempotencyKey: "position-collect-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "request-1",
      sessionId: "a7100000-0000-4000-8000-000000000090",
      tenantId,
      userId,
      wallet,
    };
    const first = await api.service.collectFees(submission);
    const duplicate = await api.service.collectFees(submission);
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(first.operation.steps.map(({ kind }) => kind)).toEqual(["collect"]);
    expect(first.operation.steps[0]).toMatchObject({ nonce: "8", state: "queued" });
  });

  it.each([1, 25, 50, 99, 100])("builds ordered %s%% remove operations", async (percent) => {
    const api = fixture();
    const request = {
      burnIfEmpty: percent === 100,
      percent,
      platformId: 1 as const,
      slippageBps: 100,
      snapshotDigest: api.snapshot.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    };
    const preview = await api.service.previewRemoveLiquidity({ request, tenantId, userId, wallet });
    expect(preview.steps.map(({ kind }) => kind)).toEqual(
      percent === 100 ? ["decrease", "collect", "burn"] : ["decrease", "collect"],
    );
    const result = await api.service.removeLiquidity({
      idempotencyKey: `position-remove-${String(percent).padStart(4, "0")}`,
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: `request-${percent}`,
      sessionId: "a7100000-0000-4000-8000-000000000090",
      tenantId,
      userId,
      wallet,
    });
    expect(result.operation.steps.map(({ nonce }) => nonce)).toEqual(
      result.operation.steps.map((_, index) => String(8 + index)),
    );
    expect(result.operation.steps[0]?.state).toBe("queued");
    expect(result.operation.steps.slice(1).every(({ state }) => state === "blocked")).toBe(true);
  });

  it("rejects partial burn, zero delta, reorg, changed approval and provider divergence", async () => {
    const state = snapshot();
    expect(() =>
      parseLocalPositionRemoveLiquidityPreview({
        burnIfEmpty: true,
        percent: 99,
        platformId: 1,
        slippageBps: 100,
        snapshotDigest: state.snapshotDigest,
        tokenId: "1",
        walletId: wallet.walletId,
      }),
    ).toThrow("BURN_NOT_ALLOWED");

    const zero = fixture({
      position: { ...structuredClone(state.position), liquidity: "50" },
    });
    await expect(
      zero.service.previewRemoveLiquidity({
        request: {
          burnIfEmpty: false,
          percent: 1,
          platformId: 1,
          slippageBps: 100,
          snapshotDigest: zero.snapshot.snapshotDigest,
          tokenId: "1",
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toBeInstanceOf(LocalPositionExecutionError);

    const reorg = fixture({ blockHash: `0x${"99".repeat(32)}` });
    await expect(
      reorg.service.previewCollectFees({
        request: {
          platformId: 1,
          snapshotDigest: reorg.snapshot.snapshotDigest,
          tokenId: "1",
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_REORGED" });

    const changed = fixture({
      position: {
        ...structuredClone(state.position),
        approval: {
          ...state.position.approval,
          approvedAddress: "0x000000000000000000000000000000000000beef",
        },
      },
    });
    await expect(
      changed.service.previewCollectFees({
        request: {
          platformId: 1,
          snapshotDigest: changed.snapshot.snapshotDigest,
          tokenId: "1",
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "OWNER_APPROVAL_MISMATCH" });

    const divergent = fixture({
      nonceViews: [
        { latest: "8", pending: "8", providerId: "anvil-primary" },
        { latest: "8", pending: "9", providerId: "anvil-secondary" },
      ],
    });
    await expect(
      divergent.service.previewCollectFees({
        request: {
          platformId: 1,
          snapshotDigest: divergent.snapshot.snapshotDigest,
          tokenId: "1",
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "NONCE_RECONCILIATION_REQUIRED" });
  });
});
