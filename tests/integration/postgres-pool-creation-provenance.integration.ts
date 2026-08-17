import {
  PoolCreationProvenanceConflictError,
  PostgresPoolCreationProvenanceStore,
  type PoolCreationProvenanceRecord,
} from "../../apps/api/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 12 });
const runId = randomUUID();
const operationPrefix = `${randomUUID().slice(0, 24)}`;
const users = [randomUUID(), randomUUID(), randomUUID()] as const;
const identity = (label: string, length: 40 | 64): PoolCreationProvenanceRecord["poolKey"] =>
  `56:0x${createHash("sha256").update(`${runId}:${label}`).digest("hex").slice(0, length)}`;
const v3PoolKey = identity("v3", 40);
const otherV3PoolKey = identity("other-v3", 40);
const v4PoolKey = identity("v4", 64);
const completedAt = "2026-08-17T10:00:00.000Z";
const adapterOptions = { now: () => new Date("2026-08-17T12:00:00.000Z") };

function record(
  operationSuffix: number,
  overrides: Partial<PoolCreationProvenanceRecord> = {},
): PoolCreationProvenanceRecord {
  return {
    chainId: 56,
    completedAt,
    creatorAddress: `0x${"d".repeat(40)}`,
    feePips: "2500",
    operationId: `${operationPrefix}${String(operationSuffix).padStart(12, "0")}`,
    outcome: "created",
    poolKey: v3PoolKey,
    protocol: "pcsv3",
    schemaVersion: 1,
    txHash: `0x${operationSuffix.toString(16).padStart(64, "0")}`,
    userId: users[0],
    ...overrides,
  };
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Creator One', NULL, $4, $4),
       ($2, 'user', 'normal', 'active', 'Creator Two', NULL, $4, $4),
       ($3, 'user', 'normal', 'active', 'Creator Three', NULL, $4, $4)`,
    [...users, new Date(completedAt)],
  );
  await pool.query(
    `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
     VALUES (8800201, $1, $4), (8800202, $2, $4), (8800203, $3, $4)`,
    [...users, new Date(completedAt)],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await pool.end();
});

describe("P02-12 PostgreSQL pool creation provenance ledger", () => {
  it("has append-only constraints for users, V3/V4 identity, operation, transaction, outcome and time", async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'pool_creation_provenance',
            'pool_creation_provenance_conflicts',
            'pool_creator_query_audit_events'
          )
        ORDER BY table_name`,
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "pool_creation_provenance",
      "pool_creation_provenance_conflicts",
      "pool_creator_query_audit_events",
    ]);

    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const saved = await adapter.record(record(1));
    expect(saved.status).toBe("inserted");
    await expect(
      pool.query("UPDATE pool_creation_provenance SET fee_pips = 500 WHERE operation_id = $1", [
        record(1).operationId,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
    await expect(
      pool.query("DELETE FROM pool_creation_provenance WHERE operation_id = $1", [
        record(1).operationId,
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });

    expect(
      await adapter.record(
        record(90, {
          poolKey: v3PoolKey.toUpperCase().replace("0X", "0x") as `56:0x${string}`,
        }),
      ),
    ).toMatchObject({ record: { poolKey: v3PoolKey }, status: "inserted" });
    await expect(
      pool.query(
        `INSERT INTO pool_creation_provenance (
           operation_id, user_id, chain_id, pool_key, protocol, creator_address,
           fee_pips, tx_hash, outcome, completed_at, schema_version, payload_sha256, recorded_at
         ) VALUES ($1, $2, 56, $3, 'pcsv3', $4, 2500, $5, 'created', $6, 1, $7, $8)`,
        [
          record(95).operationId,
          users[0],
          v3PoolKey.toUpperCase().replace("0X", "0x"),
          record(95).creatorAddress,
          record(95).txHash,
          completedAt,
          `sha256:${"0".repeat(64)}`,
          adapterOptions.now(),
        ],
      ),
    ).rejects.toThrow();

    for (const invalid of [
      record(91, { poolKey: v4PoolKey, protocol: "pcsv3" }),
      record(92, { creatorAddress: null }),
      record(93, { txHash: null }),
      record(94, { outcome: "invalid" as never }),
    ]) {
      await expect(adapter.record(invalid)).rejects.toThrow();
    }
  });

  it("is idempotent for the same operation payload and records only hashes for conflicts", async () => {
    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const input = record(2);
    expect(await adapter.record(input)).toMatchObject({ status: "inserted" });
    expect(await adapter.record(structuredClone(input))).toMatchObject({ status: "idempotent" });
    await expect(adapter.record({ ...input, feePips: "500" })).rejects.toBeInstanceOf(
      PoolCreationProvenanceConflictError,
    );
    const evidence = await pool.query<{
      attempted_payload_sha256: string;
      existing_payload_sha256: string;
      operation_id: string;
    }>(
      `SELECT operation_id::text, attempted_payload_sha256, existing_payload_sha256
         FROM pool_creation_provenance_conflicts
        WHERE operation_id = $1
        ORDER BY id DESC LIMIT 1`,
      [input.operationId],
    );
    expect(evidence.rows).toEqual([
      {
        attempted_payload_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        existing_payload_sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        operation_id: input.operationId,
      },
    ]);
    expect(JSON.stringify(evidence.rows)).not.toContain(input.creatorAddress);
    expect(JSON.stringify(evidence.rows)).not.toContain(input.txHash);
  });

  it("serializes concurrent writes and remains persistent across adapter recreation", async () => {
    const input = record(3);
    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const results = await Promise.all(Array.from({ length: 8 }, () => adapter.record(input)));
    expect(results.filter(({ status }) => status === "inserted")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "idempotent")).toHaveLength(7);

    const restarted = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const page = await restarted.listByUser({ cursor: null, limit: 100, userId: users[0] });
    expect(page.items.some(({ record: item }) => item.operationId === input.operationId)).toBe(
      true,
    );
  });

  it("paginates completedAt and identity id in a stable descending order", async () => {
    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const inputs = [4, 5, 6, 7].map((suffix) =>
      record(suffix, {
        completedAt: suffix === 7 ? "2026-08-17T10:01:00.000Z" : completedAt,
        poolKey: otherV3PoolKey,
      }),
    );
    for (const input of inputs) await adapter.record(input);
    const first = await adapter.listByUser({ cursor: null, limit: 2, userId: users[0] });
    const second = await adapter.listByUser({
      cursor: first.nextCursor,
      limit: 2,
      userId: users[0],
    });
    expect(first.items.map(({ record: item }) => item.operationId)).toEqual([
      inputs[3]!.operationId,
      inputs[2]!.operationId,
    ]);
    expect(second.items.map(({ record: item }) => item.operationId)).toEqual([
      inputs[1]!.operationId,
      inputs[0]!.operationId,
    ]);
    expect(
      new Set([...first.items, ...second.items].map(({ record: item }) => item.operationId)).size,
    ).toBe(4);
  });

  it("chooses the earliest created attempt, falling back to warned already_exists", async () => {
    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    await adapter.record(
      record(10, {
        completedAt: "2026-08-17T09:00:00.000Z",
        outcome: "already_exists",
        poolKey: v4PoolKey,
        protocol: "pcsv4",
        userId: users[0],
      }),
    );
    await adapter.record(
      record(11, {
        completedAt: "2026-08-17T09:30:00.000Z",
        poolKey: v4PoolKey,
        protocol: "pcsv4",
        userId: users[1],
      }),
    );
    await adapter.record(
      record(12, {
        completedAt: "2026-08-17T09:45:00.000Z",
        poolKey: v4PoolKey,
        protocol: "pcsv4",
        userId: users[2],
      }),
    );
    expect(
      await adapter.findAttribution(v4PoolKey.toUpperCase().replace("0X", "0x")),
    ).toMatchObject({
      creatorProfile: { displayName: "Creator Two", telegramId: "8800202" },
      record: { operationId: record(11).operationId, outcome: "created", userId: users[1] },
      warning: null,
    });

    const fallbackKey = identity("fallback", 64);
    await adapter.record(
      record(13, {
        completedAt: "2026-08-17T08:00:00.000Z",
        creatorAddress: null,
        outcome: "already_exists",
        poolKey: fallbackKey,
        protocol: "univ4",
        txHash: null,
        userId: users[2],
      }),
    );
    await adapter.record(
      record(14, {
        completedAt: "2026-08-17T08:30:00.000Z",
        outcome: "already_exists",
        poolKey: fallbackKey,
        protocol: "univ4",
        userId: users[1],
      }),
    );
    expect(await adapter.findAttribution(fallbackKey)).toMatchObject({
      record: { operationId: record(13).operationId, outcome: "already_exists" },
      warning: "ALREADY_EXISTS_NOT_PLATFORM_FIRST",
    });
    expect(await adapter.findAttribution(identity("missing", 64))).toBeNull();
  });

  it("isolates personal history and preserves a safe deleted-user attribution", async () => {
    const adapter = new PostgresPoolCreationProvenanceStore(pool, adapterOptions);
    const deletedKey = identity("deleted", 40);
    const deletedRecord = record(20, { poolKey: deletedKey, userId: users[2] });
    await adapter.record(deletedRecord);
    expect(
      (await adapter.listByUser({ cursor: null, limit: 100, userId: users[1] })).items,
    ).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          record: expect.objectContaining({ operationId: deletedRecord.operationId }),
        }),
      ]),
    );
    await pool.query("DELETE FROM users WHERE id = $1", [users[2]]);
    expect(await adapter.findAttribution(deletedKey)).toMatchObject({
      creatorProfile: null,
      record: { operationId: deletedRecord.operationId, userId: users[2] },
    });
  });
});
