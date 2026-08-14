import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const migrationPath = fileURLToPath(
  new URL("../../infra/migrations/20260815000100_create_chain_access_policies.sql", import.meta.url),
);

afterAll(async () => {
  await pool.end();
});

describe("AUTH-10 PostgreSQL chain access migration", () => {
  it("creates versioned current policy, append-only history and management audit tables", async () => {
    const result = await pool.query<{ column_name: string; table_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'chain_access_policies',
            'chain_access_policy_history',
            'chain_access_management_audit_events'
          )
        ORDER BY table_name, ordinal_position`,
    );

    expect(result.rows).toEqual([
      { column_name: "id", table_name: "chain_access_management_audit_events" },
      { column_name: "actor_user_id", table_name: "chain_access_management_audit_events" },
      { column_name: "session_id", table_name: "chain_access_management_audit_events" },
      { column_name: "request_id", table_name: "chain_access_management_audit_events" },
      { column_name: "outcome", table_name: "chain_access_management_audit_events" },
      { column_name: "result_code", table_name: "chain_access_management_audit_events" },
      { column_name: "reason", table_name: "chain_access_management_audit_events" },
      { column_name: "before_state", table_name: "chain_access_management_audit_events" },
      { column_name: "after_state", table_name: "chain_access_management_audit_events" },
      { column_name: "created_at", table_name: "chain_access_management_audit_events" },
      { column_name: "chain_id", table_name: "chain_access_policies" },
      { column_name: "access", table_name: "chain_access_policies" },
      { column_name: "revision", table_name: "chain_access_policies" },
      { column_name: "updated_by", table_name: "chain_access_policies" },
      { column_name: "updated_at", table_name: "chain_access_policies" },
      { column_name: "reason", table_name: "chain_access_policies" },
      { column_name: "chain_id", table_name: "chain_access_policy_history" },
      { column_name: "revision", table_name: "chain_access_policy_history" },
      { column_name: "before_access", table_name: "chain_access_policy_history" },
      { column_name: "after_access", table_name: "chain_access_policy_history" },
      { column_name: "updated_by", table_name: "chain_access_policy_history" },
      { column_name: "updated_at", table_name: "chain_access_policy_history" },
      { column_name: "reason", table_name: "chain_access_policy_history" },
    ]);
  });

  it("contains the deterministic local five-chain seed without claiming live state", async () => {
    const result = await pool.query<{
      access: string;
      chain_id: string;
      reason: string;
      revision: string;
      updated_at: Date;
      updated_by: string;
    }>(
      `SELECT chain_id::text, access, revision::text, updated_by, updated_at, reason
         FROM chain_access_policies
        ORDER BY array_position(ARRAY[56, 8453, 1, 4663, 196]::bigint[], chain_id)`,
    );

    expect(
      result.rows.map((row) => ({
        ...row,
        updated_at: row.updated_at.toISOString(),
      })),
    ).toEqual(
      [56, 8453, 1, 4663, 196].map((chainId) => ({
        access: chainId === 56 ? "all" : "off",
        chain_id: String(chainId),
        reason: "Deterministic local fixture seed; not a live-observed value",
        revision: "1",
        updated_at: "2026-08-15T00:00:00.000Z",
        updated_by: "local-fixture-seed",
      })),
    );

    const historyCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chain_access_policy_history",
    );
    expect(historyCount.rows[0]?.count).toBe("5");
  });

  it("rejects history mutation and executes down/up against real PostgreSQL transactionally", async () => {
    await expect(
      pool.query(
        "UPDATE chain_access_policy_history SET reason = 'mutated' WHERE chain_id = 56 AND revision = 1",
      ),
    ).rejects.toThrow(/append-only/iu);

    const source = readFileSync(migrationPath, "utf8");
    const [, upAndDown] = source.split("-- migrate:up");
    const [upSql, downSql] = upAndDown!.split("-- migrate:down");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(downSql!);
      const removed = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.chain_access_policies') IS NOT NULL AS present",
      );
      expect(removed.rows[0]?.present).toBe(false);
      await client.query(upSql!);
      const restored = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.chain_access_policies') IS NOT NULL AS present",
      );
      expect(restored.rows[0]?.present).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
