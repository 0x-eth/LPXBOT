import type { ShellStatsEvent, ShellStatsSnapshot } from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  ShellStatsAdminQueryAudit,
  ShellStatsContext,
  ShellStatsProvider,
  ShellStatsScope,
} from "../apps/api/src/shell-stats.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userId = "27000000-0000-4000-8000-000000000001";
const targetUserId = "27000000-0000-4000-8000-000000000002";
const targetTelegramId = "8801302";
const observedAt = "2026-08-14T09:15:00.000Z";
const snapshot: ShellStatsSnapshot = {
  observedAt,
  sequence: 40,
  stats: {
    fps: 60,
    gas: { baseGwei: 0.006, ethereumGwei: 0.232 },
    online: true,
    pingMs: 84,
    taskCounts: { paused: 1, running: 1, stopped: 1 },
  },
};

class FiniteStatsProvider implements ShellStatsProvider {
  audits: ShellStatsAdminQueryAudit[] = [];
  getCalls: ShellStatsScope[] = [];
  subscriptions: Array<{ afterSequence: number; scope: ShellStatsScope }> = [];

  async getSnapshot(context: ShellStatsContext): Promise<ShellStatsSnapshot> {
    this.getCalls.push(context.scope);
    if (context.scope.type === "global") {
      return {
        ...structuredClone(snapshot),
        sequence: 50,
        stats: {
          ...structuredClone(snapshot.stats),
          taskCounts: { paused: 4, running: 9, stopped: 2 },
        },
      };
    }
    if (context.scope.userId === targetUserId) {
      return {
        ...structuredClone(snapshot),
        sequence: 45,
        stats: {
          ...structuredClone(snapshot.stats),
          taskCounts: { paused: 2, running: 8, stopped: 1 },
        },
      };
    }
    return structuredClone(snapshot);
  }

  async *subscribe(context: {
    afterSequence: number;
    scope: ShellStatsScope;
    signal: AbortSignal;
  }): AsyncIterable<ShellStatsEvent> {
    this.subscriptions.push({ afterSequence: context.afterSequence, scope: context.scope });
    yield {
      observedAt,
      sequence: context.afterSequence + 1,
      stats: { pingMs: 85, taskCounts: { paused: 1, running: 2, stopped: 1 } },
      type: "update",
    };
    yield {
      observedAt,
      sequence: context.afterSequence + 1,
      stats: { pingMs: 999 },
      type: "update",
    };
    yield { observedAt, sequence: null, type: "heartbeat" };
  }

  async resolveTelegramUserId(telegramUserId: string): Promise<string | null> {
    return telegramUserId === targetTelegramId ? targetUserId : null;
  }

  async recordAdminQueryAudit(audit: ShellStatsAdminQueryAudit): Promise<void> {
    this.audits.push(audit);
  }
}

class FailingStatsProvider extends FiniteStatsProvider {
  override async getSnapshot(): Promise<ShellStatsSnapshot> {
    throw new Error("fixture database password must not escape");
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(options: { admin?: boolean; provider?: FiniteStatsProvider } = {}) {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, userId);
  if (options.admin) {
    for (const session of sessionStore.sessions.values()) session.account.role = "admin";
  }
  const statsProvider = options.provider ?? new FiniteStatsProvider();
  const logLines: string[] = [];
  const app = buildApiApp({
    logger: { write: (line) => logLines.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    now: () => new Date("2026-08-14T02:00:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    statsProvider,
  });
  apps.push(app);
  return { app, logLines, statsProvider, token };
}

function parseSse(
  body: string,
): Array<{ event: string; id: number | null; payload: ShellStatsEvent }> {
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
        id: lines.some((line) => line.startsWith("id:"))
          ? Number(
              lines
                .find((line) => line.startsWith("id:"))!
                .slice(3)
                .trim(),
            )
          : null,
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
    expect(statsProvider.getCalls).toEqual([{ type: "user", userId }]);
  });

  it("streams snapshot, ordered updates and heartbeats without recommendations when chain is omitted", async () => {
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
      ["heartbeat", null],
    ]);
    expect(events[0]!.payload).toEqual({ ...snapshot, type: "snapshot" });
    expect(events[1]!.payload).toMatchObject({ stats: { pingMs: 85 }, type: "update" });
    expect(response.body).not.toContain("999");
    expect(response.body).not.toContain("rec_pools_snapshot");
    expect(statsProvider.subscriptions).toEqual([
      { afterSequence: 40, scope: { type: "user", userId } },
    ]);
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

  it("enforces personal, administrator global and Telegram-filtered scopes for GET", async () => {
    const personal = await fixture();
    const personalResponse = await personal.app.inject({
      headers: { cookie: `lpbot_session=${personal.token}` },
      method: "GET",
      url: "/api/stats",
    });
    expect(personalResponse.json().data.stats.taskCounts).toEqual({
      paused: 1,
      running: 1,
      stopped: 1,
    });

    const admin = await fixture({ admin: true });
    const globalResponse = await admin.app.inject({
      headers: { cookie: `lpbot_session=${admin.token}` },
      method: "GET",
      url: "/api/stats",
    });
    expect(globalResponse.json().data.stats.taskCounts).toEqual({
      paused: 4,
      running: 9,
      stopped: 2,
    });
    const targetResponse = await admin.app.inject({
      headers: { cookie: `lpbot_session=${admin.token}` },
      method: "GET",
      url: `/api/stats?user_id=${targetTelegramId}`,
    });
    expect(targetResponse.json().data.stats.taskCounts).toEqual({
      paused: 2,
      running: 8,
      stopped: 1,
    });
    expect(admin.statsProvider.getCalls).toEqual([
      { type: "global" },
      { type: "user", userId: targetUserId },
    ]);
  });

  it("rejects non-admin filters and unknown Telegram IDs before SSE hijack", async () => {
    const personal = await fixture();
    const forbidden = await personal.app.inject({
      headers: { cookie: `lpbot_session=${personal.token}` },
      method: "GET",
      url: `/api/stats/stream?user_id=${targetTelegramId}`,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers["content-type"]).not.toContain("text/event-stream");
    expect(personal.statsProvider.getCalls).toEqual([]);

    const admin = await fixture({ admin: true });
    const missing = await admin.app.inject({
      headers: { cookie: `lpbot_session=${admin.token}` },
      method: "GET",
      url: "/api/stats/stream?user_id=999999999999",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("STATS_USER_NOT_FOUND");
    expect(missing.headers["content-type"]).not.toContain("text/event-stream");
    expect(admin.statsProvider.getCalls).toEqual([]);
  });

  it("streams the resolved target scope and records only a credential-free admin summary", async () => {
    const { app, logLines, statsProvider, token } = await fixture({ admin: true });
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: `/api/stats/stream?user_id=${targetTelegramId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(parseSse(response.body)[0]?.payload).toMatchObject({
      sequence: 45,
      stats: { taskCounts: { paused: 2, running: 8, stopped: 1 } },
      type: "snapshot",
    });
    expect(statsProvider.subscriptions).toContainEqual({
      afterSequence: 45,
      scope: { type: "user", userId: targetUserId },
    });
    expect(statsProvider.audits).toHaveLength(1);
    expect(statsProvider.audits[0]).toMatchObject({
      actorUserId: userId,
      outcome: "allowed",
      targetTelegramUserId: targetTelegramId,
      targetUserId,
      transport: "sse",
    });
    const auditText = JSON.stringify(statsProvider.audits) + logLines.join("\n");
    expect(auditText).not.toContain(token);
    expect(auditText).not.toMatch(/cookie|authorization|session/iu);
  });

  it("maps unready or corrupt provider reads to retryable 503 before SSE hijack", async () => {
    const provider = new FailingStatsProvider();
    const { app, token } = await fixture({ provider });
    for (const url of ["/api/stats", "/api/stats/stream"]) {
      const response = await app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "GET",
        url,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: { code: "STATS_UNAVAILABLE", retryable: true },
        success: false,
      });
      expect(response.body).not.toContain("fixture database password");
      expect(response.headers["content-type"]).not.toContain("text/event-stream");
    }
  });
});
