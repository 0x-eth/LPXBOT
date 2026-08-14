import type { ShellStatsEvent, ShellStatsSnapshot } from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type { ShellStatsProvider } from "../apps/api/src/shell-stats.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userId = "27000000-0000-4000-8000-000000000001";
const observedAt = "2026-08-14T09:15:00.000Z";
const snapshot: ShellStatsSnapshot = {
  observedAt,
  sequence: 40,
  stats: {
    fps: 60,
    gas: { baseGwei: 0.006, ethereumGwei: 0.232 },
    online: true,
    pingMs: 84,
    recommendedPools: ["USDT / utility", "WBNB / TUT"],
    taskCounts: { paused: 1, running: 1, stopped: 1 },
  },
};

class FiniteStatsProvider implements ShellStatsProvider {
  getCalls: string[] = [];
  subscriptions: Array<{ afterSequence: number; userId: string }> = [];

  async getSnapshot(context: { userId: string }): Promise<ShellStatsSnapshot> {
    this.getCalls.push(context.userId);
    return structuredClone(snapshot);
  }

  async *subscribe(context: {
    afterSequence: number;
    signal: AbortSignal;
    userId: string;
  }): AsyncIterable<ShellStatsEvent> {
    this.subscriptions.push({ afterSequence: context.afterSequence, userId: context.userId });
    yield {
      observedAt,
      sequence: 41,
      stats: { pingMs: 85, taskCounts: { paused: 1, running: 2, stopped: 1 } },
      type: "update",
    };
    yield {
      observedAt,
      sequence: 41,
      stats: { pingMs: 999 },
      type: "update",
    };
    yield {
      observedAt,
      recommendedPools: ["USDT / WBNB"],
      sequence: 42,
      type: "rec_pools_snapshot",
    };
    yield { observedAt, sequence: 43, type: "heartbeat" };
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, userId);
  const statsProvider = new FiniteStatsProvider();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => new Date("2026-08-14T02:00:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    statsProvider,
  });
  apps.push(app);
  return { app, statsProvider, token };
}

function parseSse(body: string): Array<{ event: string; id: number; payload: ShellStatsEvent }> {
  return body
    .trim()
    .split("\n\n")
    .filter((block) => block.includes("event:"))
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines
          .find((line) => line.startsWith("event:"))!
          .slice(6)
          .trim(),
        id: Number(
          lines
            .find((line) => line.startsWith("id:"))!
            .slice(3)
            .trim(),
        ),
        payload: JSON.parse(
          lines
            .find((line) => line.startsWith("data:"))!
            .slice(5)
            .trim(),
        ) as ShellStatsEvent,
      };
    });
}

describe("P01-06 shell stats API and authenticated SSE", () => {
  it("returns an authenticated no-store snapshot without manufacturing missing values", async () => {
    const { app, statsProvider, token } = await fixture();
    const anonymous = await app.inject({ method: "GET", url: "/api/stats" });
    expect(anonymous.statusCode).toBe(401);
    expect(statsProvider.getCalls).toEqual([]);

    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/stats",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toEqual(snapshot);
    expect(statsProvider.getCalls).toEqual([userId]);
  });

  it("streams snapshot, ordered updates, recommendation snapshots and heartbeats", async () => {
    const { app, statsProvider, token } = await fixture();
    const response = await app.inject({
      headers: {
        accept: "text/event-stream",
        cookie: `lpbot_session=${token}`,
      },
      method: "GET",
      url: "/api/stats/stream",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    const events = parseSse(response.body);
    expect(events.map(({ event, id }) => [event, id])).toEqual([
      ["snapshot", 40],
      ["update", 41],
      ["rec_pools_snapshot", 42],
      ["heartbeat", 43],
    ]);
    expect(events[0]!.payload).toEqual({ ...snapshot, type: "snapshot" });
    expect(events[1]!.payload).toMatchObject({ stats: { pingMs: 85 }, type: "update" });
    expect(response.body).not.toContain("999");
    expect(statsProvider.subscriptions).toEqual([{ afterSequence: 40, userId }]);
  });

  it("rejects anonymous SSE before opening a provider subscription", async () => {
    const { app, statsProvider } = await fixture();
    const response = await app.inject({
      headers: { accept: "text/event-stream" },
      method: "GET",
      url: "/api/stats/stream",
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).not.toContain("text/event-stream");
    expect(statsProvider.subscriptions).toEqual([]);
  });
});
