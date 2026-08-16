import type { MarketPoolRow } from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

export const poolNumericFilterKeys = [
  "volume",
  "fees",
  "feeTvl",
  "feeActiveTvl",
  "tvl",
  "activeTvl",
  "txs",
] as const;

export type PoolNumericFilterKey = (typeof poolNumericFilterKeys)[number];
export type PoolGeneration = "v3" | "v4";
export type PoolHookFilter = "any" | "present" | "absent";
export type PoolSortDirection = "asc" | "desc";

export interface PoolNumericRange {
  enabled: boolean;
  max: string;
  min: string;
}

export interface PoolAdvancedFilters {
  excludeHanTokens: boolean;
  generations: PoolGeneration[];
  hook: PoolHookFilter;
  ranges: Record<PoolNumericFilterKey, PoolNumericRange>;
  sortBy: PoolNumericFilterKey;
  sortDirection: PoolSortDirection;
}

export interface ParsedPoolAdvancedFilters {
  filters: PoolAdvancedFilters;
  issues: string[];
  valid: boolean;
}

const FilterDecimal = Decimal.clone({
  precision: 96,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

const generations = ["v3", "v4"] as const;
const rangeQueryKeys: Record<PoolNumericFilterKey, string> = {
  activeTvl: "pool_atvl",
  feeActiveTvl: "pool_fee_atvl",
  fees: "pool_fees",
  feeTvl: "pool_fee_tvl",
  tvl: "pool_tvl",
  txs: "pool_txs",
  volume: "pool_volume",
};
const queryRangeEntries = poolNumericFilterKeys.map(
  (key) => [key, rangeQueryKeys[key]] as const,
);
const filterQueryKeys = [
  "pool_versions",
  ...queryRangeEntries.map(([, queryKey]) => queryKey),
  "pool_hook",
  "pool_exclude_han",
  "pool_sort",
  "pool_direction",
] as const;

function emptyRanges(): Record<PoolNumericFilterKey, PoolNumericRange> {
  return Object.fromEntries(
    poolNumericFilterKeys.map((key) => [key, { enabled: false, max: "", min: "" }]),
  ) as Record<PoolNumericFilterKey, PoolNumericRange>;
}

export function defaultPoolAdvancedFilters(): PoolAdvancedFilters {
  return {
    excludeHanTokens: false,
    generations: [...generations],
    hook: "any",
    ranges: emptyRanges(),
    sortBy: "fees",
    sortDirection: "desc",
  };
}

function decimal(value: string): Decimal | null {
  if (value === "") return null;
  try {
    const parsed = new FilterDecimal(value);
    return parsed.isFinite() && parsed.greaterThanOrEqualTo(0) ? parsed : null;
  } catch {
    return null;
  }
}

function rangeIsValid(range: PoolNumericRange): boolean {
  if (!range.enabled) return true;
  const min = range.min === "" ? null : decimal(range.min);
  const max = range.max === "" ? null : decimal(range.max);
  if ((range.min !== "" && min === null) || (range.max !== "" && max === null)) return false;
  return min === null || max === null || min.lessThanOrEqualTo(max);
}

export function validatePoolAdvancedFilters(filters: PoolAdvancedFilters): boolean {
  if (
    filters.generations.length === 0 ||
    new Set(filters.generations).size !== filters.generations.length ||
    filters.generations.some((value) => !generations.includes(value)) ||
    !(["any", "present", "absent"] as const).includes(filters.hook) ||
    !poolNumericFilterKeys.includes(filters.sortBy) ||
    !(["asc", "desc"] as const).includes(filters.sortDirection)
  ) {
    return false;
  }
  return poolNumericFilterKeys.every((key) => rangeIsValid(filters.ranges[key]));
}

function parseRange(value: string): PoolNumericRange {
  const parts = value.split(":");
  return {
    enabled: true,
    max: parts.length === 2 ? (parts[1] ?? "") : "",
    min: parts[0] ?? "",
  };
}

export function parsePoolAdvancedFilters(search: string): ParsedPoolAdvancedFilters {
  const parameters = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const filters = defaultPoolAdvancedFilters();
  const issues: string[] = [];
  const versionValue = parameters.get("pool_versions");
  if (versionValue !== null) {
    const requested = versionValue.split(",");
    if (
      requested.length === 0 ||
      new Set(requested).size !== requested.length ||
      requested.some((value) => !generations.includes(value as PoolGeneration))
    ) {
      issues.push("pool_versions");
      filters.generations = [];
    } else {
      const selected = new Set(requested);
      filters.generations = generations.filter((value) => selected.has(value));
    }
  }

  for (const [key, queryKey] of queryRangeEntries) {
    const value = parameters.get(queryKey);
    if (value === null) continue;
    const range = parseRange(value);
    filters.ranges[key] = range;
    if (value.split(":").length !== 2 || !rangeIsValid(range)) issues.push(queryKey);
  }

  const hook = parameters.get("pool_hook");
  if (hook !== null) {
    if (hook === "present" || hook === "absent" || hook === "any") filters.hook = hook;
    else issues.push("pool_hook");
  }
  const excludeHan = parameters.get("pool_exclude_han");
  if (excludeHan !== null) {
    if (excludeHan === "1") filters.excludeHanTokens = true;
    else issues.push("pool_exclude_han");
  }
  const sortBy = parameters.get("pool_sort");
  if (sortBy !== null) {
    if (poolNumericFilterKeys.includes(sortBy as PoolNumericFilterKey)) {
      filters.sortBy = sortBy as PoolNumericFilterKey;
    } else issues.push("pool_sort");
  }
  const direction = parameters.get("pool_direction");
  if (direction !== null) {
    if (direction === "asc" || direction === "desc") filters.sortDirection = direction;
    else issues.push("pool_direction");
  }

  return { filters, issues, valid: issues.length === 0 && validatePoolAdvancedFilters(filters) };
}

export function writePoolAdvancedFilters(
  search: string,
  filters: PoolAdvancedFilters | null,
): string {
  const parameters = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of filterQueryKeys) parameters.delete(key);
  if (filters !== null) {
    if (!validatePoolAdvancedFilters(filters)) throw new RangeError("POOL_FILTERS_INVALID");
    if (filters.generations.length !== generations.length) {
      parameters.set("pool_versions", filters.generations.join(","));
    }
    for (const [key, queryKey] of queryRangeEntries) {
      const range = filters.ranges[key];
      if (range.enabled) parameters.set(queryKey, `${range.min}:${range.max}`);
    }
    if (filters.hook !== "any") parameters.set("pool_hook", filters.hook);
    if (filters.excludeHanTokens) parameters.set("pool_exclude_han", "1");
    if (filters.sortBy !== "fees") parameters.set("pool_sort", filters.sortBy);
    if (filters.sortDirection !== "desc") {
      parameters.set("pool_direction", filters.sortDirection);
    }
  }
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

export function poolAdvancedFiltersAreDefault(filters: PoolAdvancedFilters): boolean {
  return (
    filters.generations.length === generations.length &&
    filters.hook === "any" &&
    !filters.excludeHanTokens &&
    filters.sortBy === "fees" &&
    filters.sortDirection === "desc" &&
    poolNumericFilterKeys.every((key) => {
      const range = filters.ranges[key];
      return !range.enabled && range.min === "" && range.max === "";
    })
  );
}

function metricValue(row: MarketPoolRow, key: PoolNumericFilterKey): string | null {
  const fields: Record<PoolNumericFilterKey, string | null> = {
    activeTvl: row.activeTvlUsd,
    feeActiveTvl: row.feeActiveTvl,
    fees: row.feesUsd,
    feeTvl: row.feeTvl,
    tvl: row.tvlUsd,
    txs: row.transactionCount,
    volume: row.volumeUsd,
  };
  return fields[key];
}

function canonicalMetric(value: string | null): Decimal | null {
  if (value === null) return null;
  try {
    const parsed = new FilterDecimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function compareIdentity(left: MarketPoolRow, right: MarketPoolRow): number {
  const leftAddress = left.poolAddress?.toLowerCase();
  const rightAddress = right.poolAddress?.toLowerCase();
  if (leftAddress !== rightAddress) {
    if (leftAddress === undefined) return 1;
    if (rightAddress === undefined) return -1;
    return leftAddress.localeCompare(rightAddress);
  }
  if (left.chainId !== right.chainId) return left.chainId - right.chainId;
  const poolIdOrder = (left.poolId ?? "")
    .toLowerCase()
    .localeCompare((right.poolId ?? "").toLowerCase());
  return poolIdOrder === 0 ? left.poolKey.localeCompare(right.poolKey) : poolIdOrder;
}

function includesHanSymbol(row: MarketPoolRow): boolean {
  return [row.token0Symbol, row.token1Symbol].some(
    (symbol) => symbol !== null && /\p{Script=Han}/u.test(symbol),
  );
}

function generation(row: MarketPoolRow): PoolGeneration {
  return row.protocol.endsWith("v4") ? "v4" : "v3";
}

export function filterAndSortPoolRows(
  rows: readonly MarketPoolRow[],
  filters: PoolAdvancedFilters,
): MarketPoolRow[] {
  if (!validatePoolAdvancedFilters(filters)) return [];
  const selectedGenerations = new Set(filters.generations);
  const filtered = rows.filter((row) => {
    if (!selectedGenerations.has(generation(row))) return false;
    if (filters.hook === "present" && row.hooks === null) return false;
    if (filters.hook === "absent" && row.hooks !== null) return false;
    if (filters.excludeHanTokens && includesHanSymbol(row)) return false;
    for (const key of poolNumericFilterKeys) {
      const range = filters.ranges[key];
      if (!range.enabled) continue;
      const value = canonicalMetric(metricValue(row, key));
      if (value === null) return false;
      const min = range.min === "" ? null : decimal(range.min);
      const max = range.max === "" ? null : decimal(range.max);
      if ((min !== null && value.lessThan(min)) || (max !== null && value.greaterThan(max))) {
        return false;
      }
    }
    return true;
  });

  return filtered.sort((left, right) => {
    const leftValue = canonicalMetric(metricValue(left, filters.sortBy));
    const rightValue = canonicalMetric(metricValue(right, filters.sortBy));
    if (leftValue === null || rightValue === null) {
      if (leftValue === null && rightValue === null) return compareIdentity(left, right);
      return leftValue === null ? 1 : -1;
    }
    const valueOrder = leftValue.comparedTo(rightValue);
    if (valueOrder !== 0) return filters.sortDirection === "asc" ? valueOrder : -valueOrder;
    return compareIdentity(left, right);
  });
}
