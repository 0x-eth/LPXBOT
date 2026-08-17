import type {
  MarketPoolByTokenRow,
  MarketPoolRow,
  MarketPoolSnapshot,
  PoolBlocklistSnapshot,
} from "../packages/api-contract/src/index.js";
import {
  createMarketPoolEligibility,
  filterEligibleMarketPoolRows,
  parseMarketEligibilityCursor,
  wrapMarketEligibilityCursor,
} from "../apps/api/src/market-pools.js";
import {
  parseRecommendedPoolsCursor,
  recommendedPoolsCursor,
  selectRecommendedPools,
} from "../apps/api/src/recommended-pools.js";
import { groupPoolRows } from "../apps/web/src/pool-table-state.js";
import {
  initialPoolComparisonState,
  reconcilePoolComparison,
  togglePoolComparison,
} from "../apps/web/src/pool-comparison-state.js";
import { describe, expect, it } from "vitest";

const blockedPoolKey = `56:0x${"1".repeat(40)}` as const;
const blockedToken = `0x${"b".repeat(40)}` as const;

function row(
  identity: string,
  feesUsd: string,
  overrides: Partial<MarketPoolRow> = {},
): MarketPoolRow {
  const address = `0x${identity.repeat(40)}` as const;
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
    poolAddress: address,
    poolId: null,
    poolKey: `56:${address}`,
    protocol: "pcsv3",
    tickSpacing: "10",
    token0Address: `0x${"a".repeat(40)}`,
    token0Symbol: "AAA",
    token1Address: `0x${identity.repeat(40)}`,
    token1Symbol: "BBB",
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: feesUsd,
    ...overrides,
  };
}

function snapshot(rows: MarketPoolRow[]): MarketPoolSnapshot {
  return {
    canonicalRevision: "canonical:v1:11",
    chainId: 56,
    generatedAt: "2026-08-17T02:00:01.000Z",
    metricVersion: "market-metrics/v1",
    minutes: 5,
    rows,
    version: "11",
    windowEnd: "2026-08-17T02:00:00.000Z",
    windowStart: "2026-08-17T01:55:00.000Z",
  };
}

const blocklist: PoolBlocklistSnapshot = {
  blocklistHash: `sha256:${"c".repeat(64)}`,
  entries: [
    { chainId: 56, identity: blockedPoolKey, scope: "pool" },
    { chainId: 56, identity: blockedToken, scope: "token" },
  ],
  revision: 2,
  schemaVersion: 1,
  updatedAt: "2026-08-17T02:00:00.000Z",
};

describe("P02-11 unified pool eligibility consumers", () => {
  it("filters pool and token blocks before by-token sorting and limit so results are backfilled", () => {
    const eligibility = createMarketPoolEligibility(blocklist);
    const rows = [
      row("1", "100"),
      row("2", "90", { token0Address: blockedToken }),
      row("3", "80"),
      row("4", "70"),
    ] as MarketPoolByTokenRow[];

    const selected = filterEligibleMarketPoolRows(rows, eligibility)
      .sort((left, right) => Number(right.feesUsd) - Number(left.feesUsd))
      .slice(0, 2);

    expect(selected.map(({ poolKey }) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
  });

  it("filters recommendations before limit and keeps the next ranked pools", () => {
    const pools = selectRecommendedPools(
      snapshot([
        row("1", "100"),
        row("2", "90", { token0Address: blockedToken }),
        row("3", "80"),
        row("4", "70"),
      ]),
      2,
      createMarketPoolEligibility(blocklist),
    );

    expect(pools.map(({ poolKey }) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
  });

  it("binds market and recommendation resume cursors to the authoritative blocklist hash", () => {
    const market = wrapMarketEligibilityCursor("market:v1:top-fees:56:5:1:2:source", {
      blocklistHash: blocklist.blocklistHash,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
    });
    expect(
      parseMarketEligibilityCursor(market, {
        blocklistHash: blocklist.blocklistHash,
        protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
      }),
    ).toBe("market:v1:top-fees:56:5:1:2:source");
    expect(
      parseMarketEligibilityCursor(market, {
        blocklistHash: `sha256:${"d".repeat(64)}`,
        protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
      }),
    ).toBeNull();

    const recommendation = recommendedPoolsCursor({
      blocklistHash: blocklist.blocklistHash,
      chain: "bsc",
      limit: 3,
      selectionHash: `sha256:${"e".repeat(64)}`,
      sourceVersion: "11",
      sourceWindowEnd: "2026-08-17T02:00:00.000Z",
    });
    expect(
      parseRecommendedPoolsCursor(recommendation, {
        blocklistHash: blocklist.blocklistHash,
        chain: "bsc",
        limit: 3,
      }),
    ).toMatchObject({ blocklistHash: blocklist.blocklistHash });
    expect(
      parseRecommendedPoolsCursor(recommendation, {
        blocklistHash: `sha256:${"d".repeat(64)}`,
        chain: "bsc",
        limit: 3,
      }),
    ).toBeNull();
  });

  it("removes blocked rows before grouping and reconciles them out of comparison", () => {
    const source = snapshot([row("1", "100"), row("3", "80"), row("4", "70")]);
    const state = togglePoolComparison(
      togglePoolComparison(initialPoolComparisonState(), blockedPoolKey, source),
      `56:0x${"3".repeat(40)}`,
      source,
    );
    const eligibleRows = filterEligibleMarketPoolRows(
      source.rows,
      createMarketPoolEligibility(blocklist),
    );
    const eligibleSnapshot = { ...source, rows: eligibleRows };

    expect(
      groupPoolRows(eligibleRows, { type: "default" }).flatMap(({ members }) => members),
    ).toEqual(eligibleRows);
    expect(reconcilePoolComparison(state, eligibleSnapshot).selectedPoolKeys).toEqual([
      `56:0x${"3".repeat(40)}`,
    ]);
  });
});
