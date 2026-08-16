import type {
  MarketPoolRow,
  MarketPoolSnapshot,
  RecommendedPoolsSnapshotEvent,
} from "@lpbot/api-contract";
import type { MarketPoolsContext, MarketPoolsProvider } from "../apps/api/src/market-pools.js";
import {
  createRecommendedPoolsEventStream,
  type RecommendedPoolsScheduler,
} from "../apps/api/src/recommended-pools.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const observedAt = "2026-08-17T02:00:00.000Z";
const poolAddress = `0x${"1".repeat(40)}` as const;

function marketSnapshot(
  version: string,
  overrides: Partial<MarketPoolRow> = {},
): MarketPoolSnapshot {
  return {
    canonicalRevision: `canonical:v1:${version}`,
    chainId: 56,
    generatedAt: observedAt,
    metricVersion: "market-metrics/v1",
    minutes: 5,
    rows: [
      {
        activeTvlUsd: null,
        chainId: 56,
        fdvUsd: null,
        feeActiveTvl: null,
        feePips: "500",
        feesUsd: "12.5000",
        feeTvl: null,
        hooks: null,
        labelRuleVersion: "pool-labels/local-v1",
        labels: [],
        poolAddress,
        poolId: null,
        poolKey: `56:${poolAddress}`,
        protocol: "pcsv3",
        tickSpacing: "10",
        token0Address: `0x${"a".repeat(40)}`,
        token0Symbol: "WBNB",
        token1Address: `0x${"b".repeat(40)}`,
        token1Symbol: "USDT",
        transactionCount: null,
        tvlUsd: null,
        volumeUsd: null,
        ...overrides,
      },
    ],
    version,
    windowEnd: "2026-08-17T01:55:00.000Z",
    windowStart: "2026-08-17T01:50:00.000Z",
  };
}

class MutableMarketProvider implements MarketPoolsProvider {
  calls: MarketPoolsContext[] = [];
  current = marketSnapshot("1");

  async getByToken(): Promise<[]> {
    return [];
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.calls.push(context);
    return structuredClone(this.current);
  }

  async *subscribe(): AsyncIterable<never> {}
}

function fakeScheduler(): RecommendedPoolsScheduler {
  return {
    clearInterval(handle) {
      clearInterval(handle);
    },
    now: () => new Date(),
    setInterval(callback, milliseconds) {
      return setInterval(callback, milliseconds);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("P02-09 recommendation polling stream", () => {
  it("emits immediately, polls every five seconds, deduplicates rows, heartbeats, and cleans up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(observedAt);
    const provider = new MutableMarketProvider();
    const controller = new AbortController();
    const iterator = createRecommendedPoolsEventStream({
      chain: "bsc",
      limit: 3,
      provider,
      scheduler: fakeScheduler(),
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const initial = await iterator.next();
    expect(initial.value).toMatchObject({
      pools: [expect.objectContaining({ feesUsd: "12.5000", poolKey: `56:${poolAddress}` })],
      sourceVersion: "1",
      sourceWindow: 5,
      sourceWindowEnd: "2026-08-17T01:55:00.000Z",
      type: "rec_pools_snapshot",
    } satisfies Partial<RecommendedPoolsSnapshotEvent>);
    expect(provider.calls[0]).toMatchObject({ chainId: 56, minutes: 5 });
    expect(provider.calls[0]?.protocols).toEqual(["pcsv3", "univ3", "pcsv4", "univ4"]);
    expect(provider.calls[0]?.signal).toBe(controller.signal);

    let settled = false;
    const changed = iterator.next().then((value) => {
      settled = true;
      return value;
    });
    provider.current = marketSnapshot("2");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.calls).toHaveLength(2);
    expect(settled).toBe(false);

    provider.current = marketSnapshot("3", { token0Symbol: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await changed).value).toMatchObject({
      pools: [expect.objectContaining({ token0Symbol: null })],
      sourceVersion: "3",
      type: "rec_pools_snapshot",
    });

    const heartbeat = iterator.next();
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await heartbeat).value).toEqual({
      observedAt: "2026-08-17T02:00:25.000Z",
      type: "heartbeat",
    });

    controller.abort();
    await iterator.return?.();
    expect(vi.getTimerCount()).toBe(0);
    expect((await iterator.next()).done).toBe(true);
  });
});
