import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  compareRawLogDeliveries,
  IndexerRunner,
  PostgresCanonicalEventStore,
  type NormalizedPoolEvent,
} from "../../apps/indexer/src/index.js";
import { PostgresMarketPoolsProvider } from "../../apps/api/src/market-pools.js";
import {
  recommendationSelectionHash,
  selectRecommendedPools,
} from "../../apps/api/src/recommended-pools.js";
import type {
  LiquidityFlowProtocol,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "../../packages/api-contract/src/index.js";
import { FixtureEventDecoder, FixtureRawLogSource } from "../../apps/indexer/src/testing.js";
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
const flowMigrationPath = path.join(
  repositoryRoot,
  "infra/migrations/20260816000200_create_liquidity_flow.sql",
);
const catalogMigrationPath = path.join(
  repositoryRoot,
  "infra/migrations/20260816000400_create_market_pool_catalog.sql",
);
const labelContextMigrationPath = path.join(
  repositoryRoot,
  "infra/migrations/20260816000500_add_market_label_context.sql",
);
const goldenDirectory = path.join(repositoryRoot, "artifacts/acceptance/P02-02/golden");

function normalMarketProjection(
  entry: ReturnType<typeof readP02Fixture>["input"][number],
  index: number,
) {
  const swap = entry.fixtureDecoded.kind === "swap";
  return {
    fdvUsd: String(12_000_000 + index * 1_000),
    feesUsd: swap ? "42.125" : null,
    token0Symbol: "WBNB",
    token1Symbol: "USDT",
    tvlUsd: String(10_000 + index * 100),
    volumeUsd: swap ? "9000.75" : null,
  };
}

function reorgMarketProjection(entry: ReturnType<typeof readP02Fixture>["input"][number]) {
  const originalBranch = entry.rawLog.blockHash.endsWith("20");
  return {
    fdvUsd: originalBranch ? "5000000" : "4500000",
    feesUsd: originalBranch ? "100" : "40",
    token0Symbol: "WBNB",
    token1Symbol: "USDT",
    tvlUsd: originalBranch ? "1000" : "900",
    volumeUsd: originalBranch ? "1000" : "400",
  };
}

function goldenJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function legacyMarketRow(row: MarketPoolSnapshot["rows"][number]) {
  const legacy = { ...row } as Record<string, unknown>;
  for (const key of [
    "feePips",
    "hooks",
    "labels",
    "labelRuleVersion",
    "poolKey",
    "tickSpacing",
    "token0Address",
    "token1Address",
  ]) {
    delete legacy[key];
  }
  return legacy;
}

function legacyRows(rows: MarketPoolSnapshot["rows"]): Record<string, unknown>[] {
  return rows.map(legacyMarketRow);
}

function legacyRowsHash(rows: MarketPoolSnapshot["rows"]): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(legacyRows(rows))))
    .digest("hex");
}

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

async function takeStreamEvents(
  provider: PostgresMarketPoolsProvider,
  count: number,
  lastEventId: string | null,
  protocols: readonly LiquidityFlowProtocol[] = ["pcsv3", "univ3", "pcsv4", "univ4"],
): Promise<MarketStreamEnvelope[]> {
  const controller = new AbortController();
  const events: MarketStreamEnvelope[] = [];
  for await (const event of provider.subscribe({
    chainId: 56,
    lastEventId,
    minutes: 5,
    protocols,
    signal: controller.signal,
  })) {
    events.push(event);
    if (events.length === count) {
      controller.abort();
      break;
    }
  }
  return events;
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
    "20260816000200_create_liquidity_flow.sql",
    "20260816000400_create_market_pool_catalog.sql",
    "20260816000500_add_market_label_context.sql",
    "20260817000100_create_candle_tick_read_models.sql",
  ];
  for (const filename of migrationFiles) {
    const source = readFileSync(path.join(repositoryRoot, "infra/migrations", filename), "utf8");
    await pool.query(migrationSections(source).up);
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
    await expect(runnerFor("normal").runner.runOnce()).rejects.toThrow(
      /intentional write interruption/u,
    );
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

  it("projects a replay-safe pool catalog and replaces orphaned reorg identities", async () => {
    await runnerFor("normal").runner.runOnce();
    const initial = await pool.query<{
      created_event_id: string;
      fee_pips: string | null;
      hooks: string | null;
      pool_address: string | null;
      pool_id: string | null;
      pool_key: string;
      tick_spacing: string | null;
      token0: string;
      token1: string;
    }>(
      `SELECT pool_key, pool_address, pool_id, token0, token1,
              fee_pips::text, tick_spacing::text, hooks, created_event_id
         FROM market_pool_catalog
        ORDER BY pool_key`,
    );
    expect(initial.rows).toHaveLength(4);
    expect(initial.rows).toContainEqual(
      expect.objectContaining({
        fee_pips: "2500",
        pool_address: "0x4141414141414141414141414141414141414141",
        pool_id: null,
        pool_key: "56:0x4141414141414141414141414141414141414141",
        tick_spacing: "50",
        token0: "0x5151515151515151515151515151515151515151",
        token1: "0x5252525252525252525252525252525252525252",
      }),
    );
    expect(initial.rows).toContainEqual(
      expect.objectContaining({
        hooks: "0x6060606060606060606060606060606060606060",
        pool_address: null,
        pool_id: `0x${"43".repeat(32)}`,
        pool_key: `56:0x${"43".repeat(32)}`,
      }),
    );

    await runnerFor("normal").runner.runOnce();
    expect(
      (await pool.query("SELECT pool_key FROM market_pool_catalog ORDER BY pool_key")).rows,
    ).toEqual(initial.rows.map(({ pool_key }) => ({ pool_key })));

    await pool.query(
      `TRUNCATE liquidity_flow_outbox, liquidity_flow_events,
        market_stream_outbox, market_snapshots, integrity_quarantine,
        normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors,
        market_pool_catalog RESTART IDENTITY CASCADE`,
    );
    const duplicate = structuredClone(readP02Fixture("duplicate"));
    for (const entry of duplicate.input) {
      entry.fixtureDecoded.pool = {
        feePips: "3000",
        hooks: null,
        poolAddress: "0x4242424242424242424242424242424242424242",
        poolId: null,
        tickSpacing: "60",
        token0: "0x5151515151515151515151515151515151515151",
        token1: "0x5252525252525252525252525252525252525252",
      };
    }
    await new IndexerRunner({
      decoder: new FixtureEventDecoder(duplicate.input),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(duplicate.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    }).runOnce();
    expect(
      (await pool.query("SELECT count(*)::text AS count FROM market_pool_catalog")).rows,
    ).toEqual([{ count: "1" }]);

    await pool.query(
      `TRUNCATE liquidity_flow_outbox, liquidity_flow_events,
        market_stream_outbox, market_snapshots, integrity_quarantine,
        normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors,
        market_pool_catalog RESTART IDENTITY CASCADE`,
    );
    const reorg = structuredClone(readP02Fixture("reorg"));
    const orphanPoolId = `0x${"aa".repeat(32)}`;
    const replacementPoolId = `0x${"bb".repeat(32)}`;
    for (const [index, entry] of reorg.input.entries()) {
      entry.fixtureDecoded.pool = {
        feePips: index === 2 ? "500" : "100",
        hooks: "0x0000000000000000000000000000000000000000",
        poolAddress: null,
        poolId: index === 2 ? replacementPoolId : orphanPoolId,
        tickSpacing: index === 2 ? "10" : "1",
        token0:
          index === 2
            ? "0x7777777777777777777777777777777777777777"
            : "0x5555555555555555555555555555555555555555",
        token1: "0x6666666666666666666666666666666666666666",
      };
    }
    const replacementRunner = new IndexerRunner({
      decoder: new FixtureEventDecoder(reorg.input),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(reorg.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    await replacementRunner.runOnce();
    const replaced = await pool.query<{
      pool_key: string;
      token0: string;
    }>("SELECT pool_key, token0 FROM market_pool_catalog ORDER BY pool_key");
    expect(replaced.rows).toEqual([
      {
        pool_key: `56:${replacementPoolId}`,
        token0: "0x7777777777777777777777777777777777777777",
      },
    ]);
  });

  it("merges canonical 5m and 60m rows for stable by-token sorting", async () => {
    await runnerFor("normal").runner.runOnce();
    const catalog = await pool.query<{
      fee_pips: string | null;
      hooks: string | null;
      pool_address: string | null;
      pool_id: string | null;
      pool_key: string;
      protocol: "pcsv3" | "univ3" | "pcsv4" | "univ4";
      tick_spacing: string | null;
      token0: `0x${string}`;
      token1: `0x${string}`;
    }>(
      `SELECT pool_key, protocol, pool_address, pool_id, token0, token1,
              fee_pips::text, tick_spacing::text, hooks
         FROM market_pool_catalog
        ORDER BY pool_key`,
    );
    const [poolA, poolB, poolC, poolD] = catalog.rows;
    const marketRow = (
      entry: (typeof catalog.rows)[number],
      feesUsd: string | null,
      volumeUsd: string | null,
      overrides: Partial<MarketPoolSnapshot["rows"][number]> = {},
    ): MarketPoolSnapshot["rows"][number] => ({
      activeTvlUsd: null,
      chainId: 56,
      fdvUsd: null,
      feeActiveTvl: null,
      feePips: entry.fee_pips,
      feesUsd,
      feeTvl: null,
      hooks: entry.hooks as `0x${string}` | null,
      labelRuleVersion: "pool-labels/local-v1",
      labels: [],
      poolAddress: entry.pool_address as `0x${string}` | null,
      poolId: entry.pool_id as `0x${string}` | null,
      poolKey: entry.pool_key,
      protocol: entry.protocol,
      tickSpacing: entry.tick_spacing,
      token0Address: entry.token0,
      token0Symbol: null,
      token1Address: entry.token1,
      token1Symbol: null,
      transactionCount: feesUsd === null ? null : "1",
      tvlUsd: null,
      volumeUsd,
      ...overrides,
    });
    const rows5m = [
      marketRow(poolA!, "10", null),
      marketRow(poolB!, "10", "50", { token0Symbol: "TOKEN", token1Symbol: "QUOTE" }),
      marketRow(poolC!, null, "100"),
    ];
    const rows60m = [
      marketRow(poolA!, "100", "20"),
      marketRow(poolB!, null, "500"),
      marketRow(poolC!, "1000", null),
      marketRow(poolD!, null, "1000"),
    ];
    await pool.query(
      `UPDATE market_snapshots
          SET rows = CASE window_minutes
            WHEN 5 THEN $1::jsonb
            WHEN 60 THEN $2::jsonb
            ELSE rows
          END
        WHERE canonical AND window_minutes IN (5, 60)`,
      [JSON.stringify(rows5m), JSON.stringify(rows60m)],
    );
    const provider = new PostgresMarketPoolsProvider(pool);
    const address = "0x5151515151515151515151515151515151515151";

    const fees = await provider.getByToken({
      address,
      chainId: 56,
      limit: 3,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
      sort: "fees",
    });
    expect(fees.map(({ poolKey }) => poolKey)).toEqual([
      poolA!.pool_key,
      poolB!.pool_key,
      poolC!.pool_key,
    ]);
    expect(fees[0]).toMatchObject({
      fdvUsd: null,
      fees1h: "100",
      fees5m: "10",
      token0Symbol: null,
      token1Symbol: null,
      tvlUsd: null,
      volume1h: "20",
      volume5m: null,
    });

    const volume = await provider.getByToken({
      address,
      chainId: 56,
      limit: 100,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
      sort: "volume",
    });
    expect(volume.map(({ poolKey }) => poolKey)).toEqual([
      poolC!.pool_key,
      poolB!.pool_key,
      poolD!.pool_key,
      poolA!.pool_key,
    ]);

    const filtered = await provider.getByToken({
      address,
      chainId: 56,
      limit: 100,
      protocols: ["pcsv3", "pcsv4"],
      sort: "volume",
    });
    expect(filtered.map(({ protocol }) => protocol)).toEqual(["pcsv4", "pcsv3"]);
    expect(
      await provider.getByToken({
        address: "0xffffffffffffffffffffffffffffffffffffffff",
        chainId: 56,
        limit: 100,
        protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
        sort: "fees",
      }),
    ).toEqual([]);
  });

  it("treats same-key same-payload as no-op and quarantines a different payload", async () => {
    const duplicate = runnerFor("duplicate");
    const result = await duplicate.runner.runOnce();
    expect(result).toMatchObject({ acceptedCount: 1, conflictCount: 0, duplicateCount: 1 });

    const fixture = duplicate.fixture;
    await pool.query(
      `TRUNCATE market_stream_outbox, market_snapshots, integrity_quarantine,
        normalized_pool_events, raw_chain_logs, canonical_chain_blocks, indexer_cursors
        RESTART IDENTITY CASCADE`,
    );
    const conflicting = [structuredClone(fixture.input[0]!), structuredClone(fixture.input[0]!)];
    conflicting[1]!.rawLog.data = "0x99";
    const conflictRunner = new IndexerRunner({
      decoder: new FixtureEventDecoder(conflicting),
      evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
      source: new FixtureRawLogSource(conflicting, fixtureBlockTimestamp),
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
      decoder: new FixtureEventDecoder(first, {
        marketFor: () => ({ feesUsd: "1", volumeUsd: "10" }),
      }),
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
    const beforeReplay = await pool.query<{
      events: string;
      max_sequence: string;
      snapshots: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM normalized_pool_events) AS events,
        (SELECT count(*)::text FROM market_snapshots) AS snapshots,
        (SELECT max(sequence)::text FROM market_stream_outbox) AS max_sequence`,
    );
    await restarted.runOnce();
    const afterReplay = await pool.query<{
      events: string;
      max_sequence: string;
      snapshots: string;
    }>(
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
      evaluationTime: () => new Date("2026-08-16T00:01:00.000Z"),
      source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });
    await runner.runOnce();

    const events = await pool.query<{ block_hash: string; finality: string }>(
      "SELECT block_hash, finality FROM normalized_pool_events ORDER BY created_at, event_id",
    );
    expect(events.rows).toContainEqual({
      block_hash: fixture.input[0]!.rawLog.blockHash,
      finality: "reverted",
    });
    expect(events.rows).toContainEqual({
      block_hash: fixture.input[2]!.rawLog.blockHash,
      finality: "observed",
    });
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

  it("replaces recommendations from the canonical five-minute snapshot after a reorg", async () => {
    const fixture = structuredClone(readP02Fixture("reorg"));
    for (const entry of fixture.input) {
      entry.fixtureDecoded.kind = "swap";
      entry.fixtureDecoded.pool.token0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      entry.fixtureDecoded.pool.token1 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    }
    const runner = (input: typeof fixture.input) =>
      new IndexerRunner({
        decoder: new FixtureEventDecoder(input, { marketFor: reorgMarketProjection }),
        evaluationTime: () => new Date("2026-08-16T00:05:00.000Z"),
        source: new FixtureRawLogSource(input, fixtureBlockTimestamp),
        store: new PostgresCanonicalEventStore(pool),
      });
    const provider = new PostgresMarketPoolsProvider(pool);

    await runner(fixture.input.slice(0, 1)).runOnce();
    const originalSource = await provider.getTopFees({
      chainId: 56,
      minutes: 5,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
    });
    expect(originalSource.rows).toEqual([
      expect.objectContaining({
        feesUsd: "100",
        poolId: "0x4444444444444444444444444444444444444444444444444444444444444444",
        protocol: "univ4",
        token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ]);
    const original = selectRecommendedPools(originalSource, 3);

    await runner(fixture.input).runOnce();
    const replacementSource = await provider.getTopFees({
      chainId: 56,
      minutes: 5,
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
    });
    const replacement = selectRecommendedPools(replacementSource, 3);

    expect(original).toEqual([expect.objectContaining({ feesUsd: "100" })]);
    expect(replacement).toEqual([expect.objectContaining({ feesUsd: "40" })]);
    expect(BigInt(replacementSource.version)).toBeGreaterThan(BigInt(originalSource.version));
    expect(recommendationSelectionHash(replacement)).not.toBe(
      recommendationSelectionHash(original),
    );
    const canonicalRows = await pool.query<{ canonical: boolean; version: string }>(
      `SELECT canonical, version::text
         FROM market_snapshots
        WHERE stream_key = 'top-fees:56:5'
        ORDER BY version`,
    );
    expect(canonicalRows.rows.filter(({ canonical }) => canonical)).toEqual([
      { canonical: true, version: replacementSource.version },
    ]);
  });

  it("withdraws orphan labels and recomputes the replacement branch with shared context", async () => {
    const fixture = structuredClone(readP02Fixture("reorg"));
    for (const entry of fixture.input) entry.fixtureDecoded.kind = "swap";
    const createRunner = () =>
      new IndexerRunner({
        decoder: new FixtureEventDecoder(fixture.input, {
          marketFor(entry) {
            const oldBranch = entry.rawLog.blockHash.endsWith("20");
            return {
              feesUsd: oldBranch ? "20" : "4",
              tvlUsd: "1000",
              volumeUsd: oldBranch ? "200" : "40",
            };
          },
        }),
        evaluationTime: () => new Date("2026-08-16T00:01:00.000Z"),
        source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
        store: new PostgresCanonicalEventStore(pool),
      });

    const first = await createRunner().runOnce();
    expect(first).toMatchObject({ acceptedCount: 2, duplicateCount: 0, revertedCount: 1 });
    const outbox = await pool.query<{
      event_type: string;
      payload: {
        canonicalRevision: string;
        metricVersion: string;
        rows?: MarketPoolSnapshot["rows"];
        tombstones?: string[];
        upserts?: MarketPoolSnapshot["rows"];
        windowEnd: string;
      };
      sequence: string;
    }>(
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
    const [oldBranch, withdrawn, replacement] = outbox.rows.map(({ payload }) => payload);
    expect(oldBranch?.rows?.[0]?.labels.map(({ id }) => id)).toContain("high-fee-rate");
    const poolKey = oldBranch?.rows?.[0]?.poolKey;
    expect(withdrawn).toMatchObject({ tombstones: [poolKey], upserts: [] });
    expect(replacement?.upserts).toHaveLength(1);
    expect(replacement?.upserts?.[0]).toMatchObject({ labels: [], poolKey });
    for (const payload of [oldBranch, withdrawn, replacement]) {
      expect(payload).toMatchObject({
        canonicalRevision: expect.stringMatching(/^canonical:v1:[0-9a-f]{64}$/u),
        metricVersion: "market-metrics/v1",
        windowEnd: "2026-08-16T00:01:00.000Z",
      });
    }
    expect(
      new Set([oldBranch, withdrawn, replacement].map((item) => item?.canonicalRevision)).size,
    ).toBe(3);

    const canonical = await pool.query<{
      canonical_revision: string;
      label_rule_version: string;
      metric_version: string;
      rows: MarketPoolSnapshot["rows"];
      window_end: Date;
    }>(
      `SELECT canonical_revision, label_rule_version, metric_version, rows, window_end
         FROM market_snapshots
        WHERE stream_key = 'top-fees:56:1' AND canonical`,
    );
    expect(canonical.rows).toHaveLength(1);
    expect(canonical.rows[0]).toMatchObject({
      canonical_revision: replacement?.canonicalRevision,
      label_rule_version: "pool-labels/local-v1",
      metric_version: "market-metrics/v1",
      rows: [{ labelRuleVersion: "pool-labels/local-v1", labels: [], poolKey }],
    });
    expect(canonical.rows[0]?.window_end.toISOString()).toBe(replacement?.windowEnd);

    const beforeReplay = await pool.query<{
      max_sequence: string;
      snapshots: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM market_snapshots) AS snapshots,
         (SELECT max(sequence)::text FROM market_stream_outbox) AS max_sequence`,
    );
    const replay = await createRunner().runOnce();
    const afterReplay = await pool.query<{
      max_sequence: string;
      snapshots: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM market_snapshots) AS snapshots,
         (SELECT max(sequence)::text FROM market_stream_outbox) AS max_sequence`,
    );
    expect(replay).toMatchObject({ acceptedCount: 0, duplicateCount: 1, revertedCount: 0 });
    expect(afterReplay.rows).toEqual(beforeReplay.rows);
  });

  it("treats a stale old-branch redelivery as a strict no-op after reorg", async () => {
    const fixture = readP02Fixture("reorg");
    await runnerFor("reorg").runner.runOnce();
    const state = () =>
      pool.query<{
        canonical_block: string;
        canonical_events: string;
        cursor: string;
        max_sequence: string;
      }>(
        `SELECT
          (SELECT block_hash FROM canonical_chain_blocks WHERE chain_id = 56 AND canonical)
            AS canonical_block,
          (SELECT count(*)::text FROM normalized_pool_events WHERE canonical)
            AS canonical_events,
          (SELECT cursor FROM indexer_cursors WHERE chain_id = 56) AS cursor,
          (SELECT max(sequence)::text FROM market_stream_outbox WHERE window_minutes = 5)
            AS max_sequence`,
      );
    const before = await state();
    const staleOldBranch = [fixture.input[0]!];
    const staleRunner = new IndexerRunner({
      decoder: new FixtureEventDecoder(staleOldBranch, {
        marketFor: () => ({
          fdvUsd: "1000000",
          feesUsd: null,
          token0Symbol: "WBNB",
          token1Symbol: "USDT",
          tvlUsd: "10000",
          volumeUsd: null,
        }),
      }),
      evaluationTime: () => new Date("2026-08-16T00:06:00.000Z"),
      source: new FixtureRawLogSource(staleOldBranch, fixtureBlockTimestamp),
      store: new PostgresCanonicalEventStore(pool),
    });

    const result = await staleRunner.runOnce();
    const after = await state();

    expect(result).toMatchObject({
      acceptedCount: 0,
      duplicateCount: 1,
      revertedCount: 0,
    });
    expect(after.rows).toEqual(before.rows);
  });

  it("runs the market, flow, catalog and label migrations down and up in dependency order", async () => {
    const market = migrationSections(readFileSync(migrationPath, "utf8"));
    const flow = migrationSections(readFileSync(flowMigrationPath, "utf8"));
    const catalog = migrationSections(readFileSync(catalogMigrationPath, "utf8"));
    const labelContext = migrationSections(readFileSync(labelContextMigrationPath, "utf8"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(labelContext.down);
      await client.query(catalog.down);
      await client.query(flow.down);
      await client.query(market.down);
      const removed = await client.query<{ catalog: boolean; flow: boolean; market: boolean }>(
        `SELECT
           to_regclass('public.market_pool_catalog') IS NOT NULL AS catalog,
           to_regclass('public.liquidity_flow_outbox') IS NOT NULL AS flow,
           to_regclass('public.market_stream_outbox') IS NOT NULL AS market`,
      );
      expect(removed.rows).toEqual([{ catalog: false, flow: false, market: false }]);
      await client.query(market.up);
      await client.query(flow.up);
      await client.query(catalog.up);
      await client.query(labelContext.up);
      const restored = await client.query<{ catalog: boolean; flow: boolean; market: boolean }>(
        `SELECT
           to_regclass('public.market_pool_catalog') IS NOT NULL AS catalog,
           to_regclass('public.liquidity_flow_outbox') IS NOT NULL AS flow,
           to_regclass('public.market_stream_outbox') IS NOT NULL AS market`,
      );
      expect(restored.rows).toEqual([{ catalog: true, flow: true, market: true }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("starts a new epoch with a complete snapshot after a retention miss", async () => {
    await runnerFor("normal").runner.runOnce();
    const before = await pool.query<{ epoch: string }>(
      `SELECT o.epoch::text
         FROM market_stream_outbox AS o
        WHERE o.stream_key = 'top-fees:56:5'
        ORDER BY o.epoch DESC, o.sequence DESC
        LIMIT 1`,
    );
    const provider = new PostgresMarketPoolsProvider(pool, {
      now: () => new Date("2026-08-16T00:06:00.000Z"),
      pollMilliseconds: 1,
    });

    const [recovery] = await takeStreamEvents(provider, 1, "expired-retention-cursor");

    expect(recovery).toMatchObject({
      epoch: (BigInt(before.rows[0]!.epoch) + 1n).toString(),
      eventType: "pools.snapshot",
      mode: "snapshot",
      sequence: "1",
      streamKey: "top-fees:56:5",
    });
    expect(recovery?.data).toMatchObject({ chainId: 56, minutes: 5, rows: expect.any(Array) });
    const durable = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_stream_outbox
        WHERE cursor = $1 AND event_type = 'pools.snapshot'`,
      [recovery!.cursor],
    );
    expect(durable.rows).toEqual([{ count: "1" }]);
  });

  it("persists heartbeats and replays strictly after Last-Event-ID", async () => {
    await runnerFor("normal").runner.runOnce();
    const provider = new PostgresMarketPoolsProvider(pool, {
      heartbeatMilliseconds: 1,
      now: () => new Date("2026-08-16T00:06:00.000Z"),
      pollMilliseconds: 1,
    });

    const [snapshot, heartbeat] = await takeStreamEvents(provider, 2, null);

    expect(snapshot?.eventType).toBe("pools.snapshot");
    expect(heartbeat).toMatchObject({
      data: null,
      epoch: snapshot!.epoch,
      eventType: "heartbeat",
      mode: "diff",
      sequence: (BigInt(snapshot!.sequence) + 1n).toString(),
    });
    const replayProvider = new PostgresMarketPoolsProvider(pool, {
      now: () => new Date("2026-08-16T00:06:01.000Z"),
      pollMilliseconds: 1,
    });
    const [replayed] = await takeStreamEvents(replayProvider, 1, snapshot!.cursor);
    expect(replayed).toEqual(heartbeat);

    const durable = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM market_stream_outbox
        WHERE cursor = $1 AND event_type = 'heartbeat'`,
      [heartbeat!.cursor],
    );
    expect(durable.rows).toEqual([{ count: "1" }]);
  });

  it("uses one normalized DEX set for filtered snapshots, streams, and reconnect cursors", async () => {
    await runnerFor("normal").runner.runOnce();
    const protocols = ["pcsv3", "univ4"] as const;
    const provider = new PostgresMarketPoolsProvider(pool, {
      heartbeatMilliseconds: 1,
      now: () => new Date("2026-08-16T00:06:00.000Z"),
      pollMilliseconds: 1,
    });

    const combined = await provider.getTopFees({ chainId: 56, minutes: 5, protocols });
    const [snapshot, heartbeat] = await takeStreamEvents(provider, 2, null, protocols);

    const selected = new Set<string>(protocols);
    expect(combined.rows.every(({ protocol }) => selected.has(protocol))).toBe(true);
    expect(snapshot).toMatchObject({
      eventType: "pools.snapshot",
      streamKey: "top-fees:56:5:dex=pcsv3,univ4",
    });
    expect(snapshot?.cursor).toMatch(/^market-filter:v1:/u);
    expect((snapshot?.data as MarketPoolSnapshot).rows).toEqual(combined.rows);
    expect(heartbeat?.streamKey).toBe(snapshot?.streamKey);

    const replayProvider = new PostgresMarketPoolsProvider(pool, { pollMilliseconds: 1 });
    const [replayed] = await takeStreamEvents(replayProvider, 1, snapshot!.cursor, protocols);
    expect(replayed).toEqual(heartbeat);
  });

  it("uses the replay index and paginates retained events in bounded 500-row reads", async () => {
    await pool.query(
      `INSERT INTO market_stream_outbox (
         stream_key, chain_id, window_minutes, epoch, sequence, cursor,
         event_type, mode, envelope, created_at
       )
       SELECT
         'top-fees:56:5', 56, 5, 1, value, 'perf-' || value::text,
         'heartbeat', 'diff',
         jsonb_build_object(
           'cursor', 'perf-' || value::text,
           'data', NULL,
           'emittedAt', '2026-08-16T00:00:00.000Z',
           'epoch', '1',
           'eventType', 'heartbeat',
           'mode', 'diff',
           'schemaVersion', '1.0.0',
           'sequence', value::text,
           'streamKey', 'top-fees:56:5'
         ),
         '2026-08-16T00:00:00.000Z'::timestamptz + value * interval '1 millisecond'
       FROM generate_series(1, 600) AS value`,
    );
    await pool.query("ANALYZE market_stream_outbox");
    await pool.query("SET enable_seqscan = off");
    try {
      const plan = await pool.query(
        `EXPLAIN (FORMAT JSON)
         SELECT o.epoch::text, o.sequence::text, o.envelope
           FROM market_stream_outbox AS o
          WHERE o.stream_key = $1
            AND (o.epoch > $2 OR (o.epoch = $2 AND o.sequence > $3))
          ORDER BY o.epoch, o.sequence
          LIMIT 500`,
        ["top-fees:56:5", "1", "1"],
      );
      expect(JSON.stringify(plan.rows)).toContain("market_stream_outbox_replay");
    } finally {
      await pool.query("RESET enable_seqscan");
    }

    const provider = new PostgresMarketPoolsProvider(pool, { pollMilliseconds: 1 });
    const replay = await takeStreamEvents(provider, 501, "perf-1");
    expect(replay).toHaveLength(501);
    expect(replay[0]?.sequence).toBe("2");
    expect(replay.at(-1)?.sequence).toBe("502");
    expect(new Set(replay.map(({ cursor }) => cursor)).size).toBe(501);
  });

  it("matches the committed reorg vertical-slice golden artifacts", async () => {
    const normal = readP02Fixture("normal");
    const reorg = readP02Fixture("reorg");
    const fixtureStages = [
      { fixture: normal, marketFor: normalMarketProjection },
      { fixture: reorg, marketFor: reorgMarketProjection },
    ] as const;
    const normalizedEvents: NormalizedPoolEvent[] = [];
    for (const { fixture, marketFor } of fixtureStages) {
      const decoder = new FixtureEventDecoder(fixture.input, { marketFor });
      const source = new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp);
      const page = await source.read(null);
      normalizedEvents.push(
        ...page!.deliveries
          .slice()
          .sort(compareRawLogDeliveries)
          .map((delivery) => decoder.decode(delivery)),
      );
      await new IndexerRunner({
        decoder: new FixtureEventDecoder(fixture.input, { marketFor }),
        evaluationTime: () => new Date("2026-08-16T00:01:00.000Z"),
        source: new FixtureRawLogSource(fixture.input, fixtureBlockTimestamp),
        store: new PostgresCanonicalEventStore(pool),
      }).runOnce();
    }

    const canonicalStore = {
      blocks: (
        await pool.query(
          `SELECT chain_id::text, block_number::text, block_hash, parent_hash,
                  block_timestamp, canonical, reverted_at
             FROM canonical_chain_blocks
            ORDER BY block_number, block_hash`,
        )
      ).rows,
      cursor: (
        await pool.query(
          `SELECT chain_id::text, block_number::text, block_hash,
                  transaction_index::text, log_index::text, cursor, updated_at
             FROM indexer_cursors
            ORDER BY chain_id`,
        )
      ).rows,
      events: (
        await pool.query(
          `SELECT event_id, schema_version, chain_id::text, block_number::text,
                  block_hash, block_timestamp, transaction_hash,
                  transaction_index::text, log_index::text, protocol,
                  protocol_generation, kind, finality, canonical, cursor,
                  pool_address, pool_id, amount0::text, amount1::text,
                  liquidity_delta::text, sqrt_price_x96::text, payload,
                  market_data, raw_ref, reverted_at
             FROM normalized_pool_events
            ORDER BY block_number, block_hash, transaction_index, log_index`,
        )
      ).rows,
      rawLogs: (
        await pool.query(
          `SELECT chain_id::text, block_number::text, block_hash,
                  transaction_hash, transaction_index::text, log_index::text,
                  contract_address, removed, canonical, reverted_at
             FROM raw_chain_logs
            ORDER BY block_number, block_hash, transaction_index, log_index`,
        )
      ).rows,
    };
    const currentWindows = (
      await pool.query<{ rows: MarketPoolSnapshot["rows"]; snapshot_hash: string }>(
        `SELECT stream_key, chain_id::text, window_minutes, window_start,
                window_end, version::text, source_cursor, snapshot_hash, rows,
                created_at
           FROM market_snapshots
          WHERE canonical
        ORDER BY window_minutes`,
      )
    ).rows;
    for (const window of currentWindows) {
      for (const row of window.rows) {
        expect(row).toMatchObject({
          feePips: expect.toBeOneOf([expect.any(String), null]),
          hooks: expect.toBeOneOf([expect.any(String), null]),
          poolKey: expect.any(String),
          tickSpacing: expect.toBeOneOf([expect.any(String), null]),
          token0Address: expect.toBeOneOf([expect.any(String), null]),
          token1Address: expect.toBeOneOf([expect.any(String), null]),
        });
      }
    }
    const windows = currentWindows.map((window) => ({
      ...window,
      rows: legacyRows(window.rows),
      snapshot_hash: legacyRowsHash(window.rows),
    }));
    const snapshotHistory = await pool.query<{
      rows: MarketPoolSnapshot["rows"];
      stream_key: string;
      version: string;
    }>(
      `SELECT stream_key, version::text, rows
         FROM market_snapshots`,
    );
    const legacySnapshotHashes = new Map(
      snapshotHistory.rows.map((snapshot) => [
        `${snapshot.stream_key}:${snapshot.version}`,
        legacyRowsHash(snapshot.rows),
      ]),
    );
    const outbox = await pool.query<{ envelope: MarketStreamEnvelope }>(
      `SELECT envelope
         FROM market_stream_outbox
        WHERE stream_key = 'top-fees:56:1'
        ORDER BY epoch, sequence`,
    );
    let transcript = "retry: 3000\n\n";
    for (const { envelope: currentEnvelope } of outbox.rows) {
      const currentData = currentEnvelope.data!;
      const currentRows = "rows" in currentData ? currentData.rows : currentData.upserts;
      for (const row of currentRows) {
        expect(row).toMatchObject({
          poolKey: expect.any(String),
          token0Address: expect.toBeOneOf([expect.any(String), null]),
          token1Address: expect.toBeOneOf([expect.any(String), null]),
        });
      }
      const data: Record<string, unknown> =
        "rows" in currentData
          ? { ...currentData, rows: legacyRows(currentData.rows) }
          : { ...currentData, upserts: legacyRows(currentData.upserts) };
      delete data.canonicalRevision;
      delete data.metricVersion;
      if (!("rows" in currentData)) delete data.windowEnd;
      const legacyHash = legacySnapshotHashes.get(
        `${currentEnvelope.streamKey}:${currentData.version}`,
      )!;
      const cursor = currentEnvelope.cursor.replace(/[0-9a-f]{16}$/u, legacyHash.slice(0, 16));
      const envelope = { ...currentEnvelope, cursor, data };
      transcript += `id: ${cursor}\n`;
      transcript += `event: ${envelope.eventType}\n`;
      transcript += `data: ${JSON.stringify(envelope)}\n\n`;
    }

    const expected = new Map<string, string>([
      [
        "fixed-input.json",
        goldenJson({
          fixtures: [normal, reorg],
          schemaVersion: 1,
          sourceFixtures: [
            "artifacts/acceptance/P02-01/fixtures/normal.json",
            "artifacts/acceptance/P02-01/fixtures/reorg.json",
          ],
          workItemId: "P02-02",
        }),
      ],
      [
        "normalized-events.json",
        goldenJson({
          events: normalizedEvents,
          schemaVersion: 1,
          sourceFixtures: [
            "artifacts/acceptance/P02-01/fixtures/normal.json",
            "artifacts/acceptance/P02-01/fixtures/reorg.json",
          ],
          workItemId: "P02-02",
        }),
      ],
      [
        "canonical-store.json",
        goldenJson({
          ...canonicalStore,
          schemaVersion: 1,
          workItemId: "P02-02",
        }),
      ],
      [
        "window-results.json",
        goldenJson({
          schemaVersion: 1,
          windows,
          workItemId: "P02-02",
        }),
      ],
      ["sse-transcript.txt", transcript],
    ]);

    if (process.env.UPDATE_P02_02_GOLDEN === "1") {
      mkdirSync(goldenDirectory, { recursive: true });
      for (const [filename, content] of expected) {
        writeFileSync(path.join(goldenDirectory, filename), content);
      }
    }

    for (const [filename, content] of expected) {
      expect(readFileSync(path.join(goldenDirectory, filename), "utf8"), filename).toBe(content);
    }
  });
});
