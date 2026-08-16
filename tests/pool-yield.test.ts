import {
  calculateFeeTvl,
  computeMarketWindows,
  type MarketMetricEvent,
} from "../packages/market-metrics/src/index.js";
import { formatPoolRatioPercent } from "../apps/web/src/pool-table-state.js";
import { describe, expect, it } from "vitest";

const poolAddress = "0x1111111111111111111111111111111111111111";

function swap(market: MarketMetricEvent["market"]): MarketMetricEvent {
  return {
    blockTimestamp: "2026-08-16T00:59:30.000Z",
    chainId: 56,
    eventId: "yield-swap",
    kind: "swap",
    market,
    pool: {
      feePips: "2500",
      hooks: null,
      poolAddress,
      poolId: null,
      protocol: "pcsv3",
      tickSpacing: "50",
      token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      token0Symbol: "WBNB",
      token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      token1Symbol: "USDT",
    },
    reverted: false,
    transactionHash: "0xyield",
  };
}

describe("P02-07 Fee/TVL semantics", () => {
  it("divides arbitrary-precision decimal Fees by TVL without annualizing or rounding", () => {
    expect(calculateFeeTvl("1.000000000000000001", "1000.000000000000000003")).toBe(
      "0.001000000000000000000996999999999999999997009000000000000000008972999999999999999973081",
    );
    expect(
      calculateFeeTvl("900719925474099312345678.123456789", "0.000000000000000000000000000001"),
    ).toBe("900719925474099312345678123456789000000000000000000000");
  });

  it.each([
    [null, "100", null],
    ["1", null, null],
    [null, null, null],
    ["1", "0", null],
    ["1", "-0.000000000000000001", null],
    ["0", "100", "0"],
  ] as const)("maps Fees %s and TVL %s to %s", (fees, tvl, expected) => {
    expect(calculateFeeTvl(fees, tvl)).toBe(expected);
  });

  it("keeps aTVL and Fee/aTVL unresolved instead of synthesizing zero", () => {
    const row = computeMarketWindows(
      [swap({ feesUsd: "2.5", tvlUsd: "100", volumeUsd: "20", fdvUsd: null })],
      {
        end: "2026-08-16T01:00:00.000Z",
        windowComplete: true,
        windows: [1],
      },
    )[0]!.rows[0]!;

    expect(row).toMatchObject({
      activeTvlUsd: null,
      feeActiveTvl: null,
      feeTvl: "0.025",
    });
  });

  it("formats percentages to at most four places with ROUND_HALF_EVEN", () => {
    expect(formatPoolRatioPercent("0.0123445")).toBe("1.2344%");
    expect(formatPoolRatioPercent("0.0123455")).toBe("1.2346%");
    expect(formatPoolRatioPercent("0.01")).toBe("1%");
    expect(formatPoolRatioPercent("0")).toBe("0%");
    expect(formatPoolRatioPercent(null)).toBe("不可用");
  });
});
