import { createHash } from "node:crypto";

import {
  CANDLE_BARS,
  aggregateCanonicalCandles,
  projectCanonicalOneMinuteCandles,
  projectCanonicalTickLiquidity,
  type CandleBar,
  type CandleTickCanonicalEvent,
  type CanonicalBaseCandle,
} from "@lpbot/market-metrics";
import type { PoolClient } from "pg";

import type { NormalizedPoolEvent } from "./types.js";

export interface CandleTickReadModelImpact {
  minuteBuckets: Map<string, Set<number>>;
  poolKeys: Set<string>;
}

export interface CandleTickReadModelImpactEvent {
  blockTimestamp: Date | string;
  chainId: number;
  kind: NormalizedPoolEvent["kind"];
  poolAddress: string | null;
  poolId: string | null;
}

export interface RebuildCandleTickReadModelsInput {
  evaluationTime: string;
  impact: CandleTickReadModelImpact;
  sourceCursor: string | null;
}

interface CatalogRow {
  tick_spacing: string;
}

interface StoredReadModelEvent {
  amount0: string | null;
  amount1: string | null;
  block_number: string;
  block_timestamp: Date;
  event_id: string;
  kind: CandleTickCanonicalEvent["kind"];
  liquidity_delta: string | null;
  log_index: string;
  payload: Record<string, string | null>;
  pool_address: string | null;
  pool_id: string | null;
  protocol: CandleTickCanonicalEvent["protocol"];
  sqrt_price_x96: string | null;
  tick_spacing: string | null;
  token0: string | null;
  token1: string | null;
  transaction_index: string;
}

interface StoredCandleRow {
  bucket_start: Date;
  close: string;
  high: string;
  low: string;
  open: string;
  pool_key: string;
  volume0_raw: string;
  volume1_raw: string;
}

const aggregateBars = CANDLE_BARS.filter((bar): bar is Exclude<CandleBar, "1m"> => bar !== "1m");
const secondsByBar: Record<CandleBar, number> = {
  "1D": 86_400,
  "1H": 3_600,
  "1m": 60,
  "15m": 900,
  "4H": 14_400,
  "5m": 300,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function canonicalRevision(events: readonly CandleTickCanonicalEvent[]): string {
  const hash = createHash("sha256").update(JSON.stringify(stableValue(events))).digest("hex");
  return `canonical:v1:${hash}`;
}

function identityKey(input: {
  chainId: number;
  poolAddress: string | null;
  poolId: string | null;
}): string {
  const identity = input.poolAddress ?? input.poolId;
  if (!identity) throw new RangeError("READ_MODEL_POOL_IDENTITY_MISSING");
  return `${input.chainId}:${identity.toLowerCase()}`;
}

function epochSeconds(value: Date | string): number {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError("READ_MODEL_TIMESTAMP_INVALID");
  return Math.floor(milliseconds / 1_000);
}

export function createCandleTickReadModelImpact(): CandleTickReadModelImpact {
  return { minuteBuckets: new Map(), poolKeys: new Set() };
}

export function addCandleTickReadModelImpact(
  impact: CandleTickReadModelImpact,
  event: CandleTickReadModelImpactEvent,
): void {
  if (
    event.kind !== "pool.created" &&
    event.kind !== "swap" &&
    event.kind !== "liquidity.add" &&
    event.kind !== "liquidity.remove"
  ) {
    return;
  }
  const key = identityKey(event);
  impact.poolKeys.add(key);
  if (event.kind !== "swap") return;
  const buckets = impact.minuteBuckets.get(key) ?? new Set<number>();
  buckets.add(Math.floor(epochSeconds(event.blockTimestamp) / 60) * 60);
  impact.minuteBuckets.set(key, buckets);
}

export function mergeCandleTickReadModelImpact(
  target: CandleTickReadModelImpact,
  source: CandleTickReadModelImpact,
): void {
  for (const key of source.poolKeys) target.poolKeys.add(key);
  for (const [key, sourceBuckets] of source.minuteBuckets) {
    const buckets = target.minuteBuckets.get(key) ?? new Set<number>();
    for (const bucket of sourceBuckets) buckets.add(bucket);
    target.minuteBuckets.set(key, buckets);
  }
}

function toCanonicalEvent(row: StoredReadModelEvent): CandleTickCanonicalEvent {
  return {
    amount0: row.amount0,
    amount1: row.amount1,
    blockNumber: row.block_number,
    blockTimestamp: row.block_timestamp.toISOString(),
    canonical: true,
    eventId: row.event_id,
    kind: row.kind,
    liquidityDelta: row.liquidity_delta,
    logIndex: Number(row.log_index),
    payload: row.payload,
    pool: {
      poolAddress: row.pool_address,
      poolId: row.pool_id,
      tickSpacing: row.tick_spacing,
      token0: row.token0,
      token1: row.token1,
    },
    protocol: row.protocol,
    sqrtPriceX96: row.sqrt_price_x96,
    transactionIndex: Number(row.transaction_index),
  };
}

function storedCandle(row: StoredCandleRow): CanonicalBaseCandle {
  return {
    close: row.close,
    high: row.high,
    low: row.low,
    open: row.open,
    poolKey: row.pool_key,
    ts: Math.floor(row.bucket_start.getTime() / 1_000),
    volume0: row.volume0_raw,
    volume1: row.volume1_raw,
  };
}

export class PostgresCandleTickReadModelProjector {
  async rebuild(
    client: PoolClient,
    input: RebuildCandleTickReadModelsInput,
  ): Promise<void> {
    for (const key of [...input.impact.poolKeys].sort()) {
      const catalog = await client.query<CatalogRow>(
        `SELECT tick_spacing::text
           FROM market_pool_catalog
          WHERE chain_id = 56 AND pool_key = $1`,
        [key],
      );
      const catalogRow = catalog.rows[0];
      if (!catalogRow) {
        await client.query("DELETE FROM market_candles WHERE pool_key = $1", [key]);
        await client.query("DELETE FROM market_tick_liquidity WHERE pool_key = $1", [key]);
        await client.query("DELETE FROM market_read_model_states WHERE pool_key = $1", [key]);
        continue;
      }

      const events = await this.#events(client, key);
      if (events.length === 0) throw new Error("READ_MODEL_CANONICAL_EVENTS_MISSING");
      const tickProjection = projectCanonicalTickLiquidity(events);
      if (String(tickProjection.tickSpacing) !== catalogRow.tick_spacing) {
        throw new Error("READ_MODEL_TICK_SPACING_MISMATCH");
      }
      const previous = await client.query<{ version: string }>(
        `SELECT version::text FROM market_read_model_states
          WHERE pool_key = $1 FOR UPDATE`,
        [key],
      );
      const version = previous.rows[0]
        ? (BigInt(previous.rows[0].version) + 1n).toString()
        : "1";
      const revision = canonicalRevision(events);

      await this.#rebuildCandles(
        client,
        key,
        events,
        input.impact.minuteBuckets.get(key) ?? new Set(),
        input.evaluationTime,
      );
      await client.query("DELETE FROM market_tick_liquidity WHERE pool_key = $1", [key]);
      for (const tick of tickProjection.ticks) {
        await client.query(
          `INSERT INTO market_tick_liquidity (
             pool_key, chain_id, tick_idx, liquidity_net, updated_at
           ) VALUES ($1, 56, $2, $3, $4)`,
          [key, tick.tickIdx, tick.liquidityNet, input.evaluationTime],
        );
      }
      await client.query(
        `INSERT INTO market_read_model_states (
           pool_key, chain_id, canonical_revision, version, as_of, source,
           source_cursor, current_tick, tick_spacing, updated_at
         ) VALUES ($1, 56, $2, $3, $4, 'canonical-events', $5, $6, $7, $4)
         ON CONFLICT (pool_key) DO UPDATE SET
           canonical_revision = EXCLUDED.canonical_revision,
           version = EXCLUDED.version,
           as_of = EXCLUDED.as_of,
           source = EXCLUDED.source,
           source_cursor = EXCLUDED.source_cursor,
           current_tick = EXCLUDED.current_tick,
           tick_spacing = EXCLUDED.tick_spacing,
           updated_at = EXCLUDED.updated_at`,
        [
          key,
          revision,
          version,
          input.evaluationTime,
          input.sourceCursor,
          tickProjection.currentTick,
          tickProjection.tickSpacing,
        ],
      );
    }
  }

  async #events(client: PoolClient, key: string): Promise<CandleTickCanonicalEvent[]> {
    const result = await client.query<StoredReadModelEvent>(
      `SELECT amount0::text, amount1::text, block_number::text, block_timestamp,
              event_id, kind, liquidity_delta::text, log_index::text, payload,
              pool_address, pool_id, protocol, sqrt_price_x96::text,
              tick_spacing::text, token0, token1, transaction_index::text
         FROM normalized_pool_events
        WHERE chain_id = 56 AND canonical
          AND kind IN ('pool.created', 'swap', 'liquidity.add', 'liquidity.remove')
          AND chain_id::text || ':' || lower(COALESCE(pool_address, pool_id)) = $1
        ORDER BY block_number, transaction_index, log_index, event_id`,
      [key],
    );
    return result.rows.map(toCanonicalEvent);
  }

  async #rebuildCandles(
    client: PoolClient,
    key: string,
    events: readonly CandleTickCanonicalEvent[],
    minuteBuckets: ReadonlySet<number>,
    updatedAt: string,
  ): Promise<void> {
    const aggregateTargets = new Map<Exclude<CandleBar, "1m">, Set<number>>(
      aggregateBars.map((bar) => [bar, new Set<number>()]),
    );
    for (const minute of [...minuteBuckets].sort((left, right) => left - right)) {
      await client.query(
        `DELETE FROM market_candles
          WHERE pool_key = $1 AND bar = '1m' AND bucket_start = to_timestamp($2)`,
        [key, minute],
      );
      const projected = projectCanonicalOneMinuteCandles(
        events.filter(
          (event) =>
            event.kind === "swap" &&
            Math.floor(epochSeconds(event.blockTimestamp) / 60) * 60 === minute,
        ),
      );
      if (projected.length > 1) throw new Error("READ_MODEL_CANDLE_DUPLICATE");
      if (projected[0]) await this.#insertCandle(client, "1m", projected[0], updatedAt);
      for (const bar of aggregateBars) {
        const seconds = secondsByBar[bar];
        aggregateTargets.get(bar)!.add(Math.floor(minute / seconds) * seconds);
      }
    }

    for (const bar of aggregateBars) {
      const seconds = secondsByBar[bar];
      for (const target of [...aggregateTargets.get(bar)!].sort((left, right) => left - right)) {
        await client.query(
          `DELETE FROM market_candles
            WHERE pool_key = $1 AND bar = $2 AND bucket_start = to_timestamp($3)`,
          [key, bar, target],
        );
        const base = await client.query<StoredCandleRow>(
          `SELECT pool_key, bucket_start, open::text, high::text, low::text, close::text,
                  volume0_raw::text, volume1_raw::text
             FROM market_candles
            WHERE pool_key = $1 AND bar = '1m'
              AND bucket_start >= to_timestamp($2)
              AND bucket_start < to_timestamp($3)
            ORDER BY bucket_start`,
          [key, target, target + seconds],
        );
        const projected = aggregateCanonicalCandles(base.rows.map(storedCandle), bar, 1);
        if (projected[0]) await this.#insertCandle(client, bar, projected[0], updatedAt);
      }
    }
  }

  async #insertCandle(
    client: PoolClient,
    bar: CandleBar,
    candle: CanonicalBaseCandle,
    updatedAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO market_candles (
         pool_key, chain_id, bar, bucket_start, open, high, low, close,
         volume0_raw, volume1_raw, updated_at
       ) VALUES ($1, 56, $2, to_timestamp($3), $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (pool_key, bar, bucket_start) DO UPDATE SET
         open = EXCLUDED.open,
         high = EXCLUDED.high,
         low = EXCLUDED.low,
         close = EXCLUDED.close,
         volume0_raw = EXCLUDED.volume0_raw,
         volume1_raw = EXCLUDED.volume1_raw,
         updated_at = EXCLUDED.updated_at`,
      [
        candle.poolKey,
        bar,
        candle.ts,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume0,
        candle.volume1,
        updatedAt,
      ],
    );
  }
}
