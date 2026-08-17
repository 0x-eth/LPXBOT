import { buildApiApp } from "../apps/api/src/app.js";
import { MemoryNotificationHistoryStore } from "../apps/api/src/notification-history.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "38000000-0000-4000-8000-000000000001";
const userB = "38000000-0000-4000-8000-000000000002";
const monitorA = "38000000-0000-4000-8000-000000000011";
const monitorB = "38000000-0000-4000-8000-000000000012";
const now = new Date("2026-08-18T00:05:00.000Z");

function record(
  deliveryId: string,
  createdAt: string,
  status: "pending" | "sending" | "retrying" | "delivered" | "failed",
  overrides: Record<string, unknown> = {},
) {
  return {
    attemptCount: status === "pending" ? 0 : 1,
    conditionSummary: "volumeUsd gte 1000",
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
    deliveryId,
    destination: {
      destinationId: "38000000-0000-4000-8000-000000000021",
      name: "Operations webhook",
      type: "webhook" as const,
    },
    errorCode: status === "failed" ? "HTTP_400" : null,
    monitorId: monitorA,
    monitorName: "Volume watch",
    nextRetryAt: status === "retrying" ? "2026-08-18T00:10:00.000Z" : null,
    poolKey: `56:0x${"a".repeat(40)}`,
    status,
    updatedAt: createdAt,
    userId: userA,
    windowEnd: "2026-08-18T00:00:00.000Z",
    windowMinutes: 5,
    ...overrides,
  };
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const history = new MemoryNotificationHistoryStore([
    record("38000000-0000-4000-8000-000000000103", "2026-08-18T00:03:00.000Z", "failed"),
    record("38000000-0000-4000-8000-000000000102", "2026-08-18T00:02:00.000Z", "retrying"),
    record("38000000-0000-4000-8000-000000000101", "2026-08-18T00:02:00.000Z", "sending"),
    record("38000000-0000-4000-8000-000000000100", "2026-08-18T00:01:00.000Z", "pending", {
      monitorId: monitorB,
      monitorName: "Fees watch",
    }),
    record("38000000-0000-4000-8000-000000000199", "2026-08-18T00:04:00.000Z", "delivered", {
      userId: userB,
    }),
  ]);
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    notificationHistoryStore: history,
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P03-04 notification history API", () => {
  it("requires a session, isolates the current user, and paginates by createdAt plus deliveryId", async () => {
    const { app, tokenA, tokenB } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/notifications/history" })).statusCode).toBe(
      401,
    );

    const first = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/notifications/history?limit=2",
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json().data.items.map(({ deliveryId }: { deliveryId: string }) => deliveryId)).toEqual([
      "38000000-0000-4000-8000-000000000103",
      "38000000-0000-4000-8000-000000000102",
    ]);
    expect(first.json().data.nextCursor).toEqual(expect.any(String));

    const second = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/notifications/history?limit=2&cursor=${encodeURIComponent(first.json().data.nextCursor)}`,
    });
    expect(second.json().data.items.map(({ deliveryId }: { deliveryId: string }) => deliveryId)).toEqual([
      "38000000-0000-4000-8000-000000000101",
      "38000000-0000-4000-8000-000000000100",
    ]);
    expect(second.json().data.nextCursor).toBeNull();

    const otherUser = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/notifications/history",
    });
    expect(otherUser.json().data.items).toHaveLength(1);
    expect(otherUser.json().data.items[0].deliveryId).toBe(
      "38000000-0000-4000-8000-000000000199",
    );
  });

  it("combines monitor, public status, and inclusive time filters", async () => {
    const { app, tokenA } = await fixture();
    const response = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url:
        `/api/notifications/history?monitorId=${monitorA}` +
        "&deliveryStatus=retrying&from=2026-08-18T00%3A02%3A00.000Z&to=2026-08-18T00%3A02%3A00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [
        {
          deliveryId: "38000000-0000-4000-8000-000000000102",
          monitorId: monitorA,
          status: "retrying",
        },
      ],
      nextCursor: null,
    });
  });

  it("rejects malformed filters and returns only the public field whitelist", async () => {
    const { app, tokenA } = await fixture();
    for (const query of [
      "limit=0",
      "deliveryStatus=dead",
      "cursor=not-a-cursor",
      "monitorId=not-a-uuid",
      "from=not-a-time",
      "from=2026-08-19T00%3A00%3A00Z&to=2026-08-18T00%3A00%3A00Z",
      "unknown=true",
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "GET",
        url: `/api/notifications/history?${query}`,
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error.code, query).toBe("INVALID_NOTIFICATION_HISTORY_QUERY");
    }

    const response = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/notifications/history?limit=1",
    });
    expect(Object.keys(response.json().data.items[0]).sort()).toEqual(
      [
        "attemptCount",
        "conditionSummary",
        "createdAt",
        "deliveredAt",
        "deliveryId",
        "destination",
        "errorCode",
        "monitorId",
        "monitorName",
        "nextRetryAt",
        "poolKey",
        "status",
        "updatedAt",
        "windowEnd",
        "windowMinutes",
      ].sort(),
    );
    const serialized = response.body.toLowerCase();
    for (const forbidden of [
      "secretref",
      "requestbody",
      "queryvalue",
      "responsebody",
      "errorsummary",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
