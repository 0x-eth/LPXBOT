import type {
  MarketPoolByTokenRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsByTokenContext,
  MarketPoolsContext,
  MarketPoolsProvider,
} from "../apps/api/src/market-pools.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const row: MarketPoolByTokenRow = {
  activeTvlUsd: null,
  chainId: 56,
  fdvUsd: null,
  feeActiveTvl: null,
  feePips: "2500",
  fees1h: "11",
  fees5m: "2",
  feesUsd: "2",
  feeTvl: null,
  hooks: null,
  poolAddress: "0x1111111111111111111111111111111111111111",
  poolId: null,
  poolKey: "56:0x1111111111111111111111111111111111111111",
  protocol: "pcsv3",
  tickSpacing: "50",
  token0Address: token,
  token0Symbol: null,
  token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  token1Symbol: null,
  transactionCount: "3",
  transactionCount1h: "9",
  transactionCount5m: "3",
  tvlUsd: null,
  volume1h: null,
  volume5m: "20",
  volumeUsd: "20",
};

class ByTokenProvider implements MarketPoolsProvider {
  readonly contexts: MarketPoolsByTokenContext[] = [];

  async getByToken(context: MarketPoolsByTokenContext): Promise<MarketPoolByTokenRow[]> {
    this.contexts.push(context);
    return context.address === token ? [structuredClone(row)] : [];
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    const now = "2026-08-16T01:00:00.000Z";
    return {
      chainId: 56,
      generatedAt: now,
      minutes: context.minutes,
      rows: [],
      version: "0",
      windowEnd: now,
      windowStart: now,
    };
  }

  async *subscribe(): AsyncIterable<MarketStreamEnvelope> {}
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(rateLimit = { max: 60, timeWindowMs: 60_000 }) {
  const sessionStore = new SessionFixtureStore();
  const sessionToken = await issueFixtureSession(
    sessionStore,
    "2a000000-0000-4000-8000-000000000001",
    new Date("2026-08-16T01:00:00.000Z"),
  );
  const provider = new ByTokenProvider();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    marketPoolsProvider: provider,
    marketPoolsRateLimit: rateLimit,
    now: () => new Date("2026-08-16T01:00:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, provider, sessionToken };
}

describe("P02-06 pools by-token API", () => {
  it("normalizes BSC token, DEX, limit and sort inputs before querying the catalog", async () => {
    const { app, provider, sessionToken } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${sessionToken}` },
      method: "GET",
      url:
        `/api/pools/by-token/${token.toUpperCase().replace("0X", "0x")}` +
        "?chain=bsc&dex=univ4,pcsv3,univ4&limit=7&sort=volume",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      data: [row],
      requestId: expect.any(String),
      success: true,
    });
    expect(provider.contexts).toEqual([
      {
        address: token,
        chainId: 56,
        limit: 7,
        protocols: ["pcsv3", "univ4"],
        sort: "volume",
      },
    ]);
  });

  it("returns a successful empty array for an unknown token", async () => {
    const { app, sessionToken } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${sessionToken}` },
      method: "GET",
      url:
        "/api/pools/by-token/0xcccccccccccccccccccccccccccccccccccccccc" +
        "?chain=bsc&dex=pcsv3&sort=fees",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it.each([
    `/api/pools/by-token/not-an-address?chain=bsc&dex=pcsv3`,
    `/api/pools/by-token/${token}?chain=base&dex=pcsv3`,
    `/api/pools/by-token/${token}?chain=bsc`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv2`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3&limit=0`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3&limit=101`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3&limit=01`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3&sort=tvl`,
    `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3&extra=true`,
  ])("rejects invalid by-token input with a stable envelope: %s", async (url) => {
    const { app, provider, sessionToken } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${sessionToken}` },
      method: "GET",
      url,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "MARKET_TOKEN_QUERY_INVALID", retryable: false },
      success: false,
    });
    expect(provider.contexts).toEqual([]);
  });

  it("requires an authenticated user and applies the read-only rate limit", async () => {
    const { app, provider, sessionToken } = await fixture({ max: 1, timeWindowMs: 60_000 });
    const url = `/api/pools/by-token/${token}?chain=bsc&dex=pcsv3`;
    const anonymous = await app.inject({ method: "GET", url });
    expect(anonymous.statusCode).toBe(401);

    const first = await app.inject({
      headers: { cookie: `lpbot_session=${sessionToken}`, "x-forwarded-for": "192.0.2.2" },
      method: "GET",
      url,
    });
    const limited = await app.inject({
      headers: { cookie: `lpbot_session=${sessionToken}`, "x-forwarded-for": "192.0.2.2" },
      method: "GET",
      url,
    });
    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
      success: false,
    });
    expect(provider.contexts).toHaveLength(1);
  });
});
