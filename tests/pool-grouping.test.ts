import type { MarketPoolRow, MarketStreamEnvelope } from "../packages/api-contract/src/index.js";
import {
  BSC_QUOTE_TOKEN_ADDRESSES,
  flattenPoolGroups,
  groupPoolRows,
  reconcileExpandedPoolGroups,
} from "../apps/web/src/pool-table-state.js";
import { initialPoolStreamState, reducePoolStream } from "../apps/web/src/pools-stream-state.js";
import { describe, expect, it } from "vitest";

const quote = "0x55d398326f99059ff775485246999027b3197955" as const;
const tokenA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const tokenB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function row(
  identityByte: string,
  token0Address: `0x${string}`,
  token1Address: `0x${string}`,
  overrides: Partial<MarketPoolRow> = {},
): MarketPoolRow {
  const poolAddress = `0x${identityByte.repeat(40)}` as `0x${string}`;
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "2500",
    feesUsd: "10",
    feeTvl: null,
    hooks: null,
    labelRuleVersion: "pool-labels/local-v1",
    labels: [],
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "50",
    token0Address,
    token0Symbol: "SAME",
    token1Address,
    token1Symbol: "USDT",
    transactionCount: "1",
    tvlUsd: null,
    volumeUsd: null,
    ...overrides,
  };
}

function snapshotEvent(rows: MarketPoolRow[]): MarketStreamEnvelope {
  return {
    cursor: "group-cursor-1",
    data: {
      canonicalRevision: "canonical:v1:test",
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      metricVersion: "market-metrics/v1",
      minutes: 5,
      rows,
      version: "1",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    },
    emittedAt: "2026-08-16T01:00:00.000Z",
    epoch: "1",
    eventType: "pools.snapshot",
    mode: "snapshot",
    schemaVersion: "1.0.0",
    sequence: "1",
    streamKey: "top-fees:56:5",
  };
}

describe("P02-06 canonical token grouping", () => {
  it("uses a frozen quote registry and never groups by a colliding symbol", () => {
    expect(Object.isFrozen(BSC_QUOTE_TOKEN_ADDRESSES)).toBe(true);
    const rows = [
      row("1", tokenA, quote, { feesUsd: "30", protocol: "pcsv3" }),
      row("2", tokenA, quote, { feesUsd: "20", protocol: "univ3" }),
      row("3", tokenB, quote, { feesUsd: "10", protocol: "pcsv4" }),
      row("4", tokenA, tokenB, { feesUsd: "5", token0Symbol: "SAME" }),
      row("5", quote, BSC_QUOTE_TOKEN_ADDRESSES[1]!, { feesUsd: "4" }),
    ];

    const groups = groupPoolRows(rows, { type: "default" });

    expect(groups.map(({ groupKey, members }) => [groupKey, members.length])).toEqual([
      [`56:${tokenA}`, 2],
      [`56:${tokenB}`, 1],
      [`pool:${rows[3]!.poolKey}`, 1],
      [`pool:${rows[4]!.poolKey}`, 1],
    ]);
    expect(groups[0]!.header).toBe(rows[0]);
    expect(groups[0]!.members).toEqual(rows.slice(0, 2));
  });

  it("uses the searched token as the explicit group key and exposes +N when collapsed", () => {
    const rows = [row("1", tokenA, quote), row("2", quote, tokenA), row("3", tokenA, tokenB)];
    const groups = groupPoolRows(rows, { tokenAddress: tokenA, type: "token-search" });
    const collapsed = flattenPoolGroups(groups, new Set());
    const expanded = flattenPoolGroups(groups, new Set([`56:${tokenA}`]));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ additionalCount: 2, groupKey: `56:${tokenA}` });
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({ additionalCount: 2, isHeader: true, row: rows[0] });
    expect(expanded.map(({ row: member }) => member.poolKey)).toEqual(
      rows.map(({ poolKey }) => poolKey),
    );
  });

  it("keeps valid expansion after SSE upsert/tombstone and removes vanished groups", () => {
    const rows = [row("1", tokenA, quote), row("2", tokenA, quote), row("3", tokenA, quote)];
    const ready = reducePoolStream(initialPoolStreamState(), {
      event: snapshotEvent(rows),
      type: "event",
    });
    const updated = reducePoolStream(ready, {
      event: {
        ...snapshotEvent([]),
        cursor: "group-cursor-2",
        data: {
          canonicalRevision: "canonical:v1:test-2",
          metricVersion: "market-metrics/v1",
          tombstones: [rows[2]!.poolKey],
          upserts: [{ ...rows[1]!, feesUsd: "99" }],
          version: "2",
          windowEnd: "2026-08-16T01:00:00.000Z",
        },
        eventType: "pools.diff",
        mode: "diff",
        sequence: "2",
      },
      type: "event",
    });
    const expanded = new Set([`56:${tokenA}`, "56:0xdead"]);
    const groups = groupPoolRows(updated.rows, { type: "default" });

    expect(reconcileExpandedPoolGroups(expanded, groups)).toEqual(new Set([`56:${tokenA}`]));
    expect(groups[0]!.members.map(({ feesUsd }) => feesUsd)).toEqual(["99", "10"]);
    expect(reconcileExpandedPoolGroups(expanded, [])).toEqual(new Set());
  });
});
