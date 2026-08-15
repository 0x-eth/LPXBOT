import {
  MARKET_WINDOWS,
  computeMarketWindows,
  sortPoolMetrics,
  type MarketMetricEvent,
} from "../packages/market-metrics/src/index.js";
import { describe, expect, it } from "vitest";

const poolA = "0x1111111111111111111111111111111111111111";
const poolB = "0x2222222222222222222222222222222222222222";

function swap(
  eventId: string,
  poolAddress: string,
  blockTimestamp: string,
  transactionHash: string,
  market: MarketMetricEvent["market"],
): MarketMetricEvent {
  return {
    blockTimestamp,
    chainId: 56,
    eventId,
    kind: "swap",
    market,
    pool: {
      poolAddress,
      poolId: null,
      protocol: "pcsv3",
      token0Symbol: "WBNB",
      token1Symbol: "USDT",
    },
    reverted: false,
    transactionHash,
  };
}

describe("P02-02 arbitrary-precision market windows", () => {
  it("uses all five UTC [start,end) windows and never rounds during aggregation", () => {
    const end = "2026-08-16T01:00:00.000Z";
    const events: MarketMetricEvent[] = [
      swap("at-start", poolA, "2026-08-16T00:59:00.000Z", "0xaaa", {
        fdvUsd: "900719925474099312345678.25",
        feesUsd: "0.123456789123456789",
        tvlUsd: "1000.000000000000000001",
        volumeUsd: "10.000000000000000001",
      }),
      swap("inside", poolA, "2026-08-16T00:59:59.999Z", "0xbbb", {
        fdvUsd: "900719925474099312345679.25",
        feesUsd: "0.876543210876543212",
        tvlUsd: "1000.000000000000000003",
        volumeUsd: "20.000000000000000002",
      }),
      swap("at-end", poolA, end, "0xccc", {
        fdvUsd: "1",
        feesUsd: "100",
        tvlUsd: "1",
        volumeUsd: "100",
      }),
      swap("five-minute-only", poolA, "2026-08-16T00:55:00.000Z", "0xddd", {
        fdvUsd: "800",
        feesUsd: "2.5",
        tvlUsd: "900",
        volumeUsd: "40",
      }),
    ];

    const result = computeMarketWindows(events, { end, windowComplete: true });

    expect(result.map(({ minutes }) => minutes)).toEqual(MARKET_WINDOWS);
    const oneMinute = result.find(({ minutes }) => minutes === 1)!.rows[0]!;
    expect(oneMinute).toMatchObject({
      activeTvlUsd: null,
      fdvUsd: "900719925474099312345679.25",
      feeActiveTvl: null,
      feesUsd: "1.000000000000000001",
      transactionCount: "2",
      tvlUsd: "1000.000000000000000003",
      volumeUsd: "30.000000000000000003",
    });
    expect(oneMinute.feeTvl).toBe("0.000999999999999999998000000000000000005999999999999999982");
    const fiveMinute = result.find(({ minutes }) => minutes === 5)!.rows[0]!;
    expect(fiveMinute.feesUsd).toBe("3.500000000000000001");
    expect(fiveMinute.transactionCount).toBe("3");
  });

  it("keeps missing price-derived values null and counts unique transactions", () => {
    const events = [
      swap("a", poolA, "2026-08-16T00:59:10.000Z", "0xsame", {
        fdvUsd: null,
        feesUsd: null,
        tvlUsd: null,
        volumeUsd: "12",
      }),
      swap("b", poolA, "2026-08-16T00:59:20.000Z", "0xsame", {
        fdvUsd: null,
        feesUsd: "1",
        tvlUsd: null,
        volumeUsd: null,
      }),
    ];

    const row = computeMarketWindows(events, {
      end: "2026-08-16T01:00:00.000Z",
      windowComplete: true,
      windows: [1],
    })[0]!.rows[0]!;

    expect(row).toMatchObject({
      activeTvlUsd: null,
      fdvUsd: null,
      feeActiveTvl: null,
      feesUsd: null,
      feeTvl: null,
      transactionCount: "1",
      tvlUsd: null,
      volumeUsd: null,
    });
  });

  it("sorts by unrounded values, puts null last in both directions, and uses stable ties", () => {
    const rows = computeMarketWindows(
      [
        swap("a", poolB, "2026-08-16T00:59:10.000Z", "0xa", {
          fdvUsd: null,
          feesUsd: "1.000000000000000001",
          tvlUsd: "10",
          volumeUsd: "1",
        }),
        swap("b", poolA, "2026-08-16T00:59:20.000Z", "0xb", {
          fdvUsd: null,
          feesUsd: "1.000000000000000002",
          tvlUsd: "10",
          volumeUsd: "1",
        }),
        swap("c", "0x3333333333333333333333333333333333333333", "2026-08-16T00:59:30.000Z", "0xc", {
          fdvUsd: null,
          feesUsd: null,
          tvlUsd: "10",
          volumeUsd: "1",
        }),
      ],
      { end: "2026-08-16T01:00:00.000Z", windowComplete: true, windows: [1] },
    )[0]!.rows;

    expect(sortPoolMetrics(rows, "feesUsd", "desc").map(({ poolAddress }) => poolAddress)).toEqual([
      poolA,
      poolB,
      "0x3333333333333333333333333333333333333333",
    ]);
    expect(sortPoolMetrics(rows, "feesUsd", "asc").at(-1)?.feesUsd).toBeNull();

    const tied = rows.map((row) => ({ ...row, feesUsd: "7" }));
    expect(sortPoolMetrics(tied, "feesUsd", "desc").map(({ poolAddress }) => poolAddress)).toEqual([
      poolA,
      poolB,
      "0x3333333333333333333333333333333333333333",
    ]);
  });
});

