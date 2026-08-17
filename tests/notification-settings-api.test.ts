import type {
  DestinationDraft,
  NotificationCategory,
  NotificationDestination,
  NotificationPreferences,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import {
  MemoryNotificationConfigurationStore,
  MemoryNotificationSecretStore,
} from "../apps/api/src/notifications.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "33000000-0000-4000-8000-000000000001";
const userB = "33000000-0000-4000-8000-000000000002";
const telegramA = "700000000001";
const telegramB = "700000000002";
const now = new Date("2026-08-18T00:10:00.000Z");
const categories: NotificationCategory[] = [
  "monitor-match",
  "task-created",
  "position-moved",
  "operation-failed",
  "position-closed",
  "feedback-replied",
];

const webhookDraft: DestinationDraft = {
  categories: ["monitor-match"],
  config: {
    method: "POST",
    signingSecret: "fixture-signing-key-material-000001",
    template: { message: "{{condition.summary}}", monitor: "{{monitor.name}}" },
    url: "https://hooks.example.test/lpx",
  },
  enabled: true,
  name: "Operations webhook",
  type: "webhook",
};

const telegramDraft: DestinationDraft = {
  categories: ["monitor-match"],
  config: {
    botToken: "700000000001:fixture-bot-token-material-000001",
    telegramIdentityId: telegramA,
    template: "<b>{{monitor.name}}</b> {{condition.summary}}",
  },
  enabled: true,
  name: "Telegram alerts",
  type: "telegram",
};

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const secrets = new MemoryNotificationSecretStore();
  const notifications = new MemoryNotificationConfigurationStore({
    identities: new Map([
      [userA, telegramA],
      [userB, telegramB],
    ]),
    secrets,
  });
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    notificationStore: notifications,
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, notifications, secrets, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

async function createDestination(
  app: Awaited<ReturnType<typeof fixture>>["app"],
  token: string,
  draft: DestinationDraft = webhookDraft,
  key = "destination-create-001",
) {
  return app.inject({
    headers: { ...auth(token), "idempotency-key": key },
    method: "POST",
    payload: draft,
    url: "/api/notification-destinations",
  });
}

function expectNoCredential(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("fixture-signing-key-material");
  expect(serialized).not.toContain("fixture-bot-token-material");
  expect(serialized).not.toContain("signingSecret");
  expect(serialized).not.toContain("botToken");
}

describe("P03-03 notification preferences API", () => {
  it("exposes only the current user's Telegram destination option", async () => {
    const { app, tokenA, tokenB } = await fixture();

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/notification-destinations/options",
    });
    expect(unauthenticated.statusCode).toBe(401);

    const [optionA, optionB] = await Promise.all(
      [tokenA, tokenB].map((token) =>
        app.inject({
          headers: auth(token),
          method: "GET",
          url: "/api/notification-destinations/options",
        }),
      ),
    );
    if (!optionA || !optionB) throw new Error("Notification option fixture is incomplete");
    expect(optionA.json().data).toEqual({ telegramIdentityId: telegramA });
    expect(optionB.json().data).toEqual({ telegramIdentityId: telegramB });
    expectNoCredential(optionA.json());
    expectNoCredential(optionB.json());
  });

  it("defaults every category off and isolates CAS updates by current user", async () => {
    const { app, tokenA, tokenB } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: "/api/notification-preferences" })).statusCode,
    ).toBe(401);

    const initial = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/notification-preferences",
    });
    const preferences = initial.json().data as NotificationPreferences;
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(preferences).toEqual({
      categories: Object.fromEntries(categories.map((category) => [category, false])),
      revision: 0,
      updatedAt: null,
    });

    const enabled = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { categories: { "monitor-match": true }, expectedRevision: 0 },
      url: "/api/notification-preferences",
    });
    expect(enabled.json().data).toMatchObject({
      categories: { "monitor-match": true, "task-created": false },
      revision: 1,
      updatedAt: now.toISOString(),
    });

    const noOp = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { categories: { "monitor-match": true }, expectedRevision: 1 },
      url: "/api/notification-preferences",
    });
    expect(noOp.json().data.revision).toBe(1);

    const conflict = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { categories: { "monitor-match": false }, expectedRevision: 0 },
      url: "/api/notification-preferences",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      current: { categories: { "monitor-match": true }, revision: 1 },
      error: { code: "REVISION_CONFLICT" },
      success: false,
    });

    const other = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/notification-preferences",
    });
    expect(other.json().data).toMatchObject({
      categories: { "monitor-match": false },
      revision: 0,
    });
  });
});

describe("P03-03 notification destination API", () => {
  it("creates idempotently, isolates users, and never echoes credentials", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const first = await createDestination(app, tokenA);
    const replay = await createDestination(app, tokenA, structuredClone(webhookDraft));
    const conflict = await createDestination(app, tokenA, {
      ...webhookDraft,
      name: "Different payload",
    });
    const otherUser = await createDestination(app, tokenB, webhookDraft);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data).toEqual(first.json().data);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(otherUser.statusCode).toBe(201);
    expect(otherUser.json().data.destinationId).not.toBe(first.json().data.destinationId);
    expect(first.json().data).toMatchObject({
      categories: ["monitor-match"],
      config: {
        method: "POST",
        secretConfigured: true,
        secretRef: expect.stringMatching(/^secret-ref:\/\//u),
        url: "https://hooks.example.test/lpx",
      },
      enabled: true,
      revision: 1,
      type: "webhook",
      userId: userA,
    });
    expectNoCredential(first.json());
    expectNoCredential(replay.json());

    const mine = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/notification-destinations",
    });
    const theirs = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/notification-destinations",
    });
    expect(mine.json().data).toHaveLength(1);
    expect(theirs.json().data).toHaveLength(1);
    expectNoCredential(mine.json());
    expectNoCredential(theirs.json());
  });

  it("uses optimistic revision for no-op, update, delete, and deny-as-not-found", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const created = (await createDestination(app, tokenA)).json().data as NotificationDestination;
    const url = `/api/notification-destinations/${created.destinationId}`;

    for (const method of ["PATCH", "DELETE"] as const) {
      const response = await app.inject({
        headers: auth(tokenB),
        method,
        payload:
          method === "PATCH"
            ? { changes: { name: "Cross-user" }, expectedRevision: 1 }
            : { expectedRevision: 1 },
        url,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("DESTINATION_NOT_FOUND");
      expect(response.body).not.toContain(userA);
    }

    const noOp = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { name: webhookDraft.name }, expectedRevision: 1 },
      url,
    });
    expect(noOp.json().data.revision).toBe(1);

    const updated = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: {
        changes: {
          config: { signingSecret: "replacement-signing-key-material-0002" },
          enabled: false,
        },
        expectedRevision: 1,
      },
      url,
    });
    expect(updated.json().data).toMatchObject({ enabled: false, revision: 2 });
    expect(updated.json().data.config.secretRef).not.toBe(created.config.secretRef);
    expectNoCredential(updated.json());

    const stale = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { name: "Lost update" }, expectedRevision: 1 },
      url,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      current: { enabled: false, revision: 2 },
      error: { code: "REVISION_CONFLICT" },
    });

    const staleDelete = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      payload: { expectedRevision: 1 },
      url,
    });
    expect(staleDelete.statusCode).toBe(409);
    const deleted = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      payload: { expectedRevision: 2 },
      url,
    });
    expect(deleted.statusCode).toBe(204);
    const list = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/notification-destinations",
    });
    expect(list.json().data).toEqual([]);
    const deleteAgain = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      payload: { expectedRevision: 3 },
      url,
    });
    expect(deleteAgain.statusCode).toBe(404);
    expect(deleteAgain.json().error.code).toBe("DESTINATION_NOT_FOUND");
  });

  it("only accepts an owned Telegram identity and keeps the bot token write-only", async () => {
    const { app, tokenA } = await fixture();
    const crossIdentity = await createDestination(
      app,
      tokenA,
      {
        ...telegramDraft,
        config: { ...telegramDraft.config, telegramIdentityId: telegramB },
      },
      "telegram-cross-identity",
    );
    expect(crossIdentity.statusCode).toBe(400);
    expect(crossIdentity.json().error.code).toBe("INVALID_DESTINATION");

    const created = await createDestination(app, tokenA, telegramDraft, "telegram-owned");
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      config: {
        secretConfigured: true,
        telegramIdentityId: telegramA,
        template: telegramDraft.config.template,
      },
      type: "telegram",
    });
    expectNoCredential(created.json());
  });

  it("rejects invalid templates and targets without persisting partial configuration", async () => {
    const { app, notifications, secrets, tokenA } = await fixture();
    for (const [key, draft, code] of [
      [
        "unknown-template",
        {
          ...webhookDraft,
          config: { ...webhookDraft.config, template: { value: "{{internal.secret}}" } },
        },
        "UNKNOWN_TEMPLATE_VARIABLE",
      ],
      [
        "unsafe-target",
        { ...webhookDraft, config: { ...webhookDraft.config, url: "http://127.0.0.1/hook" } },
        "UNSAFE_WEBHOOK_TARGET",
      ],
      [
        "short-secret",
        { ...webhookDraft, config: { ...webhookDraft.config, signingSecret: "short" } },
        "INVALID_DESTINATION",
      ],
    ] as const) {
      const response = await createDestination(app, tokenA, draft, key);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe(code);
    }
    expect(await notifications.listDestinations(userA)).toEqual([]);
    expect(secrets.count()).toBe(0);
  });

  it("renders only into the explicit local sink with no persistence, audit payload, or network", async () => {
    const { app, notifications, secrets, tokenA } = await fixture();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const before = notifications.mutationCount();

    const response = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: webhookDraft,
      url: "/api/notification-destinations/test",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      destinationType: "webhook",
      networkCalls: 0,
      rendered: {
        body: expect.stringContaining("Local fixture monitor"),
        method: "POST",
      },
      signed: true,
      sink: "local-sink://p03-01",
    });
    expectNoCredential(response.json());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notifications.mutationCount()).toBe(before);
    expect(await notifications.listDestinations(userA)).toEqual([]);
    expect(secrets.count()).toBe(0);
  });
});
