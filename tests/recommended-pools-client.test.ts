import type {
  RecommendedPoolRow,
  RecommendedPoolsSnapshotEvent,
} from "../packages/api-contract/src/index.js";
import {
  createShellStatsState,
  recommendedPoolDisplay,
  recommendedPoolSearchPath,
  markShellStatsDisconnected,
  parseShellStatsEvent,
  reduceShellStatsEvent,
} from "../apps/web/src/shell-stats.js";
import { describe, expect, it } from "vitest";

const row: RecommendedPoolRow = {
  chainId: 56,
  feePips: "500",
  feesUsd: "12.5000",
  poolAddress: `0x${"1".repeat(40)}`,
  poolId: null,
  poolKey: `56:0x${"1".repeat(40)}`,
  protocol: "pcsv3",
  token0Address: `0x${"a".repeat(40)}`,
  token0Symbol: "WBNB",
  token1Address: `0x${"b".repeat(40)}`,
  token1Symbol: null,
};

function recommendation(
  version: string,
  hashDigit: string,
  overrides: Partial<RecommendedPoolsSnapshotEvent> = {},
): RecommendedPoolsSnapshotEvent {
  const selectionHash = `sha256:${hashDigit.repeat(64)}`;
  return {
    cursor: `rec-pools:v1:bsc:3:${Buffer.from(version).toString("base64url")}:${Buffer.from(
      "2026-08-17T01:55:00.000Z",
    ).toString("base64url")}:${selectionHash.slice(7)}`,
    observedAt: "2026-08-17T02:00:00.000Z",
    pools: [row],
    selectionHash,
    sourceVersion: version,
    sourceWindow: 5,
    sourceWindowEnd: "2026-08-17T01:55:00.000Z",
    type: "rec_pools_snapshot",
    ...overrides,
  };
}

describe("P02-09 recommended pool client state", () => {
  it("accepts recommendations before stats and handles duplicates, ordering, and replacement", () => {
    const firstEvent = recommendation("7", "a");
    const first = reduceShellStatsEvent(createShellStatsState(), firstEvent);

    expect(first.stats).toBeNull();
    expect(first.sequence).toBe(-1);
    expect(first.recommendations).toMatchObject({
      cursor: firstEvent.cursor,
      pools: [row],
      selectionHash: firstEvent.selectionHash,
      sourceVersion: "7",
      status: "ready",
    });
    expect(reduceShellStatsEvent(first, firstEvent)).toBe(first);
    expect(reduceShellStatsEvent(first, recommendation("6", "b"))).toBe(first);

    const replacement = reduceShellStatsEvent(first, recommendation("8", "c", {
      pools: [{ ...row, feesUsd: "9.25" }],
    }));
    expect(replacement.recommendations).toMatchObject({
      pools: [expect.objectContaining({ feesUsd: "9.25" })],
      sourceVersion: "8",
      status: "ready",
    });
  });

  it("strictly parses the structured event and rejects extra or inconsistent wire data", () => {
    const event = recommendation("7", "a");
    expect(parseShellStatsEvent(event)).toEqual(event);
    expect(parseShellStatsEvent({ ...event, extra: true })).toBeNull();
    expect(parseShellStatsEvent({ ...event, sourceWindow: 15 })).toBeNull();
    expect(parseShellStatsEvent({ ...event, selectionHash: `sha256:${"z".repeat(64)}` })).toBeNull();
    expect(
      parseShellStatsEvent({
        ...event,
        pools: [{ ...row, poolKey: `56:0x${"2".repeat(40)}` }],
      }),
    ).toBeNull();
    expect(parseShellStatsEvent({ ...event, pools: [{ ...row, unexpected: true }] })).toBeNull();
  });

  it("distinguishes reconnecting and stale without discarding the last safe rows", () => {
    const current = reduceShellStatsEvent(createShellStatsState(), recommendation("7", "a"));
    expect(markShellStatsDisconnected(current, new Date("2026-08-17T02:00:20.000Z"))).toMatchObject({
      connected: false,
      recommendations: { pools: [row], status: "reconnecting" },
    });
    expect(markShellStatsDisconnected(current, new Date("2026-08-17T02:00:31.000Z"))).toMatchObject({
      connected: false,
      recommendations: { pools: [row], status: "stale" },
    });
  });

  it("formats unknown symbols from addresses and links only to the existing pool search", () => {
    expect(recommendedPoolDisplay(row)).toEqual({
      fees: "$12.50",
      pair: "WBNB / 0xbbbb...bbbb",
    });
    expect(recommendedPoolSearchPath(row)).toBe(
      "/pools?pool_search_mode=pool&pool_search=0x1111111111111111111111111111111111111111",
    );
    expect(recommendedPoolDisplay({ ...row, feesUsd: "1234567.899" }).fees).toBe(
      "$1,234,567.90",
    );
  });
});
