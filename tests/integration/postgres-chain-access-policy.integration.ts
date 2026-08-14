import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const migrationPath = fileURLToPath(
  new URL(
    "../../infra/migrations/20260815000100_create_chain_access_policies.sql",
    import.meta.url,
  ),
);
const authorityMigrationPath = fileURLToPath(
  new URL(
    "../../infra/migrations/20260815000200_remove_user_allowed_chain_ids.sql",
    import.meta.url,
  ),
);
const seedPath = fileURLToPath(new URL("../../infra/seed.sql", import.meta.url));

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

  it("repeats the deterministic seed without changing policy revisions or history", async () => {
    const snapshot = async () => {
      const policies = await pool.query<{
        access: string;
        chain_id: string;
        reason: string;
        revision: string;
      }>(
        `SELECT chain_id::text, access, revision::text, reason
           FROM chain_access_policies
          ORDER BY chain_id`,
      );
      const history = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM chain_access_policy_history",
      );
      return { historyCount: history.rows[0]?.count, policies: policies.rows };
    };

    const before = await snapshot();
    const seed = readFileSync(seedPath, "utf8");
    await pool.query(seed);
    await pool.query(seed);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects history and audit mutation and executes down/up against real PostgreSQL", async () => {
    await expect(
      pool.query(
        "UPDATE chain_access_policy_history SET reason = 'mutated' WHERE chain_id = 56 AND revision = 1",
      ),
    ).rejects.toThrow(/append-only/iu);

    const audit = await pool.query<{ id: string }>(
      `INSERT INTO chain_access_management_audit_events (
         actor_user_id, session_id, request_id, outcome, result_code, reason,
         before_state, after_state, created_at
       ) VALUES (
         NULL, NULL, 'req-append-only-proof', 'denied', 'LOCAL_PROOF', NULL,
         NULL, NULL, TIMESTAMPTZ '2026-08-15 00:10:00+00'
       ) RETURNING id::text`,
    );
    await expect(
      pool.query(
        "UPDATE chain_access_management_audit_events SET result_code = 'mutated' WHERE id = $1",
        [audit.rows[0]!.id],
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

  it("removes the legacy per-user chain authority and rolls that migration down/up", async () => {
    const current = await pool.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'allowed_chain_ids'
       ) AS present`,
    );
    expect(current.rows[0]?.present).toBe(false);

    const source = readFileSync(authorityMigrationPath, "utf8");
    const [, upAndDown] = source.split("-- migrate:up");
    const [upSql, downSql] = upAndDown!.split("-- migrate:down");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(downSql!);
      const restored = await client.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'allowed_chain_ids'
         ) AS present`,
      );
      expect(restored.rows[0]?.present).toBe(true);
      await client.query(upSql!);
      const removed = await client.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'allowed_chain_ids'
         ) AS present`,
      );
      expect(removed.rows[0]?.present).toBe(false);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
