import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresMonitorStore } from "../../apps/api/src/postgres-monitor-store.js";
import { PostgresMonitorCandidateOutboxRepository } from "../../apps/worker/src/postgres-monitor-outbox.js";
import { PostgresMonitorEvaluationSource } from "../../apps/worker/src/postgres-monitor-source.js";
import type { CreateMonitorRequest } from "../../packages/api-contract/src/index.js";
import {
  monitorCandidateKey,
  type MonitorCandidate,
} from "../../packages/domain/src/monitor-evaluator.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0302_monitoring_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 10 });

const userA = "31000000-0000-4000-8000-000000000001";
const userB = "31000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-17T10:00:00.000Z");
const poolKey = `56:0x${"a".repeat(40)}` as const;
const request: CreateMonitorRequest = {
  conditions: [
    { enabled: true, id: "volumeUsd", operator: "gte", value: "1000" },
    { enabled: true, id: "metricVersion", operator: "eq", value: "market-metrics/v1" },
  ],
  excludeHanToken: true,
  excludeHook: true,
  name: "PostgreSQL monitor",
  poolKey,
  windowMinutes: 5,
};

function migrationUp(source: string): string {
  return source.split("-- migrate:up")[1]!.split("-- migrate:down")[0]!;
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  const migrationDirectory = path.join(repositoryRoot, "infra/migrations");
  for (const filename of readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pool.query(migrationUp(readFileSync(path.join(migrationDirectory, filename), "utf8")));
  }
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Monitor A', NULL, $3, $3),
       ($2, 'user', 'normal', 'active', 'Monitor B', NULL, $3, $3)`,
    [userA, userB, now],
  );
}, 30_000);

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

function candidate(
  input: {
    generatedAt?: string;
    sourceGenerationId?: string;
    windowEnd?: string;
  } = {},
): MonitorCandidate {
  const windowEnd = input.windowEnd ?? "2026-08-17T09:05:00Z";
  const generatedAt = input.generatedAt ?? "2026-08-17T09:05:30Z";
  const sourceGenerationId = input.sourceGenerationId ?? "generation-fixture-001";
  return {
    blocklistHash: `sha256:${"1".repeat(64)}`,
    candidateKey: monitorCandidateKey({
      metricVersion: "market-metrics/v1",
      monitorId: "",
      poolKey,
      revision: 1,
      windowEnd,
    }),
    canonicalBlockHash: `0x${"a".repeat(64)}`,
    createdAt: generatedAt,
    generatedAt,
    matchedConditions: structuredClone(request.conditions),
    metricVersion: "market-metrics/v1",
    monitorId: "",
    monitorRevision: 1,
    poolKey,
    sourceGenerationId,
    userId: userA,
    windowEnd,
  };
}

describe("P03-02 PostgreSQL monitoring persistence", () => {
  let monitorId = "";

  it("enforces schema ownership and allows one concurrent idempotent create", async () => {
    const store = new PostgresMonitorStore(pool);
    const results = await Promise.all([
      store.create({ createdAt: now, idempotencyKey: "same-key", request, userId: userA }),
      store.create({ createdAt: now, idempotencyKey: "same-key", request, userId: userA }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["created", "replayed"]);
    const values = results.flatMap((result) => ("value" in result ? [result.value] : []));
    expect(new Set(values.map(({ monitorId: id }) => id)).size).toBe(1);
    monitorId = values[0]!.monitorId;
    expect(values[0]).toMatchObject({ enabled: false, revision: 1, userId: userA });

    expect(
      await store.create({
        createdAt: now,
        idempotencyKey: "same-key",
        request: { ...request, name: "changed" },
        userId: userA,
      }),
    ).toEqual({ status: "idempotency-conflict" });
    expect(
      await store.create({
        createdAt: now,
        idempotencyKey: "same-key",
        poolEligible: false,
        request,
        userId: userA,
      }),
    ).toMatchObject({ status: "replayed", value: { monitorId } });
    expect(
      await store.create({
        createdAt: now,
        idempotencyKey: "blocked-new-key",
        poolEligible: false,
        request,
        userId: userA,
      }),
    ).toEqual({ status: "pool-ineligible" });
    expect(await store.get(userB, monitorId)).toBeNull();
    expect(await store.list(userA, { cursor: null, enabled: null, limit: 50 })).toMatchObject({
      enabledCount: 0,
      totalCount: 1,
    });

    for (const [poolIdentity, constraint] of [
      [`1:0x${"a".repeat(40)}`, "monitors_pool_key_valid"],
      [`56:0x${"A".repeat(40)}`, "monitors_pool_key_valid"],
    ]) {
      await expect(
        pool.query(
          `INSERT INTO monitors (
             monitor_id, user_id, revision, name, pool_key, window_minutes, status,
             conditions, condition_count, enabled_condition_count, exclude_han_token,
             exclude_hook, created_at, updated_at, disabled_at
           ) VALUES (gen_random_uuid(), $1, 1, 'invalid', $2, 5, 'disabled',
                     '[]'::jsonb, 0, 0, false, false, $3, $3, $3)`,
          [userA, poolIdentity, now],
        ),
      ).rejects.toMatchObject({ constraint });
    }
  });

  it("serializes different idempotency keys against the per-user capacity", async () => {
    const store = new PostgresMonitorStore(pool, { capacity: 1 });
    const contenders = await Promise.all([
      store.create({ createdAt: now, idempotencyKey: "capacity-a", request, userId: userB }),
      store.create({
        createdAt: now,
        idempotencyKey: "capacity-b",
        request: { ...request, name: "Capacity B" },
        userId: userB,
      }),
    ]);
    expect(contenders.map(({ status }) => status).sort()).toEqual(["capacity", "created"]);
    expect(await store.list(userB, { cursor: null, enabled: null, limit: 50 })).toMatchObject({
      totalCount: 1,
    });
  });

  it("keeps no-op revision stable and permits one concurrent mutation winner", async () => {
    const store = new PostgresMonitorStore(pool);
    expect(
      await store.patch({
        changes: { name: request.name },
        expectedRevision: 1,
        monitorId,
        updatedAt: now,
        userId: userA,
      }),
    ).toMatchObject({ status: "unchanged", value: { revision: 1 } });

    const contenders = await Promise.all([
      store.patch({
        changes: { name: "winner-a" },
        expectedRevision: 1,
        monitorId,
        updatedAt: new Date("2026-08-17T10:01:00Z"),
        userId: userA,
      }),
      store.patch({
        changes: { name: "winner-b" },
        expectedRevision: 1,
        monitorId,
        updatedAt: new Date("2026-08-17T10:01:01Z"),
        userId: userA,
      }),
    ]);
    expect(contenders.filter(({ status }) => status === "updated")).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === "conflict")).toHaveLength(1);
    const current = (await store.get(userA, monitorId))!;
    expect(current.revision).toBe(2);
    const enabled = await store.setEnabled({
      enabled: true,
      expectedRevision: 2,
      monitorId,
      updatedAt: new Date("2026-08-17T10:02:00Z"),
      userId: userA,
    });
    expect(enabled).toMatchObject({ status: "updated", value: { enabled: true, revision: 3 } });
    expect(
      await store.patch({
        changes: {
          conditions: request.conditions.map((condition) => ({ ...condition, enabled: false })),
        },
        expectedRevision: 3,
        monitorId,
        updatedAt: new Date("2026-08-17T10:02:01Z"),
        userId: userA,
      }),
    ).toMatchObject({ status: "invalid", current: { enabled: true, revision: 3 } });
    const source = new PostgresMonitorEvaluationSource(pool);
    expect(await source.listEnabledForPool(poolKey)).toEqual([
      expect.objectContaining({ enabled: true, monitorId, poolKey, revision: 3, userId: userA }),
    ]);
    expect(await source.get(userA)).toMatchObject({
      blocklistHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      entries: [],
    });
  });

  it("commits candidate, local-sink outbox rows, and monotonic watermark atomically", async () => {
    const repository = new PostgresMonitorCandidateOutboxRepository(pool);
    const base = candidate();
    base.monitorId = monitorId;
    base.monitorRevision = 3;
    base.candidateKey = monitorCandidateKey({
      metricVersion: base.metricVersion,
      monitorId,
      poolKey,
      revision: 3,
      windowEnd: base.windowEnd,
    });
    const destination = {
      channel: "local-sink" as const,
      destinationId: "local-sink-fixture-001",
      destinationRevision: 1,
      payload: { poolKey, sourceGenerationId: base.sourceGenerationId },
    };
    const first = await repository.commitCandidate({
      candidate: base,
      destinations: [destination],
    });
    const duplicate = await repository.commitCandidate({
      candidate: base,
      destinations: [destination],
    });
    expect(first.evidenceAction).toBe("inserted");
    expect(duplicate.evidenceAction).toBe("unchanged");
    expect(duplicate.deliveries[0]?.deliveryId).toBe(first.deliveries[0]?.deliveryId);

    const older = candidate({
      generatedAt: "2026-08-17T09:00:30Z",
      sourceGenerationId: "generation-older",
      windowEnd: "2026-08-17T09:00:00Z",
    });
    older.monitorId = monitorId;
    older.monitorRevision = 3;
    older.candidateKey = monitorCandidateKey({
      metricVersion: older.metricVersion,
      monitorId,
      poolKey,
      revision: 3,
      windowEnd: older.windowEnd,
    });
    await repository.commitCandidate({ candidate: older, destinations: [destination] });

    const counts = await pool.query<{
      candidates: string;
      outbox: string;
      source_generation_id: string;
      window_end: Date;
    }>(
      `SELECT
         (SELECT count(*)::text FROM monitor_candidates WHERE monitor_id = $1) AS candidates,
         (SELECT count(*)::text FROM notification_outbox WHERE monitor_id = $1) AS outbox,
         source_generation_id,
         window_end
       FROM monitor_evaluation_watermarks
       WHERE monitor_id = $1`,
      [monitorId],
    );
    expect(counts.rows[0]).toMatchObject({
      candidates: "2",
      outbox: "2",
      source_generation_id: base.sourceGenerationId,
    });
    expect(counts.rows[0]!.window_end.toISOString()).toBe("2026-08-17T09:05:00.000Z");

    const replacement = {
      ...base,
      generatedAt: "2026-08-17T09:05:40Z",
      sourceGenerationId: "generation-new",
    };
    const replaced = await repository.commitCandidate({
      candidate: replacement,
      destinations: [
        {
          ...destination,
          payload: { poolKey, sourceGenerationId: replacement.sourceGenerationId },
        },
      ],
    });
    expect(replaced.evidenceAction).toBe("replaced");
    const evidence = await pool.query<{ payload: unknown; source_generation_id: string }>(
      `SELECT candidate.source_generation_id, outbox.payload
         FROM monitor_candidates AS candidate
         JOIN notification_outbox AS outbox USING (candidate_key)
        WHERE candidate.candidate_key = $1`,
      [base.candidateKey],
    );
    expect(evidence.rows[0]).toMatchObject({
      payload: { poolKey, sourceGenerationId: "generation-new" },
      source_generation_id: "generation-new",
    });
  });

  it("recovers expired leases, rejects an old token, and never duplicates a delivery", async () => {
    const repository = new PostgresMonitorCandidateOutboxRepository(pool);
    const firstClaim = await repository.claimDue({ leaseOwner: "worker-a", limit: 1 });
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({ attemptCount: 1, state: "leased" });
    await pool.query(
      "UPDATE notification_outbox SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE delivery_id = $1",
      [firstClaim[0]!.deliveryId],
    );
    const secondClaim = await repository.claimDue({ leaseOwner: "worker-b", limit: 1 });
    expect(secondClaim[0]).toMatchObject({
      attemptCount: 2,
      deliveryId: firstClaim[0]!.deliveryId,
    });
    expect(secondClaim[0]!.leaseToken).not.toBe(firstClaim[0]!.leaseToken);
    expect(
      await repository.markDelivered({
        deliveryId: firstClaim[0]!.deliveryId,
        leaseToken: firstClaim[0]!.leaseToken!,
      }),
    ).toBe(false);
    expect(
      await repository.markDelivered({
        deliveryId: secondClaim[0]!.deliveryId,
        leaseToken: secondClaim[0]!.leaseToken!,
      }),
    ).toBe(true);

    const retryClaim = await repository.claimDue({ leaseOwner: "worker-retry-1", limit: 1 });
    expect(retryClaim[0]).toMatchObject({ attemptCount: 1, state: "leased" });
    expect(
      await repository.markRetry({
        deliveryId: retryClaim[0]!.deliveryId,
        errorCode: "HTTP_503",
        leaseToken: retryClaim[0]!.leaseToken!,
      }),
    ).toBe(true);
    const retryWait = await pool.query<{
      attempt_count: number;
      next_attempt_at: Date | null;
      state: string;
    }>(
      "SELECT state, attempt_count, next_attempt_at FROM notification_outbox WHERE delivery_id = $1",
      [retryClaim[0]!.deliveryId],
    );
    expect(retryWait.rows[0]).toMatchObject({ attempt_count: 1, state: "retry-wait" });
    expect(retryWait.rows[0]!.next_attempt_at).toBeInstanceOf(Date);
    await pool.query(
      "UPDATE notification_outbox SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE delivery_id = $1",
      [retryClaim[0]!.deliveryId],
    );
    const retryClaimTwo = await repository.claimDue({ leaseOwner: "worker-retry-2", limit: 1 });
    expect(retryClaimTwo[0]).toMatchObject({
      attemptCount: 2,
      deliveryId: retryClaim[0]!.deliveryId,
      state: "leased",
    });
    expect(
      await repository.markDelivered({
        deliveryId: retryClaimTwo[0]!.deliveryId,
        leaseToken: retryClaimTwo[0]!.leaseToken!,
      }),
    ).toBe(true);

    const deadCandidate = candidate({
      generatedAt: "2026-08-17T09:15:40Z",
      sourceGenerationId: "generation-new",
      windowEnd: "2026-08-17T09:15:00Z",
    });
    deadCandidate.monitorId = monitorId;
    deadCandidate.monitorRevision = 3;
    deadCandidate.candidateKey = monitorCandidateKey({
      metricVersion: deadCandidate.metricVersion,
      monitorId,
      poolKey,
      revision: 3,
      windowEnd: deadCandidate.windowEnd,
    });
    await repository.commitCandidate({
      candidate: deadCandidate,
      destinations: [
        {
          channel: "local-sink",
          destinationId: "local-sink-dead-fixture",
          destinationRevision: 1,
          payload: { poolKey },
        },
      ],
    });
    const deadClaim = await repository.claimDue({ leaseOwner: "worker-dead", limit: 1 });
    expect(deadClaim).toHaveLength(1);
    expect(
      await repository.markDead({
        deliveryId: deadClaim[0]!.deliveryId,
        errorCode: "UNSAFE_WEBHOOK_TARGET",
        errorSummary: "notification_key=must-not-persist",
        leaseToken: deadClaim[0]!.leaseToken!,
      }),
    ).toBe(true);
    const dead = await pool.query<{
      attempt_count: number;
      last_error_summary: string | null;
      next_attempt_at: Date | null;
      state: string;
    }>(
      `SELECT state, attempt_count, next_attempt_at, last_error_summary
         FROM notification_outbox WHERE delivery_id = $1`,
      [deadClaim[0]!.deliveryId],
    );
    expect(dead.rows).toEqual([
      { attempt_count: 1, last_error_summary: null, next_attempt_at: null, state: "dead" },
    ]);

    const exhaustedCandidate = candidate({
      generatedAt: "2026-08-17T09:20:30Z",
      sourceGenerationId: "generation-exhausted",
      windowEnd: "2026-08-17T09:20:00Z",
    });
    exhaustedCandidate.monitorId = monitorId;
    exhaustedCandidate.monitorRevision = 3;
    exhaustedCandidate.candidateKey = monitorCandidateKey({
      metricVersion: exhaustedCandidate.metricVersion,
      monitorId,
      poolKey,
      revision: 3,
      windowEnd: exhaustedCandidate.windowEnd,
    });
    const exhausted = await repository.commitCandidate({
      candidate: exhaustedCandidate,
      destinations: [
        {
          channel: "local-sink",
          destinationId: "local-sink-exhausted-fixture",
          destinationRevision: 1,
          payload: { poolKey },
        },
      ],
    });
    await pool.query("UPDATE notification_outbox SET attempt_count = 5 WHERE delivery_id = $1", [
      exhausted.deliveries[0]!.deliveryId,
    ]);
    const exhaustedClaim = await repository.claimDue({ leaseOwner: "worker-exhausted", limit: 1 });
    expect(exhaustedClaim[0]).toMatchObject({ attemptCount: 6, state: "leased" });
    expect(
      await repository.markRetry({
        deliveryId: exhaustedClaim[0]!.deliveryId,
        errorCode: "HTTP_503",
        leaseToken: exhaustedClaim[0]!.leaseToken!,
      }),
    ).toBe(true);
    const exhaustedState = await pool.query<{
      last_error_code: string | null;
      next_attempt_at: Date | null;
      state: string;
    }>(
      "SELECT state, next_attempt_at, last_error_code FROM notification_outbox WHERE delivery_id = $1",
      [exhaustedClaim[0]!.deliveryId],
    );
    expect(exhaustedState.rows).toEqual([
      { last_error_code: "MAX_ATTEMPTS", next_attempt_at: null, state: "dead" },
    ]);
  });

  it("rolls back candidate and watermark on outbox failure and rejects notification keys", async () => {
    const repository = new PostgresMonitorCandidateOutboxRepository(pool);
    const rollbackCandidate = candidate({
      generatedAt: "2026-08-17T09:15:30Z",
      sourceGenerationId: "generation-rollback",
      windowEnd: "2026-08-17T09:15:00Z",
    });
    rollbackCandidate.monitorId = monitorId;
    rollbackCandidate.monitorRevision = 3;
    rollbackCandidate.candidateKey = monitorCandidateKey({
      metricVersion: rollbackCandidate.metricVersion,
      monitorId,
      poolKey,
      revision: 3,
      windowEnd: rollbackCandidate.windowEnd,
    });
    await expect(
      repository.commitCandidate({
        candidate: rollbackCandidate,
        destinations: [
          {
            channel: "local-sink",
            destinationId: "rollback-valid-fixture",
            destinationRevision: 1,
            payload: { poolKey },
          },
          {
            channel: "local-sink",
            destinationId: "rollback-fixture",
            destinationRevision: -1,
            payload: { poolKey },
          },
        ],
      }),
    ).rejects.toBeDefined();
    expect(
      await pool.query("SELECT 1 FROM monitor_candidates WHERE candidate_key = $1", [
        rollbackCandidate.candidateKey,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await pool.query("SELECT 1 FROM notification_outbox WHERE candidate_key = $1", [
        rollbackCandidate.candidateKey,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await pool.query(
        "SELECT 1 FROM monitor_evaluation_watermarks WHERE monitor_id = $1 AND window_end = $2",
        [monitorId, rollbackCandidate.windowEnd],
      ),
    ).toMatchObject({ rowCount: 0 });

    await expect(
      repository.commitCandidate({
        candidate: rollbackCandidate,
        destinations: [
          {
            channel: "local-sink",
            destinationId: "secret-fixture",
            destinationRevision: 1,
            payload: { botToken: "must-not-persist" },
          },
        ],
      }),
    ).rejects.toThrow("OUTBOX_SECRET_FIELD_FORBIDDEN");
    for (const payload of [
      { bot_token: "must-not-persist" },
      { nested: { "notification-key": "must-not-persist" } },
      { Webhook_Secret: "must-not-persist" },
    ]) {
      await expect(
        repository.commitCandidate({
          candidate: rollbackCandidate,
          destinations: [
            {
              channel: "local-sink",
              destinationId: "secret-variant-fixture",
              destinationRevision: 1,
              payload,
            },
          ],
        }),
      ).rejects.toThrow("OUTBOX_SECRET_FIELD_FORBIDDEN");
    }
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notification_outbox'`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).not.toContain("notification_key");
  });
});
