import {
  buildApiApp,
  PostgresSessionStore,
  PostgresUserPreferencesStore,
} from "../../apps/api/src/index.js";
import { SessionIssuer } from "../../packages/security/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const userIds = [
  "26000000-0000-4000-8000-000000000001",
  "26000000-0000-4000-8000-000000000002",
] as const;
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const now = new Date("2026-08-14T09:00:00.000Z");

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Preference A', NULL, $3, $3),
       ($2, 'user', 'normal', 'active', 'Preference B', NULL, $3, $3)`,
    [...userIds, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
});

async function session(userId: string): Promise<string> {
  return (
    await new SessionIssuer(new PostgresSessionStore(pool), { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T10:00:00.000Z"),
      userId,
    })
  ).token;
}

function createApp() {
  return buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    preferencesStore: new PostgresUserPreferencesStore(pool),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: new PostgresSessionStore(pool),
  });
}

describe("P01-06 PostgreSQL user preferences", () => {
  it("migrates the real table, persists defaults on first change and rejects a stale writer", async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_preferences'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "user_id",
      "schema_version",
      "revision",
      "preferences",
      "created_at",
      "updated_at",
    ]);

    const token = await session(userIds[0]);
    const app = createApp();
    const defaults = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().data).toMatchObject({
      preferences: { colorTheme: "neutral", taskViewMode: "grid", theme: "system" },
      revision: 0,
      schemaVersion: 4,
      updatedAt: null,
    });

    const responses = await Promise.all([
      app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "PATCH",
        payload: { changes: { theme: "dark" }, expectedRevision: 0 },
        url: "/api/user/preferences",
      }),
      app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "PATCH",
        payload: { changes: { showHotPools: true }, expectedRevision: 0 },
        url: "/api/user/preferences",
      }),
    ]);
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);

    const stored = await pool.query<{
      owner: string;
      revision: string;
      schema_version: number;
    }>(
      `SELECT user_id::text AS owner, revision::text, schema_version
         FROM user_preferences
        WHERE user_id = $1`,
      [userIds[0]],
    );
    expect(stored.rows).toEqual([{ owner: userIds[0], revision: "1", schema_version: 4 }]);
    await app.close();

    const restoredApp = createApp();
    const restored = await restoredApp.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(restored.json().data.revision).toBe(1);
    expect(
      restored.json().data.preferences.theme === "dark" ||
        restored.json().data.preferences.showHotPools === true,
    ).toBe(true);
    await restoredApp.close();
  });

  it("upgrades a version-one row without leaking it to another user", async () => {
    await pool.query(
      `INSERT INTO user_preferences (
         user_id, schema_version, revision, preferences, created_at, updated_at
       ) VALUES ($1, 1, 7, $2::jsonb, $3, $3)`,
      [
        userIds[1],
        JSON.stringify({
          colorTheme: "blue",
          navConfig: ["wallets", "tasks"],
          taskViewMode: "list",
          theme: "dark",
        }),
        now,
      ],
    );
    const [tokenA, tokenB] = await Promise.all(userIds.map((userId) => session(userId)));
    const app = createApp();

    const migrated = await app.inject({
      headers: { cookie: `lpbot_session=${tokenB}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(migrated.statusCode).toBe(200);
    expect(migrated.json().data).toMatchObject({
      preferences: {
        colorTheme: "blue",
        navConfig: [
          { key: "wallets", visible: true },
          { key: "tasks", visible: true },
          { key: "pools", visible: true },
          { key: "strategies", visible: true },
          { key: "activity", visible: true },
          { key: "chat", visible: true },
        ],
        taskViewMode: "list",
        theme: "dark",
      },
      revision: 7,
      schemaVersion: 4,
    });
    const upgraded = await pool.query<{ revision: string; schema_version: number }>(
      `SELECT revision::text, schema_version
         FROM user_preferences
        WHERE user_id = $1`,
      [userIds[1]],
    );
    expect(upgraded.rows).toEqual([{ revision: "7", schema_version: 4 }]);

    const isolated = await app.inject({
      headers: { cookie: `lpbot_session=${tokenA}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(isolated.json().data.preferences).not.toMatchObject({
      colorTheme: "blue",
      taskViewMode: "list",
    });
    await app.close();
  });

  it("restores the same column layout after a second-device login and rejects its stale revision", async () => {
    const [firstDeviceToken, secondDeviceToken] = await Promise.all([
      session(userIds[0]),
      session(userIds[0]),
    ]);
    const firstDevice = createApp();
    const secondDevice = createApp();
    const [firstView, secondView] = await Promise.all([
      firstDevice.inject({
        headers: { cookie: `lpbot_session=${firstDeviceToken}` },
        method: "GET",
        url: "/api/user/preferences",
      }),
      secondDevice.inject({
        headers: { cookie: `lpbot_session=${secondDeviceToken}` },
        method: "GET",
        url: "/api/user/preferences",
      }),
    ]);
    expect(firstView.json().data.revision).toBe(secondView.json().data.revision);
    const columns = [
      { key: "pool", visible: true },
      { key: "fdv", visible: false },
      { key: "fees", visible: true },
      { key: "protocol", visible: true },
      { key: "volume", visible: false },
      { key: "feeTvl", visible: true },
      { key: "feeActiveTvl", visible: true },
      { key: "tvl", visible: true },
      { key: "txs", visible: true },
      { key: "actions", visible: true },
    ];

    const saved = await firstDevice.inject({
      headers: { cookie: `lpbot_session=${firstDeviceToken}` },
      method: "PATCH",
      payload: {
        changes: { poolColumns: columns },
        expectedRevision: firstView.json().data.revision,
      },
      url: "/api/user/preferences",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.preferences.poolColumns).toEqual(columns);

    const stale = await secondDevice.inject({
      headers: { cookie: `lpbot_session=${secondDeviceToken}` },
      method: "PATCH",
      payload: {
        changes: { poolColumns: columns.map((column) => ({ ...column, visible: true })) },
        expectedRevision: secondView.json().data.revision,
      },
      url: "/api/user/preferences",
    });
    expect(stale.statusCode).toBe(409);

    await Promise.all([firstDevice.close(), secondDevice.close()]);
    const relogged = createApp();
    const restored = await relogged.inject({
      headers: { cookie: `lpbot_session=${await session(userIds[0])}` },
      method: "GET",
      url: "/api/user/preferences",
    });
    expect(restored.json().data).toMatchObject({
      preferences: {
        poolColumns: columns,
        poolsPanelCollapsed: expect.any(Boolean),
        showHotPools: expect.any(Boolean),
        showScanTab: expect.any(Boolean),
      },
      revision: saved.json().data.revision,
      schemaVersion: 4,
    });
    await relogged.close();
  });
});
