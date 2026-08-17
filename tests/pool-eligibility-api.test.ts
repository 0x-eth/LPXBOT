import type {
  MarketPoolByTokenRow,
  MarketPoolRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  PoolBlocklistSnapshot,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsByTokenContext,
  MarketPoolsContext,
  MarketPoolsProvider,
  MarketPoolsStreamContext,
} from "../apps/api/src/market-pools.js";
import type { PoolBlocklistStore } from "../apps/api/src/pool-blocklist.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const blockedPoolKey: `56:0x${string}` = `56:0x${"1".repeat(40)}`;
const blockedToken = `0x${"b".repeat(40)}` as const;

function row(
  digit: string,
  feesUsd: string,
  overrides: Partial<MarketPoolRow> = {},
): MarketPoolRow {
  const poolAddress = `0x${digit.repeat(40)}` as const;
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
    token0Address: `0x${"a".repeat(40)}`,
    token0Symbol: "AAA",
    token1Address: `0x${digit.repeat(40)}`,
    token1Symbol: "BBB",
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: feesUsd,
    ...overrides,
  };
}

const rows = [
  row("1", "100"),
  row("2", "90", { token0Address: blockedToken }),
  row("3", "80"),
  row("4", "70"),
];

function snapshot(): MarketPoolSnapshot {
  return {
    canonicalRevision: "canonical:v1:1",
    chainId: 56,
    generatedAt: "2026-08-17T02:00:01.000Z",
    metricVersion: "market-metrics/v1",
    minutes: 5,
    rows: structuredClone(rows),
    version: "1",
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

class FixedBlocklistStore implements PoolBlocklistStore {
  users: string[] = [];

  async get(userId: string): Promise<PoolBlocklistSnapshot> {
    this.users.push(userId);
    return structuredClone(blocklist);
  }

  async mutate(): Promise<never> {
    throw new Error("not used");
  }
}

class EligibilityFixtureProvider implements MarketPoolsProvider {
  byTokenContexts: MarketPoolsByTokenContext[] = [];
  snapshotContexts: MarketPoolsContext[] = [];
  streamContexts: MarketPoolsStreamContext[] = [];

  async getByToken(context: MarketPoolsByTokenContext): Promise<MarketPoolByTokenRow[]> {
    this.byTokenContexts.push(context);
    const candidates = context.eligibility?.filter(rows).candidates ?? rows;
    return candidates.slice(0, context.limit).map(
      (candidate) =>
        ({
          ...candidate,
          fees1h: candidate.feesUsd,
          fees5m: candidate.feesUsd,
          transactionCount1h: null,
          transactionCount5m: null,
          volume1h: candidate.volumeUsd,
          volume5m: candidate.volumeUsd,
        }) as MarketPoolByTokenRow,
    );
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.snapshotContexts.push(context);
    return snapshot();
  }

  async *subscribe(context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope> {
    this.streamContexts.push(context);
    yield {
      cursor: "market:v1:top-fees:56:5:1:1:fixture",
      data: snapshot(),
      emittedAt: "2026-08-17T02:00:01.000Z",
      epoch: "1",
      eventType: "pools.snapshot",
      mode: "snapshot",
      schemaVersion: "1.0.0",
      sequence: "1",
      streamKey: "top-fees:56:5",
    };
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P02-11 authenticated eligibility API consumers", () => {
  it("filters top-fees, by-token backfill, and SSE snapshots for the session user", async () => {
    const sessionStore = new SessionFixtureStore();
    const userId = "29000000-0000-4000-8000-000000000011";
    const token = await issueFixtureSession(sessionStore, userId);
    const provider = new EligibilityFixtureProvider();
    const store = new FixedBlocklistStore();
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      marketPoolsProvider: provider,
      now: () => new Date("2026-08-14T02:00:00.000Z"),
      poolBlocklistStore: store,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore,
    });
    apps.push(app);
    const headers = { cookie: `lpbot_session=${token}` };

    const top = await app.inject({
      headers,
      method: "GET",
      url: "/api/pools/top-fees/5?chainId=56",
    });
    expect(top.json().data.rows.map(({ poolKey }: MarketPoolRow) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
    expect(provider.snapshotContexts[0]?.eligibility?.blocklistHash).toBe(blocklist.blocklistHash);

    const byToken = await app.inject({
      headers,
      method: "GET",
      url: `/api/pools/by-token/0x${"a".repeat(40)}?chain=bsc&dex=pcsv3&limit=2&sort=fees`,
    });
    expect(byToken.json().data.map(({ poolKey }: MarketPoolRow) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
    expect(provider.byTokenContexts[0]?.limit).toBe(2);

    const stream = await app.inject({
      headers: { ...headers, accept: "text/event-stream" },
      method: "GET",
      url: "/api/pools/top-fees/5/stream?chainId=56",
    });
    const data = stream.body
      .split("\n")
      .find((line) => line.startsWith("data: "))!
      .slice(6);
    const event = JSON.parse(data) as MarketStreamEnvelope;
    expect((event.data as MarketPoolSnapshot).rows.map(({ poolKey }) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
    expect(provider.streamContexts[0]?.eligibility?.blocklistHash).toBe(blocklist.blocklistHash);
    expect(store.users).toEqual([userId, userId, userId]);
  });
});
