import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ChainPolicyStoreError,
  PostgresChainAccessPolicyStore,
} from "../../apps/api/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0107_store_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const fixturePool = new Pool({ connectionString: fixtureUrl.toString(), max: 6 });
const actorUserId = "27000000-0000-4000-8000-000000000001";
const sessionId = "27000000-0000-4000-8000-000000000002";
const firstUpdateAt = new Date("2026-08-15T01:00:00.000Z");

function migrationUp(source: string): string {
  return source.split("-- migrate:up")[1]!.split("-- migrate:down")[0]!;
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);

  const migrationDirectory = path.join(repositoryRoot, "infra/migrations");
  for (const filename of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort()) {
    await fixturePool.query(migrationUp(readFileSync(path.join(migrationDirectory, filename), "utf8")));
  }
  await fixturePool.query(readFileSync(path.join(repositoryRoot, "infra/seed.sql"), "utf8"));
  await fixturePool.query(
    `INSERT INTO users (
       id, role, tier, status, allowed_chain_ids, display_name, avatar_url, created_at, updated_at
     ) VALUES ($1, 'admin', 'normal', 'active', ARRAY[999999], NULL, NULL, $2, $2)`,
    [actorUserId, firstUpdateAt],
  );
  await fixturePool.query(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (
       $1,
       $2,
       decode(repeat('ab', 32), 'hex'),
       $3::timestamptz,
       $3::timestamptz + INTERVAL '1 hour'
     )`,
    [sessionId, actorUserId, firstUpdateAt],
  );
}, 30_000);

afterAll(async () => {
  await fixturePool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

function updateInput(
  changes: Array<{ access: "off" | "pro" | "all"; chainId: number; expectedRevision: number }>,
  overrides: Partial<{
    reason: string;
    requestId: string;
    updatedAt: Date;
  }> = {},
) {
  return {
    actorUserId,
    changes,
    reason: overrides.reason ?? "Local policy test change",
    requestId: overrides.requestId ?? "req-chain-policy-store",
    sessionId,
    updatedAt: overrides.updatedAt ?? firstUpdateAt,
  };
}

describe("AUTH-10 PostgreSQL chain policy store", () => {
  it("reads the deterministic registry order and safe rollback metadata", async () => {
    const store = new PostgresChainAccessPolicyStore(fixturePool);
    const policies = await store.list();

    expect(policies.map(({ chainId, access, revision }) => ({ chainId, access, revision }))).toEqual([
      { access: "all", chainId: 56, revision: 1 },
      { access: "off", chainId: 8453, revision: 1 },
      { access: "off", chainId: 1, revision: 1 },
      { access: "off", chainId: 4663, revision: 1 },
      { access: "off", chainId: 196, revision: 1 },
    ]);
    expect(policies.every(({ previousAccess }) => previousAccess === null)).toBe(true);
  });

  it("updates a batch atomically and treats an unchanged retry as idempotent", async () => {
    const store = new PostgresChainAccessPolicyStore(fixturePool);
    const changes = [
      { access: "pro", chainId: 56, expectedRevision: 1 },
      { access: "all", chainId: 1, expectedRevision: 1 },
    ] as const;

    const updated = await store.update(updateInput([...changes]));
    expect(updated.status).toBe("updated");
    expect(
      updated.policies
        .filter(({ chainId }) => chainId === 56 || chainId === 1)
        .map(({ chainId, access, revision, previousAccess }) => ({
          access,
          chainId,
          previousAccess,
          revision,
        })),
    ).toEqual([
      { access: "pro", chainId: 56, previousAccess: "all", revision: 2 },
      { access: "all", chainId: 1, previousAccess: "off", revision: 2 },
    ]);

    const retried = await store.update(
      updateInput([...changes], { requestId: "req-chain-policy-idempotent" }),
    );
    expect(retried.status).toBe("unchanged");
    expect(retried.policies.find(({ chainId }) => chainId === 56)?.revision).toBe(2);

    const history = await fixturePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chain_access_policy_history WHERE chain_id IN (56, 1)",
    );
    expect(history.rows[0]?.count).toBe("4");
    const audit = await fixturePool.query<{
      actor_user_id: string;
      outcome: string;
      result_code: string;
      session_id: string;
    }>(
      `SELECT actor_user_id::text, session_id::text, outcome, result_code
         FROM chain_access_management_audit_events
        ORDER BY id`,
    );
    expect(audit.rows).toEqual([
      { actor_user_id: actorUserId, outcome: "allowed", result_code: "UPDATED", session_id: sessionId },
      {
        actor_user_id: actorUserId,
        outcome: "allowed",
        result_code: "UNCHANGED",
        session_id: sessionId,
      },
    ]);
  });

  it("rejects a partially invalid batch before any policy changes", async () => {
    const store = new PostgresChainAccessPolicyStore(fixturePool);
    await expect(
      store.update(
        updateInput([
          { access: "all", chainId: 56, expectedRevision: 2 },
          { access: "all", chainId: 999_999, expectedRevision: 0 },
        ]),
      ),
    ).rejects.toMatchObject({ code: "CHAIN_UNKNOWN" });
    expect((await store.list()).find(({ chainId }) => chainId === 56)?.access).toBe("pro");
  });

  it("enforces default-chain, readiness and optimistic concurrency constraints", async () => {
    const store = new PostgresChainAccessPolicyStore(fixturePool);
    const cases = [
      [updateInput([{ access: "off", chainId: 56, expectedRevision: 2 }]), "DEFAULT_CHAIN_REQUIRED"],
      [updateInput([{ access: "pro", chainId: 4663, expectedRevision: 1 }]), "CHAIN_NOT_READY"],
      [updateInput([{ access: "pro", chainId: 1, expectedRevision: 1 }]), "CONFIG_CONFLICT"],
    ] as const;

    for (const [input, code] of cases) {
      await expect(store.update(input), code).rejects.toBeInstanceOf(ChainPolicyStoreError);
      await expect(store.update(input), code).rejects.toMatchObject({ code });
    }
  });

  it("allows one concurrent revision winner and restores its previous access through update", async () => {
    const store = new PostgresChainAccessPolicyStore(fixturePool);
    const contenders = await Promise.allSettled([
      store.update(
        updateInput([{ access: "pro", chainId: 1, expectedRevision: 2 }], {
          reason: "Concurrent Pro candidate",
          requestId: "req-concurrent-pro",
        }),
      ),
      store.update(
        updateInput([{ access: "off", chainId: 1, expectedRevision: 2 }], {
          reason: "Concurrent off candidate",
          requestId: "req-concurrent-off",
        }),
      ),
    ]);
    expect(contenders.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(contenders.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      contenders.find(({ status }) => status === "rejected")?.status === "rejected"
        ? contenders.find(({ status }) => status === "rejected")!.reason
        : null,
    ).toMatchObject({ code: "CONFIG_CONFLICT" });

    const current = (await store.list()).find(({ chainId }) => chainId === 1)!;
    expect(current.revision).toBe(3);
    expect(current.previousAccess).toBe("all");
    const rollback = await store.update(
      updateInput(
        [{ access: current.previousAccess!, chainId: 1, expectedRevision: current.revision }],
        {
          reason: "Restore previous local revision",
          requestId: "req-policy-rollback",
          updatedAt: new Date("2026-08-15T01:05:00.000Z"),
        },
      ),
    );
    const restored = rollback.policies.find(({ chainId }) => chainId === 1)!;
    expect(restored).toMatchObject({ access: "all", previousAccess: current.access, revision: 4 });
  });
});
