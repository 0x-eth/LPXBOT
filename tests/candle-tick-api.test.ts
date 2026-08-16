import type {
  MarketCandlesResponse,
  MarketTickLiquidityResponse,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import {
  MarketChartProviderError,
  type MarketCandleQuery,
  type MarketChartsProvider,
  type MarketTickLiquidityQuery,
} from "../apps/api/src/market-charts.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const token0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const token1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const poolAddress = "0x1111111111111111111111111111111111111111" as const;
const poolKey = `56:${poolAddress}`;

const candles: MarketCandlesResponse = {
  asOf: "2026-08-17T00:05:00.000Z",
  bar: "5m",
  candles: [
    { close: "4", high: "4", low: "1", open: "1", ts: 1_786_924_800, volume: "15" },
  ],
  canonicalRevision: `canonical:v1:${"ab".repeat(32)}`,
  chainId: 56,
  direction: "token0",
  poolKey,
  priceUnit: "token1-raw/token0-raw",
  source: "canonical-events",
  token: token0,
  version: "7",
  volumeUnit: { kind: "raw-integer", token: token0 },
};

const liquidity: MarketTickLiquidityResponse = {
  asOf: "2026-08-17T00:05:00.000Z",
  canonicalRevision: `canonical:v1:${"ab".repeat(32)}`,
  chainId: 56,
  currentTick: 0,
  decimals0: 18,
  decimals1: 6,
  poolKey,
  range: 10,
  source: "canonical-events",
  tickSpacing: 60,
  ticks: [{ liquidityNet: "7", price0: "1000000000000", price1: "0.000000000001", tickIdx: 0 }],
  version: "7",
};

class FixtureChartsProvider implements MarketChartsProvider {
  readonly candleQueries: MarketCandleQuery[] = [];
  readonly tickQueries: MarketTickLiquidityQuery[] = [];
  candleError: MarketChartProviderError | null = null;
  tickError: MarketChartProviderError | null = null;

  async getCandles(query: MarketCandleQuery): Promise<MarketCandlesResponse> {
    this.candleQueries.push(query);
    if (this.candleError) throw this.candleError;
    return structuredClone(candles);
  }

  async getTickLiquidity(query: MarketTickLiquidityQuery): Promise<MarketTickLiquidityResponse> {
    this.tickQueries.push(query);
    if (this.tickError) throw this.tickError;
    return structuredClone(liquidity);
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(
  options: {
    provider?: FixtureChartsProvider | null;
    rateLimit?: { max: number; timeWindowMs: number };
  } = {},
) {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(
    sessionStore,
    "2b000000-0000-4000-8000-000000000001",
    new Date("2026-08-17T00:05:00.000Z"),
  );
  const provider = options.provider === undefined ? new FixtureChartsProvider() : options.provider;
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    ...(provider ? { marketChartsProvider: provider } : {}),
    ...(options.rateLimit ? { marketChartsRateLimit: options.rateLimit } : {}),
    now: () => new Date("2026-08-17T00:05:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, provider, token };
}

describe("P02-10 Candle/Tick read-only API", () => {
  it("normalizes explicit Candle poolKey, bar, limit, token and BSC chain parameters", async () => {
    const { app, provider, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url:
        `/api/market/candles?token=${token0.toUpperCase().replace("0X", "0x")}` +
        `&poolKey=${encodeURIComponent(poolKey.toUpperCase().replace("0X", "0x"))}` +
        "&bar=5m&limit=20&chainId=56",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      data: candles,
      requestId: expect.any(String),
      success: true,
    });
    expect(provider?.candleQueries).toEqual([
      { bar: "5m", chainId: 56, limit: 20, poolKey, token: token0 },
    ]);
  });

  it("allows token-only resolution only through the provider's unique-pool decision", async () => {
    const { app, provider, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: `/api/market/candles?token=${token0}&bar=1D&chainId=56`,
    });
    expect(response.statusCode).toBe(200);
    expect(provider?.candleQueries).toEqual([
      { bar: "1D", chainId: 56, limit: 200, poolKey: null, token: token0 },
    ]);

    provider!.candleError = new MarketChartProviderError("AMBIGUOUS_POOL");
    const ambiguous = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: `/api/market/candles?token=${token0}&bar=1m&chainId=56`,
    });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json()).toMatchObject({
      error: { code: "AMBIGUOUS_POOL", retryable: false },
      success: false,
    });
  });

  it("normalizes Tick range, identity, DEX, spacing and all-or-none decimals", async () => {
    const { app, provider, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url:
        `/api/pools/liquidity/${poolAddress.toUpperCase().replace("0X", "0x")}` +
        "?range=10&chain=bsc&dex=pcsv3&tickSpacing=60&decimals0=18&decimals1=6",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(liquidity);
    expect(provider?.tickQueries).toEqual([
      {
        chainId: 56,
        decimals0: 18,
        decimals1: 6,
        identity: poolAddress,
        protocol: "pcsv3",
        range: 10,
        tickSpacing: 60,
      },
    ]);

    await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=pcsv3&tickSpacing=60`,
    });
    expect(provider?.tickQueries[1]).toMatchObject({ decimals0: null, decimals1: null });
  });

  it.each([
    `/api/market/candles?token=bad&poolKey=${encodeURIComponent(poolKey)}&bar=5m&chainId=56`,
    `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=30m&chainId=56`,
    `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&limit=0&chainId=56`,
    `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&limit=1001&chainId=56`,
    `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&chainId=1`,
    `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&chainId=56&extra=1`,
  ])("rejects invalid Candle input without calling the provider: %s", async (url) => {
    const { app, provider, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "MARKET_CANDLE_QUERY_INVALID", retryable: false },
      success: false,
    });
    expect(provider?.candleQueries).toEqual([]);
  });

  it.each([
    `/api/pools/liquidity/bad?range=5&chain=bsc&dex=pcsv3&tickSpacing=60`,
    `/api/pools/liquidity/${poolAddress}?range=4&chain=bsc&dex=pcsv3&tickSpacing=60`,
    `/api/pools/liquidity/${poolAddress}?range=51&chain=bsc&dex=pcsv3&tickSpacing=60`,
    `/api/pools/liquidity/${poolAddress}?range=5&chain=base&dex=pcsv3&tickSpacing=60`,
    `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=v2&tickSpacing=60`,
    `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=pcsv3&tickSpacing=0`,
    `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=pcsv3&tickSpacing=60&decimals0=18`,
    `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=pcsv3&tickSpacing=60&decimals0=256&decimals1=18`,
  ])("rejects invalid Tick input without calling the provider: %s", async (url) => {
    const { app, provider, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "MARKET_LIQUIDITY_QUERY_INVALID", retryable: false },
      success: false,
    });
    expect(provider?.tickQueries).toEqual([]);
  });

  it("maps unknown pool to 404 and missing provider to retryable 503", async () => {
    const provider = new FixtureChartsProvider();
    provider.tickError = new MarketChartProviderError("MARKET_POOL_NOT_FOUND");
    const first = await fixture({ provider });
    const missing = await first.app.inject({
      headers: { cookie: `lpbot_session=${first.token}` },
      method: "GET",
      url: `/api/pools/liquidity/${poolAddress}?range=5&chain=bsc&dex=pcsv3&tickSpacing=60`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "MARKET_POOL_NOT_FOUND", retryable: false },
      success: false,
    });

    const second = await fixture({ provider: null });
    const unavailable = await second.app.inject({
      headers: { cookie: `lpbot_session=${second.token}` },
      method: "GET",
      url: `/api/market/candles?token=${token1}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&chainId=56`,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      error: { code: "MARKET_CHARTS_UNAVAILABLE", retryable: true },
      success: false,
    });
  });

  it("requires authentication and enforces a credential-keyed read-only rate limit", async () => {
    const { app, provider, token } = await fixture({
      rateLimit: { max: 1, timeWindowMs: 60_000 },
    });
    const url = `/api/market/candles?token=${token0}&poolKey=${encodeURIComponent(poolKey)}&bar=5m&chainId=56`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          headers: { cookie: `lpbot_session=${token}` },
          method: "GET",
          url,
        })
      ).statusCode,
    ).toBe(200);
    const limited = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
      success: false,
    });
    expect(provider?.candleQueries).toHaveLength(1);
  });
});
