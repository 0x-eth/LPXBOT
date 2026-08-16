import { Decimal } from "decimal.js";

export const CANDLE_TICK_CONTRACT_VERSION = "candle-tick/local-v1" as const;
export const CANDLE_BARS = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;

export type CandleBar = (typeof CANDLE_BARS)[number];
export type CandlePriceDirection = "token0" | "token1";

export interface CandleTickCanonicalEvent {
  amount0: string | null;
  amount1: string | null;
  blockNumber: string;
  blockTimestamp: string;
  canonical: boolean;
  eventId: string;
  kind: "pool.created" | "swap" | "liquidity.add" | "liquidity.remove" | "collect";
  liquidityDelta: string | null;
  logIndex: number;
  payload: {
    tick?: string | null;
    tickLower?: string | null;
    tickUpper?: string | null;
  };
  pool: {
    poolAddress: string | null;
    poolId: string | null;
    tickSpacing: string | null;
    token0: string | null;
    token1: string | null;
  };
  protocol: "pcsv3" | "univ3" | "pcsv4" | "univ4";
  sqrtPriceX96: string | null;
  transactionIndex: number;
}

export interface CanonicalBaseCandle {
  close: string;
  high: string;
  low: string;
  open: string;
  poolKey: string;
  ts: number;
  volume0: string;
  volume1: string;
}

export interface OrientedCandle {
  close: string;
  high: string;
  low: string;
  open: string;
  poolKey: string;
  ts: number;
  volume: string;
}

export interface CanonicalTickBoundary {
  liquidityNet: string;
  tickIdx: number;
}

export interface CanonicalTickLiquidity {
  currentTick: number | null;
  poolKey: string;
  tickSpacing: number;
  ticks: CanonicalTickBoundary[];
}

export interface PricedTickBoundary extends CanonicalTickBoundary {
  price0: string | null;
  price1: string | null;
}

export interface SelectedTickLiquidity
  extends Omit<CanonicalTickLiquidity, "ticks"> {
  ticks: PricedTickBoundary[];
}

const ProjectionDecimal = Decimal.clone({
  precision: 96,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000_000,
  toExpPos: 1_000_000,
});
const Q192 = new ProjectionDecimal((2n ** 192n).toString());

const barSeconds: Record<CandleBar, number> = {
  "1D": 86_400,
  "1H": 3_600,
  "1m": 60,
  "15m": 900,
  "4H": 14_400,
  "5m": 300,
};

function decimal(value: string): Decimal {
  const parsed = new ProjectionDecimal(value);
  if (!parsed.isFinite()) throw new RangeError("CANDLE_DECIMAL_INVALID");
  return parsed;
}

function decimalString(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

function integer(value: string, code: string): bigint {
  if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value)) throw new RangeError(code);
  return BigInt(value);
}

function safeInteger(value: string, code: string): number {
  const parsed = integer(value, code);
  const result = Number(parsed);
  if (!Number.isSafeInteger(result)) throw new RangeError(code);
  return result;
}

function poolKey(event: Pick<CandleTickCanonicalEvent, "pool">): string {
  const identity = event.pool.poolAddress ?? event.pool.poolId;
  if (!identity) throw new RangeError("CANDLE_POOL_IDENTITY_MISSING");
  return `56:${identity.toLowerCase()}`;
}

function timestampSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError("CANDLE_TIMESTAMP_INVALID");
  return Math.floor(milliseconds / 1_000);
}

function compareCanonicalOrder(
  left: CandleTickCanonicalEvent,
  right: CandleTickCanonicalEvent,
): number {
  const blockOrder = integer(left.blockNumber, "CANDLE_BLOCK_NUMBER_INVALID") -
    integer(right.blockNumber, "CANDLE_BLOCK_NUMBER_INVALID");
  if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) {
    return left.transactionIndex - right.transactionIndex;
  }
  if (left.logIndex !== right.logIndex) return left.logIndex - right.logIndex;
  return left.eventId.localeCompare(right.eventId);
}

function compareDecimal(left: string, right: string): number {
  return decimal(left).comparedTo(decimal(right));
}

function exactDuplicate(left: CandleTickCanonicalEvent, right: CandleTickCanonicalEvent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalEvents(
  events: readonly CandleTickCanonicalEvent[],
): CandleTickCanonicalEvent[] {
  const byId = new Map<string, CandleTickCanonicalEvent>();
  for (const event of events) {
    if (!event.canonical) continue;
    const previous = byId.get(event.eventId);
    if (previous) {
      if (!exactDuplicate(previous, event)) throw new Error("CANDLE_EVENT_CONFLICT");
      continue;
    }
    byId.set(event.eventId, event);
  }
  return [...byId.values()].sort(compareCanonicalOrder);
}

export function sqrtPriceX96ToToken0Price(sqrtPriceX96: string): string {
  const sqrt = integer(sqrtPriceX96, "CANDLE_SQRT_PRICE_INVALID");
  if (sqrt <= 0n) throw new RangeError("CANDLE_SQRT_PRICE_INVALID");
  return decimalString(new ProjectionDecimal(sqrt.toString()).pow(2).dividedBy(Q192));
}

export function projectCanonicalOneMinuteCandles(
  input: readonly CandleTickCanonicalEvent[],
): CanonicalBaseCandle[] {
  const grouped = new Map<
    string,
    {
      close: string;
      high: string;
      low: string;
      open: string;
      poolKey: string;
      ts: number;
      volume0: Decimal;
      volume1: Decimal;
    }
  >();
  for (const event of canonicalEvents(input)) {
    if (event.kind !== "swap") continue;
    if (event.sqrtPriceX96 === null || event.amount0 === null || event.amount1 === null) {
      throw new RangeError("CANDLE_SWAP_FIELDS_MISSING");
    }
    integer(event.amount0, "CANDLE_VOLUME_INVALID");
    integer(event.amount1, "CANDLE_VOLUME_INVALID");
    const identity = poolKey(event);
    const ts = Math.floor(timestampSeconds(event.blockTimestamp) / 60) * 60;
    const key = `${identity}:${ts}`;
    const price = sqrtPriceX96ToToken0Price(event.sqrtPriceX96);
    const volume0 = decimal(event.amount0).abs();
    const volume1 = decimal(event.amount1).abs();
    const candle = grouped.get(key);
    if (!candle) {
      grouped.set(key, {
        close: price,
        high: price,
        low: price,
        open: price,
        poolKey: identity,
        ts,
        volume0,
        volume1,
      });
      continue;
    }
    candle.close = price;
    if (compareDecimal(price, candle.high) > 0) candle.high = price;
    if (compareDecimal(price, candle.low) < 0) candle.low = price;
    candle.volume0 = candle.volume0.plus(volume0);
    candle.volume1 = candle.volume1.plus(volume1);
  }
  return [...grouped.values()]
    .sort((left, right) => left.poolKey.localeCompare(right.poolKey) || left.ts - right.ts)
    .map(({ volume0, volume1, ...candle }) => ({
      ...candle,
      volume0: decimalString(volume0),
      volume1: decimalString(volume1),
    }));
}

export function aggregateCanonicalCandles(
  input: readonly CanonicalBaseCandle[],
  bar: CandleBar,
  limit: number,
): CanonicalBaseCandle[] {
  if (!CANDLE_BARS.includes(bar)) throw new RangeError("CANDLE_BAR_INVALID");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("CANDLE_LIMIT_INVALID");
  }
  const source = [...input].sort(
    (left, right) => left.poolKey.localeCompare(right.poolKey) || left.ts - right.ts,
  );
  const seen = new Set<string>();
  const grouped = new Map<string, CanonicalBaseCandle>();
  const seconds = barSeconds[bar];
  for (const candle of source) {
    const sourceKey = `${candle.poolKey}:${candle.ts}`;
    if (seen.has(sourceKey)) throw new Error("CANDLE_TIMESTAMP_DUPLICATE");
    seen.add(sourceKey);
    const ts = Math.floor(candle.ts / seconds) * seconds;
    const key = `${candle.poolKey}:${ts}`;
    const aggregate = grouped.get(key);
    if (!aggregate) {
      grouped.set(key, { ...candle, ts });
      continue;
    }
    aggregate.close = candle.close;
    if (compareDecimal(candle.high, aggregate.high) > 0) aggregate.high = candle.high;
    if (compareDecimal(candle.low, aggregate.low) < 0) aggregate.low = candle.low;
    aggregate.volume0 = decimalString(decimal(aggregate.volume0).plus(decimal(candle.volume0)));
    aggregate.volume1 = decimalString(decimal(aggregate.volume1).plus(decimal(candle.volume1)));
  }
  const rows = [...grouped.values()].sort(
    (left, right) => left.poolKey.localeCompare(right.poolKey) || left.ts - right.ts,
  );
  const selected: CanonicalBaseCandle[] = [];
  for (const identity of new Set(rows.map(({ poolKey: key }) => key))) {
    selected.push(...rows.filter(({ poolKey: key }) => key === identity).slice(-limit));
  }
  return selected.sort(
    (left, right) => left.poolKey.localeCompare(right.poolKey) || left.ts - right.ts,
  );
}

export function orientCanonicalCandles(
  input: readonly CanonicalBaseCandle[],
  direction: CandlePriceDirection,
): OrientedCandle[] {
  return input.map((candle) => {
    if (direction === "token0") {
      const { volume0, volume1: _volume1, ...values } = candle;
      return { ...values, volume: volume0 };
    }
    if (direction !== "token1") throw new RangeError("CANDLE_DIRECTION_INVALID");
    const inverse = (value: string) => decimalString(new ProjectionDecimal(1).dividedBy(decimal(value)));
    return {
      close: inverse(candle.close),
      high: inverse(candle.low),
      low: inverse(candle.high),
      open: inverse(candle.open),
      poolKey: candle.poolKey,
      ts: candle.ts,
      volume: candle.volume1,
    };
  });
}

export function projectCanonicalTickLiquidity(
  input: readonly CandleTickCanonicalEvent[],
): CanonicalTickLiquidity {
  const events = canonicalEvents(input);
  if (events.length === 0) throw new RangeError("TICK_POOL_EVENTS_MISSING");
  const identity = poolKey(events[0]!);
  if (events.some((event) => poolKey(event) !== identity)) {
    throw new RangeError("TICK_MULTIPLE_POOLS");
  }
  const spacings = new Set(
    events
      .map(({ pool }) => pool.tickSpacing)
      .filter((value): value is string => value !== null)
      .map((value) => safeInteger(value, "TICK_SPACING_INVALID")),
  );
  if (spacings.size !== 1) throw new RangeError("TICK_SPACING_MISMATCH");
  const tickSpacing = [...spacings][0]!;
  if (tickSpacing <= 0) throw new RangeError("TICK_SPACING_INVALID");

  const liquidity = new Map<number, bigint>();
  let currentTick: number | null = null;
  for (const event of events) {
    if ((event.kind === "pool.created" || event.kind === "swap") && event.payload.tick != null) {
      currentTick = safeInteger(event.payload.tick, "TICK_INDEX_INVALID");
    }
    if (event.kind !== "liquidity.add" && event.kind !== "liquidity.remove") continue;
    if (
      event.liquidityDelta === null ||
      event.payload.tickLower == null ||
      event.payload.tickUpper == null
    ) {
      throw new RangeError("TICK_LIQUIDITY_FIELDS_MISSING");
    }
    const lower = safeInteger(event.payload.tickLower, "TICK_INDEX_INVALID");
    const upper = safeInteger(event.payload.tickUpper, "TICK_INDEX_INVALID");
    if (lower >= upper || lower % tickSpacing !== 0 || upper % tickSpacing !== 0) {
      throw new RangeError("TICK_BOUNDARY_INVALID");
    }
    const delta = integer(event.liquidityDelta, "TICK_LIQUIDITY_INVALID");
    liquidity.set(lower, (liquidity.get(lower) ?? 0n) + delta);
    liquidity.set(upper, (liquidity.get(upper) ?? 0n) - delta);
  }
  return {
    currentTick,
    poolKey: identity,
    tickSpacing,
    ticks: [...liquidity.entries()]
      .filter(([, value]) => value !== 0n)
      .sort(([left], [right]) => left - right)
      .map(([tickIdx, value]) => ({ liquidityNet: value.toString(), tickIdx })),
  };
}

function validDecimals(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function pricesAtTick(
  tickIdx: number,
  decimals0: number | null,
  decimals1: number | null,
): { price0: string | null; price1: string | null } {
  if (decimals0 === null && decimals1 === null) return { price0: null, price1: null };
  if (!validDecimals(decimals0) || !validDecimals(decimals1)) {
    throw new RangeError("TICK_DECIMALS_INVALID");
  }
  const decimalScale = new ProjectionDecimal(10).pow(decimals0 - decimals1);
  const price0 = new ProjectionDecimal("1.0001").pow(tickIdx).times(decimalScale);
  return {
    price0: decimalString(price0),
    price1: decimalString(new ProjectionDecimal(1).dividedBy(price0)),
  };
}

export function selectTickLiquidityRange(
  projection: CanonicalTickLiquidity,
  range: number,
  decimals0: number | null,
  decimals1: number | null,
): SelectedTickLiquidity {
  if (!Number.isSafeInteger(range) || range < 5 || range > 50) {
    throw new RangeError("TICK_RANGE_INVALID");
  }
  const base = {
    currentTick: projection.currentTick,
    poolKey: projection.poolKey,
    tickSpacing: projection.tickSpacing,
  };
  if (projection.currentTick === null) return { ...base, ticks: [] };
  const radius = range * projection.tickSpacing;
  return {
    ...base,
    ticks: projection.ticks
      .filter(({ tickIdx }) => Math.abs(tickIdx - projection.currentTick!) <= radius)
      .map((tick) => ({ ...tick, ...pricesAtTick(tick.tickIdx, decimals0, decimals1) })),
  };
}
