import type {
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  ShellStatsEvent,
  ShellStatsSnapshot,
} from "@lpbot/api-contract";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsByTokenContext,
  MarketPoolsContext,
  MarketPoolsProvider,
  MarketPoolsStreamContext,
} from "../apps/api/src/market-pools.js";
import type { ShellStatsProvider } from "../apps/api/src/shell-stats.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userId = "27000000-0000-4000-8000-000000000009";
const apps: Array<{ close(): Promise<void> }> = [];

class EmptyMarketProvider implements MarketPoolsProvider {
  contexts: MarketPoolsContext[] = [];

  async getByToken(_context: MarketPoolsByTokenContext): Promise<[]> {
    return [];
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.contexts.push(context);
    return {
      canonicalRevision: "canonical:v1:empty",
      chainId: 56,
      generatedAt: "2026-08-17T02:00:00.000Z",
      metricVersion: "market-metrics/v1",
      minutes: 5,
      rows: [],
      version: "7",
      windowEnd: "2026-08-17T01:55:00.000Z",
      windowStart: "2026-08-17T01:50:00.000Z",
    };
  }

  async *subscribe(_context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope> {}
}

class FiniteStatsProvider implements ShellStatsProvider {
  contexts: string[] = [];

  async getSnapshot(context: { userId: string }): Promise<ShellStatsSnapshot> {
    this.contexts.push(context.userId);
    return {
      observedAt: "2026-08-17T02:00:00.000Z",
      sequence: 1,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        recommendedPools: null,
        taskCounts: { paused: null, running: null, stopped: null },
      },
    };
  }

  async *subscribe(): AsyncIterable<ShellStatsEvent> {}
}

async function fixture(options: {
  admin?: boolean;
  marketPoolsProvider?: MarketPoolsProvider;
  statsProvider?: ShellStatsProvider;
} = {}) {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(
    sessionStore,
    userId,
    new Date("2026-08-17T02:00:00.000Z"),
  );
  if (options.admin) {
    for (const session of sessionStore.sessions.values()) session.account.role = "admin";
  }
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    ...(options.marketPoolsProvider ? { marketPoolsProvider: options.marketPoolsProvider } : {}),
    ...(options.statsProvider ? { statsProvider: options.statsProvider } : {}),
  });
  apps.push(app);
  return { app, token };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P02-09 recommendation stream HTTP boundary", () => {
  it.each([
    "?chain=eth",
    "?chain=base",
    "?chain=bsc,eth",
    "?chain=BSC",
    "?chain=bsc&limit=0",
    "?chain=bsc&limit=21",
    "?chain=bsc&limit=1.0",
    "?chain=bsc&extra=true",
  ])("rejects an unsupported chain, limit, or unknown filter: %s", async (query) => {
    const { app, token } = await fixture({ statsProvider: new FiniteStatsProvider() });
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: `/api/stats/stream${query}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("STATS_STREAM_QUERY_INVALID");
  });

  it("keeps an omitted chain stats-only and does not read the recommendation provider", async () => {
    const marketPoolsProvider = new EmptyMarketProvider();
    const statsProvider = new FiniteStatsProvider();
    const { app, token } = await fixture({ marketPoolsProvider, statsProvider });
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats/stream?limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("event: snapshot");
    expect(response.body).not.toContain("rec_pools_snapshot");
    expect(marketPoolsProvider.contexts).toEqual([]);
  });

  it("returns safe provider errors and rejects a non-admin user filter", async () => {
    const statsProvider = new FiniteStatsProvider();
    const { app, token } = await fixture({ statsProvider });
    const headers = { cookie: `lpbot_session=${token}` };

    const missing = await app.inject({
      headers,
      method: "GET",
      url: "/api/stats/stream?chain=bsc",
    });
    expect(missing.statusCode).toBe(503);
    expect(missing.json().error.code).toBe("RECOMMENDATIONS_UNAVAILABLE");

    const forbidden = await app.inject({
      headers,
      method: "GET",
      url: "/api/stats/stream?user_id=someone-else",
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");
    expect(statsProvider.contexts).toEqual([]);
  });
});
