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
import { PostgresLiquidityFlowProvider } from "../../apps/api/src/liquidity-flow.js";
import type {
  LiquidityFlowBackfill,
  LiquidityFlowCanonicalEnvelope,
} from "../../packages/api-contract/src/index.js";
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

async function takeFlow(
  provider: PostgresLiquidityFlowProvider,
  count: number,
  filter: Partial<{ nftId: string; pool: `0x${string}`; token: `0x${string}`; user: `0x${string}` }> = {},
): Promise<LiquidityFlowCanonicalEnvelope[]> {
  const controller = new AbortController();
  const result: LiquidityFlowCanonicalEnvelope[] = [];
  for await (const envelope of provider.subscribe({
    nftId: filter.nftId ?? null,
    pool: filter.pool ?? null,
    signal: controller.signal,
    since: 0,
    token: filter.token ?? null,
    user: filter.user ?? null,
  })) {
    result.push(envelope);
    if (result.length === count) {
      controller.abort();
      break;
    }
  }
  return result;
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

  it("provides bounded historical backfill and identical pool/token/user/NFT filtering", async () => {
    const commitResult = await new PostgresCanonicalEventStore(pool).commit(productionGoldenCommit());
    expect(commitResult).toMatchObject({ acceptedCount: 16, revertedCount: 0 });
    const projectionCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM liquidity_flow_events",
    );
    expect(projectionCount.rows).toEqual([{ count: "10" }]);
    const provider = new PostgresLiquidityFlowProvider(pool, {
      backfillLimit: 3,
      now: () => new Date("2026-08-16T03:01:00.000Z"),
      pollMilliseconds: 1,
    });
    const durableOrder = await pool.query<{ id: string; sequence: string }>(
      `SELECT sequence::text, payload->>'id' AS id
         FROM liquidity_flow_outbox
        ORDER BY sequence`,
    );
    expect(durableOrder.rows.slice(-3)).toEqual([
      {
        id: "eb56e2cf006282c2a07bdc2fc563014b1390560763a27618bd3ffe95a2485370",
        sequence: "8",
      },
      {
        id: "d12fab3e18894c97163abe2cd1b544bb9037694403572feb79021688267c1d76",
        sequence: "9",
      },
      {
        id: "ccf15384ff3ce1450c0f574c3d3ee8652df091c511a832452214a596dccee2b2",
        sequence: "10",
      },
    ]);

    const [boundedEnvelope] = await takeFlow(provider, 1);
    const bounded = boundedEnvelope!.data as LiquidityFlowBackfill;
    expect(bounded.events).toHaveLength(3);
    expect(bounded.has_more).toBe(true);
    expect(bounded.events.map(({ id }) => id)).toEqual([
      "eb56e2cf006282c2a07bdc2fc563014b1390560763a27618bd3ffe95a2485370",
      "d12fab3e18894c97163abe2cd1b544bb9037694403572feb79021688267c1d76",
      "ccf15384ff3ce1450c0f574c3d3ee8652df091c511a832452214a596dccee2b2",
    ]);

    const filterProvider = new PostgresLiquidityFlowProvider(pool, { backfillLimit: 20 });
    const poolAddress = "0xab058332a7279f1e64162be08f59ac0cd9601759" as const;
    const tokenAddress = "0x55d398326f99059ff775485246999027b3197955" as const;
    const userAddress = "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364" as const;
    const [filteredEnvelope] = await takeFlow(filterProvider, 1, {
      pool: poolAddress,
      token: tokenAddress,
      user: userAddress,
    });
    const filtered = filteredEnvelope!.data as LiquidityFlowBackfill;
    expect(filtered.events.map(({ id }) => id)).toEqual([
      "47dc88f839f41af63e13bf37c2527afe9bf7d89d3c1984e166bf3bd19cd0dbbd",
      "95f6f25fbb0646feb4a1712096d4922db3bb1df5b447dd4f2f50c8ac89942bc1",
    ]);

    const [emptyEnvelope] = await takeFlow(filterProvider, 1, { nftId: "42" });
    expect((emptyEnvelope!.data as LiquidityFlowBackfill).events).toEqual([]);
  });

  it("replays reorg tombstones and persists a canonical heartbeat", async () => {
    await reorgRunner().runOnce();
    const provider = new PostgresLiquidityFlowProvider(pool, {
      heartbeatMilliseconds: 1,
      now: () => new Date("2026-08-16T00:06:00.000Z"),
      pollMilliseconds: 1,
    });

    const [backfillEnvelope, heartbeat] = await takeFlow(provider, 2);
    const backfill = backfillEnvelope!.data as LiquidityFlowBackfill;
    expect(backfill.events.map(({ record_type }) => record_type)).toEqual([
      "event",
      "tombstone",
      "event",
    ]);
    expect(heartbeat).toMatchObject({ data: null, eventType: "heartbeat" });
    const durable = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM liquidity_flow_outbox WHERE record_type = 'heartbeat'",
    );
    expect(durable.rows).toEqual([{ count: "1" }]);
  });
});
