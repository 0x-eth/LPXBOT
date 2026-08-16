import type {
  MarketCandlesResponse,
  MarketTickLiquidityResponse,
} from "../packages/api-contract/src/index.js";
import {
  MarketChartRequestManager,
  buildMarketCandlesUrl,
  buildMarketTickLiquidityUrl,
  parseMarketCandlesResponse,
  parseMarketTickLiquidityResponse,
} from "../apps/web/src/market-chart-client.js";
import { describe, expect, it, vi } from "vitest";

const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const poolAddress = "0x1111111111111111111111111111111111111111";
const poolKey = `56:${poolAddress}`;
const revision = `canonical:v1:${"ab".repeat(32)}`;

const candleResponse: MarketCandlesResponse = {
  asOf: "2026-08-17T00:05:00.000Z",
  bar: "5m",
  candles: [{ close: "2", high: "3", low: "1", open: "1.5", ts: 1_786_924_800, volume: "20" }],
  canonicalRevision: revision,
  chainId: 56,
  direction: "token0",
  poolKey,
  priceUnit: "token1-raw/token0-raw",
  source: "canonical-events",
  token,
  version: "3",
  volumeUnit: { kind: "raw-integer", token },
};

const tickResponse: MarketTickLiquidityResponse = {
  asOf: "2026-08-17T00:05:00.000Z",
  canonicalRevision: revision,
  chainId: 56,
  currentTick: null,
  decimals0: null,
  decimals1: null,
  poolKey,
  range: 10,
  source: "canonical-events",
  tickSpacing: 60,
  ticks: [],
  version: "3",
};

describe("P02-10 market chart client", () => {
  it("always includes canonical poolKey in Candle requests and stable Tick parameters", () => {
    expect(buildMarketCandlesUrl({ bar: "1H", limit: 200, poolKey, token })).toBe(
      "/api/market/candles?token=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&poolKey=56%3A0x1111111111111111111111111111111111111111&bar=1H&limit=200&chainId=56",
    );
    expect(
      buildMarketTickLiquidityUrl({
        decimals0: null,
        decimals1: null,
        identity: poolAddress,
        protocol: "pcsv3",
        range: 10,
        tickSpacing: 60,
      }),
    ).toBe(
      "/api/pools/liquidity/0x1111111111111111111111111111111111111111?range=10&chain=bsc&dex=pcsv3&tickSpacing=60",
    );
  });

  it("accepts canonical Decimal strings, null prices/currentTick and rejects duplicate or descending ts", () => {
    expect(parseMarketCandlesResponse(structuredClone(candleResponse))).toEqual(candleResponse);
    expect(parseMarketTickLiquidityResponse(structuredClone(tickResponse))).toEqual(tickResponse);

    expect(() =>
      parseMarketCandlesResponse({
        ...candleResponse,
        candles: [candleResponse.candles[0], { ...candleResponse.candles[0] }],
      }),
    ).toThrowError("MARKET_CANDLE_RESPONSE_INVALID");
    expect(() =>
      parseMarketCandlesResponse({
        ...candleResponse,
        candles: [
          { ...candleResponse.candles[0]!, ts: 2 },
          { ...candleResponse.candles[0]!, ts: 1 },
        ],
      }),
    ).toThrowError("MARKET_CANDLE_RESPONSE_INVALID");
    expect(() =>
      parseMarketTickLiquidityResponse({
        ...tickResponse,
        ticks: [{ liquidityNet: "1", price0: "NaN", price1: null, tickIdx: -60 }],
      }),
    ).toThrowError("MARKET_TICK_RESPONSE_INVALID");
  });

  it("aborts the old selection and prevents its late response from becoming current", () => {
    const manager = new MarketChartRequestManager();
    const abort = vi.fn();
    const first = manager.start(`${poolKey}:candles:5m`, {
      abort,
      signal: new AbortController().signal,
    });
    const second = manager.start(`${poolKey}:candles:1H`);

    expect(abort).toHaveBeenCalledOnce();
    expect(manager.isCurrent(first.requestId, first.selectionKey)).toBe(false);
    expect(manager.isCurrent(second.requestId, second.selectionKey)).toBe(true);

    manager.clear();
    expect(second.signal.aborted).toBe(true);
    expect(manager.isCurrent(second.requestId, second.selectionKey)).toBe(false);
  });
});
