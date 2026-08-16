import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresCanonicalEventStore } from "../../apps/indexer/src/index.js";
import type {
  CanonicalCommit,
  NormalizedPoolEvent,
  RawLogDelivery,
} from "../../apps/indexer/src/types.js";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const migrationDirectory = path.join(repositoryRoot, "infra/migrations");
const migrationPath = path.join(
  migrationDirectory,
  "20260817000100_create_candle_tick_read_models.sql",
);
const databaseName = `lpbot_p0210_candle_tick_${process.pid}`;
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const fixtureUrl = new URL(databaseUrl);
fixtureUrl.pathname = `/${databaseName}`;
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const pool = new Pool({ connectionString: fixtureUrl.toString(), max: 4 });

const token0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const token1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const poolA = "0x1111111111111111111111111111111111111111";
const poolB = "0x2222222222222222222222222222222222222222";
const Q96 = 2n ** 96n;

function sections(source: string): { down: string; up: string } {
  const [, afterUp] = source.split("-- migrate:up");
  const [up, down] = afterUp!.split("-- migrate:down");
  if (!up?.trim() || !down?.trim()) throw new Error("Migration must have up/down sections");
  return { down, up };
}

function hex(byte: string): `0x${string}` {
  return `0x${byte.repeat(64 / byte.length)}`;
}

function fixture(
  id: string,
  options: {
    amount0?: string | null;
    amount1?: string | null;
    blockHash: `0x${string}`;
    blockNumber: string;
    blockTimestamp: string;
    kind: NormalizedPoolEvent["kind"];
    liquidityDelta?: string | null;
    logIndex?: number;
    parentHash: `0x${string}` | null;
    poolAddress?: string;
    removed?: boolean;
    sqrtPriceX96?: string | null;
    tick?: string | null;
    tickLower?: string | null;
    tickSpacing?: string;
    tickUpper?: string | null;
    transactionIndex?: number;
  },
): { delivery: RawLogDelivery; event: NormalizedPoolEvent } {
  const address = options.poolAddress ?? poolA;
  const logIndex = options.logIndex ?? 0;
  const transactionIndex = options.transactionIndex ?? 0;
  const transactionHash = hex(id.padEnd(2, "0").slice(0, 2));
  const cursor = {
    blockHash: options.blockHash,
    blockNumber: options.blockNumber,
    chainId: 56,
    logIndex,
    transactionIndex,
    value: `v1:56:${options.blockNumber}:${transactionIndex}:${logIndex}:${options.blockHash}`,
  };
  const removed = options.removed ?? false;
  const delivery: RawLogDelivery = {
    block: {
      blockHash: options.blockHash,
      blockNumber: options.blockNumber,
      blockTimestamp: options.blockTimestamp,
      chainId: 56,
      parentHash: options.parentHash,
    },
    log: {
      address,
      blockHash: options.blockHash,
      blockNumber: options.blockNumber,
      chainId: 56,
      data: `0x${id}`,
      logIndex,
      removed,
      topics: [hex("ef")],
      transactionHash,
      transactionIndex,
    },
  };
  return {
    delivery,
    event: {
      amount0: options.amount0 ?? null,
      amount1: options.amount1 ?? null,
      blockHash: options.blockHash,
      blockNumber: options.blockNumber,
      blockTimestamp: options.blockTimestamp,
      chainId: 56,
      contractAddress: address,
      cursor,
      eventId: `event-${id}-${options.blockHash}`,
      finality: removed ? "reverted" : "observed",
      kind: options.kind,
      liquidityDelta: options.liquidityDelta ?? null,
      logIndex,
      market: {},
      payload: {
        tick: options.tick ?? null,
        tickLower: options.tickLower ?? null,
        tickUpper: options.tickUpper ?? null,
      },
      pool: {
        feePips: "3000",
        hooks: null,
        poolAddress: address,
        poolId: null,
        tickSpacing: options.tickSpacing ?? "60",
        token0,
        token1,
      },
      protocol: "univ3",
      protocolGeneration: "v3",
      rawRef: `fixture://${id}`,
      removed,
      schemaVersion: "1.0.0",
      sqrtPriceX96: options.sqrtPriceX96 ?? null,
      transactionHash,
      transactionIndex,
    },
  };
}

function commit(entries: readonly ReturnType<typeof fixture>[], evaluationTime: string): CanonicalCommit {
  return {
    chainId: 56,
    deliveries: entries.map(({ delivery }) => delivery),
    evaluationTime,
    events: entries.map(({ event }) => event),
  };
}

const hash98 = hex("98");
const hash99 = hex("99");
const hash100 = hex("10");
const oldHash101 = hex("11");
const newHash101 = hex("12");

function initialEntries() {
  return [
    fixture("a1", {
      blockHash: hash98,
      blockNumber: "98",
      blockTimestamp: "2026-08-17T00:00:00.000Z",
      kind: "pool.created",
      parentHash: null,
      poolAddress: poolA,
    }),
    fixture("b1", {
      blockHash: hash99,
      blockNumber: "99",
      blockTimestamp: "2026-08-17T00:00:01.000Z",
      kind: "pool.created",
      parentHash: hash98,
      poolAddress: poolB,
    }),
    fixture("a2", {
      amount0: "-10",
      amount1: "20",
      blockHash: hash100,
      blockNumber: "100",
      blockTimestamp: "2026-08-17T00:00:10.000Z",
      kind: "swap",
      parentHash: hash99,
      poolAddress: poolA,
      sqrtPriceX96: Q96.toString(),
      tick: "0",
    }),
    fixture("b2", {
      amount0: "-30",
      amount1: "40",
      blockHash: hash100,
      blockNumber: "100",
      blockTimestamp: "2026-08-17T00:00:11.000Z",
      kind: "swap",
      logIndex: 1,
      parentHash: hash99,
      poolAddress: poolB,
      sqrtPriceX96: (Q96 * 3n).toString(),
      tick: "120",
    }),
    fixture("a3", {
      amount0: "-5",
      amount1: "7",
      blockHash: oldHash101,
      blockNumber: "101",
      blockTimestamp: "2026-08-17T00:00:50.000Z",
      kind: "swap",
      parentHash: hash100,
      poolAddress: poolA,
      sqrtPriceX96: (Q96 * 2n).toString(),
      tick: "60",
    }),
    fixture("a4", {
      blockHash: oldHash101,
      blockNumber: "101",
      blockTimestamp: "2026-08-17T00:00:51.000Z",
      kind: "liquidity.add",
      liquidityDelta: "90071992547409931234567890",
      logIndex: 1,
      parentHash: hash100,
      poolAddress: poolA,
      tickLower: "-120",
      tickUpper: "180",
    }),
  ];
}

beforeAll(async () => {
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  for (const filename of readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const source = readFileSync(path.join(migrationDirectory, filename), "utf8");
    await pool.query(sections(source).up);
  }
}, 30_000);

beforeEach(async () => {
  await pool.query(
    `TRUNCATE market_tick_liquidity, market_candles, market_read_model_states,
      liquidity_flow_outbox, liquidity_flow_events, market_pool_catalog,
      market_stream_outbox, market_snapshots, integrity_quarantine,
      normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors
      RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await adminPool.end();
});

describe("P02-10 PostgreSQL Candle/Tick read model", () => {
  it("migrates all constrained tables and restores the migration down/up", async () => {
    const tables = async () =>
      (
        await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('market_candles', 'market_tick_liquidity', 'market_read_model_states')
            ORDER BY table_name`,
        )
      ).rows.map(({ table_name }) => table_name);
    expect(await tables()).toEqual([
      "market_candles",
      "market_read_model_states",
      "market_tick_liquidity",
    ]);

    const migration = sections(readFileSync(migrationPath, "utf8"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.down);
      expect(await tables()).toEqual([]);
      await client.query(migration.up);
      expect(await tables()).toHaveLength(3);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("commits canonical events, Candle/Tick snapshots and cursor in one transaction", async () => {
    await pool.query(`
      CREATE FUNCTION p0210_fail_candle() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'intentional candle interruption'; END $$;
      CREATE TRIGGER p0210_fail_candle BEFORE INSERT ON market_candles
      FOR EACH ROW EXECUTE FUNCTION p0210_fail_candle();
    `);
    const store = new PostgresCanonicalEventStore(pool);
    await expect(
      store.commit(commit(initialEntries(), "2026-08-17T00:05:00.000Z")),
    ).rejects.toThrow(/intentional candle interruption/u);
    const rolledBack = await pool.query<{ total: string }>(
      `SELECT (
        (SELECT count(*) FROM normalized_pool_events) +
        (SELECT count(*) FROM market_candles) +
        (SELECT count(*) FROM market_tick_liquidity) +
        (SELECT count(*) FROM market_read_model_states) +
        (SELECT count(*) FROM indexer_cursors)
      )::text AS total`,
    );
    expect(rolledBack.rows).toEqual([{ total: "0" }]);
    await pool.query("DROP TRIGGER p0210_fail_candle ON market_candles");
    await pool.query("DROP FUNCTION p0210_fail_candle()");
  });

  it("is duplicate-safe and replaces only orphaned pool buckets and Tick boundaries", async () => {
    const store = new PostgresCanonicalEventStore(pool);
    const initial = initialEntries();
    expect(await store.commit(commit(initial, "2026-08-17T00:05:00.000Z"))).toMatchObject({
      acceptedCount: 6,
      duplicateCount: 0,
    });
    const versionsBefore = await pool.query<{ pool_key: string; version: string }>(
      "SELECT pool_key, version::text FROM market_read_model_states ORDER BY pool_key",
    );
    expect(versionsBefore.rows).toEqual([
      { pool_key: `56:${poolA}`, version: "1" },
      { pool_key: `56:${poolB}`, version: "1" },
    ]);

    expect(await store.commit(commit(initial, "2026-08-17T00:06:00.000Z"))).toMatchObject({
      acceptedCount: 0,
      duplicateCount: 6,
    });
    expect(
      await pool.query("SELECT pool_key, version::text FROM market_read_model_states ORDER BY pool_key"),
    ).toMatchObject({ rows: versionsBefore.rows });

    const removed = fixture("removed", {
      blockHash: oldHash101,
      blockNumber: "101",
      blockTimestamp: "2026-08-17T00:00:50.000Z",
      kind: "swap",
      parentHash: hash100,
      poolAddress: poolA,
      removed: true,
    });
    const replacementSwap = fixture("a5", {
      amount0: "-2",
      amount1: "3",
      blockHash: newHash101,
      blockNumber: "101",
      blockTimestamp: "2026-08-17T00:01:00.000Z",
      kind: "swap",
      parentHash: hash100,
      poolAddress: poolA,
      sqrtPriceX96: (Q96 * 3n).toString(),
      tick: "-60",
    });
    const replacementLiquidity = fixture("a6", {
      blockHash: newHash101,
      blockNumber: "101",
      blockTimestamp: "2026-08-17T00:01:01.000Z",
      kind: "liquidity.add",
      liquidityDelta: "7",
      logIndex: 1,
      parentHash: hash100,
      poolAddress: poolA,
      tickLower: "-60",
      tickUpper: "120",
    });
    expect(
      await store.commit(
        commit([removed, replacementSwap, replacementLiquidity], "2026-08-17T00:07:00.000Z"),
      ),
    ).toMatchObject({ acceptedCount: 2, revertedCount: 2 });

    const candles = await pool.query<{
      bar: string;
      close: string;
      pool_key: string;
      ts: string;
      volume0: string;
    }>(
      `SELECT pool_key, bar, extract(epoch FROM bucket_start)::bigint::text AS ts,
              close::text, volume0_raw::text AS volume0
         FROM market_candles WHERE bar = '1m' ORDER BY pool_key, bucket_start`,
    );
    expect(candles.rows).toEqual([
      {
        bar: "1m",
        close: "1",
        pool_key: `56:${poolA}`,
        ts: "1786924800",
        volume0: "10",
      },
      {
        bar: "1m",
        close: "9",
        pool_key: `56:${poolA}`,
        ts: "1786924860",
        volume0: "2",
      },
      {
        bar: "1m",
        close: "9",
        pool_key: `56:${poolB}`,
        ts: "1786924800",
        volume0: "30",
      },
    ]);
    const ticks = await pool.query<{ liquidity_net: string; tick_idx: number }>(
      `SELECT tick_idx, liquidity_net::text FROM market_tick_liquidity
        WHERE pool_key = $1 ORDER BY tick_idx`,
      [`56:${poolA}`],
    );
    expect(ticks.rows).toEqual([
      { liquidity_net: "7", tick_idx: -60 },
      { liquidity_net: "-7", tick_idx: 120 },
    ]);
    const states = await pool.query<{
      current_tick: number | null;
      pool_key: string;
      version: string;
    }>(
      "SELECT pool_key, current_tick, version::text FROM market_read_model_states ORDER BY pool_key",
    );
    expect(states.rows).toEqual([
      { current_tick: -60, pool_key: `56:${poolA}`, version: "3" },
      { current_tick: 120, pool_key: `56:${poolB}`, version: "1" },
    ]);
    expect(JSON.stringify(candles.rows)).not.toContain("90071992547409931234567890");
  });
});
