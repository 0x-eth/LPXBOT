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
let fixturePool = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });

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
      "address_remark_audit_events",
      "address_remarks",
      "app_metadata",
      "auth_login_wallets",
      "auth_wallet_challenges",
      "canonical_chain_blocks",
      "chain_access_management_audit_events",
      "chain_access_policies",
      "chain_access_policy_history",
      "custody_wallet_audit_events",
      "custody_wallet_custom_tokens",
      "custody_wallet_delete_previews",
      "custody_wallet_envelopes",
      "custody_wallet_tombstones",
      "custody_wallets",
      "indexer_cursors",
      "integrity_quarantine",
      "liquidity_flow_events",
      "liquidity_flow_outbox",
      "market_candles",
      "market_pool_catalog",
      "market_read_model_states",
      "market_snapshots",
      "market_stream_outbox",
      "market_tick_liquidity",
      "monitor_candidate_suppressions",
      "monitor_candidates",
      "monitor_create_idempotency",
      "monitor_evaluation_watermarks",
      "monitor_notification_destination_bindings",
      "monitors",
      "normalized_pool_events",
      "notification_delivery_history",
      "notification_destination_create_idempotency",
      "notification_destination_versions",
      "notification_destinations",
      "notification_outbox",
      "notification_preferences",
      "okx_credential_audit_events",
      "okx_credential_heads",
      "okx_credential_tombstones",
      "okx_credential_versions",
      "pool_creation_provenance",
      "pool_creation_provenance_conflicts",
      "pool_creator_query_audit_events",
      "raw_chain_logs",
      "security_password_audit_events",
      "sessions",
      "task_status_stats_conflicts",
      "task_status_stats_projection_state",
      "task_status_stats_query_audit_events",
      "task_status_stats_stream_heads",
      "task_status_stats_user_snapshots",
      "telegram_bot_login_intents",
      "telegram_identities",
      "telegram_init_data_replays",
      "user_keystore_failures",
      "user_keystore_reset_previews",
      "user_keystore_versions",
      "user_keystores",
      "user_pool_blocklist_entries",
      "user_pool_blocklist_state",
      "user_preferences",
      "user_security_password_versions",
      "user_security_passwords",
      "users",
      "wallet_address_book_audit_events",
      "wallet_address_book_entries",
      "wallet_helper_bindings",
      "wallet_helper_residual_snapshots",
      "wallet_helper_verification_snapshots",
      "wallet_nonce_ledgers",
      "wallet_transfer_audit_events",
      "wallet_transfer_idempotency",
      "wallet_transfer_operations",
      "wallet_transfer_outbox",
      "wallet_transfer_receipt_evidence",
      "wallet_transfer_reconciliation_cases",
      "wallet_transfer_replacement_authorizations",
      "wallet_transfer_transactions",
    ]);

    await migrateDown();
    expect(await publicTables()).toEqual([]);

    // TimescaleDB cannot be dropped and reloaded in one PostgreSQL backend session.
    // Real dbmate down/up commands use separate processes, so reconnect at that boundary.
    await fixturePool.end();
    fixturePool = new Pool({ connectionString: fixtureUrl.toString(), max: 1 });
    await migrateUp();
    await fixturePool.query(seed);
    await fixturePool.query(seed);

    const extensions = await fixturePool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'timescaledb') ORDER BY extname",
    );
    expect(extensions.rows.map(({ extname }) => extname)).toEqual(["pgcrypto", "timescaledb"]);
    expect(await publicTables()).toEqual([
      "access_audit_events",
      "address_remark_audit_events",
      "address_remarks",
      "app_metadata",
      "auth_login_wallets",
      "auth_wallet_challenges",
      "canonical_chain_blocks",
      "chain_access_management_audit_events",
      "chain_access_policies",
      "chain_access_policy_history",
      "custody_wallet_audit_events",
      "custody_wallet_custom_tokens",
      "custody_wallet_delete_previews",
      "custody_wallet_envelopes",
      "custody_wallet_tombstones",
      "custody_wallets",
      "indexer_cursors",
      "integrity_quarantine",
      "liquidity_flow_events",
      "liquidity_flow_outbox",
      "market_candles",
      "market_pool_catalog",
      "market_read_model_states",
      "market_snapshots",
      "market_stream_outbox",
      "market_tick_liquidity",
      "monitor_candidate_suppressions",
      "monitor_candidates",
      "monitor_create_idempotency",
      "monitor_evaluation_watermarks",
      "monitor_notification_destination_bindings",
      "monitors",
      "normalized_pool_events",
      "notification_delivery_history",
      "notification_destination_create_idempotency",
      "notification_destination_versions",
      "notification_destinations",
      "notification_outbox",
      "notification_preferences",
      "okx_credential_audit_events",
      "okx_credential_heads",
      "okx_credential_tombstones",
      "okx_credential_versions",
      "pool_creation_provenance",
      "pool_creation_provenance_conflicts",
      "pool_creator_query_audit_events",
      "raw_chain_logs",
      "security_password_audit_events",
      "sessions",
      "task_status_stats_conflicts",
      "task_status_stats_projection_state",
      "task_status_stats_query_audit_events",
      "task_status_stats_stream_heads",
      "task_status_stats_user_snapshots",
      "telegram_bot_login_intents",
      "telegram_identities",
      "telegram_init_data_replays",
      "user_keystore_failures",
      "user_keystore_reset_previews",
      "user_keystore_versions",
      "user_keystores",
      "user_pool_blocklist_entries",
      "user_pool_blocklist_state",
      "user_preferences",
      "user_security_password_versions",
      "user_security_passwords",
      "users",
      "wallet_address_book_audit_events",
      "wallet_address_book_entries",
      "wallet_helper_bindings",
      "wallet_helper_residual_snapshots",
      "wallet_helper_verification_snapshots",
      "wallet_nonce_ledgers",
      "wallet_transfer_audit_events",
      "wallet_transfer_idempotency",
      "wallet_transfer_operations",
      "wallet_transfer_outbox",
      "wallet_transfer_receipt_evidence",
      "wallet_transfer_reconciliation_cases",
      "wallet_transfer_replacement_authorizations",
      "wallet_transfer_transactions",
    ]);

    const seeded = await fixturePool.query<{ history_count: string; policy_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM chain_access_policies) AS policy_count,
         (SELECT count(*)::text FROM chain_access_policy_history) AS history_count`,
    );
    expect(seeded.rows).toEqual([{ history_count: "5", policy_count: "5" }]);
  });
});
