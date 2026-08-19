import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  buildApiApp,
  buildLocalPositionSnapshot,
  LocalPositionExecutionService,
  MemoryLocalPositionOperationStore,
  MemoryLocalPositionPreviewStore,
  MemoryLocalPositionSnapshotStore,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type LocalPositionChainInspection,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-20T07:30:00.000Z");
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const tenantId = "tenant-local-position-http";
const userA = "a7300000-0000-4000-8000-000000000001";
const userB = "a7300000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Local Position HTTP",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a7300000-0000-4000-8000-000000000003",
};

class Policies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [
      {
        access: "all",
        chainId: 31_337,
        configurationComplete: true,
        displayName: "Local Anvil",
        isDefault: true,
        missingConfiguration: [],
        previousAccess: null,
        reason: "synthetic only",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: userA,
      },
    ];
  }
  async recordManagementAudit(): Promise<void> {}
  async update(): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("unused");
  }
}

class Directory implements WalletDirectory {
  async getWallet(userId: string, walletId: string) {
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }
  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

function positionSnapshot() {
  return buildLocalPositionSnapshot({
    block: { hash: `0x${"12".repeat(32)}`, number: "8", timestamp: now.toISOString() },
    chainId: 31_337,
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
    manager: structuredClone(registry.manager),
    observedAt: now.toISOString(),
    position: {
      approval: { approvedAddress: null, approvedForAll: false, operator: null },
      liquidity: "101",
      owner: wallet.address,
      platformId: 1 as const,
      pool: {
        feePips: "3000",
        poolAddress: "0x0000000000000000000000000000000000001234" as const,
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
    tokens: registry.tokenPolicy.tokens.map(({ address, runtimeCodeHash }) => ({
      address,
      runtimeCodeHash,
    })) as [
      { address: `0x${string}`; runtimeCodeHash: `0x${string}` },
      { address: `0x${string}`; runtimeCodeHash: `0x${string}` },
    ],
    wallet: { address: wallet.address, walletId: wallet.walletId },
  });
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(executionEnabled = true) {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  const snapshot = positionSnapshot();
  const inspection: LocalPositionChainInspection = {
    blockHash: snapshot.block.hash,
    blockNumber: snapshot.block.number,
    headBlockNumber: "9",
    manager: {
      address: snapshot.manager.address,
      runtimeCodeHash: snapshot.manager.runtimeCodeHash,
    },
    nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
    position: structuredClone(snapshot.position),
    tokenCode: snapshot.tokens.map((token) => ({ ...token })),
  };
  let sequence = 20;
  const localPositionExecutions = new LocalPositionExecutionService({
    chain: {
      async inspect() {
        return structuredClone(inspection);
      },
    },
    now: () => now,
    operations: new MemoryLocalPositionOperationStore({
      now: () => now,
      uuid: () => `a7300000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    }),
    previews: new MemoryLocalPositionPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(9),
    snapshots: new MemoryLocalPositionSnapshotStore([{ snapshot, tenantId, userId: userA }]),
  });
  const app = buildApiApp({
    chainPolicyStore: new Policies(),
    freshReauthentication: {
      async verify({ proof }) {
        return proof === "fresh-proof";
      },
    },
    localPositionExecutionChainIds: executionEnabled ? [31_337] : [],
    localPositionExecutions,
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: sessions,
    tenantId,
    walletDirectory: new Directory(),
  });
  apps.push(app);
  return { app, snapshot, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => Promise.all(apps.map((app) => app.close())));

describe("P05-07 local position HTTP API", () => {
  it("previews, reauthenticates, submits idempotently and queries through the unified endpoint", async () => {
    const { app, snapshot, tokenA, tokenB } = await fixture();
    const request = {
      platformId: 1,
      snapshotDigest: snapshot.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    };
    const currentUrl = `/api/positions/local-current?walletId=${wallet.walletId}`;
    expect((await app.inject({ method: "GET", url: currentUrl })).statusCode).toBe(401);
    const current = await app.inject({ headers: auth(tokenA), method: "GET", url: currentUrl });
    expect(current.statusCode).toBe(200);
    expect(current.headers["cache-control"]).toBe("no-store");
    expect(current.json().data).toMatchObject({
      chainId: 31_337,
      executionEnabled: true,
      registryVersion: "p05-local-position-execution-v2",
      serviceFeeBps: 0,
      walletId: wallet.walletId,
    });
    expect(current.json().data.items).toEqual([snapshot]);
    expect(
      (await app.inject({ headers: auth(tokenB), method: "GET", url: currentUrl })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "GET",
          url: `${currentUrl}&manager=0x${"1".repeat(40)}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          payload: request,
          url: "/api/positions/collect-fees/preview",
        })
      ).statusCode,
    ).toBe(401);
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: request,
      url: "/api/positions/collect-fees/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.json().data).toMatchObject({
      deadline: new Date(now.getTime() + registry.maxDeadlineSeconds * 1_000).toISOString(),
      operationKind: "position-collect-fees",
      serviceFeeBps: 0,
    });
    const execute = {
      ...request,
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
    };
    const headers = { ...auth(tokenA), "idempotency-key": "position-http-collect-0001" };
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: execute,
          url: "/api/positions/collect-fees",
        })
      ).statusCode,
    ).toBe(403);
    const submitted = await app.inject({
      headers: { ...headers, "x-lpbot-reauthentication": "fresh-proof" },
      method: "POST",
      payload: execute,
      url: "/api/positions/collect-fees",
    });
    expect(submitted.statusCode).toBe(202);
    expect(
      (
        await app.inject({
          headers: { ...headers, "x-lpbot-reauthentication": "fresh-proof" },
          method: "POST",
          payload: execute,
          url: "/api/positions/collect-fees",
        })
      ).statusCode,
    ).toBe(200);
    const url = `/api/chain-operations/${submitted.json().data.operationId}`;
    expect((await app.inject({ headers: auth(tokenA), method: "GET", url })).statusCode).toBe(200);
    expect((await app.inject({ headers: auth(tokenB), method: "GET", url })).statusCode).toBe(404);
  });

  it("builds and submits ordered full removal", async () => {
    const { app, snapshot, tokenA } = await fixture();
    const request = {
      burnIfEmpty: true,
      percent: 100,
      platformId: 1,
      slippageBps: 100,
      snapshotDigest: snapshot.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    };
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: request,
      url: "/api/positions/remove-liquidity/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.steps.map(({ kind }: { kind: string }) => kind)).toEqual([
      "decrease",
      "collect",
      "burn",
    ]);
    const submitted = await app.inject({
      headers: {
        ...auth(tokenA),
        "idempotency-key": "position-http-remove-0001",
        "x-lpbot-reauthentication": "fresh-proof",
      },
      method: "POST",
      payload: {
        ...request,
        previewDigest: preview.json().data.previewDigest,
        previewToken: preview.json().data.previewToken,
      },
      url: "/api/positions/remove-liquidity",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().data.steps.map(({ kind }: { kind: string }) => kind)).toEqual([
      "decrease",
      "collect",
      "burn",
    ]);
  });

  it("rejects execution-field injection, foreign wallets and a closed local gate", async () => {
    const { app, snapshot, tokenA, tokenB } = await fixture();
    const base = {
      burnIfEmpty: false,
      percent: 25,
      platformId: 1,
      slippageBps: 100,
      snapshotDigest: snapshot.snapshotDigest,
      tokenId: "1",
      walletId: wallet.walletId,
    };
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
      "deadline",
      "fee",
      "feeLimit",
      "serviceFeeBps",
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload: { ...base, [field]: "injected" },
        url: "/api/positions/remove-liquidity/preview",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("PREVIEW_INVALID");
    }
    expect(
      (
        await app.inject({
          headers: auth(tokenB),
          method: "POST",
          payload: base,
          url: "/api/positions/remove-liquidity/preview",
        })
      ).statusCode,
    ).toBe(404);
    const closed = await fixture(false);
    expect(
      (
        await closed.app.inject({
          headers: auth(closed.tokenA),
          method: "GET",
          url: `/api/positions/local-current?walletId=${wallet.walletId}`,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await closed.app.inject({
          headers: auth(closed.tokenA),
          method: "POST",
          payload: base,
          url: "/api/positions/remove-liquidity/preview",
        })
      ).statusCode,
    ).toBe(403);
    expect(() =>
      buildApiApp({
        localPositionExecutionChainIds: [56],
        maintenance: { enabled: false, message: null, until: null },
        regionPolicy: () => ({ blocked: false, code: null, message: null }),
        sessionStore: new SessionFixtureStore(),
      }),
    ).toThrow("Local position execution chain IDs must contain only 31337");
  });
});
