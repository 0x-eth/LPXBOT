import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresMonitorStore } from "../../apps/api/src/postgres-monitor-store.js";
import { PostgresNotificationConfigurationStore } from "../../apps/api/src/postgres-notification-store.js";
import type { NotificationSecretStore } from "../../apps/api/src/notifications.js";
import { PostgresMonitorDestinationSelector } from "../../apps/worker/src/postgres-monitor-destination-selector.js";
import { PostgresMonitorCandidateOutboxRepository } from "../../apps/worker/src/postgres-monitor-outbox.js";
import type {
  CreateMonitorRequest,
  DestinationDraft,
} from "../../packages/api-contract/src/index.js";
import {
  monitorCandidateKey,
  type MonitorCandidate,
  type MonitorEvaluationDefinition,
} from "../../packages/domain/src/monitor-evaluator.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0303_notifications_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 12 });

const userA = "33000000-0000-4000-8000-000000000011";
const userB = "33000000-0000-4000-8000-000000000012";
const telegramA = "710000000001";
const telegramB = "710000000002";
const now = new Date("2026-08-18T01:00:00.000Z");
const poolKey = `56:0x${"d".repeat(40)}` as const;

const webhookDraft: DestinationDraft = {
  categories: ["monitor-match"],
  config: {
    method: "POST",
    signingSecret: "postgres-fixture-signing-key-material-0001",
    template: { message: "{{condition.summary}}" },
    url: "https://hooks.example.test/lpx",
  },
  enabled: true,
  name: "PostgreSQL webhook",
  type: "webhook",
};

class FixtureSecretStore implements NotificationSecretStore {
  readonly values = new Map<string, string>();
  failDelete = false;
  failPut = false;
  #sequence = 0;

  async delete(secretRef: string): Promise<void> {
    if (this.failDelete) throw new Error("fixture secret delete failure");
    this.values.delete(secretRef);
  }

  async put(input: {
    kind: "telegram-bot-token" | "webhook-hmac";
    secret: string;
    userId: string;
  }): Promise<{ secretRef: string }> {
    if (this.failPut) throw new Error("fixture secret put failure");
    this.#sequence += 1;
    const secretRef = `secret-ref://postgres-fixture/${input.kind}/${this.#sequence}`;
    this.values.set(secretRef, input.secret);
    return { secretRef };
  }
}

const secrets = new FixtureSecretStore();

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
       ($1, 'user', 'normal', 'active', 'Notify A', NULL, $3, $3),
       ($2, 'user', 'normal', 'active', 'Notify B', NULL, $3, $3)`,
    [userA, userB, now],
  );
  await pool.query(
    `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
     VALUES ($3, $1, $5), ($4, $2, $5)`,
    [userA, userB, telegramA, telegramB, now],
  );
}, 30_000);

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

function monitorRequest(destinationIds: string[]): CreateMonitorRequest {
  return {
    conditions: [{ enabled: true, id: "volumeUsd", operator: "gte", value: "1000" }],
    destinationIds,
    excludeHanToken: false,
    excludeHook: false,
    name: "Bound PostgreSQL monitor",
    poolKey,
    windowMinutes: 5,
  };
}

function candidate(
  monitor: MonitorEvaluationDefinition,
  windowEnd = "2026-08-18T00:55:00.000Z",
): MonitorCandidate {
  const generatedAt = new Date(new Date(windowEnd).getTime() + 30_000).toISOString();
  return {
    blocklistHash: `sha256:${"1".repeat(64)}`,
    candidateKey: monitorCandidateKey({
      metricVersion: "market-metrics/v1",
      monitorId: monitor.monitorId,
      poolKey,
      revision: monitor.revision,
      windowEnd,
    }),
    canonicalBlockHash: `0x${"2".repeat(64)}`,
    createdAt: "2026-08-18T01:00:00.000Z",
    generatedAt,
    matchedConditions: structuredClone(monitor.conditions),
    metricVersion: "market-metrics/v1",
    monitorId: monitor.monitorId,
    monitorRevision: monitor.revision,
    poolKey,
    sourceGenerationId: `generation-${windowEnd}`,
    userId: monitor.userId,
    windowEnd,
  };
}

describe("P03-03 PostgreSQL notification configuration", () => {
  let destinationId = "";
  let destinationRevision = 0;

  it("defaults preferences off and serializes CAS updates without duplicate revisions", async () => {
    const store = new PostgresNotificationConfigurationStore(pool, { secrets });
    expect(await store.getPreferences(userA)).toMatchObject({
      categories: { "monitor-match": false, "task-created": false },
      revision: 0,
      updatedAt: null,
    });
    const contenders = await Promise.all([
      store.updatePreferences({
        patch: { categories: { "monitor-match": true }, expectedRevision: 0 },
        updatedAt: now,
        userId: userA,
      }),
      store.updatePreferences({
        patch: { categories: { "monitor-match": true }, expectedRevision: 0 },
        updatedAt: now,
        userId: userA,
      }),
    ]);
    expect(contenders.filter(({ status }) => status === "updated")).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === "conflict")).toHaveLength(1);
    expect(
      await store.updatePreferences({
        patch: { categories: { "monitor-match": true }, expectedRevision: 1 },
        updatedAt: now,
        userId: userA,
      }),
    ).toMatchObject({ status: "unchanged", value: { revision: 1 } });
    expect(await store.getPreferences(userB)).toMatchObject({
      categories: { "monitor-match": false },
      revision: 0,
    });
  });

  it("serializes idempotent creates, owns Telegram identities, and stores only secret refs", async () => {
    const store = new PostgresNotificationConfigurationStore(pool, { secrets });
    const contenders = await Promise.all([
      store.createDestination({
        createdAt: now,
        draft: webhookDraft,
        idempotencyKey: "same-create",
        userId: userA,
      }),
      store.createDestination({
        createdAt: now,
        draft: structuredClone(webhookDraft),
        idempotencyKey: "same-create",
        userId: userA,
      }),
    ]);
    expect(contenders.map(({ status }) => status).sort()).toEqual(["created", "replayed"]);
    const values = contenders.flatMap((result) => ("value" in result ? [result.value] : []));
    destinationId = values[0]!.destinationId;
    destinationRevision = 1;
    expect(new Set(values.map(({ destinationId: id }) => id))).toEqual(new Set([destinationId]));
    expect(secrets.values.size).toBe(1);
    expect(values[0]).toMatchObject({
      config: { secretConfigured: true, secretRef: expect.stringMatching(/^secret-ref:\/\//u) },
      revision: 1,
      userId: userA,
    });
    expect(JSON.stringify(values)).not.toContain(webhookDraft.config.signingSecret);

    expect(
      await store.createDestination({
        createdAt: now,
        draft: { ...webhookDraft, name: "Changed payload" },
        idempotencyKey: "same-create",
        userId: userA,
      }),
    ).toEqual({ status: "idempotency-conflict" });
    expect(await store.listDestinations(userB)).toEqual([]);

    const invalidTelegram = await store.createDestination({
      createdAt: now,
      draft: {
        categories: ["monitor-match"],
        config: {
          botToken: "710000000002:postgres-fixture-token-material",
          telegramIdentityId: telegramB,
          template: "{{monitor.name}}",
        },
        enabled: true,
        name: "Cross identity",
        type: "telegram",
      },
      idempotencyKey: "cross-identity",
      userId: userA,
    });
    expect(invalidTelegram).toEqual({ status: "invalid" });

    const persisted = await pool.query<{ config: unknown; secret_ref: string | null }>(
      `SELECT config, secret_ref
         FROM notification_destination_versions
        WHERE destination_id = $1`,
      [destinationId],
    );
    expect(persisted.rows).toHaveLength(1);
    expect(JSON.stringify(persisted.rows)).not.toContain(webhookDraft.config.signingSecret);
    expect(persisted.rows[0]!.secret_ref).toMatch(/^secret-ref:\/\//u);
  });

  it("permits one concurrent update, keeps immutable history, and cleans failed secret writes", async () => {
    const store = new PostgresNotificationConfigurationStore(pool, { secrets });
    const contenders = await Promise.all([
      store.patchDestination({
        destinationId,
        patch: { changes: { name: "Winner A" }, expectedRevision: 1 },
        updatedAt: new Date("2026-08-18T01:01:00.000Z"),
        userId: userA,
      }),
      store.patchDestination({
        destinationId,
        patch: { changes: { name: "Winner B" }, expectedRevision: 1 },
        updatedAt: new Date("2026-08-18T01:01:01.000Z"),
        userId: userA,
      }),
    ]);
    expect(contenders.filter(({ status }) => status === "updated")).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === "conflict")).toHaveLength(1);
    destinationRevision = 2;

    const secretUpdate = await store.patchDestination({
      destinationId,
      patch: {
        changes: { config: { signingSecret: "postgres-replacement-signing-key-material-0002" } },
        expectedRevision: 2,
      },
      updatedAt: new Date("2026-08-18T01:02:00.000Z"),
      userId: userA,
    });
    expect(secretUpdate).toMatchObject({ status: "updated", value: { revision: 3 } });
    destinationRevision = 3;
    expect(secrets.values.size).toBe(2);

    const noOp = await store.patchDestination({
      destinationId,
      patch: { changes: { enabled: true }, expectedRevision: 3 },
      updatedAt: new Date("2026-08-18T01:03:00.000Z"),
      userId: userA,
    });
    expect(noOp).toMatchObject({ status: "unchanged", value: { revision: 3 } });
    const versions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM notification_destination_versions WHERE destination_id = $1",
      [destinationId],
    );
    expect(versions.rows[0]?.count).toBe("3");
    await expect(
      pool.query(
        "UPDATE notification_destination_versions SET name = 'mutated' WHERE destination_id = $1 AND revision = 1",
        [destinationId],
      ),
    ).rejects.toMatchObject({ code: "55000" });

    const cleanupSecrets = new FixtureSecretStore();
    const failing = new PostgresNotificationConfigurationStore(pool, {
      idFactory: () => "not-a-uuid",
      secrets: cleanupSecrets,
    });
    expect(
      await failing.createDestination({
        createdAt: now,
        draft: webhookDraft,
        idempotencyKey: "rollback-secret",
        userId: userB,
      }),
    ).toEqual({ status: "service-unavailable" });
    expect(cleanupSecrets.values.size).toBe(0);
    expect(
      await pool.query(
        "SELECT 1 FROM notification_destinations WHERE user_id = $1 AND created_at = $2",
        [userB, now],
      ),
    ).toMatchObject({ rowCount: 0 });

    const unavailable = new PostgresNotificationConfigurationStore(pool);
    expect(
      await unavailable.createDestination({
        createdAt: now,
        draft: webhookDraft,
        idempotencyKey: "no-secret-store",
        userId: userB,
      }),
    ).toEqual({ status: "service-unavailable" });
  });

  it("binds owned destinations and selects only explicit enabled category snapshots", async () => {
    const monitorStore = new PostgresMonitorStore(pool);
    const created = await monitorStore.create({
      createdAt: now,
      idempotencyKey: "bound-monitor",
      poolEligible: true,
      request: monitorRequest([destinationId]),
      userId: userA,
    });
    expect(created).toMatchObject({
      status: "created",
      value: { destinationIds: [destinationId], revision: 1 },
    });
    if (!("value" in created)) throw new Error("monitor create failed");
    const enabled = await monitorStore.setEnabled({
      enabled: true,
      expectedRevision: 1,
      monitorId: created.value.monitorId,
      updatedAt: new Date("2026-08-18T01:04:00.000Z"),
      userId: userA,
    });
    if (!("value" in enabled)) throw new Error("monitor enable failed");
    expect(enabled.value).toMatchObject({ destinationIds: [destinationId], revision: 2 });
    const definition = enabled.value as MonitorEvaluationDefinition;
    const firstCandidate = candidate(definition);
    const selector = new PostgresMonitorDestinationSelector(pool);
    const selected = await selector.select({
      candidate: firstCandidate,
      category: "monitor-match",
      monitor: definition,
    });
    expect(selected).toEqual([
      expect.objectContaining({
        channel: "webhook",
        destinationId,
        destinationRevision,
        payload: {
          category: "monitor-match",
          conditionSummary: expect.any(String),
          metricVersion: firstCandidate.metricVersion,
          monitorId: definition.monitorId,
          monitorName: definition.name,
          monitorRevision: definition.revision,
          poolKey,
          windowEnd: firstCandidate.windowEnd,
        },
      }),
    ]);
    expect(JSON.stringify(selected)).not.toMatch(/secret|token|url|template/iu);

    const otherDestination = await new PostgresNotificationConfigurationStore(pool, {
      secrets,
    }).createDestination({
      createdAt: now,
      draft: webhookDraft,
      idempotencyKey: "other-owner-destination",
      userId: userB,
    });
    if (!("value" in otherDestination)) throw new Error("other destination create failed");
    const denied = await monitorStore.patch({
      changes: { destinationIds: [otherDestination.value.destinationId] },
      expectedRevision: definition.revision,
      monitorId: definition.monitorId,
      updatedAt: new Date("2026-08-18T01:05:00.000Z"),
      userId: userA,
    });
    expect(denied).toMatchObject({ status: "destination-not-found" });
    expect(await monitorStore.get(userA, definition.monitorId)).toMatchObject({
      destinationIds: [destinationId],
      revision: definition.revision,
    });
  });

  it("dedupes concurrent Outbox writes, snapshots revision, and never backfills old candidates", async () => {
    const monitorStore = new PostgresMonitorStore(pool);
    const monitor = (await monitorStore.list(userA, { cursor: null, enabled: true, limit: 10 })).items[0]!;
    const definition = monitor as MonitorEvaluationDefinition;
    const firstCandidate = candidate(definition);
    const selector = new PostgresMonitorDestinationSelector(pool);
    const repository = new PostgresMonitorCandidateOutboxRepository(pool);
    const selected = await selector.select({
      candidate: firstCandidate,
      category: "monitor-match",
      monitor: definition,
    });
    const committed = await Promise.all([
      repository.commitCandidate({ candidate: firstCandidate, destinations: selected }),
      repository.commitCandidate({ candidate: firstCandidate, destinations: selected }),
    ]);
    const deliveryIds = new Set(
      committed.flatMap(({ deliveries }) => deliveries.map(({ deliveryId }) => deliveryId)),
    );
    expect(deliveryIds.size).toBe(1);

    const store = new PostgresNotificationConfigurationStore(pool, { secrets });
    const revised = await store.patchDestination({
      destinationId,
      patch: { changes: { name: "Revision four" }, expectedRevision: destinationRevision },
      updatedAt: new Date("2026-08-18T01:06:00.000Z"),
      userId: userA,
    });
    expect(revised).toMatchObject({ status: "updated", value: { revision: 4 } });
    destinationRevision = 4;
    const revisedSelection = await selector.select({
      candidate: firstCandidate,
      category: "monitor-match",
      monitor: definition,
    });
    expect(revisedSelection[0]?.destinationRevision).toBe(4);
    await repository.commitCandidate({ candidate: firstCandidate, destinations: revisedSelection });
    expect(
      await pool.query(
        "SELECT 1 FROM notification_outbox WHERE candidate_key = $1 ORDER BY destination_revision",
        [firstCandidate.candidateKey],
      ),
    ).toMatchObject({ rowCount: 1 });

    const secondCandidate = candidate(definition, "2026-08-18T01:00:00.000Z");
    await repository.commitCandidate({
      candidate: secondCandidate,
      destinations: await selector.select({
        candidate: secondCandidate,
        category: "monitor-match",
        monitor: definition,
      }),
    });
    const outbox = await pool.query<{
      destination_revision: string;
      payload: unknown;
      dedupe_key: string;
    }>(
      `SELECT destination_revision::text, payload, dedupe_key
         FROM notification_outbox
        WHERE monitor_id = $1
        ORDER BY destination_revision`,
      [definition.monitorId],
    );
    expect(outbox.rows.map(({ destination_revision }) => destination_revision)).toEqual(["3", "4"]);
    expect(new Set(outbox.rows.map(({ dedupe_key }) => dedupe_key)).size).toBe(2);
    expect(JSON.stringify(outbox.rows)).not.toMatch(/secret|token|url|template/iu);
  });

  it("uses a tombstone without deleting Outbox and stores non-monitor categories only", async () => {
    const store = new PostgresNotificationConfigurationStore(pool, { secrets });
    const outboxBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM notification_outbox WHERE destination_id = $1",
      [destinationId],
    );
    expect(outboxBefore.rows[0]?.count).toBe("2");
    expect(
      await store.updatePreferences({
        patch: { categories: { "task-created": true }, expectedRevision: 1 },
        updatedAt: new Date("2026-08-18T01:07:00.000Z"),
        userId: userA,
      }),
    ).toMatchObject({ status: "updated", value: { revision: 2 } });
    const outboxAfterPreference = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM notification_outbox WHERE destination_id = $1",
      [destinationId],
    );
    expect(outboxAfterPreference.rows[0]?.count).toBe("2");

    expect(
      await store.deleteDestination({
        destinationId,
        expectedRevision: destinationRevision,
        updatedAt: new Date("2026-08-18T01:08:00.000Z"),
        userId: userA,
      }),
    ).toEqual({ status: "deleted" });
    expect(await store.listDestinations(userA)).toEqual([]);
    const persisted = await pool.query<{
      binding_count: string;
      outbox_count: string;
      revision: string;
      tombstone: boolean;
    }>(
      `SELECT
         (SELECT count(*)::text FROM monitor_notification_destination_bindings
           WHERE destination_id = $1) AS binding_count,
         (SELECT count(*)::text FROM notification_outbox
           WHERE destination_id = $1) AS outbox_count,
         revision::text,
         tombstone
       FROM notification_destination_versions
       WHERE destination_id = $1
       ORDER BY revision DESC
       LIMIT 1`,
      [destinationId],
    );
    expect(persisted.rows[0]).toEqual({
      binding_count: "0",
      outbox_count: "2",
      revision: "5",
      tombstone: true,
    });
  });
});
