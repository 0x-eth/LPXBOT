import type { MarketPoolRow } from "../packages/api-contract/src/index.js";
import {
  defaultPoolAdvancedFilters,
  filterAndSortPoolRows,
  parsePoolAdvancedFilters,
  validatePoolAdvancedFilters,
  writePoolAdvancedFilters,
  type PoolAdvancedFilters,
  type PoolNumericFilterKey,
} from "../apps/web/src/pool-filter-state.js";
import { describe, expect, it } from "vitest";

function row(suffix: string, overrides: Partial<MarketPoolRow> = {}): MarketPoolRow {
  const poolAddress = `0x${suffix.repeat(40)}` as MarketPoolRow["poolAddress"];
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "2500",
    feesUsd: "10",
    feeTvl: "0.01",
    hooks: null,
    labelRuleVersion: "pool-labels/local-v1",
    labels: [],
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "50",
    token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token0Symbol: "WBNB",
    token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    token1Symbol: "USDT",
    transactionCount: "4",
    tvlUsd: "1000",
    volumeUsd: "100",
    ...overrides,
  };
}

const rows: MarketPoolRow[] = [
  row("1", { feesUsd: "20", feeTvl: "0.02", transactionCount: "8", volumeUsd: "200" }),
  row("2", {
    feesUsd: "20",
    feeTvl: "0.02",
    hooks: "0xcccccccccccccccccccccccccccccccccccccccc",
    protocol: "univ3",
    token0Symbol: "币安币",
    transactionCount: "12",
    tvlUsd: "2000",
    volumeUsd: "300",
  }),
  row("3", {
    feesUsd: "5",
    feeTvl: "0.005",
    poolAddress: null,
    poolId: `0x${"3".repeat(64)}`,
    poolKey: `56:0x${"3".repeat(64)}`,
    protocol: "pcsv4",
    token0Symbol: null,
    token1Symbol: null,
    transactionCount: "2",
    tvlUsd: "500",
    volumeUsd: "50",
  }),
  row("4", {
    feesUsd: null,
    feeTvl: null,
    poolAddress: null,
    poolId: `0x${"4".repeat(64)}`,
    poolKey: `56:0x${"4".repeat(64)}`,
    protocol: "univ4",
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: null,
  }),
];

function enabledRange(key: PoolNumericFilterKey, min: string, max: string): PoolAdvancedFilters {
  const filters = defaultPoolAdvancedFilters();
  filters.ranges[key] = { enabled: true, max, min };
  return filters;
}

describe("P02-07 advanced pool filters", () => {
  it("supports V3/V4, every numeric range, Hook, and known Han token symbols", () => {
    const v3 = defaultPoolAdvancedFilters();
    v3.generations = ["v3"];
    expect(filterAndSortPoolRows(rows, v3).map(({ poolKey }) => poolKey)).toHaveLength(2);

    const v4 = defaultPoolAdvancedFilters();
    v4.generations = ["v4"];
    expect(filterAndSortPoolRows(rows, v4).map(({ poolKey }) => poolKey)).toHaveLength(2);

    const cases: Record<PoolNumericFilterKey, { bounds: [string, string]; count: number }> = {
      activeTvl: { bounds: ["", ""], count: 0 },
      feeActiveTvl: { bounds: ["", ""], count: 0 },
      fees: { bounds: ["10", "20"], count: 2 },
      feeTvl: { bounds: ["0.01", "0.02"], count: 2 },
      tvl: { bounds: ["900", "2000"], count: 2 },
      txs: { bounds: ["8", "12"], count: 2 },
      volume: { bounds: ["100", "300"], count: 2 },
    };
    for (const key of Object.keys(cases) as PoolNumericFilterKey[]) {
      const { bounds, count } = cases[key];
      expect(
        filterAndSortPoolRows(rows, enabledRange(key, bounds[0]!, bounds[1]!)),
        key,
      ).toHaveLength(count);
    }

    const withHook = defaultPoolAdvancedFilters();
    withHook.hook = "present";
    expect(filterAndSortPoolRows(rows, withHook).map(({ poolKey }) => poolKey)).toEqual([
      rows[1]!.poolKey,
    ]);

    const excludeHan = defaultPoolAdvancedFilters();
    excludeHan.excludeHanTokens = true;
    const withoutHan = filterAndSortPoolRows(rows, excludeHan);
    expect(withoutHan.map(({ poolKey }) => poolKey)).not.toContain(rows[1]!.poolKey);
    expect(withoutHan.map(({ poolKey }) => poolKey)).toContain(rows[2]!.poolKey);
  });

  it("excludes null rows whenever a numeric filter is enabled", () => {
    for (const key of ["fees", "feeTvl", "tvl", "txs", "volume"] as const) {
      const filtered = filterAndSortPoolRows(rows, enabledRange(key, "", ""));
      expect(
        filtered.map(({ poolKey }) => poolKey),
        key,
      ).not.toContain(rows[3]!.poolKey);
    }
    expect(filterAndSortPoolRows(rows, enabledRange("activeTvl", "", ""))).toEqual([]);
    expect(filterAndSortPoolRows(rows, enabledRange("feeActiveTvl", "", ""))).toEqual([]);
  });

  it("combines filters with AND and compares Decimal boundaries inclusively", () => {
    const filters = defaultPoolAdvancedFilters();
    filters.generations = ["v3"];
    filters.hook = "present";
    filters.excludeHanTokens = false;
    filters.ranges.fees = { enabled: true, min: "20.000000000000000000", max: "20" };
    filters.ranges.txs = { enabled: true, min: "12", max: "12" };
    filters.ranges.volume = { enabled: true, min: "300", max: "300.000000000000000001" };
    expect(filterAndSortPoolRows(rows, filters).map(({ poolKey }) => poolKey)).toEqual([
      rows[1]!.poolKey,
    ]);
  });

  it("round-trips valid URL state, reports invalid input, and resets deterministically", () => {
    const filters = defaultPoolAdvancedFilters();
    filters.generations = ["v4"];
    filters.excludeHanTokens = true;
    filters.hook = "absent";
    filters.ranges.feeTvl = { enabled: true, min: "0.0001", max: "0.1" };
    filters.ranges.volume = { enabled: true, min: "10", max: "" };
    filters.sortBy = "feeTvl";
    filters.sortDirection = "asc";

    const serialized = writePoolAdvancedFilters("?fixture=pools-ready&dex=pcsv4", filters);
    expect(serialized).toBe(
      "?fixture=pools-ready&dex=pcsv4&pool_versions=v4&pool_volume=10%3A&pool_fee_tvl=0.0001%3A0.1&pool_hook=absent&pool_exclude_han=1&pool_sort=feeTvl&pool_direction=asc",
    );
    expect(parsePoolAdvancedFilters(serialized)).toEqual({ filters, issues: [], valid: true });
    expect(writePoolAdvancedFilters(serialized, null)).toBe("?fixture=pools-ready&dex=pcsv4");

    const invalid = parsePoolAdvancedFilters(
      "?pool_versions=v5&pool_fees=20:10&pool_txs=one:2&pool_hook=maybe",
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toEqual(["pool_versions", "pool_fees", "pool_txs", "pool_hook"]);
    expect(validatePoolAdvancedFilters(invalid.filters)).toBe(false);

    const duplicate = parsePoolAdvancedFilters("?pool_hook=present&pool_hook=absent");
    expect(duplicate).toMatchObject({ issues: ["pool_hook"], valid: false });
  });

  it("sorts raw Decimal values stably with null last in both directions", () => {
    const descending = defaultPoolAdvancedFilters();
    descending.sortBy = "fees";
    descending.sortDirection = "desc";
    expect(filterAndSortPoolRows(rows, descending).map(({ poolKey }) => poolKey)).toEqual([
      rows[0]!.poolKey,
      rows[1]!.poolKey,
      rows[2]!.poolKey,
      rows[3]!.poolKey,
    ]);

    const ascending = structuredClone(descending);
    ascending.sortDirection = "asc";
    expect(filterAndSortPoolRows(rows, ascending).map(({ poolKey }) => poolKey)).toEqual([
      rows[2]!.poolKey,
      rows[0]!.poolKey,
      rows[1]!.poolKey,
      rows[3]!.poolKey,
    ]);

    const unresolved = structuredClone(descending);
    unresolved.sortBy = "feeActiveTvl";
    expect(filterAndSortPoolRows(rows, unresolved).map(({ poolKey }) => poolKey)).toEqual(
      [...rows]
        .sort((left, right) => left.poolKey.localeCompare(right.poolKey))
        .map(({ poolKey }) => poolKey),
    );
  });
});
