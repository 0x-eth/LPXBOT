import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  compareRawLogDeliveries,
  IndexerRunner,
  PostgresCanonicalEventStore,
  type NormalizedPoolEvent,
  type RawLogDelivery,
} from "../../apps/indexer/src/index.js";
import { FixtureEventDecoder, FixtureRawLogSource } from "../../apps/indexer/src/testing.js";
import { fixtureBlockTimestamp, readP02Fixture } from "../helpers/p02-fixture.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const databaseName = `lpbot_p0204_flow_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 4 });

function migrationSection(source: string): string {
  const [, afterUp] = source.split("-- migrate:up");
  const [up] = afterUp!.split("-- migrate:down");
  if (!up?.trim()) throw new Error("Migration must contain an up section");
  return up;
}

function productionGoldenCommit() {
  const normalizedRoot = path.join(root, "artifacts/acceptance/P02-03/golden/normalized");
  const rawRoot = path.join(root, "artifacts/acceptance/P02-03/golden/raw");
  const pairs: Array<{ delivery: RawLogDelivery; event: NormalizedPoolEvent }> = [];
  for (const protocol of ["pcsv3", "univ3", "pcsv4", "univ4"]) {
    const directory = path.join(normalizedRoot, protocol);
    for (const filename of readdirSync(directory).filter((value) => value.endsWith(".json"))) {
      const event = JSON.parse(readFileSync(path.join(directory, filename), "utf8")) as
        NormalizedPoolEvent;
      const raw = JSON.parse(readFileSync(path.join(rawRoot, protocol, filename), "utf8")) as {
        delivery: RawLogDelivery;
      };
      pairs.push({ delivery: raw.delivery, event });
    }
  }
  pairs.sort((left, right) => compareRawLogDeliveries(left.delivery, right.delivery));
  return {
    chainId: 56,
    deliveries: pairs.map(({ delivery }) => delivery),
    evaluationTime: "2026-08-16T03:00:00.000Z",
    events: pairs.map(({ event }) => event),
  } as const;
}

function reorgRunner(): IndexerRunner {
  const fixture = readP02Fixture("reorg");
  return new IndexerRunner({
    decoder: new FixtureEventDecoder(fixture.input),
    evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
    source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
    store: new PostgresCanonicalEventStore(pool),
  });
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  const migrations = readdirSync(path.join(root, "infra/migrations"))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of migrations) {
    const source = readFileSync(path.join(root, "infra/migrations", filename), "utf8");
    await pool.query(migrationSection(source));
  }
}, 30_000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE liquidity_flow_outbox, liquidity_flow_events, market_stream_outbox,
      market_snapshots, integrity_quarantine, normalized_pool_events, raw_chain_logs,
      canonical_chain_blocks, indexer_cursors RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("P02-04 PostgreSQL liquidity flow read model", () => {
  it("atomically projects all 16 production Goldens without inferred values or finality", async () => {
    const store = new PostgresCanonicalEventStore(pool);

    const first = await store.commit(productionGoldenCommit());
    const beforeReplay = await pool.query<{
      canonical: string;
      finalized: string;
      normalized: string;
      outbox: string;
      v4_inferred_amounts: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM liquidity_flow_events WHERE canonical) AS canonical,
         (SELECT count(*)::text FROM normalized_pool_events) AS normalized,
         (SELECT count(*)::text FROM liquidity_flow_outbox) AS outbox,
         (SELECT count(*)::text FROM liquidity_flow_events WHERE finality = 'finalized') AS finalized,
         (SELECT count(*)::text FROM liquidity_flow_events
           WHERE protocol_generation = 'v4' AND event_type <> 'create'
             AND (amount0 IS NOT NULL OR amount1 IS NOT NULL)) AS v4_inferred_amounts`,
    );
    const replay = await store.commit(productionGoldenCommit());
    const afterReplay = await pool.query(
      `SELECT
         (SELECT count(*)::text FROM liquidity_flow_events WHERE canonical) AS canonical,
         (SELECT count(*)::text FROM normalized_pool_events) AS normalized,
         (SELECT count(*)::text FROM liquidity_flow_outbox) AS outbox,
         (SELECT count(*)::text FROM liquidity_flow_events WHERE finality = 'finalized') AS finalized,
         (SELECT count(*)::text FROM liquidity_flow_events
           WHERE protocol_generation = 'v4' AND event_type <> 'create'
             AND (amount0 IS NOT NULL OR amount1 IS NOT NULL)) AS v4_inferred_amounts`,
    );

    expect(first).toMatchObject({ acceptedCount: 16, duplicateCount: 0 });
    expect(replay).toMatchObject({ acceptedCount: 0, duplicateCount: 16 });
    expect(beforeReplay.rows).toEqual([
      {
        canonical: "10",
        finalized: "0",
        normalized: "16",
        outbox: "10",
        v4_inferred_amounts: "0",
      },
    ]);
    expect(afterReplay.rows).toEqual(beforeReplay.rows);
  });

  it("rolls canonical event, projection, outbox, and cursor back together", async () => {
    await pool.query(`
      CREATE FUNCTION p0204_fail_flow_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'intentional flow outbox failure'; END $$;
      CREATE TRIGGER p0204_fail_flow_outbox BEFORE INSERT ON liquidity_flow_outbox
      FOR EACH ROW EXECUTE FUNCTION p0204_fail_flow_outbox();
    `);

    await expect(new PostgresCanonicalEventStore(pool).commit(productionGoldenCommit())).rejects
      .toThrow(/intentional flow outbox failure/u);
    const result = await pool.query<{ total: string }>(
      `SELECT (
         (SELECT count(*) FROM normalized_pool_events) +
         (SELECT count(*) FROM liquidity_flow_events) +
         (SELECT count(*) FROM liquidity_flow_outbox) +
         (SELECT count(*) FROM indexer_cursors)
       )::text AS total`,
    );

    expect(result.rows).toEqual([{ total: "0" }]);
    await pool.query("DROP TRIGGER p0204_fail_flow_outbox ON liquidity_flow_outbox");
    await pool.query("DROP FUNCTION p0204_fail_flow_outbox()");
  });

  it("writes tombstone before replacement and rewinds the canonical cursor on reorg", async () => {
    const fixture = readP02Fixture("reorg");

    await reorgRunner().runOnce();
    const outbox = await pool.query<{
      payload: { id: string; record_type: string; reverted_id?: string };
      record_type: string;
    }>(
      `SELECT record_type, payload
         FROM liquidity_flow_outbox
        ORDER BY sequence`,
    );
    const projection = await pool.query<{ canonical: boolean; finality: string; event_id: string }>(
      `SELECT event_id, canonical, finality
         FROM liquidity_flow_events
        ORDER BY created_at, event_id`,
    );
    const cursor = await pool.query<{ block_hash: string; block_number: string }>(
      "SELECT block_hash, block_number::text FROM indexer_cursors WHERE chain_id = 56",
    );

    expect(outbox.rows.map(({ record_type }) => record_type)).toEqual([
      "event",
      "tombstone",
      "event",
    ]);
    expect(outbox.rows[1]?.payload).toMatchObject({
      record_type: "tombstone",
      reverted_id: projection.rows.find(({ finality }) => finality === "reverted")?.event_id,
    });
    expect(projection.rows).toHaveLength(2);
    expect(projection.rows.map(({ canonical, finality }) => ({ canonical, finality }))).toEqual(
      expect.arrayContaining([
        { canonical: false, finality: "reverted" },
        { canonical: true, finality: "observed" },
      ]),
    );
    expect(cursor.rows).toEqual([
      { block_hash: fixture.input[2]!.rawLog.blockHash, block_number: "110" },
    ]);
  });
});
