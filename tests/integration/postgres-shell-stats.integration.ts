import {
  PostgresShellStatsProvider,
  PostgresTaskStatusStatsPublisher,
  ShellStatsUnavailableError,
  type ShellStatsScope,
} from "../../apps/api/src/index.js";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 16 });
const users = [randomUUID(), randomUUID(), randomUUID()] as const;
const telegramIds = ["8801301", "8801302", "8801303"] as const;
const observedAt = "2026-08-17T08:00:00.000Z";
const later = "2026-08-17T08:00:01.000Z";

const userScope = (userId: string): ShellStatsScope => ({ type: "user", userId });
const globalScope: ShellStatsScope = { type: "global" };

async function resetProjection(): Promise<void> {
  await pool.query("TRUNCATE task_status_stats_conflicts, task_status_stats_query_audit_events");
  await pool.query("TRUNCATE task_status_stats_user_snapshots CASCADE");
  await pool.query("DELETE FROM task_status_stats_stream_heads WHERE scope = 'user'");
  await pool.query(
    `UPDATE task_status_stats_stream_heads
        SET sequence = 0, running = 0, paused = 0, stopped = 0,
            content_hash = task_status_stats_counts_hash(0, 0, 0),
            observed_at = '1970-01-01T00:00:00.000Z'
      WHERE scope = 'global'`,
  );
  await pool.query(
    `UPDATE task_status_stats_projection_state
        SET ready = false, backfill_completed_at = NULL, updated_at = $1
      WHERE singleton = true`,
    [observedAt],
  );
}

async function insertUsers(): Promise<void> {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Stats One', NULL, $4, $4),
       ($2, 'user', 'normal', 'active', 'Stats Two', NULL, $4, $4),
       ($3, 'admin', 'pro', 'active', 'Stats Admin', NULL, $4, $4)`,
    [...users, observedAt],
  );
  await pool.query(
    `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
     VALUES ($1, $4, $7), ($2, $5, $7), ($3, $6, $7)`,
    [...telegramIds, ...users, observedAt],
  );
}

beforeAll(insertUsers);
beforeEach(resetProjection);
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.end();
});

describe("P02-13 PostgreSQL task status projection", () => {
  it("distinguishes unready storage from authoritative zero after backfill", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    const provider = new PostgresShellStatsProvider(pool);

    await expect(provider.getSnapshot({ scope: userScope(users[0]) })).rejects.toBeInstanceOf(
      ShellStatsUnavailableError,
    );
    await publisher.publish({
      observedAt,
      paused: 2,
      running: 3,
      sourceRevision: 1,
      stopped: 4,
      userId: users[0],
    });
    await expect(provider.getSnapshot({ scope: userScope(users[0]) })).rejects.toBeInstanceOf(
      ShellStatsUnavailableError,
    );
    await publisher.completeBackfill({ observedAt });
    expect(await provider.getSnapshot({ scope: userScope(users[1]) })).toMatchObject({
      sequence: 0,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        taskCounts: { paused: 0, running: 0, stopped: 0 },
      },
    });

    await publisher.publish({
      observedAt: later,
      paused: 0,
      running: 0,
      sourceRevision: 1,
      stopped: 0,
      userId: users[1],
    });
    const stored = await pool.query<{ source_revision: string }>(
      "SELECT source_revision::text FROM task_status_stats_user_snapshots WHERE user_id = $1",
      [users[1]],
    );
    expect(stored.rows).toEqual([{ source_revision: "1" }]);
  });

  it("publishes absolute snapshots idempotently and rejects stale or conflicting revisions", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    const provider = new PostgresShellStatsProvider(pool);
    await publisher.completeBackfill({ observedAt });
    const input = {
      observedAt: later,
      paused: 2,
      running: 3,
      sourceRevision: 5,
      stopped: 4,
      userId: users[0],
    } as const;

    expect(await publisher.publish(input)).toMatchObject({ changed: true, status: "applied" });
    expect(await publisher.publish(input)).toMatchObject({ changed: false, status: "idempotent" });
    expect(await publisher.publish({ ...input, sourceRevision: 4, running: 99 })).toMatchObject({
      changed: false,
      status: "stale",
    });
    expect(await publisher.publish({ ...input, running: 8 })).toMatchObject({
      changed: false,
      status: "conflict",
    });
    expect((await provider.getSnapshot({ scope: userScope(users[0]) })).stats.taskCounts).toEqual({
      paused: 2,
      running: 3,
      stopped: 4,
    });
    expect((await provider.getSnapshot({ scope: globalScope })).stats.taskCounts).toEqual({
      paused: 2,
      running: 3,
      stopped: 4,
    });
    const conflicts = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM task_status_stats_conflicts WHERE user_id = $1",
      [users[0]],
    );
    expect(conflicts.rows).toEqual([{ count: "1" }]);
  });

  it("serializes concurrent user/global updates and isolates personal scopes", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    const provider = new PostgresShellStatsProvider(pool);
    await publisher.completeBackfill({ observedAt });
    await Promise.all([
      publisher.publish({
        observedAt,
        paused: 2,
        running: 11,
        sourceRevision: 1,
        stopped: 3,
        userId: users[0],
      }),
      publisher.publish({
        observedAt,
        paused: 5,
        running: 7,
        sourceRevision: 1,
        stopped: 13,
        userId: users[1],
      }),
    ]);

    expect((await provider.getSnapshot({ scope: globalScope })).stats.taskCounts).toEqual({
      paused: 7,
      running: 18,
      stopped: 16,
    });
    expect((await provider.getSnapshot({ scope: userScope(users[0]) })).stats.taskCounts).toEqual({
      paused: 2,
      running: 11,
      stopped: 3,
    });
    expect((await provider.getSnapshot({ scope: userScope(users[1]) })).stats.taskCounts).toEqual({
      paused: 5,
      running: 7,
      stopped: 13,
    });

    const contenders = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        publisher.publish({
          observedAt: later,
          paused: 2,
          running: index + 20,
          sourceRevision: 2,
          stopped: 3,
          userId: users[0],
        }),
      ),
    );
    expect(contenders.filter(({ status }) => status === "applied")).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === "conflict")).toHaveLength(7);
  });

  it("polls latest full counts, suppresses no-change updates, heartbeats and resumes sequence", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    await publisher.completeBackfill({ observedAt });
    await publisher.publish({
      observedAt,
      paused: 1,
      running: 1,
      sourceRevision: 1,
      stopped: 1,
      userId: users[0],
    });
    const provider = new PostgresShellStatsProvider(pool, {
      heartbeatMilliseconds: 35,
      pollMilliseconds: 5,
    });
    const snapshot = await provider.getSnapshot({ scope: userScope(users[0]) });
    const controller = new AbortController();
    const iterator = provider
      .subscribe({
        afterSequence: snapshot.sequence,
        scope: userScope(users[0]),
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();

    await publisher.publish({
      observedAt: later,
      paused: 2,
      running: 2,
      sourceRevision: 2,
      stopped: 2,
      userId: users[0],
    });
    await publisher.publish({
      observedAt: later,
      paused: 3,
      running: 3,
      sourceRevision: 3,
      stopped: 3,
      userId: users[0],
    });
    const update = await iterator.next();
    expect(update.value).toMatchObject({
      stats: { taskCounts: { paused: 3, running: 3, stopped: 3 } },
      type: "update",
    });
    expect(update.value?.sequence).toBeGreaterThan(snapshot.sequence);

    const sameCounts = await publisher.publish({
      observedAt: later,
      paused: 3,
      running: 3,
      sourceRevision: 4,
      stopped: 3,
      userId: users[0],
    });
    expect(sameCounts).toMatchObject({ changed: false, status: "applied" });
    expect(await iterator.next()).toMatchObject({
      value: { sequence: null, type: "heartbeat" },
    });

    controller.abort();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    const restarted = new PostgresShellStatsProvider(pool);
    expect((await restarted.getSnapshot({ scope: userScope(users[0]) })).sequence).toBe(
      update.value?.sequence,
    );
  });

  it("updates the global stream on user deletion and resolves decimal Telegram identities", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    const provider = new PostgresShellStatsProvider(pool);
    await publisher.completeBackfill({ observedAt });
    await publisher.publish({
      observedAt,
      paused: 2,
      running: 3,
      sourceRevision: 1,
      stopped: 4,
      userId: users[1],
    });
    const before = await provider.getSnapshot({ scope: globalScope });
    expect(await provider.resolveTelegramUserId(telegramIds[1])).toBe(users[1]);
    expect(await provider.resolveTelegramUserId("999999999999")).toBeNull();
    await provider.recordAdminQueryAudit({
      actorUserId: users[2],
      createdAt: observedAt,
      outcome: "allowed",
      requestId: "req-p02-13-filter",
      targetTelegramUserId: telegramIds[1],
      targetUserId: users[1],
      transport: "sse",
    });
    const audit = await pool.query<{
      actor_user_id: string;
      outcome: string;
      request_id: string;
      target_telegram_user_id: string;
      target_user_id: string;
      transport: string;
    }>(
      `SELECT actor_user_id::text, target_user_id::text,
              target_telegram_user_id::text, transport, outcome, request_id
         FROM task_status_stats_query_audit_events`,
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: users[2],
        outcome: "allowed",
        request_id: "req-p02-13-filter",
        target_telegram_user_id: telegramIds[1],
        target_user_id: users[1],
        transport: "sse",
      },
    ]);
    expect(Object.keys(audit.rows[0]!)).not.toEqual(
      expect.arrayContaining(["authorization", "cookie", "session_id"]),
    );
    await pool.query("DELETE FROM users WHERE id = $1", [users[1]]);
    const after = await provider.getSnapshot({ scope: globalScope });
    expect(after.sequence).toBeGreaterThan(before.sequence);
    expect(after.stats.taskCounts).toEqual({ paused: 0, running: 0, stopped: 0 });
  });

  it("fails closed when a persisted content hash is inconsistent", async () => {
    const publisher = new PostgresTaskStatusStatsPublisher(pool);
    const provider = new PostgresShellStatsProvider(pool);
    await publisher.completeBackfill({ observedAt });
    await pool.query(
      "UPDATE task_status_stats_stream_heads SET content_hash = $1 WHERE scope_key = 'global'",
      [`sha256:${"0".repeat(64)}`],
    );
    await expect(provider.getSnapshot({ scope: globalScope })).rejects.toBeInstanceOf(
      ShellStatsUnavailableError,
    );
  });
});
