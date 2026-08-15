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
import type { MarketStreamEnvelope } from "../../packages/api-contract/src/index.js";
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
): Promise<MarketStreamEnvelope[]> {
  const controller = new AbortController();
  const events: MarketStreamEnvelope[] = [];
  for await (const event of provider.subscribe({
    chainId: 56,
    lastEventId,
    minutes: 5,
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
    const windows = (
      await pool.query(
        `SELECT stream_key, chain_id::text, window_minutes, window_start,
                window_end, version::text, source_cursor, snapshot_hash, rows,
                created_at
           FROM market_snapshots
          WHERE canonical
          ORDER BY window_minutes`,
      )
    ).rows;
    const outbox = await pool.query<{ envelope: MarketStreamEnvelope }>(
      `SELECT envelope
         FROM market_stream_outbox
        WHERE stream_key = 'top-fees:56:1'
        ORDER BY epoch, sequence`,
    );
    let transcript = "retry: 3000\n\n";
    for (const { envelope } of outbox.rows) {
      transcript += `id: ${envelope.cursor}\n`;
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
