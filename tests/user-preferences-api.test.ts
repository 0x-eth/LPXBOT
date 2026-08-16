import type {
  UserPreferences,
  VersionedUserPreferences,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import { normalizeStoredUserPreferences } from "../apps/api/src/user-preferences.js";
import type {
  UpdateUserPreferencesInput,
  UserPreferencesStore,
  UserPreferencesUpdateResult,
} from "../apps/api/src/user-preferences.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "20000000-0000-4000-8000-000000000001";
const userB = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-14T02:00:00.000Z");

const defaultPreferences: UserPreferences = {
  colorTheme: "neutral",
  customColor: null,
  navConfig: [
    { key: "tasks", visible: true },
    { key: "pools", visible: true },
    { key: "strategies", visible: true },
    { key: "activity", visible: true },
    { key: "wallets", visible: true },
    { key: "chat", visible: true },
  ],
  poolColumns: [
    { key: "pool", visible: true },
    { key: "protocol", visible: true },
    { key: "fees", visible: true },
    { key: "volume", visible: true },
    { key: "feeTvl", visible: true },
    { key: "feeActiveTvl", visible: true },
    { key: "tvl", visible: true },
    { key: "txs", visible: true },
    { key: "fdv", visible: true },
    { key: "actions", visible: true },
  ],
  poolsPanelCollapsed: false,
  showHotPools: false,
  showScanTab: true,
  taskViewMode: "grid",
  theme: "system",
};

class MemoryPreferencesStore implements UserPreferencesStore {
  readonly records = new Map<string, VersionedUserPreferences>();
  reads = 0;

  async get(userId: string): Promise<VersionedUserPreferences | null> {
    this.reads += 1;
    return this.records.get(userId) ?? null;
  }

  async update(input: UpdateUserPreferencesInput): Promise<UserPreferencesUpdateResult> {
    const current = this.records.get(input.userId);
    const revision = current?.revision ?? 0;
    if (revision !== input.expectedRevision) {
      return {
        current: current ?? {
          preferences: structuredClone(defaultPreferences),
          revision: 0,
          schemaVersion: 4,
          updatedAt: null,
        },
        status: "conflict",
      };
    }
    const next: VersionedUserPreferences = {
      preferences: structuredClone(input.preferences),
      revision: revision + 1,
      schemaVersion: 4,
      updatedAt: input.updatedAt.toISOString(),
    };
    this.records.set(input.userId, next);
    return { status: "updated", value: next };
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const preferencesStore = new MemoryPreferencesStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    preferencesStore,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, preferencesStore, tokenA, tokenB };
}

describe("P01-06 user preferences API", () => {
  it("returns server-owned defaults and rejects anonymous access", async () => {
    const { app, preferencesStore, tokenA } = await fixture();

    const anonymous = await app.inject({ method: "GET", url: "/api/user/preferences" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("UNAUTHENTICATED");
    expect(preferencesStore.reads).toBe(0);

    const authenticated = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.headers["cache-control"]).toBe("no-store");
    expect(authenticated.json().data).toEqual({
      preferences: defaultPreferences,
      revision: 0,
      schemaVersion: 4,
      updatedAt: null,
    });
  });

  it("normalizes an authenticated patch and detects stale concurrent revisions", async () => {
    const { app, tokenA } = await fixture();
    const changes = {
      colorTheme: "teal",
      navConfig: [
        { key: "wallets", visible: true },
        { key: "tasks", visible: true },
        { key: "pools", visible: true },
        { key: "strategies", visible: false },
        { key: "activity", visible: true },
        { key: "chat", visible: true },
      ],
      taskViewMode: "list",
      theme: "dark",
    } as const;

    const first = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "PATCH",
      payload: { changes, expectedRevision: 0 },
      url: "/api/user/preferences",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      preferences: { ...defaultPreferences, ...changes },
      revision: 1,
      schemaVersion: 4,
      updatedAt: now.toISOString(),
    });

    const stale = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "PATCH",
      payload: { changes: { showHotPools: true }, expectedRevision: 0 },
      url: "/api/user/preferences",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: "PREFERENCES_CONFLICT",
      retryable: true,
    });

    const current = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(current.json().data.revision).toBe(1);
    expect(current.json().data.preferences.showHotPools).toBe(false);
  });

  it("accepts only whitelisted fields, valid colors and a complete unique navigation", async () => {
    const { app, tokenA } = await fixture();
    const invalidChanges = [
      { admin: true },
      { customColor: "red" },
      { customColor: "#fff" },
      { colorTheme: "custom", customColor: null },
      {
        navConfig: [
          { key: "tasks", visible: true },
          { key: "tasks", visible: true },
          { key: "pools", visible: true },
          { key: "strategies", visible: true },
          { key: "activity", visible: true },
          { key: "wallets", visible: true },
        ],
      },
      {
        navConfig: [
          { key: "tasks", visible: false },
          { key: "pools", visible: true },
          { key: "strategies", visible: true },
          { key: "activity", visible: true },
          { key: "wallets", visible: true },
          { key: "chat", visible: true },
        ],
      },
      { expectedRevision: 99, theme: "light" },
      {
        poolColumns: [
          { key: "pool", visible: true },
          { key: "protocol", visible: true },
          { key: "fees", visible: true },
          { key: "volume", visible: true },
          { key: "tvl", visible: true },
          { key: "txs", visible: true },
          { key: "fdv", visible: true },
          { key: "pool", visible: true },
        ],
      },
      {
        poolColumns: defaultPreferences.poolColumns.map((column) => ({
          ...column,
          visible: column.key === "pool" ? false : column.visible,
        })),
      },
      {
        poolColumns: defaultPreferences.poolColumns.map((column) => ({
          ...column,
          visible: column.key === "actions" ? false : column.visible,
        })),
      },
    ];

    for (const changes of invalidChanges) {
      const response = await app.inject({
        headers: { cookie: `lpbot_session=${tokenA}` },
        method: "PATCH",
        payload: { changes, expectedRevision: 0 },
        url: "/api/user/preferences",
      });
      expect(response.statusCode, JSON.stringify(changes)).toBe(400);
      expect(response.json().error.code).toBe("PREFERENCES_INVALID");
    }
  });

  it("migrates schema v3 columns while preserving order and every existing preference", () => {
    const migrated = normalizeStoredUserPreferences({
      colorTheme: "teal",
      customColor: null,
      navConfig: [
        { key: "wallets", visible: false },
        { key: "tasks", visible: true },
        { key: "pools", visible: true },
        { key: "strategies", visible: true },
        { key: "activity", visible: true },
        { key: "chat", visible: true },
      ],
      poolColumns: [
        { key: "pool", visible: false },
        { key: "fdv", visible: false },
        { key: "future-column", visible: true },
        { key: "fdv", visible: true },
        { key: "fees", visible: true },
        { key: "protocol", visible: true },
        { key: "volume", visible: false },
        { key: "tvl", visible: true },
        { key: "txs", visible: true },
        { key: "actions", visible: false },
      ],
      poolsPanelCollapsed: true,
      showHotPools: true,
      showScanTab: false,
      taskViewMode: "list",
      theme: "dark",
    });

    expect(migrated).toMatchObject({
      colorTheme: "teal",
      customColor: null,
      poolsPanelCollapsed: true,
      showHotPools: true,
      showScanTab: false,
      taskViewMode: "list",
      theme: "dark",
    });
    expect(migrated.navConfig[0]).toEqual({ key: "wallets", visible: false });
    expect(migrated.poolColumns).toEqual([
      { key: "pool", visible: true },
      { key: "fdv", visible: false },
      { key: "fees", visible: true },
      { key: "protocol", visible: true },
      { key: "volume", visible: false },
      { key: "tvl", visible: true },
      { key: "txs", visible: true },
      { key: "feeTvl", visible: true },
      { key: "feeActiveTvl", visible: true },
      { key: "actions", visible: true },
    ]);
  });

  it("derives ownership only from the session and isolates two users", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const saved = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "PATCH",
      payload: { changes: { theme: "dark" }, expectedRevision: 0 },
      url: "/api/user/preferences",
    });
    expect(saved.statusCode).toBe(200);

    const other = await app.inject({
      headers: { cookie: `lpbot_session=${tokenB}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(other.json().data).toMatchObject({
      preferences: { theme: "system" },
      revision: 0,
    });

    const idor = await app.inject({
      headers: { cookie: `lpbot_session=${tokenB}` },
      method: "PATCH",
      payload: { changes: { theme: "light" }, expectedRevision: 0, userId: userA },
      url: "/api/user/preferences",
    });
    expect(idor.statusCode).toBe(400);
    expect(idor.body).not.toContain(userA);
  });
});
