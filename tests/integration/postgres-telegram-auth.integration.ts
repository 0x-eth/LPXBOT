import { PostgresSessionStore } from "../../apps/api/src/index.js";
import {
  TelegramBotLoginService,
  hashSessionToken,
} from "../../packages/security/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const now = new Date("2026-08-14T03:00:00.000Z");
const fixtureUserId = "20000000-0000-4000-8000-000000000042";
const candidateUserIds = [
  "20000000-0000-4000-8000-000000000091",
  "20000000-0000-4000-8000-000000000092",
] as const;
const fixtureSubjects = ["420000000042", "420000000099"] as const;
const replayDigest = "a".repeat(64);
const pool = new Pool({ connectionString: databaseUrl, max: 6 });

beforeAll(async () => {
  await pool.query("DELETE FROM telegram_init_data_replays WHERE digest = decode($1, 'hex')", [
    replayDigest,
  ]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [fixtureUserId, ...candidateUserIds],
  ]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, allowed_chain_ids, display_name, avatar_url, created_at, updated_at
     ) VALUES ($1, 'user', 'normal', 'active', ARRAY[1, 56], 'Postgres Fixture', NULL, $2, $2)`,
    [fixtureUserId, now],
  );
  await pool.query(
    `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
     VALUES ($1, $2, $3)`,
    [fixtureSubjects[0], fixtureUserId, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM telegram_init_data_replays WHERE digest = decode($1, 'hex')", [
    replayDigest,
  ]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [fixtureUserId, ...candidateUserIds],
  ]);
  await pool.end();
});

describe("P01-03 PostgreSQL Telegram authentication", () => {
  it("atomically consumes replay digests and maps concurrent unknown identities once", async () => {
    const store = new PostgresSessionStore(pool);

    const replayResults = await Promise.all([
      store.consumeInitDataReplay({ consumedAt: now, digest: replayDigest }),
      store.consumeInitDataReplay({ consumedAt: now, digest: replayDigest }),
    ]);
    expect(replayResults.sort()).toEqual([false, true]);

    const accounts = await Promise.all(
      candidateUserIds.map((candidateUserId) =>
        store.resolveTelegramIdentity({
          candidateUserId,
          createdAt: now,
          subject: fixtureSubjects[1],
        }),
      ),
    );
    expect(new Set(accounts.map(({ id }) => id))).toHaveProperty("size", 1);
    expect(accounts[0]?.status).toBe("pending");

    const persisted = await pool.query<{
      digest_size: number;
      identity_count: number;
      user_count: number;
    }>(
      `SELECT
         (SELECT octet_length(digest)::int
            FROM telegram_init_data_replays
           WHERE digest = decode($1, 'hex')) AS digest_size,
         (SELECT count(*)::int
            FROM telegram_identities
           WHERE telegram_user_id = $2) AS identity_count,
         (SELECT count(*)::int
            FROM users
           WHERE id = ANY($3::uuid[])) AS user_count`,
      [replayDigest, fixtureSubjects[1], candidateUserIds],
    );
    expect(persisted.rows[0]).toEqual({ digest_size: 32, identity_count: 1, user_count: 1 });
  });

  it("atomically consumes a confirmed intent with one hashed session", async () => {
    const store = new PostgresSessionStore(pool);
    const service = new TelegramBotLoginService(store, {
      intentTtlSeconds: 180,
      now: () => now,
      sessionTtlSeconds: 3_600,
    });
    const created = await service.create("postgres-create");
    await service.confirmLogin({
      requestId: "postgres-confirm",
      telegramSubject: fixtureSubjects[0],
      token: created.token,
    });

    const polls = await Promise.all([
      service.poll(created.token, "postgres-poll-a"),
      service.poll(created.token, "postgres-poll-b"),
    ]);
    expect(polls.filter(({ login }) => login !== null)).toHaveLength(1);
    expect(polls.filter(({ login }) => login === null)).toHaveLength(1);

    const persisted = await pool.query<{
      intent_status: string;
      session_count: number;
      token_digest: string;
    }>(
      `SELECT i.status AS intent_status,
              encode(i.token_hash, 'hex') AS token_digest,
              count(s.id)::int AS session_count
         FROM telegram_bot_login_intents i
         LEFT JOIN sessions s ON s.user_id = i.user_id AND s.created_at = i.consumed_at
        WHERE i.token_hash = decode($1, 'hex')
        GROUP BY i.status, i.token_hash`,
      [hashSessionToken(created.token)],
    );
    expect(persisted.rows[0]).toMatchObject({
      intent_status: "consumed",
      session_count: 1,
      token_digest: hashSessionToken(created.token),
    });
    expect(JSON.stringify(persisted.rows)).not.toContain(created.token);
  });

  it("serializes cancellation against first consumption without issuing a losing session", async () => {
    const store = new PostgresSessionStore(pool);
    const service = new TelegramBotLoginService(store, {
      intentTtlSeconds: 180,
      now: () => now,
      sessionTtlSeconds: 3_600,
    });
    const created = await service.create("postgres-race-create");
    await service.confirmLogin({
      requestId: "postgres-race-confirm",
      telegramSubject: fixtureSubjects[0],
      token: created.token,
    });

    const [cancelled, polled] = await Promise.all([
      service.cancel(created.token, "postgres-race-cancel"),
      service.poll(created.token, "postgres-race-poll"),
    ]);
    const persisted = await pool.query<{ intent_status: string; session_count: number }>(
      `SELECT i.status AS intent_status, count(s.id)::int AS session_count
         FROM telegram_bot_login_intents i
         LEFT JOIN sessions s ON s.user_id = i.user_id AND s.created_at = i.consumed_at
        WHERE i.token_hash = decode($1, 'hex')
        GROUP BY i.status`,
      [hashSessionToken(created.token)],
    );

    if (persisted.rows[0]?.intent_status === "consumed") {
      expect(cancelled.status).toBe("consumed");
      expect(polled.login).not.toBeNull();
      expect(persisted.rows[0].session_count).toBe(1);
    } else {
      expect(persisted.rows[0]).toEqual({ intent_status: "cancelled", session_count: 0 });
      expect(cancelled.status).toBe("cancelled");
      expect(polled.login).toBeNull();
    }
    expect(JSON.stringify(persisted.rows)).not.toContain(created.token);
  });
});
