import type {
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  ShellStatsEvent,
  ShellStatsSnapshot,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsContext,
  MarketPoolsProvider,
} from "../apps/api/src/market-pools.js";
import type { ShellStatsProvider } from "../apps/api/src/shell-stats.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userId = "27000000-0000-4000-8000-000000000009";
const apps: Array<{ close(): Promise<void> }> = [];

function emptySnapshot(version = "7"): MarketPoolSnapshot {
  return {
    canonicalRevision: `canonical:v1:${version}`,
    chainId: 56,
    generatedAt: "2026-08-17T02:00:00.000Z",
    metricVersion: "market-metrics/v1",
    minutes: 5,
    rows: [],
    version,
    windowEnd: "2026-08-17T01:55:00.000Z",
    windowStart: "2026-08-17T01:50:00.000Z",
  };
}

function populatedSnapshot(version: string, feesUsd: string): MarketPoolSnapshot {
  const poolAddress = `0x${"1".repeat(40)}` as const;
  return {
    ...emptySnapshot(version),
    canonicalRevision: `canonical:reorg:${version}`,
    rows: [
      {
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
        token0Symbol: "WBNB",
        token1Address: `0x${"b".repeat(40)}`,
        token1Symbol: "USDT",
        transactionCount: null,
        tvlUsd: null,
        volumeUsd: null,
      },
    ],
  };
}

class EmptyMarketProvider implements MarketPoolsProvider {
  contexts: MarketPoolsContext[] = [];
  current = emptySnapshot();

  async getByToken(): Promise<[]> {
    return [];
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.contexts.push(context);
    return structuredClone(this.current);
  }

  async *subscribe(): AsyncIterable<MarketStreamEnvelope> {}
}

class ReplacingMarketProvider extends EmptyMarketProvider {
  override async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    const snapshot =
      this.contexts.length === 0 ? populatedSnapshot("7", "12.5") : populatedSnapshot("8", "9.25");
    this.contexts.push(context);
    return snapshot;
  }
}

class FailingMarketProvider extends EmptyMarketProvider {
  override async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.contexts.push(context);
    throw new Error("fixture database detail must not escape");
  }
}

class BlockingMarketProvider extends EmptyMarketProvider {
  aborted = false;

  override async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.contexts.push(context);
    if (this.contexts.length === 1) return populatedSnapshot("7", "12.5");
    return new Promise((_resolve, reject) => {
      context.signal?.addEventListener(
        "abort",
        () => {
          this.aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
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
        taskCounts: { paused: null, running: null, stopped: null },
      },
    };
  }

  async *subscribe(): AsyncIterable<ShellStatsEvent> {}
}

async function fixture(
  options: {
    admin?: boolean;
    heartbeatMilliseconds?: number;
    marketPoolsProvider?: MarketPoolsProvider;
    pollMilliseconds?: number;
    rateLimitMax?: number;
    statsProvider?: ShellStatsProvider;
  } = {},
) {
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
    ...(options.heartbeatMilliseconds === undefined
      ? {}
      : { statsHeartbeatMilliseconds: options.heartbeatMilliseconds }),
    ...(options.marketPoolsProvider ? { marketPoolsProvider: options.marketPoolsProvider } : {}),
    ...(options.pollMilliseconds === undefined
      ? {}
      : { recommendedPoolsPollMilliseconds: options.pollMilliseconds }),
    ...(options.rateLimitMax === undefined
      ? {}
      : { statsRateLimit: { max: options.rateLimitMax, timeWindowMs: 60_000 } }),
    ...(options.statsProvider ? { statsProvider: options.statsProvider } : {}),
  });
  apps.push(app);
  return { app, token };
}

interface SseFrame {
  event: string;
  id: string | null;
  payload: Record<string, unknown>;
}

function parseFrame(block: string): SseFrame | null {
  const lines = block.split("\n");
  const event = lines
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = lines
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim();
  if (!event || !data) return null;
  return {
    event,
    id:
      lines
        .find((line) => line.startsWith("id:"))
        ?.slice(3)
        .trim() ?? null,
    payload: JSON.parse(data) as Record<string, unknown>,
  };
}

async function readSseFrames(
  response: Response,
  count: number,
  controller: AbortController,
  close = true,
): Promise<SseFrame[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buffer = "";
  try {
    while (frames.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame) frames.push(frame);
        if (frames.length === count) break;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    if (close) {
      controller.abort();
      await reader.cancel().catch(() => undefined);
    } else {
      reader.releaseLock();
    }
  }
  return frames;
}

async function openSse(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  token: string,
  path: string,
  controller: AbortController,
  lastEventId?: string,
): Promise<Response> {
  const listeningAddress = app.server.address();
  const origin =
    listeningAddress && typeof listeningAddress !== "string"
      ? `http://127.0.0.1:${listeningAddress.port}`
      : await app.listen({ host: "127.0.0.1", port: 0 });
  return fetch(`${origin}${path}`, {
    headers: {
      Accept: "text/event-stream",
      Cookie: `lpbot_session=${token}`,
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
    },
    signal: controller.signal,
  });
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

  it("returns a safe 503 envelope when the initial canonical read fails", async () => {
    const marketPoolsProvider = new FailingMarketProvider();
    const { app, token } = await fixture({ marketPoolsProvider });
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats/stream?chain=bsc&limit=3",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        code: "RECOMMENDATIONS_UNAVAILABLE",
        message: "Recommended pool data is temporarily unavailable",
        retryable: true,
      },
      success: false,
    });
    expect(response.body).not.toContain("fixture database detail");
    expect(marketPoolsProvider.contexts).toHaveLength(1);
  });

  it("streams an immediate empty recommendation and heartbeat without a stats provider", async () => {
    const marketPoolsProvider = new EmptyMarketProvider();
    const { app, token } = await fixture({
      heartbeatMilliseconds: 20,
      marketPoolsProvider,
      pollMilliseconds: 100,
    });
    const controller = new AbortController();
    const response = await openSse(app, token, "/api/stats/stream?chain=bsc&limit=3", controller);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const frames = await readSseFrames(response, 2, controller);

    expect(frames.map(({ event }) => event)).toEqual(["rec_pools_snapshot", "heartbeat"]);
    expect(frames[0]).toMatchObject({
      id: expect.stringMatching(/^rec-pools:v1:bsc:3:/u),
      payload: {
        pools: [],
        sourceVersion: "7",
        sourceWindow: 5,
        sourceWindowEnd: "2026-08-17T01:55:00.000Z",
        type: "rec_pools_snapshot",
      },
    });
    expect(frames[1]?.id).toBeNull();
    await vi.waitFor(() => expect(marketPoolsProvider.contexts[0]?.signal?.aborted).toBe(true));
  });

  it("accepts a matching Last-Event-ID and rejects malformed or cross-limit cursors", async () => {
    const marketPoolsProvider = new EmptyMarketProvider();
    const { app, token } = await fixture({ marketPoolsProvider, pollMilliseconds: 100 });
    const firstController = new AbortController();
    const first = await openSse(app, token, "/api/stats/stream?chain=bsc&limit=3", firstController);
    const [initial] = await readSseFrames(first, 1, firstController);
    const cursor = initial!.id!;

    const reconnectController = new AbortController();
    const reconnect = await openSse(
      app,
      token,
      "/api/stats/stream?chain=bsc&limit=3",
      reconnectController,
      cursor,
    );
    expect((await readSseFrames(reconnect, 1, reconnectController))[0]?.id).toBe(cursor);

    for (const [lastEventId, limit] of [
      ["bad-cursor", 3],
      [cursor, 4],
    ] as const) {
      const invalid = await app.inject({
        headers: {
          cookie: `lpbot_session=${token}`,
          "last-event-id": lastEventId,
        },
        method: "GET",
        url: `/api/stats/stream?chain=bsc&limit=${limit}`,
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe("STATS_STREAM_CURSOR_INVALID");
    }
  });

  it("passes an admin user filter only to stats and rate limits the read stream", async () => {
    const statsProvider = new FiniteStatsProvider();
    const { app, token } = await fixture({ admin: true, rateLimitMax: 2, statsProvider });
    const filtered = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats/stream?user_id=target-user&limit=3",
    });
    expect(filtered.statusCode).toBe(200);
    expect(statsProvider.contexts).toEqual(["target-user"]);

    await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats/stream",
    });
    const limited = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats/stream",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
  });

  it("emits a reorg replacement when the ordered wire payload changes", async () => {
    const marketPoolsProvider = new ReplacingMarketProvider();
    const { app, token } = await fixture({
      heartbeatMilliseconds: 1_000,
      marketPoolsProvider,
      pollMilliseconds: 10,
    });
    const controller = new AbortController();
    const response = await openSse(app, token, "/api/stats/stream?chain=bsc", controller);
    const frames = await readSseFrames(response, 2, controller);

    expect(frames.map(({ event }) => event)).toEqual(["rec_pools_snapshot", "rec_pools_snapshot"]);
    expect(frames.map(({ payload }) => payload.sourceVersion)).toEqual(["7", "8"]);
    expect(frames[0]?.payload.selectionHash).not.toBe(frames[1]?.payload.selectionHash);
    expect(frames[1]?.payload.pools).toEqual([expect.objectContaining({ feesUsd: "9.25" })]);
  });

  it("aborts an in-flight canonical snapshot read when the client disconnects", async () => {
    const marketPoolsProvider = new BlockingMarketProvider();
    const { app, token } = await fixture({ marketPoolsProvider, pollMilliseconds: 10 });
    const controller = new AbortController();
    const response = await openSse(app, token, "/api/stats/stream?chain=bsc", controller);
    await readSseFrames(response, 1, controller, false);
    await vi.waitFor(() => expect(marketPoolsProvider.contexts).toHaveLength(2));

    controller.abort();
    await vi.waitFor(() => expect(marketPoolsProvider.aborted).toBe(true));
    expect(marketPoolsProvider.contexts[1]?.signal?.aborted).toBe(true);
  });
});
