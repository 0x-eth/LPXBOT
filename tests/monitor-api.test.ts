import type { CreateMonitorRequest, PoolBlocklistSnapshot } from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import { MemoryMonitorStore } from "../apps/api/src/monitors.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "30000000-0000-4000-8000-000000000001";
const userB = "30000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-17T10:00:00.000Z");
const poolKey = `56:0x${"a".repeat(40)}` as const;
const secondPoolKey = `56:0x${"b".repeat(40)}` as const;

const createRequest: CreateMonitorRequest = {
  conditions: [
    { enabled: true, id: "volumeUsd", operator: "gte", value: "1000" },
    { enabled: true, id: "metricVersion", operator: "eq", value: "market-metrics/v1" },
  ],
  excludeHanToken: true,
  excludeHook: true,
  name: "BSC volume",
  poolKey,
  windowMinutes: 5,
};

const emptyBlocklist: PoolBlocklistSnapshot = {
  blocklistHash: `sha256:${"0".repeat(64)}`,
  entries: [],
  revision: 0,
  schemaVersion: 1,
  updatedAt: null,
};

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(blocklist: PoolBlocklistSnapshot = emptyBlocklist) {
  const sessionStore = new SessionFixtureStore();
  const monitorStore = new MemoryMonitorStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    monitorStore,
    now: () => now,
    poolBlocklistStore: {
      get: async () => structuredClone(blocklist),
      mutate: async () => {
        throw new Error("not used");
      },
    },
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, monitorStore, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

async function create(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  token: string,
  payload: object = createRequest,
  idempotencyKey = "monitor-create-001",
) {
  return app.inject({
    headers: { ...auth(token), "idempotency-key": idempotencyKey },
    method: "POST",
    payload,
    url: "/api/monitors",
  });
}

describe("P03-02 monitor API", () => {
  it("requires a session, creates disabled monitors, isolates users, and reports enabled/total", async () => {
    const { app, tokenA, tokenB } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/monitors" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", payload: createRequest, url: "/api/monitors" })).statusCode).toBe(
      401,
    );

    const created = await create(app, tokenA);
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json().data).toMatchObject({
      enabled: false,
      name: "BSC volume",
      poolKey,
      revision: 1,
      userId: userA,
    });
    const monitorId = created.json().data.monitorId as string;

    const [mine, other, crossUser] = await Promise.all([
      app.inject({ headers: auth(tokenA), method: "GET", url: "/api/monitors" }),
      app.inject({ headers: auth(tokenB), method: "GET", url: "/api/monitors" }),
      app.inject({ headers: auth(tokenB), method: "GET", url: `/api/monitors/${monitorId}` }),
    ]);
    expect(mine.json().data).toMatchObject({ enabledCount: 0, totalCount: 1 });
    expect(mine.json().data.items).toHaveLength(1);
    expect(other.json().data).toMatchObject({ enabledCount: 0, items: [], totalCount: 0 });
    expect(crossUser.statusCode).toBe(404);
    expect(crossUser.json().error.code).toBe("MONITOR_NOT_FOUND");
    expect(crossUser.body).not.toContain(userA);
  });

  it("replays equal idempotent creates, rejects changed payloads, and scopes keys by user", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const first = await create(app, tokenA);
    const replay = await create(app, tokenA, structuredClone(createRequest));
    const conflict = await create(app, tokenA, { ...createRequest, name: "Different" });
    const otherUser = await create(app, tokenB);

    expect(replay.statusCode).toBe(201);
    expect(replay.json().data).toEqual(first.json().data);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(otherUser.statusCode).toBe(201);
    expect(otherUser.json().data.monitorId).not.toBe(first.json().data.monitorId);
  });

  it("increments only effective mutations and returns authoritative revision conflicts", async () => {
    const { app, tokenA } = await fixture();
    const monitor = (await create(app, tokenA)).json().data;
    const url = `/api/monitors/${monitor.monitorId}`;

    const noOp = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { name: createRequest.name }, expectedRevision: 1 },
      url,
    });
    expect(noOp.statusCode).toBe(200);
    expect(noOp.json().data.revision).toBe(1);

    const updated = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { name: "Updated" }, expectedRevision: 1 },
      url,
    });
    expect(updated.json().data).toMatchObject({ name: "Updated", revision: 2 });

    const stale = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { name: "Lost update" }, expectedRevision: 1 },
      url,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      current: { name: "Updated", revision: 2 },
      error: { code: "REVISION_CONFLICT" },
      success: false,
    });

    const enabled = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { expectedRevision: 2 },
      url: `${url}/enable`,
    });
    expect(enabled.json().data).toMatchObject({ enabled: true, revision: 3 });
    const enableNoOp = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { expectedRevision: 3 },
      url: `${url}/enable`,
    });
    expect(enableNoOp.json().data.revision).toBe(3);

    const invalidEnabledPatch = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { windowMinutes: 15 }, expectedRevision: 3 },
      url,
    });
    expect(invalidEnabledPatch.statusCode).toBe(400);
    expect(invalidEnabledPatch.json().error.code).toBe("INVALID_MONITOR");

    const disabled = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { expectedRevision: 3 },
      url: `${url}/disable`,
    });
    expect(disabled.json().data).toMatchObject({ enabled: false, revision: 4 });
    const staleDelete = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      payload: { expectedRevision: 3 },
      url,
    });
    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json().error.code).toBe("REVISION_CONFLICT");
    const deleted = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      payload: { expectedRevision: 4 },
      url,
    });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ headers: auth(tokenA), method: "GET", url })).statusCode).toBe(404);
  });

  it("rejects invalid, unsupported, non-BSC, and no-op-shaped updates", async () => {
    const { app, tokenA } = await fixture();
    for (const payload of [
      { ...createRequest, chainId: 1 },
      { ...createRequest, poolKey: `1:0x${"a".repeat(40)}` },
      { ...createRequest, poolKey: "WBNB/USDT" },
      {
        ...createRequest,
        conditions: [{ enabled: true, id: "activeTvlUsd", operator: "gte", value: "1" }],
      },
    ]) {
      const response = await create(app, tokenA, payload, `invalid-${JSON.stringify(payload)}`);
      expect(response.statusCode).toBe(payload.conditions?.[0]?.id === "activeTvlUsd" ? 422 : 400);
      expect(response.json().error.code).toBe(
        payload.conditions?.[0]?.id === "activeTvlUsd" ? "UNSUPPORTED_METRIC" : "INVALID_MONITOR",
      );
    }

    const monitor = (await create(app, tokenA, createRequest, "valid-monitor")).json().data;
    for (const payload of [
      { changes: {}, expectedRevision: 1 },
      { changes: { poolKey: secondPoolKey }, expectedRevision: 1 },
      { changes: { name: "x" }, expectedRevision: 1, unknown: true },
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "PATCH",
        payload,
        url: `/api/monitors/${monitor.monitorId}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_MONITOR");
    }
  });

  it("enforces pool eligibility and monitor readiness before enable", async () => {
    const blocked = {
      ...emptyBlocklist,
      blocklistHash: `sha256:${"1".repeat(64)}` as const,
      entries: [{ chainId: 56 as const, identity: poolKey, scope: "pool" as const }],
      revision: 1,
      updatedAt: now.toISOString(),
    };
    const blockedFixture = await fixture(blocked);
    const rejected = await create(blockedFixture.app, blockedFixture.tokenA);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("POOL_NOT_ELIGIBLE");

    const readyFixture = await fixture();
    const draft = await create(
      readyFixture.app,
      readyFixture.tokenA,
      {
        ...createRequest,
        conditions: createRequest.conditions.map((condition) => ({ ...condition, enabled: false })),
      },
      "draft-monitor",
    );
    expect(draft.statusCode).toBe(201);
    const enable = await readyFixture.app.inject({
      headers: auth(readyFixture.tokenA),
      method: "POST",
      payload: { expectedRevision: 1 },
      url: `/api/monitors/${draft.json().data.monitorId}/enable`,
    });
    expect(enable.statusCode).toBe(422);
    expect(enable.json().error.code).toBe("MONITOR_NOT_READY");
  });
});
