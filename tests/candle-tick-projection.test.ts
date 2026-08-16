import {
  aggregateCanonicalCandles,
  orientCanonicalCandles,
  projectCanonicalOneMinuteCandles,
  projectCanonicalTickLiquidity,
  selectTickLiquidityRange,
  sqrtPriceX96ToToken0Price,
  type CandleTickCanonicalEvent,
} from "../packages/market-metrics/src/candle-tick.js";
import { describe, expect, it } from "vitest";

const Q96 = 2n ** 96n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const poolId = `0x${"22".repeat(32)}`;

function canonicalEvent(
  eventId: string,
  overrides: Partial<CandleTickCanonicalEvent> = {},
): CandleTickCanonicalEvent {
  return {
    amount0: "-10",
    amount1: "40",
    blockNumber: "100",
    blockTimestamp: "2026-08-17T00:00:10.000Z",
    canonical: true,
    eventId,
    kind: "swap",
    liquidityDelta: null,
    logIndex: 0,
    payload: { tick: "0", tickLower: null, tickUpper: null },
    pool: {
      poolAddress,
      poolId: null,
      tickSpacing: "60",
      token0: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      token1: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    protocol: "pcsv3",
    sqrtPriceX96: Q96.toString(),
    transactionIndex: 0,
    ...overrides,
  };
}

describe("P02-10 canonical Candle projection", () => {
  it("uses BigInt sqrtPriceX96 and deterministic chain order at exact UTC bucket boundaries", () => {
    const events = [
      canonicalEvent("later-log", {
        amount0: "-900719925474099312345678901234567890",
        amount1: "7",
        blockNumber: "101",
        blockTimestamp: "2026-08-17T00:00:59.999Z",
        logIndex: 4,
        sqrtPriceX96: (Q96 * 3n).toString(),
      }),
      canonicalEvent("first-chain-position", {
        amount0: "5",
        amount1: "-11",
        blockNumber: "100",
        blockTimestamp: "2026-08-17T00:00:58.000Z",
        logIndex: 2,
        sqrtPriceX96: (Q96 * 2n).toString(),
      }),
      canonicalEvent("next-bucket", {
        amount0: "-2",
        amount1: "3",
        blockNumber: "102",
        blockTimestamp: "2026-08-17T00:01:00.000Z",
        sqrtPriceX96: Q96.toString(),
      }),
    ];

    expect(sqrtPriceX96ToToken0Price(Q96.toString())).toBe("1");
    expect(projectCanonicalOneMinuteCandles(events)).toEqual([
      {
        close: "9",
        high: "9",
        low: "4",
        open: "4",
        poolKey: `56:${poolAddress}`,
        ts: 1_776_038_400,
        volume0: "900719925474099312345678901234567895",
        volume1: "18",
      },
      {
        close: "1",
        high: "1",
        low: "1",
        open: "1",
        poolKey: `56:${poolAddress}`,
        ts: 1_776_038_460,
        volume0: "2",
        volume1: "3",
      },
    ]);
  });

  it("does not fill empty buckets and aggregates 5m through 1D before taking the latest limit", () => {
    const base = projectCanonicalOneMinuteCandles([
      canonicalEvent("a", {
        blockTimestamp: "2026-08-17T00:00:59.999Z",
        sqrtPriceX96: Q96.toString(),
      }),
      canonicalEvent("b", {
        blockTimestamp: "2026-08-17T00:04:59.999Z",
        sqrtPriceX96: (Q96 * 2n).toString(),
      }),
      canonicalEvent("c", {
        blockTimestamp: "2026-08-17T00:10:00.000Z",
        sqrtPriceX96: (Q96 * 3n).toString(),
      }),
      canonicalEvent("d", {
        blockTimestamp: "2026-08-18T00:00:00.000Z",
        sqrtPriceX96: (Q96 * 4n).toString(),
      }),
    ]);

    expect(aggregateCanonicalCandles(base, "5m", 2).map(({ ts }) => ts)).toEqual([
      1_776_039_000, 1_776_124_800,
    ]);
    expect(aggregateCanonicalCandles(base, "5m", 10)).toHaveLength(3);
    expect(aggregateCanonicalCandles(base, "15m", 10)[0]).toMatchObject({
      close: "9",
      high: "9",
      low: "1",
      open: "1",
      volume0: "30",
      volume1: "120",
    });
    for (const bar of ["1H", "4H", "1D"] as const) {
      const result = aggregateCanonicalCandles(base, bar, 10);
      expect(result.map(({ ts }) => ts)).toEqual([...new Set(result.map(({ ts }) => ts))]);
      expect(result.map(({ ts }) => ts)).toEqual([...result.map(({ ts }) => ts)].sort());
    }
  });

  it("reverses token1 OHLC high/low and uses the selected base token raw volume", () => {
    const [base] = projectCanonicalOneMinuteCandles([
      canonicalEvent("open", { sqrtPriceX96: Q96.toString() }),
      canonicalEvent("high", {
        amount1: "-25",
        blockNumber: "101",
        sqrtPriceX96: (Q96 * 2n).toString(),
      }),
    ]);

    expect(orientCanonicalCandles([base!], "token0")).toEqual([
      expect.objectContaining({ close: "4", high: "4", low: "1", open: "1", volume: "20" }),
    ]);
    expect(orientCanonicalCandles([base!], "token1")).toEqual([
      expect.objectContaining({ close: "0.25", high: "1", low: "0.25", open: "1", volume: "65" }),
    ]);
  });

  it("deduplicates exact deliveries, ignores orphan events and rejects duplicate base timestamps", () => {
    const event = canonicalEvent("same");
    expect(projectCanonicalOneMinuteCandles([event, structuredClone(event)])).toHaveLength(1);
    expect(
      projectCanonicalOneMinuteCandles([
        event,
        canonicalEvent("orphan", { canonical: false, sqrtPriceX96: (Q96 * 8n).toString() }),
      ])[0],
    ).toMatchObject({ high: "1", volume0: "10" });
    expect(() =>
      aggregateCanonicalCandles(
        [
          projectCanonicalOneMinuteCandles([event])[0]!,
          projectCanonicalOneMinuteCandles([canonicalEvent("other")])[0]!,
        ],
        "5m",
        10,
      ),
    ).toThrowError("CANDLE_TIMESTAMP_DUPLICATE");
  });
});

describe("P02-10 canonical Tick liquidity projection", () => {
  it("applies V3 Mint/Burn lower += delta and upper -= delta across negative tick boundaries", () => {
    const mint = canonicalEvent("mint", {
      kind: "liquidity.add",
      liquidityDelta: "900719925474099312345678901234567890",
      payload: { tick: null, tickLower: "-887220", tickUpper: "887220" },
      sqrtPriceX96: null,
    });
    const burn = canonicalEvent("burn", {
      blockNumber: "101",
      kind: "liquidity.remove",
      liquidityDelta: "-900719925474099312345678901234567890",
      payload: { tick: null, tickLower: "-887220", tickUpper: "887220" },
      sqrtPriceX96: null,
    });
    const remaining = canonicalEvent("remaining", {
      blockNumber: "102",
      kind: "liquidity.add",
      liquidityDelta: "5",
      payload: { tick: null, tickLower: "-120", tickUpper: "60" },
      sqrtPriceX96: null,
    });

    const projected = projectCanonicalTickLiquidity([mint, burn, remaining]);
    expect(projected).toMatchObject({ currentTick: 0, tickSpacing: 60 });
    expect(projected.ticks).toEqual([
      { liquidityNet: "5", tickIdx: -120 },
      { liquidityNet: "-5", tickIdx: 60 },
    ]);
  });

  it("uses V4 poolId identity, ModifyLiquidity signs, stable sorting and catalog tickSpacing", () => {
    const initialize = canonicalEvent("initialize", {
      blockNumber: "99",
      kind: "pool.created",
      payload: { tick: "-11", tickLower: null, tickUpper: null },
      pool: {
        poolAddress: null,
        poolId,
        tickSpacing: "10",
        token0: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      protocol: "univ4",
    });
    const modify = canonicalEvent("modify", {
      blockNumber: "100",
      kind: "liquidity.add",
      liquidityDelta: "123456789012345678901234567890",
      payload: { tick: null, tickLower: "-20", tickUpper: "30" },
      pool: initialize.pool,
      protocol: "univ4",
      sqrtPriceX96: null,
    });
    const swap = canonicalEvent("swap", {
      blockNumber: "101",
      payload: { tick: "9", tickLower: null, tickUpper: null },
      pool: initialize.pool,
      protocol: "univ4",
    });

    const projected = projectCanonicalTickLiquidity([swap, modify, initialize]);
    expect(projected).toEqual({
      currentTick: 9,
      poolKey: `56:${poolId}`,
      tickSpacing: 10,
      ticks: [
        { liquidityNet: "123456789012345678901234567890", tickIdx: -20 },
        { liquidityNet: "-123456789012345678901234567890", tickIdx: 30 },
      ],
    });
  });

  it("selects range * tickSpacing and computes Decimal prices only with both valid decimals", () => {
    const events = [
      canonicalEvent("left", {
        kind: "liquidity.add",
        liquidityDelta: "10",
        payload: { tick: null, tickLower: "-300", tickUpper: "360" },
        sqrtPriceX96: null,
      }),
      canonicalEvent("center", {
        kind: "liquidity.add",
        liquidityDelta: "3",
        payload: { tick: null, tickLower: "-60", tickUpper: "60" },
        sqrtPriceX96: null,
      }),
    ];
    const projected = projectCanonicalTickLiquidity(events);

    expect(selectTickLiquidityRange(projected, 5, null, null).ticks).toEqual([
      { liquidityNet: "10", price0: null, price1: null, tickIdx: -300 },
      { liquidityNet: "3", price0: null, price1: null, tickIdx: -60 },
      { liquidityNet: "-3", price0: null, price1: null, tickIdx: 60 },
    ]);
    const priced = selectTickLiquidityRange(projected, 6, 18, 18);
    expect(priced.ticks[1]).toMatchObject({
      price0: expect.stringMatching(/^0\.994018262239/),
      price1: expect.stringMatching(/^1\.006017734268/),
      tickIdx: -60,
    });
  });

  it("returns no guessed center when Initialize and Swap are absent", () => {
    const projected = projectCanonicalTickLiquidity([
      canonicalEvent("modify-only", {
        kind: "liquidity.add",
        liquidityDelta: "5",
        payload: { tick: null, tickLower: "-60", tickUpper: "60" },
        sqrtPriceX96: null,
      }),
    ]);
    expect(selectTickLiquidityRange(projected, 5, 18, 18)).toEqual({
      currentTick: null,
      poolKey: `56:${poolAddress}`,
      tickSpacing: 60,
      ticks: [],
    });
  });
});
