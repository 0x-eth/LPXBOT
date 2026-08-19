import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type SwapQuoteApplication,
  type SwapQuoteApplicationInput,
} from "../apps/api/src/index.js";
import {
  BscSwapQuoteAdapter,
  DeterministicSwapQuoteProvider,
  type SwapQuote,
} from "../packages/chain-adapters/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T06:00:00.000Z");
const userA = "68000000-0000-4000-8000-000000000001";
const userB = "68000000-0000-4000-8000-000000000002";
const tokenIn = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" as const;
const tokenOut = "0x55d398326f99059ff775485246999027b3197955" as const;
const wallet: CustodyWallet = {
  address: "0x1111111111111111111111111111111111111111",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Quote fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "68000000-0000-4000-8000-000000000011",
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

class Directory {
  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }
  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

class Quotes implements SwapQuoteApplication {
  readonly calls: SwapQuoteApplicationInput[] = [];
  failure: Error | null = null;
  readonly adapter = new BscSwapQuoteAdapter({
    now: () => now,
    provider: new DeterministicSwapQuoteProvider(),
    readRuntimeCodeHash: async ({ expectedRuntimeCodeHash }) => expectedRuntimeCodeHash,
  });

  async quote(input: SwapQuoteApplicationInput): Promise<Readonly<SwapQuote>> {
    this.calls.push(input);
    if (this.failure) throw this.failure;
    return this.adapter.quote(input);
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(rateLimit = { max: 100, timeWindowMs: 60_000 }) {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  const quotes = new Quotes();
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: sessions,
    swapQuoteRateLimit: rateLimit,
    swapQuotes: quotes,
    tenantId: "tenant-p05-03",
    walletDirectory: new Directory(),
  });
  apps.push(app);
  return { app, quotes, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

function body() {
  return {
    amountInBaseUnit: "1000000000000000001",
    chainId: 56,
    platformId: 2,
    slippageBps: 50,
    tokenIn,
    tokenOut,
    walletId: wallet.walletId,
  };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P05-03 swap quote API", () => {
  it("requires a session and resolves wallet address and route fields on the server", async () => {
    const { app, quotes, tokenA } = await fixture();
    expect(
      (await app.inject({ method: "POST", payload: body(), url: "/api/swap/quote" })).statusCode,
    ).toBe(401);

    const response = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: body(),
      url: "/api/swap/quote",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({
      amountInBaseUnit: body().amountInBaseUnit,
      chainId: 56,
      executionEnabled: false,
      platformId: 2,
      tokenIn,
      tokenOut,
      walletAddress: wallet.address,
      walletId: wallet.walletId,
    });
    expect(response.json().data).not.toHaveProperty("calldata");
    expect(quotes.calls).toEqual([
      {
        ...body(),
        userId: userA,
        walletAddress: wallet.address,
      },
    ]);
  });

  it("hides cross-user and unknown wallet ids before contacting the quote provider", async () => {
    const { app, quotes, tokenA, tokenB } = await fixture();
    for (const [token, walletId] of [
      [tokenB, wallet.walletId],
      [tokenA, "68000000-0000-4000-8000-000000000099"],
      [tokenA, "not-a-wallet-id"],
    ]) {
      const response = await app.inject({
        headers: auth(token!),
        method: "POST",
        payload: { ...body(), walletId },
        url: "/api/swap/quote",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("WALLET_NOT_FOUND");
    }
    expect(quotes.calls).toEqual([]);
  });

  it("accepts only the seven public request fields and validates token policy and boundaries", async () => {
    const { app, quotes, tokenA } = await fixture();
    const invalidBodies = [
      { ...body(), calldata: "0x1234" },
      { ...body(), router: wallet.address },
      { ...body(), spender: wallet.address },
      { ...body(), selector: "0x12345678" },
      { ...body(), okxApiKey: "secret" },
      { ...body(), amountInBaseUnit: "0" },
      { ...body(), amountInBaseUnit: "1.5" },
      { ...body(), tokenOut: tokenIn },
      { ...body(), tokenOut: "0x9999999999999999999999999999999999999999" },
      { ...body(), platformId: 3 },
      { ...body(), slippageBps: -1 },
      { ...body(), slippageBps: 501 },
    ];
    for (const payload of invalidBodies) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload,
        url: "/api/swap/quote",
      });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().error.code).toBe("SWAP_QUOTE_INVALID");
    }
    expect(quotes.calls).toEqual([]);
  });

  it("fails closed when unconfigured and redacts provider details", async () => {
    const { app, quotes, tokenA } = await fixture();
    quotes.failure = new Error("https://provider.invalid token=provider-secret raw=0xdeadbeef");
    const response = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: body(),
      url: "/api/swap/quote",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({
      code: "SWAP_QUOTE_UNAVAILABLE",
      message: "The controlled quote provider is unavailable",
      retryable: true,
    });
    expect(response.body).not.toContain("provider.invalid");
    expect(response.body).not.toContain("provider-secret");

    const sessions = new SessionFixtureStore();
    const token = await issueFixtureSession(sessions, userA, now);
    const disabled = buildApiApp({
      chainPolicyStore: new ChainPolicies(),
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: sessions,
      tenantId: "tenant-p05-03",
      walletDirectory: new Directory(),
    });
    apps.push(disabled);
    const unavailable = await disabled.inject({
      headers: auth(token),
      method: "POST",
      payload: body(),
      url: "/api/swap/quote",
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("SWAP_QUOTE_UNAVAILABLE");
  });

  it("rate limits quote refreshes independently", async () => {
    const { app, tokenA } = await fixture({ max: 1, timeWindowMs: 60_000 });
    const first = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: body(),
      url: "/api/swap/quote",
    });
    const second = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: body(),
      url: "/api/swap/quote",
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });
});
