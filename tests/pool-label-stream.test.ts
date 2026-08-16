import type { MarketStreamEnvelope } from "../packages/api-contract/src/index.js";
import { parseMarketStreamEnvelope } from "../apps/web/src/pools-client.js";
import { initialPoolStreamState, reducePoolStream } from "../apps/web/src/pools-stream-state.js";
import { describe, expect, it } from "vitest";

const label = {
  computedAt: "2026-08-16T01:00:00.000Z",
  id: "high-fee-rate" as const,
  label: "高费率",
  reasons: [
    {
      code: "FEE_TVL_GTE_THRESHOLD",
      observed: "0.01",
      operator: ">=" as const,
      threshold: "0.01",
      window: "5m",
    },
  ],
  ruleVersion: "pool-labels/local-v1",
  score: 50,
};

const row = {
  activeTvlUsd: null,
  chainId: 56 as const,
  fdvUsd: null,
  feeActiveTvl: null,
  feePips: "2500",
  feesUsd: "10",
  feeTvl: "0.01",
  hooks: null,
  labelRuleVersion: "pool-labels/local-v1",
  labels: [label],
  poolAddress: "0x1111111111111111111111111111111111111111" as const,
  poolId: null,
  poolKey: "56:0x1111111111111111111111111111111111111111",
  protocol: "pcsv3" as const,
  tickSpacing: "50",
  token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  token0Symbol: "WBNB",
  token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
  token1Symbol: "USDT",
  transactionCount: "20",
  tvlUsd: "1000",
  volumeUsd: "100",
};

function envelope(
  sequence: string,
  eventType: MarketStreamEnvelope["eventType"],
  data: MarketStreamEnvelope["data"],
): MarketStreamEnvelope {
  return {
    cursor: `cursor-${sequence}`,
    data,
    emittedAt: "2026-08-16T01:00:00.000Z",
    epoch: "1",
    eventType,
    mode: eventType === "pools.snapshot" ? "snapshot" : "diff",
    schemaVersion: "1.0.0",
    sequence,
    streamKey: "top-fees:56:5",
  };
}

describe("P02-08 label API/SSE client contract", () => {
  it("parses complete label reasons and rejects missing or malformed label fields", () => {
    const snapshot = envelope("1", "pools.snapshot", {
      canonicalRevision: "canonical:v1:abc",
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      metricVersion: "market-metrics/v1",
      minutes: 5,
      rows: [row],
      version: "1",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    expect(parseMarketStreamEnvelope(structuredClone(snapshot))).toEqual(snapshot);

    const noLabels = structuredClone(snapshot) as unknown as Record<string, any>;
    delete noLabels.data.rows[0].labels;
    expect(() => parseMarketStreamEnvelope(noLabels)).toThrow("MARKET_STREAM_RESPONSE_INVALID");

    const badScore = structuredClone(snapshot) as unknown as Record<string, any>;
    badScore.data.rows[0].labels[0].score = 101;
    expect(() => parseMarketStreamEnvelope(badScore)).toThrow("MARKET_STREAM_RESPONSE_INVALID");
  });

  it("applies a label-only upsert and then deletes by stable poolKey tombstone", () => {
    const snapshot = envelope("1", "pools.snapshot", {
      canonicalRevision: "canonical:v1:abc",
      chainId: 56,
      generatedAt: "2026-08-16T01:00:00.000Z",
      metricVersion: "market-metrics/v1",
      minutes: 5,
      rows: [{ ...row, labels: [] }],
      version: "1",
      windowEnd: "2026-08-16T01:00:00.000Z",
      windowStart: "2026-08-16T00:55:00.000Z",
    });
    const withLabels = reducePoolStream(initialPoolStreamState(), {
      event: snapshot,
      type: "event",
    });
    const upserted = reducePoolStream(withLabels, {
      event: envelope("2", "pools.diff", {
        canonicalRevision: "canonical:v1:def",
        metricVersion: "market-metrics/v1",
        tombstones: [],
        upserts: [row],
        version: "2",
        windowEnd: "2026-08-16T01:00:00.000Z",
      }),
      type: "event",
    });
    expect(upserted.rows[0]!.labels).toEqual([label]);
    expect(upserted.snapshot).toMatchObject({
      canonicalRevision: "canonical:v1:def",
      metricVersion: "market-metrics/v1",
      version: "2",
      windowEnd: "2026-08-16T01:00:00.000Z",
    });

    const removed = reducePoolStream(upserted, {
      event: envelope("3", "pools.diff", {
        canonicalRevision: "canonical:v1:ghi",
        metricVersion: "market-metrics/v1",
        tombstones: [row.poolKey],
        upserts: [],
        version: "3",
        windowEnd: "2026-08-16T01:00:00.000Z",
      }),
      type: "event",
    });
    expect(removed.rows).toEqual([]);
  });
});
