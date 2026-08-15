import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IndexerRunner,
  PostgresCanonicalEventStore,
} from "../../apps/indexer/src/index.js";
import {
  FixtureEventDecoder,
  FixtureRawLogSource,
} from "../../apps/indexer/src/testing.js";
import { fixtureBlockTimestamp, readP02Fixture } from "../helpers/p02-fixture.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0202_indexer_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 4 });

function migrationSections(source: string) {
  const [, afterUp] = source.split("-- migrate:up");
  const [up, down] = afterUp!.split("-- migrate:down");
  if (!up?.trim() || !down?.trim()) throw new Error("Migration must contain up and down sections");
  return { down, up };
}

const migrationPath = path.join(
  repositoryRoot,
  "infra/migrations/20260816000100_create_market_indexer.sql",
);

function runnerFor(name: "normal" | "duplicate" | "out-of-order" | "reorg") {
  const fixture = readP02Fixture(name);
  return {
    fixture,
    runner: new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input, {
        marketFor(entry, index) {
          const amount = String(index + 1);
          return {
            fdvUsd: "1000000",
            feesUsd: entry.fixtureDecoded.kind === "swap" ? amount : null,
            token0Symbol: "WBNB",
            token1Symbol: "USDT",
            tvlUsd: "10000",
            volumeUsd: entry.fixtureDecoded.kind === "swap" ? `${amount}00` : null,
          };
        },
      }),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    }),
  };
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  const migrationFiles = [
    "20260813000100_initialize_local_metadata.sql",
    "20260814000100_create_auth_sessions.sql",
    "20260814000200_create_telegram_auth.sql",
    "20260814000300_create_login_wallet_auth.sql",
    "20260814000400_create_user_preferences.sql",
    "20260815000100_create_chain_access_policies.sql",
    "20260815000200_remove_user_allowed_chain_ids.sql",
    "20260816000100_create_market_indexer.sql",
  ];
  for (const filename of migrationFiles) {
    const source = readFileSync(path.join(repositoryRoot, "infra/migrations", filename), "utf8");
    await pool.query(migrationSections(source).up);
  }
}, 30_000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE market_stream_outbox, market_snapshots, integrity_quarantine,
      normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors
      RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("P02-02 real PostgreSQL canonical indexer", () => {
  it("commits event, derived snapshots, cursor and outbox atomically", async () => {
    const { runner } = runnerFor("normal");
    await runner.runOnce();
    const counts = await pool.query<{
      cursors: string;
      events: string;
      outbox: string;
      snapshots: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM normalized_pool_events) AS events,
        (SELECT count(*)::text FROM market_snapshots) AS snapshots,
        (SELECT count(*)::text FROM indexer_cursors) AS cursors,
        (SELECT count(*)::text FROM market_stream_outbox) AS outbox`,
    );
    expect(counts.rows[0]).toEqual({ cursors: "1", events: "5", outbox: "5", snapshots: "5" });

    await pool.query(`
      CREATE OR REPLACE FUNCTION p0202_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'intentional write interruption'; END $$;
      CREATE TRIGGER p0202_fail_outbox BEFORE INSERT ON market_stream_outbox
      FOR EACH ROW EXECUTE FUNCTION p0202_fail_outbox();
    `);
    await pool.query(
      `TRUNCATE market_stream_outbox, market_snapshots, integrity_quarantine,
        normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors
        RESTART IDENTITY CASCADE`,
    );
    await expect(runnerFor("normal").runner.runOnce()).rejects.toThrow(/intentional write interruption/u);
    const rolledBack = await pool.query<{ total: string }>(
      `SELECT (
        (SELECT count(*) FROM normalized_pool_events) +
        (SELECT count(*) FROM market_snapshots) +
        (SELECT count(*) FROM indexer_cursors) +
        (SELECT count(*) FROM market_stream_outbox)
      )::text AS total`,
    );
    expect(rolledBack.rows[0]?.total).toBe("0");
    await pool.query("DROP TRIGGER p0202_fail_outbox ON market_stream_outbox");
    await pool.query("DROP FUNCTION p0202_fail_outbox() ");
  });

  it("treats same-key same-payload as no-op and quarantines a different payload", async () => {
    const duplicate = runnerFor("duplicate");
    const result = await duplicate.runner.runOnce();
    expect(result).toMatchObject({ acceptedCount: 1, conflictCount: 0, duplicateCount: 1 });

    const fixture = duplicate.fixture;
    const conflicting = structuredClone(fixture.input);
    conflicting[1]!.rawLog.data = "0x99";
    const conflictRunner = new IndexerRunner({
      decoder: new FixtureEventDecoder(conflicting),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(conflicting.slice(1), fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    const conflict = await conflictRunner.runOnce();
    expect(conflict.conflictCount).toBe(1);
    const quarantine = await pool.query<{ status: string }>(
      "SELECT status FROM integrity_quarantine",
    );
    expect(quarantine.rows).toEqual([{ status: "quarantined" }]);
    const counts = await pool.query<{ events: string; outbox: string }>(
      `SELECT (SELECT count(*)::text FROM normalized_pool_events) AS events,
              (SELECT count(*)::text FROM market_stream_outbox) AS outbox`,
    );
    expect(counts.rows[0]).toEqual({ events: "1", outbox: "5" });
  });

  it("recovers from a durable cursor after restart without changing metrics or sequence twice", async () => {
    const fixture = readP02Fixture("out-of-order");
    const first = fixture.input.filter(({ rawLog }) => rawLog.blockNumber === "106");
    const firstRunner = new IndexerRunner({
      decoder: new FixtureEventDecoder(first, { marketFor: () => ({ feesUsd: "1", volumeUsd: "10" }) }),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(first, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    await firstRunner.runOnce();

    const restarted = new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input, {
        marketFor: () => ({ feesUsd: "1", volumeUsd: "10" }),
      }),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    await restarted.runOnce();
    const beforeReplay = await pool.query<{ events: string; max_sequence: string; snapshots: string }>(
      `SELECT
        (SELECT count(*)::text FROM normalized_pool_events) AS events,
        (SELECT count(*)::text FROM market_snapshots) AS snapshots,
        (SELECT max(sequence)::text FROM market_stream_outbox) AS max_sequence`,
    );
    await restarted.runOnce();
    const afterReplay = await pool.query<{ events: string; max_sequence: string; snapshots: string }>(
      `SELECT
        (SELECT count(*)::text FROM normalized_pool_events) AS events,
        (SELECT count(*)::text FROM market_snapshots) AS snapshots,
        (SELECT max(sequence)::text FROM market_stream_outbox) AS max_sequence`,
    );
    expect(beforeReplay.rows[0]).toEqual(afterReplay.rows[0]);
    expect(afterReplay.rows[0]?.events).toBe("3");
  });

  it("rewinds to the ancestor, emits tombstones, and deterministically replays replacement", async () => {
    const fixture = readP02Fixture("reorg");
    const runner = new IndexerRunner({
      decoder: new FixtureEventDecoder(fixture.input, {
        marketFor(entry) {
          return {
            feesUsd: entry.rawLog.blockHash.endsWith("20") ? "100" : "40",
            tvlUsd: "1000",
            volumeUsd: entry.rawLog.blockHash.endsWith("20") ? "100" : "40",
          };
        },
      }),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    await runner.runOnce();

    const events = await pool.query<{ block_hash: string; finality: string }>(
      "SELECT block_hash, finality FROM normalized_pool_events ORDER BY created_at, event_id",
    );
    expect(events.rows).toContainEqual({ block_hash: fixture.input[0]!.rawLog.blockHash, finality: "reverted" });
    expect(events.rows).toContainEqual({ block_hash: fixture.input[2]!.rawLog.blockHash, finality: "observed" });
    const outbox = await pool.query<{ event_type: string; payload: unknown; sequence: string }>(
      `SELECT event_type, sequence::text, envelope->'data' AS payload
         FROM market_stream_outbox
        WHERE window_minutes = 1
        ORDER BY sequence`,
    );
    expect(outbox.rows.map(({ event_type }) => event_type)).toEqual([
      "pools.snapshot",
      "pools.diff",
      "pools.diff",
    ]);
    expect(outbox.rows[1]!.payload).toMatchObject({ tombstones: [expect.any(String)] });
    expect(outbox.rows[2]!.payload).toMatchObject({ upserts: [expect.any(Object)] });

    const cursor = await pool.query<{ block_hash: string; block_number: string }>(
      "SELECT block_hash, block_number::text FROM indexer_cursors WHERE chain_id = 56",
    );
    expect(cursor.rows).toEqual([
      { block_hash: fixture.input[2]!.rawLog.blockHash, block_number: "110" },
    ]);
  });

  it("runs the market migration down and up in a real transaction", async () => {
    const source = readFileSync(migrationPath, "utf8");
    const { down, up } = migrationSections(source);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(down);
      const removed = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.market_stream_outbox') IS NOT NULL AS present",
      );
      expect(removed.rows[0]?.present).toBe(false);
      await client.query(up);
      const restored = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.market_stream_outbox') IS NOT NULL AS present",
      );
      expect(restored.rows[0]?.present).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

