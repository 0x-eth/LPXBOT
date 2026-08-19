import type { CustodyWallet, WalletPositionPage } from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  PositionCursorError,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type PositionReadApplication,
  type PositionReadScanInput,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T01:30:00.000Z");
const userA = "63000000-0000-4000-8000-000000000001";
const userB = "63000000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0x1111111111111111111111111111111111111111",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Position fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "63000000-0000-4000-8000-000000000011",
};

class ChainPolicies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [
      {
        access: "all",
        chainId: 56,
        configurationComplete: true,
        displayName: "BNB Smart Chain",
        isDefault: true,
        missingConfiguration: [],
        previousAccess: null,
        reason: null,
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: "fixture",
      },
    ];
  }

  async recordManagementAudit(): Promise<void> {}

  async update(): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("unused");
  }
}

class Directory implements WalletDirectory {
  calls = 0;

  async getWallet(): Promise<CustodyWallet | null> {
    throw new Error("address routes must not trust a client walletId");
  }

  async listWallets(userId: string) {
    this.calls += 1;
    return { items: userId === userA ? [wallet] : [] };
  }
}

class PositionReads implements PositionReadApplication {
  readonly calls: PositionReadScanInput[] = [];
  failure: Error | null = null;

  async scan(input: PositionReadScanInput): Promise<Readonly<WalletPositionPage>> {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return Object.freeze({
      address: input.address,
      chainId: 56,
      coverage: Object.freeze({
        complete: true,
        failedPlatformIds: Object.freeze([]),
        scannedPlatformIds: Object.freeze(input.platformId === null ? [1, 2, 4, 5] : [input.platformId]),
      }),
      cursor: null,
      items: Object.freeze([]),
      quarantined: Object.freeze([]),
      registryVersion: "p05-bsc-execution-v1",
      snapshot: Object.freeze({
        blockHash: `0x${"ab".repeat(32)}` as const,
        blockNumber: "116718500",
        blockTimestamp: now.toISOString(),
        digest: `0x${"cd".repeat(32)}` as const,
      }),
      status: "empty",
      walletId: input.walletId,
    });
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const directory = new Directory();
  const positions = new PositionReads();
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    positionReads: positions,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    walletDirectory: directory,
  });
  apps.push(app);
  return { app, directory, positions, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P05-02 position read API", () => {
  it("serves both no-store read routes for the session-owned custody address", async () => {
    const { app, positions, tokenA } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: `/api/wallets/${wallet.address}/positions?chainId=56` }))
        .statusCode,
    ).toBe(401);

    const list = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address.toUpperCase().replace("0X", "0x")}/positions?chainId=56&platformId=4&limit=25`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().data).toMatchObject({ address: wallet.address, status: "empty" });
    expect(positions.calls[0]).toMatchObject({
      address: wallet.address,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 25,
      platformId: 4,
      userId: userA,
      walletId: wallet.walletId,
    });

    const scan = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/positions/scan/${wallet.address}?chainId=56&cursor=fixture-cursor&limit=10`,
    });
    expect(scan.statusCode).toBe(200);
    expect(positions.calls[1]).toMatchObject({ cursor: "fixture-cursor", limit: 10, platformId: null });
  });

  it("hides unknown and cross-user wallets before starting chain reads", async () => {
    const { app, positions, tokenA, tokenB } = await fixture();
    for (const [token, address] of [
      [tokenB, wallet.address],
      [tokenA, "0x2222222222222222222222222222222222222222"],
      [tokenA, "not-an-address"],
    ]) {
      const response = await app.inject({
        headers: auth(token),
        method: "GET",
        url: `/api/wallets/${address}/positions?chainId=56`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("WALLET_NOT_FOUND");
    }
    expect(positions.calls).toEqual([]);
  });

  it("rejects arbitrary RPC fields, unsupported scope, and malformed pagination", async () => {
    const { app, positions, tokenA } = await fixture();
    for (const query of [
      "chainId=56&target=0x2222222222222222222222222222222222222222",
      "chainId=56&provider=https%3A%2F%2Frpc.invalid",
      "chainId=56&calldata=0x1234",
      "chainId=56&platformId=3",
      "chainId=56&limit=0",
      "chainId=56&limit=101",
      "chainId=56&cursor=",
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "GET",
        url: `/api/wallets/${wallet.address}/positions?${query}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("POSITION_QUERY_INVALID");
    }
    const wrongChain = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/positions?chainId=1`,
    });
    expect(wrongChain.statusCode).toBe(403);
    expect(wrongChain.json().error.code).toBe("CHAIN_NOT_ALLOWED");
    expect(positions.calls).toEqual([]);
  });

  it("redacts cursor and provider failures into stable API errors", async () => {
    const { app, positions, tokenA } = await fixture();
    positions.failure = new PositionCursorError();
    const invalidCursor = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/positions?chainId=56&cursor=bad`,
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(invalidCursor.json().error.code).toBe("POSITION_CURSOR_INVALID");

    positions.failure = new Error("https://secret-rpc.invalid token=secret provider detail");
    const unavailable = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/positions?chainId=56`,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error).toEqual({
      code: "CHAIN_READ_UNAVAILABLE",
      message: "The controlled position reader is unavailable",
      retryable: true,
    });
    expect(unavailable.body).not.toContain("secret-rpc");
  });
});
