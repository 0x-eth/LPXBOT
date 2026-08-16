import type { MarketPoolRow, MarketPoolSnapshot } from "@lpbot/api-contract";
import {
  recommendationSelectionHash,
  selectRecommendedPools,
} from "../apps/api/src/recommended-pools.js";
import { describe, expect, it } from "vitest";

const address = (digit: string): `0x${string}` => `0x${digit.repeat(40)}`;

function row(
  poolDigit: string,
  feesUsd: string | null,
  overrides: Partial<MarketPoolRow> = {},
): MarketPoolRow {
  const poolAddress = address(poolDigit);
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "500",
    feesUsd,
    feeTvl: null,
    hooks: null,
    labelRuleVersion: "pool-labels/local-v1",
    labels: [],
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "10",
    token0Address: address("a"),
    token0Symbol: "WBNB",
    token1Address: address("b"),
    token1Symbol: "USDT",
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: null,
    ...overrides,
  };
}

function snapshot(rows: MarketPoolRow[]): MarketPoolSnapshot {
  return {
    canonicalRevision: "canonical:v1:12",
    chainId: 56,
    generatedAt: "2026-08-17T01:05:01.000Z",
    metricVersion: "market-metrics/v1",
    minutes: 5,
    rows,
    version: "12",
    windowEnd: "2026-08-17T01:05:00.000Z",
    windowStart: "2026-08-17T01:00:00.000Z",
  };
}

describe("P02-09 recommended pool selection", () => {
  it("sorts by unrounded fees then pool key, deduplicates, and only then applies limit", () => {
    const duplicate = row("1", "9.999999999999999999");
    const selected = selectRecommendedPools(
      snapshot([
        row("2", "10.000000000000000001"),
        row("3", "10.000000000000000001"),
        duplicate,
        { ...duplicate, feesUsd: "8.5", token0Symbol: "DUPLICATE" },
      ]),
      3,
    );

    expect(selected).toEqual([
      expect.objectContaining({ feesUsd: "10.000000000000000001", poolKey: `56:${address("2")}` }),
      expect.objectContaining({ feesUsd: "10.000000000000000001", poolKey: `56:${address("3")}` }),
      expect.objectContaining({ feesUsd: "9.999999999999999999", poolKey: `56:${address("1")}` }),
    ]);
    expect(selected[2]?.token0Symbol).toBe("WBNB");
  });

  it("returns an array while filtering null, non-positive, malformed, and incomplete rows", () => {
    const selected = selectRecommendedPools(
      snapshot([
        row("1", null),
        row("2", "0"),
        row("3", "-0.1"),
        row("4", "not-a-decimal"),
        row("5", "1", { poolKey: `1:${address("5")}` }),
        row("6", "1", { token0Address: null }),
      ]),
      3,
    );

    expect(selected).toEqual([]);
    expect(selectRecommendedPools(snapshot([]), 20)).toEqual([]);
  });

  it("rejects non-BSC/non-five-minute sources and limits outside 1..20", () => {
    expect(() => selectRecommendedPools({ ...snapshot([]), minutes: 15 }, 3)).toThrow(
      "RECOMMENDATION_SOURCE_INVALID",
    );
    for (const limit of [0, 21, 1.5, Number.NaN]) {
      expect(() => selectRecommendedPools(snapshot([]), limit)).toThrow(
        "RECOMMENDATION_LIMIT_INVALID",
      );
    }
  });

  it("hashes ordered wire rows and changes for any display-field replacement", () => {
    const rows = selectRecommendedPools(
      snapshot([row("1", "2.5000", { token0Symbol: null }), row("2", "1")]),
      3,
    );
    const hash = recommendationSelectionHash(rows);

    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(recommendationSelectionHash(structuredClone(rows))).toBe(hash);
    expect(recommendationSelectionHash([{ ...rows[0]!, feesUsd: "2.5001" }, rows[1]!])).not.toBe(
      hash,
    );
    expect(
      recommendationSelectionHash([{ ...rows[0]!, token0Symbol: "WBNB" }, rows[1]!]),
    ).not.toBe(hash);
    expect(recommendationSelectionHash([...rows].reverse())).not.toBe(hash);
  });
});
