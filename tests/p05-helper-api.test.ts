import type {
  CustodyWallet,
  HelperResidualPage,
  WalletHelperStatus,
  WalletPositionPage,
} from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  HelperResidualCursorError,
  HelperResidualReadError,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type PositionReadApplication,
  type PositionReadScanInput,
  type WalletDirectory,
  type WalletHelperReadApplication,
  type WalletHelperResidualApplication,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T04:00:00.000Z");
const userA = "66000000-0000-4000-8000-000000000001";
const userB = "66000000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0x1111111111111111111111111111111111111111",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Helper fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "66000000-0000-4000-8000-000000000011",
};
const helperAddress = "0x2222222222222222222222222222222222222222" as const;
const snapshot = {
  blockHash: `0x${"ab".repeat(32)}` as const,
  blockNumber: "116718500",
  blockTimestamp: now.toISOString(),
  digest: `0x${"cd".repeat(32)}` as const,
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
  readonly getCalls: Array<{ userId: string; walletId: string }> = [];
  readonly listCalls: string[] = [];

  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    this.getCalls.push({ userId, walletId });
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }

  async listWallets(userId: string) {
    this.listCalls.push(userId);
    return { items: userId === userA ? [wallet] : [] };
  }
}

function helperStatus(): WalletHelperStatus {
  return {
    address: helperAddress,
    chainId: 56,
    failures: [],
    helperVersion: "v2",
    owner: wallet.address,
    registryVersion: "p05-bsc-execution-v1",
    state: "active",
    verification: {
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      blockTimestamp: snapshot.blockTimestamp,
      checks: { address: true, owner: true, runtimeCodeHash: true, selectorSet: true, version: true },
      digest: snapshot.digest,
      observedOwner: wallet.address,
      observedRuntimeCodeHash: `0x${"ef".repeat(32)}`,
      observedSelectors: ["0x8da5cb5b"],
      verifiedAt: now.toISOString(),
    },
    walletId: wallet.walletId,
  };
}

class HelperReads implements WalletHelperReadApplication {
  readonly addressCalls: Array<{ chainId: 56; userId: string; walletId: string }> = [];
  readonly statusCalls: Array<{
    chainId: 56;
    userId: string;
    walletAddress: `0x${string}`;
    walletId: string;
  }> = [];
  failure: Error | null = null;

  async resolveTrustedAddress(input: { chainId: 56; userId: string; walletId: string }) {
    this.addressCalls.push(input);
    return helperAddress;
  }

  async status(input: {
    chainId: 56;
    userId: string;
    walletAddress: `0x${string}`;
    walletId: string;
  }): Promise<Readonly<WalletHelperStatus>> {
    this.statusCalls.push(input);
    if (this.failure) throw this.failure;
    return helperStatus();
  }
}

function residualPage(): HelperResidualPage {
  return {
    allowlistVersion: "fixture-residual-v1",
    chainId: 56,
    coverage: {
      allowlistComplete: true,
      complete: true,
      missingSources: [],
      positionTokensComplete: true,
      walletTokenRegistryComplete: true,
    },
    cursor: null,
    helperAddress,
    items: [],
    registryVersion: "p05-bsc-execution-v1",
    scanId: "66000000-0000-4000-8000-000000000021",
    scannedAt: now.toISOString(),
    snapshot,
    state: "empty",
    walletId: wallet.walletId,
  };
}

class ResidualReads implements WalletHelperResidualApplication {
  readonly latestCalls: Array<{
    chainId: 56;
    cursor: string | null;
    limit: number;
    userId: string;
    walletId: string;
  }> = [];
  readonly scanCalls: Array<{
    chainId: 56;
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }> = [];
  failure: Error | null = null;
  latestValue: HelperResidualPage | null = residualPage();

  async latest(input: (typeof this.latestCalls)[number]) {
    this.latestCalls.push(input);
    if (this.failure) throw this.failure;
    return this.latestValue;
  }

  async scan(input: (typeof this.scanCalls)[number]) {
    this.scanCalls.push(input);
    if (this.failure) throw this.failure;
    return residualPage();
  }
}

class Positions implements PositionReadApplication {
  readonly calls: PositionReadScanInput[] = [];

  async scan(input: PositionReadScanInput): Promise<Readonly<WalletPositionPage>> {
    this.calls.push(input);
    return Object.freeze({
      address: input.address,
      chainId: 56,
      coverage: Object.freeze({ complete: true, failedPlatformIds: [], scannedPlatformIds: [] }),
      cursor: null,
      items: [],
      quarantined: [],
      registryVersion: "p05-bsc-execution-v1",
      snapshot,
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
  const helpers = new HelperReads();
  const residuals = new ResidualReads();
  const positions = new Positions();
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    helperReads: helpers,
    helperResiduals: residuals,
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    positionReads: positions,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    walletDirectory: directory,
  });
  apps.push(app);
  return { app, directory, helpers, positions, residuals, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P05-02 Helper and residual API", () => {
  it("serves Helper health only for the session-owned custody address", async () => {
    const { app, helpers, tokenA, tokenB } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: `/api/wallets/${wallet.address}/helper?chainId=56` }))
        .statusCode,
    ).toBe(401);

    const response = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/helper?chainId=56`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({ address: helperAddress, state: "active" });
    expect(helpers.statusCalls).toEqual([
      { chainId: 56, userId: userA, walletAddress: wallet.address, walletId: wallet.walletId },
    ]);

    const denied = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: `/api/wallets/${wallet.address}/helper?chainId=56`,
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("WALLET_NOT_FOUND");
    expect(helpers.statusCalls).toHaveLength(1);
  });

  it("rejects arbitrary Helper query fields and non-BSC scope before a chain read", async () => {
    const { app, helpers, tokenA } = await fixture();
    for (const query of [
      "chainId=56&helperAddress=0x2222222222222222222222222222222222222222",
      "chainId=56&target=0x2222222222222222222222222222222222222222",
      "chainId=56&provider=https%3A%2F%2Frpc.invalid",
      "chainId=56&calldata=0x1234",
      "chainId=56&token=0x3333333333333333333333333333333333333333",
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "GET",
        url: `/api/wallets/${wallet.address}/helper?${query}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("HELPER_QUERY_INVALID");
    }
    const wrongChain = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/helper?chainId=1`,
    });
    expect(wrongChain.statusCode).toBe(403);
    expect(helpers.statusCalls).toEqual([]);
  });

  it("lists and idempotently scans residuals using only a custody wallet id", async () => {
    const { app, residuals, tokenA } = await fixture();
    const listed = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/helper-residuals?chainId=56&walletId=${wallet.walletId}&limit=25`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().data).toMatchObject({ state: "empty", walletId: wallet.walletId });
    expect(residuals.latestCalls).toEqual([
      { chainId: 56, cursor: null, limit: 25, userId: userA, walletId: wallet.walletId },
    ]);

    const scanned = await app.inject({
      headers: { ...auth(tokenA), "content-type": "application/json" },
      method: "POST",
      payload: { chainId: 56, idempotencyKey: "fixture-residual-001", walletId: wallet.walletId },
      url: "/api/wallets/helper-residuals/scan",
    });
    expect(scanned.statusCode).toBe(200);
    expect(scanned.headers["cache-control"]).toBe("no-store");
    expect(residuals.scanCalls).toEqual([
      {
        chainId: 56,
        idempotencyKey: "fixture-residual-001",
        userId: userA,
        walletId: wallet.walletId,
      },
    ]);
  });

  it("rejects client-controlled residual targets and cross-user wallet ids", async () => {
    const { app, residuals, tokenA, tokenB } = await fixture();
    for (const field of ["token", "tokens", "provider", "target", "calldata", "helperAddress"]) {
      const response = await app.inject({
        headers: { ...auth(tokenA), "content-type": "application/json" },
        method: "POST",
        payload: {
          chainId: 56,
          idempotencyKey: "fixture-residual-001",
          [field]: "client-controlled",
          walletId: wallet.walletId,
        },
        url: "/api/wallets/helper-residuals/scan",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("HELPER_RESIDUAL_INPUT_INVALID");
    }
    const denied = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: `/api/wallets/helper-residuals?chainId=56&walletId=${wallet.walletId}`,
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("WALLET_NOT_FOUND");
    expect(residuals.scanCalls).toEqual([]);
    expect(residuals.latestCalls).toEqual([]);
  });

  it("maps cursor, undeployed, and provider failures without leaking details", async () => {
    const { app, helpers, residuals, tokenA } = await fixture();
    residuals.failure = new HelperResidualCursorError();
    const cursor = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/helper-residuals?chainId=56&walletId=${wallet.walletId}&cursor=bad`,
    });
    expect(cursor.statusCode).toBe(400);
    expect(cursor.json().error.code).toBe("HELPER_RESIDUAL_CURSOR_INVALID");

    residuals.failure = new HelperResidualReadError("HELPER_UNDEPLOYED");
    const undeployed = await app.inject({
      headers: { ...auth(tokenA), "content-type": "application/json" },
      method: "POST",
      payload: { chainId: 56, idempotencyKey: "fixture-residual-002", walletId: wallet.walletId },
      url: "/api/wallets/helper-residuals/scan",
    });
    expect(undeployed.statusCode).toBe(409);
    expect(undeployed.json().error.code).toBe("HELPER_UNDEPLOYED");

    helpers.failure = new Error("https://secret-rpc.invalid token=secret");
    const unavailable = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/helper?chainId=56`,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain("secret-rpc");
    expect(unavailable.json().error.code).toBe("CHAIN_READ_UNAVAILABLE");
  });

  it("passes only the internally bound Helper address into position approval reads", async () => {
    const { app, helpers, positions, tokenA } = await fixture();
    const response = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${wallet.address}/positions?chainId=56`,
    });
    expect(response.statusCode).toBe(200);
    expect(helpers.addressCalls).toEqual([{ chainId: 56, userId: userA, walletId: wallet.walletId }]);
    expect(positions.calls[0]?.helperAddress).toBe(helperAddress);
  });
});
