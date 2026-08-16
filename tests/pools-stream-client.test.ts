import type { MarketStreamEnvelope } from "../packages/api-contract/src/index.js";
import { initialPoolStreamState, reducePoolStream } from "../apps/web/src/pools-stream-state.js";
import { buildMarketPoolsUrl, buildPoolsByTokenUrl } from "../apps/web/src/pools-client.js";
import { describe, expect, it } from "vitest";

const row = {
  activeTvlUsd: null,
  chainId: 56 as const,
  fdvUsd: "100",
  feePips: "2500",
  feeActiveTvl: null,
  feesUsd: "2",
  feeTvl: "0.02",
  hooks: null,
  labelRuleVersion: "pool-labels/local-v1",
  labels: [],
  poolAddress: "0x1111111111111111111111111111111111111111" as const,
  poolId: null,
  poolKey: "56:0x1111111111111111111111111111111111111111",
  protocol: "pcsv3" as const,
  tickSpacing: "50",
  token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  token0Symbol: "WBNB",
  token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  token1Symbol: "USDT",
  transactionCount: "3",
  tvlUsd: "100",
  volumeUsd: "20",
};

const snapshotContext = {
  canonicalRevision: "canonical:v1:test",
  metricVersion: "market-metrics/v1",
};
const diffContext = {
  ...snapshotContext,
  windowEnd: "2026-08-16T01:00:00.000Z",
};

function event(
  sequence: string,
  eventType: MarketStreamEnvelope["eventType"],
  data: MarketStreamEnvelope["data"],
  epoch = "1",
): MarketStreamEnvelope {
  return {
    cursor: `cursor-${epoch}-${sequence}`,
    data,
    emittedAt: "2026-08-16T01:00:00.000Z",
    epoch,
    eventType,
    mode: eventType === "pools.snapshot" ? "snapshot" : "diff",
    schemaVersion: "1.0.0",
    sequence,
    streamKey: "top-fees:56:5",
  };
}

describe("P02-02 pool stream client state", () => {
  it("uses the same canonical DEX collection for snapshot and stream URLs", () => {
    expect(buildMarketPoolsUrl(5, ["univ4", "pcsv3", "univ4"], false)).toBe(
      "/api/pools/top-fees/5?chainId=56&dex=pcsv3%2Cuniv4",
    );
    expect(buildMarketPoolsUrl(5, ["univ4", "pcsv3", "univ4"], true)).toBe(
      "/api/pools/top-fees/5/stream?chainId=56&dex=pcsv3%2Cuniv4",
    );
    expect(
      buildPoolsByTokenUrl(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ["univ4", "pcsv3", "univ4"],
        25,
        "volume",
      ),
    ).toBe(
      "/api/pools/by-token/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?chain=bsc&dex=pcsv3%2Cuniv4&limit=25&sort=volume",
    );
  });

  it("applies snapshot, diff and heartbeat atomically in sequence", () => {
    const snapshot = event("4", "pools.snapshot", {
      ...snapshotContext,
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      minutes: 5,
      rows: [row],
      version: "4",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    const diff = event("5", "pools.diff", {
      ...diffContext,
      tombstones: [],
      upserts: [{ ...row, feesUsd: "3" }],
      version: "5",
    });
    const heartbeat = event("6", "heartbeat", null);

    const ready = reducePoolStream(initialPoolStreamState(), {
      event: snapshot,
      type: "event",
    });
    const updated = reducePoolStream(ready, { event: diff, type: "event" });
    const alive = reducePoolStream(updated, { event: heartbeat, type: "event" });

    expect(alive.connection).toBe("ready");
    expect(alive.rows[0]?.feesUsd).toBe("3");
    expect(alive.sequence).toBe("6");
    expect(alive.cursor).toBe("cursor-1-6");
  });

  it("ignores exact duplicates and reconnects without applying gaps", () => {
    const snapshot = event("4", "pools.snapshot", {
      ...snapshotContext,
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      minutes: 5,
      rows: [row],
      version: "4",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    const ready = reducePoolStream(initialPoolStreamState(), { event: snapshot, type: "event" });
    expect(reducePoolStream(ready, { event: snapshot, type: "event" })).toEqual(ready);

    const gapped = reducePoolStream(ready, {
      event: event("6", "pools.diff", {
        ...diffContext,
        tombstones: [],
        upserts: [{ ...row, feesUsd: "999" }],
        version: "6",
      }),
      type: "event",
    });
    expect(gapped.connection).toBe("reconnecting");
    expect(gapped.rows[0]?.feesUsd).toBe("2");
    expect(gapped.cursor).toBe("cursor-1-4");
  });

  it("requires a snapshot on epoch change and retains last good rows when stale", () => {
    const snapshot = event("1", "pools.snapshot", {
      ...snapshotContext,
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      minutes: 5,
      rows: [row],
      version: "1",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    const ready = reducePoolStream(initialPoolStreamState(), { event: snapshot, type: "event" });
    const invalidEpoch = reducePoolStream(ready, {
      event: event(
        "1",
        "pools.diff",
        { ...diffContext, tombstones: [], upserts: [], version: "2" },
        "2",
      ),
      type: "event",
    });
    expect(invalidEpoch.connection).toBe("reconnecting");
    expect(invalidEpoch.rows).toEqual([row]);

    const stale = reducePoolStream(ready, { type: "stale" });
    expect(stale.connection).toBe("stale");
    expect(stale.rows).toEqual([row]);
  });

  it("sorts decimal fee strings by their numeric value after a diff", () => {
    const lowerFeeRow = {
      ...row,
      feesUsd: "9.9",
      poolAddress: "0x2222222222222222222222222222222222222222" as const,
    };
    const snapshot = event("1", "pools.snapshot", {
      ...snapshotContext,
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      minutes: 5,
      rows: [{ ...row, feesUsd: "10" }, lowerFeeRow],
      version: "1",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    const ready = reducePoolStream(initialPoolStreamState(), { event: snapshot, type: "event" });
    const sorted = reducePoolStream(ready, {
      event: event("2", "pools.diff", {
        ...diffContext,
        tombstones: [],
        upserts: [lowerFeeRow],
        version: "2",
      }),
      type: "event",
    });

    expect(sorted.rows.map(({ feesUsd }) => feesUsd)).toEqual(["10", "9.9"]);
  });
});
