import type { MarketPoolRow, MarketPoolSnapshot } from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

import { formatPoolRatioPercent } from "./pool-table-state.js";

export type PoolComparisonStatus = "none-selected" | "one-selected" | "ready" | "limit-reached";

export interface PoolSnapshotBinding {
  asOf: string;
  snapshotVersion: string;
  windowMinutes: MarketPoolSnapshot["minutes"];
}

export interface PoolComparisonState {
  binding: PoolSnapshotBinding | null;
  selectedPoolKeys: string[];
  status: PoolComparisonStatus;
}

export type PoolComparisonMetricKey =
  "fees" | "volume" | "tvl" | "activeTvl" | "feeTvl" | "txs" | "feeTier";

export interface PoolComparisonMetricValue {
  display: string;
  isBest: boolean;
  poolKey: string;
  rawValue: string | null;
}

export interface PoolComparisonMetric {
  key: PoolComparisonMetricKey;
  label: string;
  values: PoolComparisonMetricValue[];
}

export interface PoolComparisonView {
  binding: PoolSnapshotBinding;
  metrics: PoolComparisonMetric[];
  pools: MarketPoolRow[];
  status: PoolComparisonStatus;
}

const ComparisonDecimal = Decimal.clone({
  precision: 96,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

const metricDefinitions: ReadonlyArray<{
  key: PoolComparisonMetricKey;
  label: string;
}> = [
  { key: "fees", label: "Fees" },
  { key: "volume", label: "Volume" },
  { key: "tvl", label: "TVL" },
  { key: "activeTvl", label: "aTVL" },
  { key: "feeTvl", label: "Fee/TVL" },
  { key: "txs", label: "Txs" },
  { key: "feeTier", label: "Fee Tier" },
];

function binding(snapshot: MarketPoolSnapshot): PoolSnapshotBinding {
  return {
    asOf: snapshot.windowEnd,
    snapshotVersion: snapshot.version,
    windowMinutes: snapshot.minutes,
  };
}

function sameBinding(left: PoolSnapshotBinding | null, right: PoolSnapshotBinding): boolean {
  return (
    left !== null &&
    left.asOf === right.asOf &&
    left.snapshotVersion === right.snapshotVersion &&
    left.windowMinutes === right.windowMinutes
  );
}

function statusForCount(count: number): PoolComparisonStatus {
  if (count === 0) return "none-selected";
  if (count === 1) return "one-selected";
  return "ready";
}

export function initialPoolComparisonState(): PoolComparisonState {
  return { binding: null, selectedPoolKeys: [], status: "none-selected" };
}

export function reconcilePoolComparison(
  state: PoolComparisonState,
  snapshot: MarketPoolSnapshot,
): PoolComparisonState {
  const keys = new Set(snapshot.rows.map(({ poolKey }) => poolKey));
  const selectedPoolKeys = state.selectedPoolKeys.filter((poolKey) => keys.has(poolKey));
  const nextBinding = binding(snapshot);
  const unchangedLimit =
    state.status === "limit-reached" &&
    selectedPoolKeys.length === 3 &&
    sameBinding(state.binding, nextBinding);
  return {
    binding: nextBinding,
    selectedPoolKeys,
    status: unchangedLimit ? "limit-reached" : statusForCount(selectedPoolKeys.length),
  };
}

export function togglePoolComparison(
  state: PoolComparisonState,
  poolKey: string,
  snapshot: MarketPoolSnapshot,
): PoolComparisonState {
  const current = reconcilePoolComparison(state, snapshot);
  if (!snapshot.rows.some((row) => row.poolKey === poolKey)) return current;
  if (current.selectedPoolKeys.includes(poolKey)) {
    const selectedPoolKeys = current.selectedPoolKeys.filter((key) => key !== poolKey);
    return { ...current, selectedPoolKeys, status: statusForCount(selectedPoolKeys.length) };
  }
  if (current.selectedPoolKeys.length >= 3) return { ...current, status: "limit-reached" };
  const selectedPoolKeys = [...current.selectedPoolKeys, poolKey];
  return { ...current, selectedPoolKeys, status: statusForCount(selectedPoolKeys.length) };
}

function rawMetric(row: MarketPoolRow, key: PoolComparisonMetricKey): string | null {
  const values: Record<PoolComparisonMetricKey, string | null> = {
    activeTvl: row.activeTvlUsd,
    fees: row.feesUsd,
    feeTier: row.feePips,
    feeTvl: row.feeTvl,
    tvl: row.tvlUsd,
    txs: row.transactionCount,
    volume: row.volumeUsd,
  };
  return values[key];
}

function decimal(value: string | null): Decimal | null {
  if (value === null) return null;
  try {
    const parsed = new ComparisonDecimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function decimalDisplay(value: string | null, prefix = ""): string {
  const parsed = decimal(value);
  if (parsed === null) return "不可用";
  return `${prefix}${parsed.toFixed()}`;
}

export function canonicalFeeTierDisplay(feePips: string | null): string {
  if (feePips === null || !/^(?:0|[1-9][0-9]*)$/u.test(feePips)) return "不可用";
  const parsed = decimal(feePips);
  if (parsed === null) return "不可用";
  return `${parsed.dividedBy(10_000).toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN).toFixed()}%`;
}

function metricDisplay(key: PoolComparisonMetricKey, value: string | null): string {
  if (key === "feeTvl") return formatPoolRatioPercent(value);
  if (key === "feeTier") return canonicalFeeTierDisplay(value);
  if (key === "fees" || key === "volume" || key === "tvl" || key === "activeTvl") {
    return decimalDisplay(value, "$ ");
  }
  return decimalDisplay(value);
}

function bestValue(rows: readonly MarketPoolRow[], key: PoolComparisonMetricKey): Decimal | null {
  if (key === "feeTier") return null;
  return rows.reduce<Decimal | null>((best, row) => {
    const value = decimal(rawMetric(row, key));
    if (value === null) return best;
    return best === null || value.greaterThan(best) ? value : best;
  }, null);
}

export function buildPoolComparison(
  state: PoolComparisonState,
  snapshot: MarketPoolSnapshot,
): PoolComparisonView {
  const current = reconcilePoolComparison(state, snapshot);
  const rowsByKey = new Map(snapshot.rows.map((row) => [row.poolKey, row]));
  const pools = current.selectedPoolKeys.flatMap((poolKey) => {
    const row = rowsByKey.get(poolKey);
    return row ? [row] : [];
  });
  return {
    binding: binding(snapshot),
    metrics: metricDefinitions.map(({ key, label }) => {
      const best = bestValue(pools, key);
      return {
        key,
        label,
        values: pools.map((row) => {
          const rawValue = rawMetric(row, key);
          const value = decimal(rawValue);
          return {
            display: metricDisplay(key, rawValue),
            isBest: best !== null && value !== null && value.equals(best),
            poolKey: row.poolKey,
            rawValue,
          };
        }),
      };
    }),
    pools,
    status: current.status,
  };
}
