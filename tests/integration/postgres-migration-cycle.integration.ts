import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const migrationDirectory = path.join(repositoryRoot, "infra/migrations");
const migrationSources = readdirSync(migrationDirectory)
  .filter((filename) => filename.endsWith(".sql"))
  .sort()
  .map((filename) => ({
    filename,
    source: readFileSync(path.join(migrationDirectory, filename), "utf8"),
  }));
const seed = readFileSync(path.join(repositoryRoot, "infra/seed.sql"), "utf8");
const databaseName = `lpbot_p0108_migration_cycle_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const fixturePool = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });

function sections(source: string): { down: string; up: string } {
  const [, afterUp] = source.split("-- migrate:up");
  const [up, down] = afterUp!.split("-- migrate:down");
  if (!up?.trim() || !down?.trim()) throw new Error("Migration must contain up and down sections");
  return { down, up };
}

async function migrateUp(): Promise<void> {
  for (const migration of migrationSources) {
    await fixturePool.query(sections(migration.source).up);
  }
}

async function migrateDown(): Promise<void> {
  for (const migration of [...migrationSources].reverse()) {
    await fixturePool.query(sections(migration.source).down);
  }
}

async function publicTables(): Promise<string[]> {
  const result = await fixturePool.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return result.rows.map(({ table_name }) => table_name);
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
}, 30_000);

afterAll(async () => {
  await fixturePool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("P01 complete PostgreSQL migration cycle", () => {
  it("runs every migration up, all downs in reverse, then every up and repeatable seed", async () => {
    await migrateUp();
    await fixturePool.query(seed);
    await fixturePool.query(seed);

    expect(await publicTables()).toEqual([
      "access_audit_events",
      "app_metadata",
      "auth_login_wallets",
      "auth_wallet_challenges",
      "chain_access_management_audit_events",
      "chain_access_policies",
      "chain_access_policy_history",
      "sessions",
      "telegram_bot_login_intents",
      "telegram_identities",
      "telegram_init_data_replays",
      "user_preferences",
      "users",
    ]);

    await migrateDown();
    expect(await publicTables()).toEqual([]);

    await migrateUp();
    await fixturePool.query(seed);
    await fixturePool.query(seed);

    const extensions = await fixturePool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'timescaledb') ORDER BY extname",
    );
    expect(extensions.rows.map(({ extname }) => extname)).toEqual(["pgcrypto", "timescaledb"]);
    expect(await publicTables()).toEqual([
      "access_audit_events",
      "app_metadata",
      "auth_login_wallets",
      "auth_wallet_challenges",
      "chain_access_management_audit_events",
      "chain_access_policies",
      "chain_access_policy_history",
      "sessions",
      "telegram_bot_login_intents",
      "telegram_identities",
      "telegram_init_data_replays",
      "user_preferences",
      "users",
    ]);

    const seeded = await fixturePool.query<{ history_count: string; policy_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM chain_access_policies) AS policy_count,
         (SELECT count(*)::text FROM chain_access_policy_history) AS history_count`,
    );
    expect(seeded.rows).toEqual([{ history_count: "5", policy_count: "5" }]);
  });
});
