import {
  PostgresPoolBlocklistStore,
  type PoolBlocklistMutationInput,
} from "../../apps/api/src/index.js";
import type { PoolBlocklistOperation } from "../../packages/api-contract/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const userIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
] as const;
const poolKey = `56:0x${"1".repeat(40)}` as const;
const v4PoolKey = `56:0x${"2".repeat(64)}` as const;
const tokenAddress = `0x${"a".repeat(40)}` as const;
const now = new Date("2026-08-17T08:30:00.000Z");
const pool = new Pool({ connectionString: databaseUrl, max: 8 });

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Blocklist A', NULL, $4, $4),
       ($2, 'user', 'normal', 'active', 'Blocklist B', NULL, $4, $4),
       ($3, 'user', 'normal', 'active', 'Blocklist C', NULL, $4, $4)`,
    [...userIds, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
});

function input(
  userId: string,
  expectedRevision: number,
  operation: PoolBlocklistOperation,
): PoolBlocklistMutationInput {
  return { expectedRevision, operation, updatedAt: now, userId };
}

describe("P02-11 PostgreSQL pool blocklist", () => {
  it("migrates user-owned state and unique entries with canonical identity constraints", async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('user_pool_blocklist_state', 'user_pool_blocklist_entries')
        ORDER BY table_name`,
    );
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "user_pool_blocklist_entries",
      "user_pool_blocklist_state",
    ]);
    const columns = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('user_pool_blocklist_state', 'user_pool_blocklist_entries')
        ORDER BY table_name, ordinal_position`,
    );
    expect(columns.rows).toEqual([
      { column_name: "user_id", table_name: "user_pool_blocklist_entries" },
      { column_name: "chain_id", table_name: "user_pool_blocklist_entries" },
      { column_name: "scope", table_name: "user_pool_blocklist_entries" },
      { column_name: "identity", table_name: "user_pool_blocklist_entries" },
      { column_name: "label", table_name: "user_pool_blocklist_entries" },
      { column_name: "created_at", table_name: "user_pool_blocklist_entries" },
      { column_name: "updated_at", table_name: "user_pool_blocklist_entries" },
      { column_name: "user_id", table_name: "user_pool_blocklist_state" },
      { column_name: "schema_version", table_name: "user_pool_blocklist_state" },
      { column_name: "revision", table_name: "user_pool_blocklist_state" },
      { column_name: "created_at", table_name: "user_pool_blocklist_state" },
      { column_name: "updated_at", table_name: "user_pool_blocklist_state" },
    ]);
    const unique = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'user_pool_blocklist_entries_identity_key'`,
    );
    expect(unique.rows[0]?.definition).toBe("UNIQUE (user_id, scope, chain_id, identity)");

    for (const [scope, identity, constraint] of [
      ["token", "WBNB", "user_pool_blocklist_entries_identity_valid"],
      ["token", `0x${"A".repeat(40)}`, "user_pool_blocklist_entries_identity_valid"],
      ["pool", poolKey.slice(3), "user_pool_blocklist_entries_identity_valid"],
      ["pool", `56:0x${"F".repeat(40)}`, "user_pool_blocklist_entries_identity_valid"],
    ] as const) {
      await expect(
        pool.query(
          `INSERT INTO user_pool_blocklist_entries (
             user_id, chain_id, scope, identity, label, created_at, updated_at
           ) VALUES ($1, 56, $2, $3, NULL, $4, $4)`,
          [userIds[0], scope, identity, now],
        ),
      ).rejects.toMatchObject({ constraint });
    }
  });

  it("allows one concurrent revision winner and keeps entry plus revision in one transaction", async () => {
    const store = new PostgresPoolBlocklistStore(pool);
    expect(await store.get(userIds[0])).toMatchObject({ entries: [], revision: 0, updatedAt: null });
    const operations = [
      {
        entry: { chainId: 56 as const, identity: tokenAddress, scope: "token" as const },
        type: "block" as const,
      },
      {
        entry: { chainId: 56 as const, identity: poolKey, scope: "pool" as const },
        type: "block" as const,
      },
    ];
    const results = await Promise.all(
      operations.map((operation) => store.mutate(input(userIds[0], 0, operation))),
    );
    expect(results.filter(({ status }) => status === "updated")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "conflict")).toHaveLength(1);
    const current = await store.get(userIds[0]);
    expect(current).toMatchObject({ revision: 1, updatedAt: now.toISOString() });
    expect(current.entries).toHaveLength(1);
    const state = await pool.query<{ entries: string; revision: string }>(
      `SELECT state.revision::text,
              (SELECT count(*)::text FROM user_pool_blocklist_entries AS entry
                WHERE entry.user_id = state.user_id) AS entries
         FROM user_pool_blocklist_state AS state
        WHERE state.user_id = $1`,
      [userIds[0]],
    );
    expect(state.rows).toEqual([{ entries: "1", revision: "1" }]);

    const winningEntry = current.entries[0]!;
    const idempotent = await store.mutate(
      input(userIds[0], 1, { entry: winningEntry, type: "block" }),
    );
    expect(idempotent).toMatchObject({ status: "unchanged", value: { revision: 1 } });
    const stale = await store.mutate(
      input(userIds[0], 0, {
        entry: { chainId: 56, identity: v4PoolKey, scope: "pool" },
        type: "block",
      }),
    );
    expect(stale).toMatchObject({ current: { revision: 1 }, status: "conflict" });
    const restored = await store.mutate(
      input(userIds[0], 1, {
        entry: { chainId: 56, identity: winningEntry.identity, scope: winningEntry.scope },
        type: "restore",
      }),
    );
    expect(restored).toMatchObject({ status: "updated", value: { entries: [], revision: 2 } });
    const absent = await store.mutate(
      input(userIds[0], 2, {
        entry: { chainId: 56, identity: winningEntry.identity, scope: winningEntry.scope },
        type: "restore",
      }),
    );
    expect(absent).toMatchObject({ status: "unchanged", value: { entries: [], revision: 2 } });
  });

  it("persists across adapter recreation, isolates users, enforces capacity and cascades cleanup", async () => {
    const firstAdapter = new PostgresPoolBlocklistStore(pool);
    const block = await firstAdapter.mutate(
      input(userIds[1], 0, {
        entry: { chainId: 56, identity: v4PoolKey, label: "Persisted V4", scope: "pool" },
        type: "block",
      }),
    );
    expect(block).toMatchObject({ status: "updated", value: { revision: 1 } });

    const restartedAdapter = new PostgresPoolBlocklistStore(pool);
    expect(await restartedAdapter.get(userIds[1])).toMatchObject({
      entries: [{ identity: v4PoolKey, label: "Persisted V4", scope: "pool" }],
      revision: 1,
    });
    expect(await restartedAdapter.get(userIds[0])).toMatchObject({ entries: [], revision: 2 });

    const bounded = new PostgresPoolBlocklistStore(pool, { maxEntries: 1 });
    expect(
      await bounded.mutate(
        input(userIds[2], 0, {
          entry: { chainId: 56, identity: tokenAddress, scope: "token" },
          type: "block",
        }),
      ),
    ).toMatchObject({ status: "updated", value: { revision: 1 } });
    expect(
      await bounded.mutate(
        input(userIds[2], 1, {
          entry: { chainId: 56, identity: poolKey, scope: "pool" },
          type: "block",
        }),
      ),
    ).toMatchObject({ current: { entries: [{ identity: tokenAddress }], revision: 1 }, status: "capacity" });

    await pool.query("DELETE FROM users WHERE id = $1", [userIds[2]]);
    const residual = await pool.query<{ entries: string; states: string }>(
      `SELECT
         (SELECT count(*)::text FROM user_pool_blocklist_entries WHERE user_id = $1) AS entries,
         (SELECT count(*)::text FROM user_pool_blocklist_state WHERE user_id = $1) AS states`,
      [userIds[2]],
    );
    expect(residual.rows).toEqual([{ entries: "0", states: "0" }]);
  });
});
