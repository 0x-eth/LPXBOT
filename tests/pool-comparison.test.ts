import type {
  MarketPoolRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "../packages/api-contract/src/index.js";
import {
  buildPoolComparison,
  canonicalFeeTierDisplay,
  initialPoolComparisonState,
  reconcilePoolComparison,
  togglePoolComparison,
} from "../apps/web/src/pool-comparison-state.js";
import { initialPoolStreamState, reducePoolStream } from "../apps/web/src/pools-stream-state.js";
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
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "50",
    token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token0Symbol: `TOKEN${suffix}`,
    token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    token1Symbol: "USDT",
    transactionCount: "4",
    tvlUsd: "1000",
    volumeUsd: "100",
    ...overrides,
  };
}

const poolA = row("1", { feesUsd: "20", feePips: "2500", transactionCount: "8" });
const poolB = row("2", { feesUsd: "10", feePips: "500", transactionCount: "4" });
const poolC = row("3", { feesUsd: null, feePips: null, feeTvl: null, transactionCount: null });
const poolD = row("4");

function snapshot(
  version: string,
  rows: MarketPoolRow[] = [poolA, poolB, poolC, poolD],
): MarketPoolSnapshot {
  return {
    chainId: 56,
    generatedAt: "2026-08-16T01:00:01.000Z",
    minutes: 5,
    rows,
    version,
    windowEnd: "2026-08-16T01:00:00.000Z",
    windowStart: "2026-08-16T00:55:00.000Z",
  };
}

function envelope(
  sequence: string,
  eventType: MarketStreamEnvelope["eventType"],
  data: MarketStreamEnvelope["data"],
): MarketStreamEnvelope {
  return {
    cursor: `cursor-${sequence}`,
    data,
    emittedAt: "2026-08-16T01:00:02.000Z",
    epoch: "1",
    eventType,
    mode: eventType === "pools.snapshot" ? "snapshot" : "diff",
    schemaVersion: "1.0.0",
    sequence,
    streamKey: "top-fees:56:5",
  };
}

describe("P02-07 same-snapshot pool comparison", () => {
  it("selects stable pool keys, becomes ready at two, and limits selection to three", () => {
    const current = snapshot("1");
    let state = initialPoolComparisonState();
    expect(state.status).toBe("none-selected");
    state = togglePoolComparison(state, poolA.poolKey, current);
    expect(state).toMatchObject({ selectedPoolKeys: [poolA.poolKey], status: "one-selected" });
    state = togglePoolComparison(state, poolB.poolKey, current);
    expect(state.status).toBe("ready");
    state = togglePoolComparison(state, poolC.poolKey, current);
    expect(state).toMatchObject({
      selectedPoolKeys: [poolA.poolKey, poolB.poolKey, poolC.poolKey],
      status: "ready",
    });
    state = togglePoolComparison(state, poolD.poolKey, current);
    expect(state).toMatchObject({
      selectedPoolKeys: [poolA.poolKey, poolB.poolKey, poolC.poolKey],
      status: "limit-reached",
    });
    state = togglePoolComparison(state, poolA.poolKey, current);
    expect(state).toMatchObject({
      selectedPoolKeys: [poolB.poolKey, poolC.poolKey],
      status: "ready",
    });
  });

  it("projects all metrics from one window, version and as-of time", () => {
    const current = snapshot("7", [poolA, poolB]);
    let state = togglePoolComparison(initialPoolComparisonState(), poolA.poolKey, current);
    state = togglePoolComparison(state, poolB.poolKey, current);
    const comparison = buildPoolComparison(state, current);

    expect(comparison.binding).toEqual({
      asOf: "2026-08-16T01:00:00.000Z",
      snapshotVersion: "7",
      windowMinutes: 5,
    });
    expect(comparison.pools.map(({ poolKey }) => poolKey)).toEqual([poolA.poolKey, poolB.poolKey]);
    expect(comparison.metrics.map(({ key }) => key)).toEqual([
      "fees",
      "volume",
      "tvl",
      "activeTvl",
      "feeTvl",
      "txs",
      "feeTier",
    ]);
    const activeTvl = comparison.metrics.find(({ key }) => key === "activeTvl")!;
    expect(activeTvl.values.every(({ display, isBest }) => display === "不可用" && !isBest)).toBe(
      true,
    );
    expect(
      comparison.metrics
        .find(({ key }) => key === "fees")!
        .values.map(({ isBest, poolKey }) => [poolKey, isBest]),
    ).toEqual([
      [poolA.poolKey, true],
      [poolB.poolKey, false],
    ]);
  });

  it("maps Fee Tier only from canonical feePips", () => {
    expect(canonicalFeeTierDisplay("2500")).toBe("0.25%");
    expect(canonicalFeeTierDisplay("500")).toBe("0.05%");
    expect(canonicalFeeTierDisplay(null)).toBe("不可用");
    expect(canonicalFeeTierDisplay("Fee 0.3%")).toBe("不可用");
  });

  it("refreshes selected values on SSE upsert and removes tombstones atomically", () => {
    const initialSnapshot = snapshot("1", [poolA, poolB]);
    let stream = reducePoolStream(initialPoolStreamState(), {
      event: envelope("1", "pools.snapshot", initialSnapshot),
      type: "event",
    });
    let selection = togglePoolComparison(
      initialPoolComparisonState(),
      poolA.poolKey,
      stream.snapshot!,
    );
    selection = togglePoolComparison(selection, poolB.poolKey, stream.snapshot!);

    stream = reducePoolStream(stream, {
      event: envelope("2", "pools.diff", {
        tombstones: [],
        upserts: [{ ...poolA, feesUsd: "99" }],
        version: "2",
      }),
      type: "event",
    });
    selection = reconcilePoolComparison(selection, stream.snapshot!);
    const refreshed = buildPoolComparison(selection, stream.snapshot!);
    expect(refreshed.binding.snapshotVersion).toBe("2");
    expect(refreshed.pools.find(({ poolKey }) => poolKey === poolA.poolKey)?.feesUsd).toBe("99");

    stream = reducePoolStream(stream, {
      event: envelope("3", "pools.diff", {
        tombstones: [poolB.poolKey],
        upserts: [],
        version: "3",
      }),
      type: "event",
    });
    selection = reconcilePoolComparison(selection, stream.snapshot!);
    expect(selection).toMatchObject({ selectedPoolKeys: [poolA.poolKey], status: "one-selected" });
    expect(buildPoolComparison(selection, stream.snapshot!).pools).toHaveLength(1);
  });

  it("drops a stale binding instead of mixing snapshots", () => {
    const first = snapshot("1", [poolA, poolB]);
    let state = togglePoolComparison(initialPoolComparisonState(), poolA.poolKey, first);
    state = togglePoolComparison(state, poolB.poolKey, first);

    const nextWindow = { ...snapshot("8", [poolC]), minutes: 15 as const };
    state = reconcilePoolComparison(state, nextWindow);
    expect(state).toMatchObject({ selectedPoolKeys: [], status: "none-selected" });
    expect(state.binding).toEqual({
      asOf: nextWindow.windowEnd,
      snapshotVersion: "8",
      windowMinutes: 15,
    });
  });
});
