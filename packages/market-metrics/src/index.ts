import { domainPackage } from "@lpbot/domain";
import { Decimal } from "decimal.js";

export const MARKET_WINDOWS = [1, 5, 15, 30, 60] as const;
export const MARKET_METRIC_VERSION = "market-metrics/v1" as const;

export type MarketWindowMinutes = (typeof MARKET_WINDOWS)[number];
export type MarketMetricKind =
  "pool.created" | "swap" | "liquidity.add" | "liquidity.remove" | "collect";
export type MarketMetricProtocol = "pcsv3" | "univ3" | "pcsv4" | "univ4";

export interface MarketMetricValues {
  fdvUsd?: string | null;
  feesUsd?: string | null;
  tvlUsd?: string | null;
  volumeUsd?: string | null;
}

export interface MarketMetricEvent {
  blockTimestamp: string;
  chainId: number;
  eventId: string;
  kind: MarketMetricKind;
  liquidityDelta?: string | null;
  market: MarketMetricValues;
  pool: {
    feePips?: string | null;
    hooks?: string | null;
    poolAddress: string | null;
    poolId: string | null;
    protocol: MarketMetricProtocol;
    tickSpacing?: string | null;
    token0Address?: string | null;
    token0Symbol?: string | null;
    token1Address?: string | null;
    token1Symbol?: string | null;
  };
  reverted: boolean;
  sqrtPriceX96?: string | null;
  transactionHash: string;
}

export interface PoolMetricRow {
  activeTvlUsd: null;
  chainId: number;
  fdvUsd: string | null;
  feePips: string | null;
  feeActiveTvl: null;
  feesUsd: string | null;
  feeTvl: string | null;
  hooks: string | null;
  poolAddress: string | null;
  poolId: string | null;
  poolKey: string;
  protocol: MarketMetricProtocol;
  tickSpacing: string | null;
  token0Address: string | null;
  token0Symbol: string | null;
  token1Address: string | null;
  token1Symbol: string | null;
  transactionCount: string;
  tvlUsd: string | null;
  volumeUsd: string | null;
}

export interface MarketWindowResult {
  end: string;
  minutes: MarketWindowMinutes;
  rows: PoolMetricRow[];
  start: string;
}

export interface ComputeMarketWindowsOptions {
  end: string;
  windowComplete: boolean;
  windows?: readonly MarketWindowMinutes[];
}

export type SortablePoolMetric = "feesUsd" | "volumeUsd" | "tvlUsd" | "fdvUsd" | "feeTvl";

const MarketDecimal = Decimal.clone({
  precision: 96,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

function decimal(value: string): Decimal {
  const parsed = new MarketDecimal(value);
  if (!parsed.isFinite()) throw new RangeError(`Invalid decimal value: ${value}`);
  return parsed;
}

function decimalString(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

export function calculateFeeTvl(feesUsd: string | null, tvlUsd: string | null): string | null {
  if (feesUsd === null || tvlUsd === null) return null;
  const tvl = decimal(tvlUsd);
  if (tvl.lessThanOrEqualTo(0)) return null;
  return decimalString(decimal(feesUsd).dividedBy(tvl));
}

export function poolMetricKey(
  row: Pick<PoolMetricRow, "chainId" | "poolAddress" | "poolId">,
): string {
  const identity = row.poolAddress ?? row.poolId;
  if (!identity) throw new RangeError("A pool address or pool ID is required");
  return `${row.chainId}:${identity.toLowerCase()}`;
}

function timestamp(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError(`Invalid UTC timestamp: ${value}`);
  return milliseconds;
}

function metricSum(
  events: readonly MarketMetricEvent[],
  field: "feesUsd" | "volumeUsd",
  windowComplete: boolean,
): string | null {
  const swaps = events.filter(({ kind }) => kind === "swap");
  if (swaps.length === 0) return windowComplete ? "0" : null;
  const values = swaps.map(({ market }) => market[field]);
  if (values.some((value) => value === null || value === undefined)) return null;
  return decimalString(
    values.reduce<Decimal>((total, value) => total.plus(decimal(value!)), new MarketDecimal(0)),
  );
}

function latestPointValue(
  events: readonly MarketMetricEvent[],
  field: "fdvUsd" | "tvlUsd",
): string | null {
  const matching = events.filter(({ market }) => market[field] !== undefined);
  if (matching.length === 0) return null;
  const value = matching.at(-1)!.market[field];
  return value === null || value === undefined ? null : decimalString(decimal(value));
}

function compareEventOrder(left: MarketMetricEvent, right: MarketMetricEvent): number {
  const timeOrder = timestamp(left.blockTimestamp) - timestamp(right.blockTimestamp);
  return timeOrder === 0 ? left.eventId.localeCompare(right.eventId) : timeOrder;
}

function compareIdentity(left: PoolMetricRow, right: PoolMetricRow): number {
  const leftAddress = left.poolAddress?.toLowerCase();
  const rightAddress = right.poolAddress?.toLowerCase();
  if (leftAddress !== rightAddress) {
    if (leftAddress === undefined) return 1;
    if (rightAddress === undefined) return -1;
    return leftAddress.localeCompare(rightAddress);
  }
  if (left.chainId !== right.chainId) return left.chainId - right.chainId;
  return (left.poolId ?? "").toLowerCase().localeCompare((right.poolId ?? "").toLowerCase());
}

function rowForPool(
  poolEvents: readonly MarketMetricEvent[],
  allPoolEventsBeforeEnd: readonly MarketMetricEvent[],
  windowComplete: boolean,
): PoolMetricRow {
  const first = poolEvents[0]!;
  const identity = allPoolEventsBeforeEnd[0] ?? first;
  const feesUsd = metricSum(poolEvents, "feesUsd", windowComplete);
  const tvlUsd = latestPointValue(allPoolEventsBeforeEnd, "tvlUsd");
  const feeTvl = calculateFeeTvl(feesUsd, tvlUsd);
  return {
    activeTvlUsd: null,
    chainId: first.chainId,
    fdvUsd: latestPointValue(allPoolEventsBeforeEnd, "fdvUsd"),
    feePips: identity.pool.feePips ?? null,
    feeActiveTvl: null,
    feesUsd,
    feeTvl,
    hooks: identity.pool.hooks?.toLowerCase() ?? null,
    poolAddress: first.pool.poolAddress,
    poolId: first.pool.poolId,
    poolKey: poolMetricKey({
      chainId: first.chainId,
      poolAddress: first.pool.poolAddress,
      poolId: first.pool.poolId,
    }),
    protocol: first.pool.protocol,
    tickSpacing: identity.pool.tickSpacing ?? null,
    token0Address: identity.pool.token0Address?.toLowerCase() ?? null,
    token0Symbol: first.pool.token0Symbol ?? null,
    token1Address: identity.pool.token1Address?.toLowerCase() ?? null,
    token1Symbol: first.pool.token1Symbol ?? null,
    transactionCount: String(
      new Set(
        poolEvents
          .filter(({ kind }) => kind === "swap")
          .map(({ chainId, transactionHash }) => `${chainId}:${transactionHash.toLowerCase()}`),
      ).size,
    ),
    tvlUsd,
    volumeUsd: metricSum(poolEvents, "volumeUsd", windowComplete),
  };
}

export function computeMarketWindows(
  inputEvents: readonly MarketMetricEvent[],
  options: ComputeMarketWindowsOptions,
): MarketWindowResult[] {
  const endMilliseconds = timestamp(options.end);
  const end = new Date(endMilliseconds).toISOString();
  const windows = options.windows ?? MARKET_WINDOWS;
  const canonical = inputEvents
    .filter((event) => !event.reverted && timestamp(event.blockTimestamp) < endMilliseconds)
    .sort(compareEventOrder);

  return windows.map((minutes) => {
    const startMilliseconds = endMilliseconds - minutes * 60_000;
    const withinWindow = canonical.filter((event) => {
      const value = timestamp(event.blockTimestamp);
      return value >= startMilliseconds && value < endMilliseconds;
    });
    const grouped = new Map<string, MarketMetricEvent[]>();
    for (const event of withinWindow) {
      const key = poolMetricKey({
        chainId: event.chainId,
        poolAddress: event.pool.poolAddress,
        poolId: event.pool.poolId,
      });
      const events = grouped.get(key) ?? [];
      events.push(event);
      grouped.set(key, events);
    }

    const rows = [...grouped.entries()].map(([key, events]) =>
      rowForPool(
        events,
        canonical.filter(
          (event) =>
            key ===
            poolMetricKey({
              chainId: event.chainId,
              poolAddress: event.pool.poolAddress,
              poolId: event.pool.poolId,
            }),
        ),
        options.windowComplete,
      ),
    );

    return {
      end,
      minutes,
      rows: sortPoolMetrics(rows, "feesUsd", "desc"),
      start: new Date(startMilliseconds).toISOString(),
    };
  });
}

export function sortPoolMetrics(
  rows: readonly PoolMetricRow[],
  metric: SortablePoolMetric,
  direction: "asc" | "desc",
): PoolMetricRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = left[metric];
    const rightValue = right[metric];
    if (leftValue === null || rightValue === null) {
      if (leftValue === null && rightValue === null) return compareIdentity(left, right);
      return leftValue === null ? 1 : -1;
    }
    const valueOrder = decimal(leftValue).comparedTo(decimal(rightValue));
    if (valueOrder !== 0) return direction === "asc" ? valueOrder : -valueOrder;
    return compareIdentity(left, right);
  });
}

export const marketMetricsPackage = {
  domain: domainPackage.name,
  name: "@lpbot/market-metrics",
} as const;

export {
  POOL_LABEL_RULE_CONTRACT,
  computePoolLabels,
  type ComputedPoolLabel,
  type ComputePoolLabelsInput,
  type PoolLabelId,
  type PoolLabelReason,
  type PoolLabelReasonOperator,
  type PoolLabelRule,
  type PoolLabelRuleContract,
} from "./pool-labels.js";

export {
  CANDLE_BARS,
  CANDLE_TICK_CONTRACT_VERSION,
  aggregateCanonicalCandles,
  orientCanonicalCandles,
  projectCanonicalOneMinuteCandles,
  projectCanonicalTickLiquidity,
  selectTickLiquidityRange,
  sqrtPriceX96ToToken0Price,
  type CandleBar,
  type CandlePriceDirection,
  type CandleTickCanonicalEvent,
  type CanonicalBaseCandle,
  type CanonicalTickBoundary,
  type CanonicalTickLiquidity,
  type OrientedCandle,
  type PricedTickBoundary,
  type SelectedTickLiquidity,
} from "./candle-tick.js";
