import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const composeFile = path.join(repoRoot, "infra/docker/compose.yaml");
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
  assert.equal(query("SELECT count(*) FROM schema_migrations"), "1");
  assert.equal(
    query(
      "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public'",
    ),
    "app_metadata,schema_migrations",
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
