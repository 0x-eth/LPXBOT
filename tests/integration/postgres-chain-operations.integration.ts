import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildApiApp,
  PostgresChainAccessPolicyStore,
  PostgresSessionStore,
} from "../../apps/api/src/index.js";
import { SessionIssuer } from "../../packages/security/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0107_ops_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const fixturePool = new Pool({ connectionString: fixtureUrl.toString(), max: 4 });
const actorUserId = "28000000-0000-4000-8000-000000000001";
const origin = "https://local.fixture";
let currentTime = new Date("2026-08-15T02:00:00.000Z");
let app: ReturnType<typeof buildApiApp>;
let issued: Awaited<ReturnType<SessionIssuer["issue"]>>;

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
    await fixturePool.query(
      migrationUp(readFileSync(path.join(migrationDirectory, filename), "utf8")),
    );
  }
  await fixturePool.query(readFileSync(path.join(repositoryRoot, "infra/seed.sql"), "utf8"));
  await fixturePool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES ($1, 'admin', 'normal', 'active', 'Local Operations Admin', NULL, $2, $2)`,
    [actorUserId, currentTime],
  );

  const sessionStore = new PostgresSessionStore(fixturePool);
  issued = await new SessionIssuer(sessionStore, { now: () => currentTime }).issue({
    expiresAt: new Date("2026-08-15T03:00:00.000Z"),
    userId: actorUserId,
  });
  app = buildApiApp({
    chainPolicyStore: new PostgresChainAccessPolicyStore(fixturePool),
    maintenance: { enabled: false, message: null, until: null },
    managementOrigin: origin,
    now: () => currentTime,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
}, 30_000);

afterAll(async () => {
  await app?.close();
  await fixturePool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("AUTH-10 local PostgreSQL operations drill", () => {
  it("runs all to pro to rollback through the API with complete history and audit", async () => {
    const submit = (access: "all" | "pro", expectedRevision: number, reason: string) =>
      app.inject({
        headers: { cookie: `lpbot_session=${issued.token}`, origin },
        method: "POST",
        payload: { access: { "56": access }, expectedRevision: { "56": expectedRevision }, reason },
        url: "/api/system-config/chains",
      });

    currentTime = new Date("2026-08-15T02:01:00.000Z");
    const restricted = await submit("pro", 1, "Local all to pro operations drill");
    expect(restricted.statusCode).toBe(200);
    expect(restricted.json().data.chains[0]).toMatchObject({
      access: "pro",
      previousAccess: "all",
      revision: 2,
    });

    currentTime = new Date("2026-08-15T02:02:00.000Z");
    const rolledBack = await submit("all", 2, "Local rollback operations drill");
    expect(rolledBack.statusCode).toBe(200);
    expect(rolledBack.json().data.chains[0]).toMatchObject({
      access: "all",
      previousAccess: "pro",
      revision: 3,
    });

    const history = await fixturePool.query<{
      after_access: string;
      before_access: string | null;
      reason: string;
      revision: string;
      updated_by: string;
    }>(
      `SELECT revision::text, before_access, after_access, updated_by, reason
         FROM chain_access_policy_history
        WHERE chain_id = 56
        ORDER BY revision`,
    );
    expect(history.rows).toEqual([
      {
        after_access: "all",
        before_access: null,
        reason: "Deterministic local fixture seed; not a live-observed value",
        revision: "1",
        updated_by: "local-fixture-seed",
      },
      {
        after_access: "pro",
        before_access: "all",
        reason: "Local all to pro operations drill",
        revision: "2",
        updated_by: actorUserId,
      },
      {
        after_access: "all",
        before_access: "pro",
        reason: "Local rollback operations drill",
        revision: "3",
        updated_by: actorUserId,
      },
    ]);

    const audit = await fixturePool.query<{
      actor_user_id: string;
      after_state: unknown;
      before_state: unknown;
      outcome: string;
      reason: string;
      request_id: string;
      result_code: string;
      session_id: string;
    }>(
      `SELECT actor_user_id::text,
              session_id::text,
              request_id,
              outcome,
              result_code,
              reason,
              before_state,
              after_state
         FROM chain_access_management_audit_events
        ORDER BY id`,
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: actorUserId,
        after_state: [{ access: "pro", chainId: 56, revision: 2 }],
        before_state: [{ access: "all", chainId: 56, revision: 1 }],
        outcome: "allowed",
        reason: "Local all to pro operations drill",
        request_id: expect.any(String),
        result_code: "UPDATED",
        session_id: issued.sessionId,
      },
      {
        actor_user_id: actorUserId,
        after_state: [{ access: "all", chainId: 56, revision: 3 }],
        before_state: [{ access: "pro", chainId: 56, revision: 2 }],
        outcome: "allowed",
        reason: "Local rollback operations drill",
        request_id: expect.any(String),
        result_code: "UPDATED",
        session_id: issued.sessionId,
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain(issued.token);
  });
});
