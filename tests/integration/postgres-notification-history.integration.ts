import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresNotificationHistoryStore } from "../../apps/api/src/postgres-notification-history-store.js";
import { PostgresMonitorCandidateOutboxRepository } from "../../apps/worker/src/postgres-monitor-outbox.js";
import { monitorCandidateKey, type MonitorCandidate } from "../../packages/domain/src/monitor-evaluator.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0304_history_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 6 });

const userA = "39000000-0000-4000-8000-000000000001";
const userB = "39000000-0000-4000-8000-000000000002";
const monitorA = "39000000-0000-4000-8000-000000000011";
const monitorB = "39000000-0000-4000-8000-000000000012";
const destinationA = "39000000-0000-4000-8000-000000000021";
const createdAt = "2026-08-18T01:00:00.000Z";
const poolKey = `56:0x${"a".repeat(40)}` as const;

function migrationUp(source: string): string {
  return source.split("-- migrate:up")[1]!.split("-- migrate:down")[0]!;
}

function candidate(input: {
  monitorId: string;
  monitorRevision?: number;
  userId: string;
  windowEnd?: string;
}): MonitorCandidate {
  const windowEnd = input.windowEnd ?? "2026-08-18T00:55:00.000Z";
  const monitorRevision = input.monitorRevision ?? 1;
  return {
    blocklistHash: `sha256:${"1".repeat(64)}`,
    candidateKey: monitorCandidateKey({
      metricVersion: "market-metrics/v1",
      monitorId: input.monitorId,
      poolKey,
      revision: monitorRevision,
      windowEnd,
    }),
    canonicalBlockHash: `0x${"a".repeat(64)}`,
    createdAt,
    generatedAt: createdAt,
    matchedConditions: [{ enabled: true, id: "volumeUsd", operator: "gte", value: "1000" }],
    metricVersion: "market-metrics/v1",
    monitorId: input.monitorId,
    monitorRevision,
    poolKey,
    sourceGenerationId: `generation-${input.monitorId}`,
    userId: input.userId,
    windowEnd,
  };
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  for (const filename of readdirSync(path.join(repositoryRoot, "infra/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pool.query(
      migrationUp(readFileSync(path.join(repositoryRoot, "infra/migrations", filename), "utf8")),
    );
  }
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'History A', $3, $3),
            ($2, 'user', 'normal', 'active', 'History B', $3, $3)`,
    [userA, userB, createdAt],
  );
  await pool.query(
    `INSERT INTO monitors (
       monitor_id, user_id, revision, name, pool_key, window_minutes, status,
       conditions, condition_count, enabled_condition_count, exclude_han_token,
       exclude_hook, created_at, updated_at, enabled_at
     ) VALUES
       ($1, $3, 1, 'Volume watch', $5, 5, 'enabled', $6::jsonb, 1, 1, true, true, $7, $7, $7),
       ($2, $4, 1, 'Other user watch', $5, 15, 'enabled', $6::jsonb, 1, 1, true, true, $7, $7, $7)`,
    [
      monitorA,
      monitorB,
      userA,
      userB,
      poolKey,
      JSON.stringify([{ enabled: true, id: "volumeUsd", operator: "gte", value: "1000" }]),
      createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO notification_destinations (
       destination_id, user_id, current_revision, created_at, updated_at
     ) VALUES ($1, $2, 1, $3, $3);
     INSERT INTO notification_destination_versions (
       destination_id, user_id, revision, type, name, enabled, categories,
       config, secret_ref, tombstone, created_at
     ) VALUES (
       $1, $2, 1, 'webhook', 'Operations webhook', true, ARRAY['monitor-match'],
       '{"method":"POST","template":{"text":"{{monitor.name}}"},"url":"https://hooks.fixture.example/event"}'::jsonb,
       'secret-ref://fixture/webhook/history', false, $3
     )`,
    [destinationA, userA, createdAt],
  );
}, 30_000);

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("P03-04 PostgreSQL notification delivery history", () => {
  it("atomically mirrors enqueue, lease recovery, late result, retry, and delivery", async () => {
    const outbox = new PostgresMonitorCandidateOutboxRepository(pool);
    const history = new PostgresNotificationHistoryStore(pool);
    const committed = await outbox.commitCandidate({
      candidate: candidate({ monitorId: monitorA, userId: userA }),
      destinations: [
        {
          channel: "webhook",
          destinationId: destinationA,
          destinationRevision: 1,
          payload: {
            conditionSummary: "volumeUsd gte 1000",
            metricVersion: "market-metrics/v1",
            monitorId: monitorA,
            monitorName: "Volume watch",
            monitorRevision: 1,
            poolKey,
            windowEnd: "2026-08-18T00:55:00.000Z",
          },
        },
      ],
    });
    const deliveryId = committed.deliveries[0]!.deliveryId;
    await expect(
      history.list(userA, {
        cursor: null,
        deliveryStatus: null,
        from: null,
        limit: 25,
        monitorId: null,
        to: null,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          attemptCount: 0,
          conditionSummary: "volumeUsd gte 1000",
          deliveryId,
          destination: {
            destinationId: destinationA,
            name: "Operations webhook",
            type: "webhook",
          },
          monitorId: monitorA,
          monitorName: "Volume watch",
          poolKey,
          status: "pending",
          windowMinutes: 5,
        },
      ],
      nextCursor: null,
    });

    expect((await outbox.peekDue({ limit: 10 })).map(({ deliveryId: id }) => id)).toContain(
      deliveryId,
    );
    const first = (
      await outbox.claimDue({
        deliveryIds: [deliveryId],
        leaseOwner: "dispatcher-first",
        limit: 1,
      })
    )[0]!;
    expect(first).toMatchObject({ attemptCount: 1, userId: userA });
    await pool.query(
      "UPDATE notification_outbox SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE delivery_id = $1",
      [deliveryId],
    );
    const second = (
      await outbox.claimDue({
        deliveryIds: [deliveryId],
        leaseOwner: "dispatcher-second",
        limit: 1,
      })
    )[0]!;
    expect(second.attemptCount).toBe(2);
    await expect(
      outbox.markDelivered({
        acknowledgement: "late-provider-result",
        deliveryId,
        leaseToken: first.leaseToken!,
      }),
    ).resolves.toBe(false);
    await expect(
      outbox.markRetry({
        deliveryId,
        errorCode: "HTTP_503",
        leaseToken: second.leaseToken!,
        retryAfterSeconds: 60,
      }),
    ).resolves.toBe(true);
    await expect(
      history.list(userA, {
        cursor: null,
        deliveryStatus: "retrying",
        from: null,
        limit: 25,
        monitorId: monitorA,
        to: null,
      }),
    ).resolves.toMatchObject({
      items: [{ attemptCount: 2, deliveryId, errorCode: "HTTP_503", status: "retrying" }],
    });

    await pool.query(
      "UPDATE notification_outbox SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE delivery_id = $1",
      [deliveryId],
    );
    const third = (
      await outbox.claimDue({
        deliveryIds: [deliveryId],
        leaseOwner: "dispatcher-third",
        limit: 1,
      })
    )[0]!;
    await expect(
      outbox.markDelivered({
        acknowledgement: "telegram:bounded-ack",
        deliveryId,
        leaseToken: third.leaseToken!,
      }),
    ).resolves.toBe(true);
    const projected = await pool.query<{
      provider_acknowledgement: string | null;
      status: string;
    }>(
      "SELECT status, provider_acknowledgement FROM notification_delivery_history WHERE delivery_id = $1",
      [deliveryId],
    );
    expect(projected.rows).toEqual([
      { provider_acknowledgement: "telegram:bounded-ack", status: "delivered" },
    ]);
  });

  it("rolls back a claim if its required history projection is missing", async () => {
    const outbox = new PostgresMonitorCandidateOutboxRepository(pool);
    const committed = await outbox.commitCandidate({
      candidate: candidate({
        monitorId: monitorA,
        userId: userA,
        windowEnd: "2026-08-18T00:56:00.000Z",
      }),
      destinations: [
        {
          channel: "webhook",
          destinationId: destinationA,
          destinationRevision: 1,
          payload: { poolKey },
        },
      ],
    });
    const deliveryId = committed.deliveries[0]!.deliveryId;
    await pool.query("DELETE FROM notification_delivery_history WHERE delivery_id = $1", [deliveryId]);
    await expect(
      outbox.claimDue({
        deliveryIds: [deliveryId],
        leaseOwner: "dispatcher-missing-history",
        limit: 1,
      }),
    ).rejects.toThrow("OUTBOX_HISTORY_SYNC_FAILED");
    const state = await pool.query<{ attempt_count: number; state: string }>(
      "SELECT state, attempt_count FROM notification_outbox WHERE delivery_id = $1",
      [deliveryId],
    );
    expect(state.rows).toEqual([{ attempt_count: 0, state: "pending" }]);
  });

  it("retains snapshots after monitor and destination deletion and clears them with the user", async () => {
    const outbox = new PostgresMonitorCandidateOutboxRepository(pool);
    const history = new PostgresNotificationHistoryStore(pool);
    const committed = await outbox.commitCandidate({
      candidate: candidate({
        monitorId: monitorB,
        userId: userB,
        windowEnd: "2026-08-18T00:57:00.000Z",
      }),
      destinations: [
        {
          channel: "local-sink",
          destinationId: "local-history-fixture",
          destinationRevision: 0,
          payload: { poolKey },
        },
      ],
    });
    const deliveryId = committed.deliveries[0]!.deliveryId;
    await pool.query(
      "UPDATE notification_destinations SET deleted_at = $2, updated_at = $2 WHERE destination_id = $1",
      [destinationA, createdAt],
    );
    await pool.query("DELETE FROM monitors WHERE monitor_id = $1", [monitorB]);
    expect(
      await pool.query("SELECT 1 FROM notification_outbox WHERE delivery_id = $1", [deliveryId]),
    ).toMatchObject({ rowCount: 0 });
    await expect(
      history.list(userB, {
        cursor: null,
        deliveryStatus: null,
        from: null,
        limit: 25,
        monitorId: monitorB,
        to: null,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          deliveryId,
          destination: { destinationId: "local-history-fixture", name: "local-history-fixture" },
          monitorName: "Other user watch",
        },
      ],
    });
    await pool.query("DELETE FROM users WHERE id = $1", [userB]);
    await expect(
      history.list(userB, {
        cursor: null,
        deliveryStatus: null,
        from: null,
        limit: 25,
        monitorId: null,
        to: null,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});
