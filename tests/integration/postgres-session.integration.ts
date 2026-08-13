import { buildApiApp, PostgresSessionStore } from "../../apps/api/src/index.js";
import { SessionIssuer } from "../../packages/security/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const userIds = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.query(
    `INSERT INTO users (
      id, role, tier, status, allowed_chain_ids, display_name, avatar_url, created_at, updated_at
    ) VALUES
      ($1, 'user', 'normal', 'active', ARRAY[1, 56], 'Fixture User A', NULL, $4, $4),
      ($2, 'pro', 'pro', 'active', ARRAY[1, 56, 8453], 'Fixture User B', NULL, $4, $4),
      ($3, 'admin', 'normal', 'active', ARRAY[1, 56], 'Fixture Admin', NULL, $4, $4)`,
    [...userIds, new Date("2026-08-14T02:00:00.000Z")],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
});

describe("P01-02 PostgreSQL sessions", () => {
  it("persists only token hashes and isolates expiry, logout and users", async () => {
    const store = new PostgresSessionStore(pool);
    const issuedAt = new Date("2026-08-14T02:00:00.000Z");
    const issuer = new SessionIssuer(store, { now: () => issuedAt });
    const first = await issuer.issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: userIds[0],
    });
    const second = await issuer.issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: userIds[1],
    });
    const expired = await issuer.issue({
      expiresAt: new Date("2026-08-14T02:15:00.000Z"),
      userId: userIds[2],
    });

    const persisted = await pool.query<{
      digest: string;
      digest_size: number;
      user_id: string;
    }>(
      `SELECT encode(token_hash, 'hex') AS digest,
              octet_length(token_hash)::int AS digest_size,
              user_id::text
         FROM sessions
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id`,
      [userIds],
    );
    expect(persisted.rows).toHaveLength(3);
    expect(persisted.rows.every((row) => row.digest_size === 32)).toBe(true);
    for (const credential of [first.token, second.token, expired.token]) {
      expect(JSON.stringify(persisted.rows)).not.toContain(credential);
    }

    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => new Date("2026-08-14T02:30:00.000Z"),
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });

    const firstBeforeLogout = await app.inject({
      headers: { cookie: `lpbot_session=${first.token}` },
      method: "POST",
      url: "/api/auth/me",
    });
    expect(firstBeforeLogout.statusCode).toBe(200);
    expect(firstBeforeLogout.json().data.user.userId).toBe(userIds[0]);

    const expiredResponse = await app.inject({
      headers: { cookie: `lpbot_session=${expired.token}` },
      method: "POST",
      url: "/api/auth/me",
    });
    expect(expiredResponse.statusCode).toBe(401);

    const logout = await app.inject({
      headers: { cookie: `lpbot_session=${first.token}` },
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(logout.statusCode).toBe(200);

    const [firstAfterLogout, secondStillActive] = await Promise.all([
      app.inject({
        headers: { cookie: `lpbot_session=${first.token}` },
        method: "POST",
        url: "/api/auth/me",
      }),
      app.inject({
        headers: { cookie: `lpbot_session=${second.token}` },
        method: "POST",
        url: "/api/auth/me",
      }),
    ]);
    expect(firstAfterLogout.statusCode).toBe(401);
    expect(secondStillActive.statusCode).toBe(200);
    expect(secondStillActive.json().data.user.userId).toBe(userIds[1]);

    const audit = await pool.query<{ action: string; outcome: string }>(
      `SELECT action, outcome
         FROM access_audit_events
        WHERE user_id = ANY($1::uuid[])
        ORDER BY id`,
      [userIds],
    );
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { action: "session.access", outcome: "allowed" },
        { action: "session.logout", outcome: "allowed" },
      ]),
    );

    await app.close();
  });
});
