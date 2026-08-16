import {
  type EvmAddress,
  type MarketCandleBar,
  type MarketCandlesResponse,
  type MarketProtocol,
  type MarketTickLiquidityResponse,
} from "@lpbot/api-contract";
import {
  orientCanonicalCandles,
  selectTickLiquidityRange,
  type CanonicalBaseCandle,
  type CanonicalTickLiquidity,
} from "@lpbot/market-metrics";
import type { Pool } from "pg";

export interface MarketCandleQuery {
  bar: MarketCandleBar;
  chainId: 56;
  limit: number;
  poolKey: string | null;
  token: EvmAddress;
}

export interface MarketTickLiquidityQuery {
  chainId: 56;
  decimals0: number | null;
  decimals1: number | null;
  identity: `0x${string}`;
  protocol: MarketProtocol;
  range: number;
  tickSpacing: number;
}

export interface MarketChartsProvider {
  getCandles(query: MarketCandleQuery): Promise<MarketCandlesResponse>;
  getTickLiquidity(query: MarketTickLiquidityQuery): Promise<MarketTickLiquidityResponse>;
}

export type MarketChartProviderErrorCode =
  | "AMBIGUOUS_POOL"
  | "MARKET_POOL_NOT_FOUND"
  | "TICK_SPACING_MISMATCH"
  | "TOKEN_NOT_IN_POOL";

export class MarketChartProviderError extends Error {
  readonly code: MarketChartProviderErrorCode;

  constructor(code: MarketChartProviderErrorCode) {
    super(code);
    this.name = "MarketChartProviderError";
    this.code = code;
  }
}

interface CatalogStateRow {
  as_of: Date | null;
  canonical_revision: string | null;
  current_tick: number | null;
  pool_key: string;
  protocol: MarketProtocol;
  tick_spacing: string;
  token0: EvmAddress;
  token1: EvmAddress;
  updated_at: Date;
  version: string | null;
}

interface CandleRow {
  bucket_start: Date;
  close: string;
  high: string;
  low: string;
  open: string;
  pool_key: string;
  volume0_raw: string;
  volume1_raw: string;
}

interface TickRow {
  liquidity_net: string;
  tick_idx: number;
}

const emptyRevision = `canonical:v1:${"0".repeat(64)}`;

function metadata(row: CatalogStateRow) {
  return {
    asOf: (row.as_of ?? row.updated_at).toISOString(),
    canonicalRevision: row.canonical_revision ?? emptyRevision,
    source: "canonical-events" as const,
    version: row.version ?? "0",
  };
}

function canonicalBaseCandle(row: CandleRow): CanonicalBaseCandle {
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

export class PostgresMarketChartsProvider implements MarketChartsProvider {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getCandles(query: MarketCandleQuery): Promise<MarketCandlesResponse> {
    const pool = await this.#resolveCandlePool(query);
    const direction = query.token === pool.token0 ? "token0" : "token1";
    const result = await this.#pool.query<CandleRow>(
      `SELECT * FROM (
         SELECT pool_key, bucket_start, open::text, high::text, low::text, close::text,
                volume0_raw::text, volume1_raw::text
           FROM market_candles
          WHERE pool_key = $1 AND bar = $2
          ORDER BY bucket_start DESC
          LIMIT $3
       ) AS latest
       ORDER BY bucket_start`,
      [pool.pool_key, query.bar, query.limit],
    );
    const oriented = orientCanonicalCandles(result.rows.map(canonicalBaseCandle), direction);
    const timestamps = new Set<number>();
    const candles = oriented.map(({ poolKey: _poolKey, ...candle }) => {
      if (timestamps.has(candle.ts)) throw new Error("MARKET_CANDLE_TIMESTAMP_DUPLICATE");
      timestamps.add(candle.ts);
      return candle;
    });
    return {
      ...metadata(pool),
      bar: query.bar,
      candles,
      chainId: 56,
      direction,
      poolKey: pool.pool_key,
      priceUnit: direction === "token0" ? "token1-raw/token0-raw" : "token0-raw/token1-raw",
      token: query.token,
      volumeUnit: { kind: "raw-integer", token: query.token },
    };
  }

  async getTickLiquidity(query: MarketTickLiquidityQuery): Promise<MarketTickLiquidityResponse> {
    const result = await this.#pool.query<CatalogStateRow>(
      `SELECT catalog.pool_key, catalog.protocol, catalog.token0, catalog.token1,
              catalog.tick_spacing::text, catalog.updated_at,
              state.canonical_revision, state.version::text, state.as_of, state.current_tick
         FROM market_pool_catalog AS catalog
         LEFT JOIN market_read_model_states AS state ON state.pool_key = catalog.pool_key
        WHERE catalog.chain_id = $1
          AND lower(COALESCE(catalog.pool_address, catalog.pool_id)) = $2
          AND catalog.protocol = $3`,
      [query.chainId, query.identity.toLowerCase(), query.protocol],
    );
    const pool = result.rows[0];
    if (!pool) throw new MarketChartProviderError("MARKET_POOL_NOT_FOUND");
    if (pool.tick_spacing !== String(query.tickSpacing)) {
      throw new MarketChartProviderError("TICK_SPACING_MISMATCH");
    }
    const ticks = await this.#pool.query<TickRow>(
      `SELECT tick_idx, liquidity_net::text
         FROM market_tick_liquidity
        WHERE pool_key = $1
        ORDER BY tick_idx`,
      [pool.pool_key],
    );
    const projection: CanonicalTickLiquidity = {
      currentTick: pool.current_tick,
      poolKey: pool.pool_key,
      tickSpacing: query.tickSpacing,
      ticks: ticks.rows.map((tick) => ({
        liquidityNet: tick.liquidity_net,
        tickIdx: tick.tick_idx,
      })),
    };
    const selected = selectTickLiquidityRange(
      projection,
      query.range,
      query.decimals0,
      query.decimals1,
    );
    return {
      ...metadata(pool),
      chainId: 56,
      currentTick: selected.currentTick,
      decimals0: query.decimals0,
      decimals1: query.decimals1,
      poolKey: selected.poolKey,
      range: query.range,
      tickSpacing: selected.tickSpacing,
      ticks: selected.ticks,
    };
  }

  async #resolveCandlePool(query: MarketCandleQuery): Promise<CatalogStateRow> {
    const parameters: unknown[] = [query.chainId];
    let clause: string;
    if (query.poolKey) {
      parameters.push(query.poolKey);
      clause = `catalog.pool_key = $2`;
    } else {
      parameters.push(query.token);
      clause = `(catalog.token0 = $2 OR catalog.token1 = $2)`;
    }
    const result = await this.#pool.query<CatalogStateRow>(
      `SELECT catalog.pool_key, catalog.protocol, catalog.token0, catalog.token1,
              catalog.tick_spacing::text, catalog.updated_at,
              state.canonical_revision, state.version::text, state.as_of, state.current_tick
         FROM market_pool_catalog AS catalog
         LEFT JOIN market_read_model_states AS state ON state.pool_key = catalog.pool_key
        WHERE catalog.chain_id = $1 AND ${clause}
        ORDER BY catalog.pool_key
        LIMIT 2`,
      parameters,
    );
    if (result.rows.length === 0) throw new MarketChartProviderError("MARKET_POOL_NOT_FOUND");
    if (!query.poolKey && result.rows.length > 1) {
      throw new MarketChartProviderError("AMBIGUOUS_POOL");
    }
    const pool = result.rows[0]!;
    if (query.token !== pool.token0 && query.token !== pool.token1) {
      throw new MarketChartProviderError("TOKEN_NOT_IN_POOL");
    }
    return pool;
  }
}
