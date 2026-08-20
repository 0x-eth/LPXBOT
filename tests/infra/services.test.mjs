import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const composeFile = path.join(repoRoot, "infra/docker/compose.yaml");
const migrationVersions = readdirSync(path.join(repoRoot, "infra/migrations"))
  .filter((name) => /^\d+_.+\.sql$/u.test(name))
  .map((name) => name.slice(0, name.indexOf("_")))
  .sort();
const projectName = "lpbot-p00-local";
const envFile = existsSync(path.join(repoRoot, ".env"))
  ? path.join(repoRoot, ".env")
  : path.join(repoRoot, ".env.example");

const secrets = Object.entries(parseEnv(readFileSync(envFile, "utf8")))
  .filter(([key]) => /(PASSWORD|DATABASE_URL|REDIS_URL|MINIO_ROOT_USER)/.test(key))
  .map(([, value]) => value)
  .filter(Boolean);

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function redact(source) {
  return secrets.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), source);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
    ...options,
  });

  if (result.error) {
    const message = redact(result.error.message);
    throw new Error(`${command} failed before completion: ${message}`, { cause: result.error });
  }

  if (result.status !== 0) {
    const details = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim();
    throw new Error(
      `${command} exited with ${String(result.status)}${details ? `: ${details}` : ""}`,
    );
  }

  return result.stdout.trim();
}

function compose(...args) {
  return run("docker", [
    "compose",
    "--project-name",
    projectName,
    "--env-file",
    envFile,
    "--file",
    composeFile,
    ...args,
  ]);
}

function query(sql) {
  return compose(
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-align --tuples-only --set ON_ERROR_STOP=1 --command "$1"',
    "lpbot-query",
    sql,
  );
}

test("PostgreSQL exposes TimescaleDB, pgcrypto, and migration history", () => {
  assert.match(query("SHOW server_version"), /^16\./u);
  assert.equal(query("SHOW timescaledb.telemetry_level"), "off");
  assert.equal(
    query(
      "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('pgcrypto', 'timescaledb')",
    ),
    "pgcrypto,timescaledb",
  );
  assert.equal(query("SELECT to_regclass('public.schema_migrations') IS NOT NULL"), "t");
  assert.equal(
    query("SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations"),
    migrationVersions.join(","),
  );
  assert.equal(query("SELECT count(*) FROM schema_migrations"), String(migrationVersions.length));
  assert.equal(
    query(
      "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'",
    ),
    "access_audit_events,address_remark_audit_events,address_remarks,app_metadata,auth_login_wallets,auth_wallet_challenges,canonical_chain_blocks,chain_access_management_audit_events,chain_access_policies,chain_access_policy_history,chain_operation_audit_events,chain_operation_idempotency,chain_operation_outbox,chain_operation_receipt_evidence,chain_operation_reconciliation_cases,chain_operation_replacement_authorizations,chain_operation_transactions,chain_operations,custody_wallet_audit_events,custody_wallet_custom_tokens,custody_wallet_delete_previews,custody_wallet_envelopes,custody_wallet_tombstones,custody_wallets,helper_deployment_previews,indexer_cursors,integrity_quarantine,liquidity_flow_events,liquidity_flow_outbox,local_helper_residual_snapshots,local_helper_sweep_audit_events,local_helper_sweep_batches,local_helper_sweep_operations,local_helper_sweep_outbox,local_helper_sweep_previews,local_helper_sweep_receipt_evidence,local_helper_sweep_reconciliation_cases,local_helper_sweep_replacement_authorizations,local_helper_sweep_transactions,market_candles,market_pool_catalog,market_read_model_states,market_snapshots,market_stream_outbox,market_tick_liquidity,monitor_candidate_suppressions,monitor_candidates,monitor_create_idempotency,monitor_evaluation_watermarks,monitor_notification_destination_bindings,monitors,normalized_pool_events,notification_delivery_history,notification_destination_create_idempotency,notification_destination_versions,notification_destinations,notification_outbox,notification_preferences,okx_credential_audit_events,okx_credential_heads,okx_credential_tombstones,okx_credential_versions,pool_creation_provenance,pool_creation_provenance_conflicts,pool_creator_query_audit_events,pricing_position_observations,pricing_position_outbox,pricing_position_state_events,pricing_position_stream_heads,pricing_position_withdrawn_tombstones,pricing_positions,raw_chain_logs,schema_migrations,security_password_audit_events,sessions,swap_quote_snapshots,task_status_stats_conflicts,task_status_stats_projection_state,task_status_stats_query_audit_events,task_status_stats_stream_heads,task_status_stats_user_snapshots,telegram_bot_login_intents,telegram_identities,telegram_init_data_replays,user_keystore_failures,user_keystore_reset_previews,user_keystore_versions,user_keystores,user_pool_blocklist_entries,user_pool_blocklist_state,user_preferences,user_security_password_versions,user_security_passwords,users,wallet_address_book_audit_events,wallet_address_book_entries,wallet_helper_bindings,wallet_helper_deployment_bindings,wallet_helper_residual_snapshots,wallet_helper_verification_snapshots,wallet_nonce_ledgers,wallet_transfer_audit_events,wallet_transfer_idempotency,wallet_transfer_operations,wallet_transfer_outbox,wallet_transfer_receipt_evidence,wallet_transfer_reconciliation_cases,wallet_transfer_replacement_authorizations,wallet_transfer_transactions",
  );
});

test("running migration twice is a database no-op", () => {
  const migrationSnapshot =
    "SELECT string_agg(version || ':' || xmin::text, ',' ORDER BY version) FROM schema_migrations";
  const before = query(migrationSnapshot);
  run("bash", ["scripts/db.sh", "migrate"]);
  const after = query(migrationSnapshot);

  assert.equal(after, before);
});

test("running the deterministic seed twice preserves the same tuple", () => {
  const snapshotSql = `
    SELECT metadata_key || '|' || metadata_value || '|' ||
      to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '|' || xmin::text
    FROM app_metadata
    WHERE metadata_key = 'fixture_version'
  `;

  run("bash", ["scripts/db.sh", "seed"]);
  const before = query(snapshotSql);
  run("bash", ["scripts/db.sh", "seed"]);
  const after = query(snapshotSql);

  assert.deepEqual(before.split("|").slice(0, 3), [
    "fixture_version",
    "p00-03-v1",
    "2026-08-13T00:00:00Z",
  ]);
  assert.match(before.split("|")[3], /^\d+$/u);
  assert.equal(after, before);
  assert.equal(
    query("SELECT count(*) FROM app_metadata WHERE metadata_key = 'fixture_version'"),
    "1",
  );
  assert.equal(
    query(
      "SELECT string_agg(chain_id::text || ':' || access || ':' || revision::text, ',' ORDER BY array_position(ARRAY[56,8453,1,4663,196]::bigint[], chain_id)) FROM chain_access_policies",
    ),
    "56:all:1,8453:off:1,1:off:1,4663:off:1,196:off:1",
  );
  assert.equal(query("SELECT count(*) FROM chain_access_policy_history"), "5");
});

test("Redis supports PING, expiring SET/GET, and TTL", () => {
  const output = compose(
    "exec",
    "-T",
    "redis",
    "sh",
    "-ec",
    `
      redis_call() { redis-cli --no-auth-warning --raw -a "$REDIS_PASSWORD" "$@"; }
      redis_call PING
      redis_call SET lpbot:p00-03:ttl deterministic EX 60
      redis_call GET lpbot:p00-03:ttl
      redis_call TTL lpbot:p00-03:ttl
      redis_call DEL lpbot:p00-03:ttl >/dev/null
    `,
  );
  const [ping, setResult, value, ttlText] = output.split("\n");
  const ttl = Number(ttlText);

  assert.equal(ping, "PONG");
  assert.equal(setResult, "OK");
  assert.equal(value, "deterministic");
  assert.ok(ttl > 0 && ttl <= 60, `unexpected Redis TTL: ${ttlText}`);
});

test("MinIO supports bucket lookup and object put/get/delete", () => {
  const output = compose(
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "/bin/sh",
    "minio-init",
    "-ec",
    `
      mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
      mc stat "local/$MINIO_BUCKET" >/dev/null
      printf deterministic-minio-fixture >/tmp/p00-03.txt
      mc cp /tmp/p00-03.txt "local/$MINIO_BUCKET/p00-03/integration.txt" >/dev/null
      mc cat "local/$MINIO_BUCKET/p00-03/integration.txt"
      mc rm "local/$MINIO_BUCKET/p00-03/integration.txt" >/dev/null
      if mc stat "local/$MINIO_BUCKET/p00-03/integration.txt" >/dev/null 2>&1; then
        exit 1
      fi
    `,
  );

  assert.equal(output, "deterministic-minio-fixture");
});

test("Anvil uses chain 31337 and supports snapshot/revert", () => {
  const output = compose(
    "exec",
    "-T",
    "anvil",
    "sh",
    "-ec",
    `
      rpc=http://127.0.0.1:8545
      chain_id="$(cast rpc eth_chainId --rpc-url "$rpc" | tr -d '"')"
      snapshot="$(cast rpc evm_snapshot --rpc-url "$rpc" | tr -d '"')"
      cast rpc evm_mine --rpc-url "$rpc" >/dev/null
      reverted="$(cast rpc evm_revert "$snapshot" --rpc-url "$rpc")"
      printf '%s|%s' "$chain_id" "$reverted"
    `,
  );

  assert.equal(output, "0x7a69|true");
});

test("service logs do not expose configured local credentials", () => {
  const logs = compose("logs", "--no-color", "postgres", "redis", "minio", "anvil");

  for (const secret of secrets) {
    assert.ok(!logs.includes(secret), "service logs exposed a configured credential");
  }
});
