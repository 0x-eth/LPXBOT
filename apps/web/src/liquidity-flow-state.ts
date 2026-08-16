import type {
  EvmAddress,
  LiquidityFlowEvent,
  LiquidityFlowProtocol,
  LiquidityFlowRecord,
} from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

const MoneyDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });

export type LiquidityFlowConnection =
  "loading-backfill" | "live" | "paused-hidden" | "empty" | "error" | "stale" | "reconnecting";

export interface LiquidityFlowState {
  buffered: LiquidityFlowRecord[];
  connection: LiquidityFlowConnection;
  errorCode: string | null;
  events: LiquidityFlowEvent[];
  revertedIds: Set<string>;
  seenIds: Set<string>;
  since: number;
}

export type LiquidityFlowAction =
  | { records: readonly LiquidityFlowRecord[]; type: "backfill" }
  | { record: LiquidityFlowRecord; type: "event" }
  | { code: string; type: "error" }
  | { since?: number; type: "loading" }
  | { type: "heartbeat" | "pause" | "reconnecting" | "resume" | "stale" };

export interface LiquidityFlowUiFilters {
  eventType: "all" | LiquidityFlowEvent["event_type"];
  generation: "all" | LiquidityFlowEvent["version"];
  minUsd: string;
  nftId: string;
  pool: string;
  token: string;
  user: string;
}

export type LiquidityFlowValuationCompleteness = "complete" | "partial";
export type LiquidityFlowAddressSort = "net" | "count" | "recent";

export interface LiquidityFlowSummary {
  completeness: LiquidityFlowValuationCompleteness;
  eventCount: number;
  inflowUsd: string;
  netUsd: string;
  outflowUsd: string;
  uniqueAddressCount: number;
  unvaluedEventCount: number;
  valuedEventCount: number;
  valuedSubtotalUsd: string;
}

export interface LiquidityFlowAddressAggregate {
  address: EvmAddress;
  completeness: LiquidityFlowValuationCompleteness;
  eventCount: number;
  idle: boolean;
  inflowUsd: string;
  netUsd: string;
  outflowUsd: string;
  poolCount: number;
  recentTs: number | null;
  unvaluedEventCount: number;
  valuedEventCount: number;
}

export interface LiquidityFlowProjection {
  addresses: LiquidityFlowAddressAggregate[];
  events: LiquidityFlowEvent[];
  summary: LiquidityFlowSummary;
}

export interface LiquidityFlowProjectionOptions {
  protocols: readonly LiquidityFlowProtocol[];
  sort: LiquidityFlowAddressSort;
  watchedAddresses: readonly string[];
  watchedOnly: boolean;
}

export const defaultLiquidityFlowUiFilters: Readonly<LiquidityFlowUiFilters> = Object.freeze({
  eventType: "all",
  generation: "all",
  minUsd: "",
  nftId: "",
  pool: "",
  token: "",
  user: "",
});

export function initialLiquidityFlowState(since: number): LiquidityFlowState {
  return {
    buffered: [],
    connection: "loading-backfill",
    errorCode: null,
    events: [],
    revertedIds: new Set(),
    seenIds: new Set(),
    since,
  };
}

function compareEvents(left: LiquidityFlowEvent, right: LiquidityFlowEvent): number {
  if (left.ts !== right.ts) return right.ts - left.ts;
  const blockOrder = BigInt(right.block_number) - BigInt(left.block_number);
  if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
  if (left.tx_index !== right.tx_index) return right.tx_index - left.tx_index;
  if (left.log_index !== right.log_index) return right.log_index - left.log_index;
  const hashOrder = left.tx_hash.localeCompare(right.tx_hash);
  return hashOrder === 0 ? left.id.localeCompare(right.id) : hashOrder;
}

function applyRecord(state: LiquidityFlowState, record: LiquidityFlowRecord): LiquidityFlowState {
  const since = Math.max(state.since, record.ts);
  if (state.seenIds.has(record.id)) return since === state.since ? state : { ...state, since };

  const seenIds = new Set(state.seenIds).add(record.id);
  if (record.record_type === "tombstone") {
    const revertedIds = new Set(state.revertedIds).add(record.reverted_id);
    return {
      ...state,
      events: state.events.filter(({ id }) => id !== record.reverted_id),
      revertedIds,
      seenIds,
      since,
    };
  }
  if (state.revertedIds.has(record.id)) return { ...state, seenIds, since };
  return {
    ...state,
    events: [...state.events, record].sort(compareEvents),
    seenIds,
    since,
  };
}

function settledConnection(events: readonly LiquidityFlowEvent[]): LiquidityFlowConnection {
  return events.length === 0 ? "empty" : "live";
}

export function reduceLiquidityFlow(
  state: LiquidityFlowState,
  action: LiquidityFlowAction,
): LiquidityFlowState {
  if (action.type === "loading") {
    return initialLiquidityFlowState(action.since ?? state.since);
  }
  if (action.type === "pause") return { ...state, connection: "paused-hidden" };
  if (action.type === "resume") {
    const resumed = state.buffered.reduce(applyRecord, { ...state, buffered: [] });
    return { ...resumed, connection: settledConnection(resumed.events), errorCode: null };
  }
  if (action.type === "event") {
    if (state.connection === "paused-hidden") {
      return {
        ...state,
        buffered: [...state.buffered, action.record],
        since: Math.max(state.since, action.record.ts),
      };
    }
    const next = applyRecord(state, action.record);
    return { ...next, connection: settledConnection(next.events), errorCode: null };
  }
  if (action.type === "backfill") {
    const next = action.records.reduce(applyRecord, state);
    return { ...next, connection: settledConnection(next.events), errorCode: null };
  }
  if (action.type === "heartbeat") {
    return { ...state, connection: settledConnection(state.events), errorCode: null };
  }
  if (action.type === "reconnecting") return { ...state, connection: "reconnecting" };
  if (action.type === "stale") {
    return state.events.length === 0 ? state : { ...state, connection: "stale" };
  }
  if (action.type === "error") {
    return {
      ...state,
      connection: state.events.length === 0 ? "error" : "reconnecting",
      errorCode: action.code,
    };
  }
  return state;
}

function matchesAddress(value: string, candidates: readonly (string | null)[]): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return candidates.some((candidate) => candidate?.toLowerCase() === normalized);
}

export function applyLiquidityFlowFilters(
  events: readonly LiquidityFlowEvent[],
  filters: LiquidityFlowUiFilters,
): LiquidityFlowEvent[] {
  let minimum: Decimal | null = null;
  try {
    if (filters.minUsd.trim()) minimum = new Decimal(filters.minUsd);
  } catch {
    return [];
  }
  return events.filter((event) => {
    if (filters.eventType !== "all" && event.event_type !== filters.eventType) return false;
    if (filters.generation !== "all" && event.version !== filters.generation) return false;
    if (!matchesAddress(filters.pool, [event.pool_address, event.pool_id])) return false;
    if (!matchesAddress(filters.token, [event.token0_address, event.token1_address])) return false;
    if (!matchesAddress(filters.user, [event.user])) return false;
    if (filters.nftId && event.nft_id !== filters.nftId) return false;
    if (minimum?.greaterThan(0)) {
      if (event.usd_value === null || new Decimal(event.usd_value).lessThan(minimum)) return false;
    }
    return true;
  });
}

function decimalString(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

function summarizeLiquidityFlow(events: readonly LiquidityFlowEvent[]): LiquidityFlowSummary {
  let inflow = new MoneyDecimal(0);
  let outflow = new MoneyDecimal(0);
  let valuedEventCount = 0;
  let unvaluedEventCount = 0;
  const addresses = new Set<string>();

  for (const event of events) {
    if (event.user) addresses.add(event.user.toLowerCase());
    if (event.event_type === "create") continue;
    if (event.usd_value === null) {
      unvaluedEventCount += 1;
      continue;
    }
    const value = new MoneyDecimal(event.usd_value).abs();
    valuedEventCount += 1;
    if (event.event_type === "add") inflow = inflow.plus(value);
    else outflow = outflow.plus(value);
  }

  return {
    completeness: unvaluedEventCount === 0 ? "complete" : "partial",
    eventCount: events.length,
    inflowUsd: decimalString(inflow),
    netUsd: decimalString(inflow.minus(outflow)),
    outflowUsd: decimalString(outflow),
    uniqueAddressCount: addresses.size,
    unvaluedEventCount,
    valuedEventCount,
    valuedSubtotalUsd: decimalString(inflow.plus(outflow)),
  };
}

interface MutableAddressAggregate {
  address: EvmAddress;
  eventCount: number;
  idle?: boolean;
  inflow: Decimal;
  outflow: Decimal;
  pools: Set<string>;
  recentTs: number | null;
  unvaluedEventCount: number;
  valuedEventCount: number;
}

function compareAddress(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function aggregateLiquidityFlowAddresses(
  events: readonly LiquidityFlowEvent[],
  options: LiquidityFlowProjectionOptions,
  watched: ReadonlySet<string>,
): LiquidityFlowAddressAggregate[] {
  const aggregates = new Map<string, MutableAddressAggregate>();
  for (const event of events) {
    if (!event.user) continue;
    const address = event.user.toLowerCase() as EvmAddress;
    let aggregate = aggregates.get(address);
    if (!aggregate) {
      aggregate = {
        address,
        eventCount: 0,
        inflow: new MoneyDecimal(0),
        outflow: new MoneyDecimal(0),
        pools: new Set(),
        recentTs: null,
        unvaluedEventCount: 0,
        valuedEventCount: 0,
      };
      aggregates.set(address, aggregate);
    }

    aggregate.eventCount += 1;
    aggregate.recentTs = Math.max(aggregate.recentTs ?? event.ts, event.ts);
    const pool = event.pool_address ?? event.pool_id;
    if (pool) aggregate.pools.add(pool.toLowerCase());
    if (event.event_type === "create") continue;
    if (event.usd_value === null) {
      aggregate.unvaluedEventCount += 1;
      continue;
    }
    const value = new MoneyDecimal(event.usd_value).abs();
    aggregate.valuedEventCount += 1;
    if (event.event_type === "add") aggregate.inflow = aggregate.inflow.plus(value);
    else aggregate.outflow = aggregate.outflow.plus(value);
  }

  if (options.watchedOnly) {
    for (const address of watched) {
      if (aggregates.has(address)) continue;
      aggregates.set(address, {
        address: address as EvmAddress,
        eventCount: 0,
        idle: true,
        inflow: new MoneyDecimal(0),
        outflow: new MoneyDecimal(0),
        pools: new Set(),
        recentTs: null,
        unvaluedEventCount: 0,
        valuedEventCount: 0,
      });
    }
  }

  const rows = [...aggregates.values()].map<LiquidityFlowAddressAggregate>((aggregate) => ({
    address: aggregate.address,
    completeness: aggregate.unvaluedEventCount === 0 ? "complete" : "partial",
    eventCount: aggregate.eventCount,
    idle: aggregate.idle ?? false,
    inflowUsd: decimalString(aggregate.inflow),
    netUsd: decimalString(aggregate.inflow.minus(aggregate.outflow)),
    outflowUsd: decimalString(aggregate.outflow),
    poolCount: aggregate.pools.size,
    recentTs: aggregate.recentTs,
    unvaluedEventCount: aggregate.unvaluedEventCount,
    valuedEventCount: aggregate.valuedEventCount,
  }));

  return rows.sort((left, right) => {
    if (left.idle !== right.idle) return left.idle ? 1 : -1;
    if (options.sort === "net" && left.completeness !== right.completeness) {
      return left.completeness === "complete" ? -1 : 1;
    }
    if (options.sort === "count" && left.eventCount !== right.eventCount) {
      return right.eventCount - left.eventCount;
    }
    if (options.sort === "recent" && left.recentTs !== right.recentTs) {
      return (right.recentTs ?? -1) - (left.recentTs ?? -1);
    }
    if (options.sort === "net") {
      const order = new MoneyDecimal(right.netUsd).abs().comparedTo(new MoneyDecimal(left.netUsd).abs());
      if (order !== 0) return order;
    }
    return compareAddress(left.address, right.address);
  });
}

export function buildLiquidityFlowProjection(
  events: readonly LiquidityFlowEvent[],
  filters: LiquidityFlowUiFilters,
  options: LiquidityFlowProjectionOptions,
): LiquidityFlowProjection {
  const selectedProtocols = new Set(options.protocols);
  const watched = new Set(options.watchedAddresses.map((address) => address.toLowerCase()));
  const filtered = applyLiquidityFlowFilters(events, filters).filter(
    (event) =>
      selectedProtocols.has(event.dex) &&
      (!options.watchedOnly || (event.user !== null && watched.has(event.user.toLowerCase()))),
  );
  return {
    addresses: aggregateLiquidityFlowAddresses(filtered, options, watched),
    events: filtered,
    summary: summarizeLiquidityFlow(filtered),
  };
}

export function serializeLiquidityFlowUiFilters(filters: LiquidityFlowUiFilters): URLSearchParams {
  const parameters = new URLSearchParams();
  if (filters.eventType !== "all") parameters.set("flow_event", filters.eventType);
  if (filters.generation !== "all") parameters.set("flow_version", filters.generation);
  if (filters.minUsd) parameters.set("min_usd", filters.minUsd);
  if (filters.pool) parameters.set("pool", filters.pool);
  if (filters.token) parameters.set("token", filters.token);
  if (filters.user) parameters.set("user", filters.user);
  if (filters.nftId) parameters.set("nft_id", filters.nftId);
  return parameters;
}

export function parseLiquidityFlowUiFilters(
  input: URLSearchParams | string,
): LiquidityFlowUiFilters {
  const parameters = typeof input === "string" ? new URLSearchParams(input) : input;
  const eventType = parameters.get("flow_event");
  const generation = parameters.get("flow_version");
  return {
    eventType:
      eventType === "create" || eventType === "add" || eventType === "remove" ? eventType : "all",
    generation: generation === "v3" || generation === "v4" ? generation : "all",
    minUsd: parameters.get("min_usd") ?? "",
    nftId: parameters.get("nft_id") ?? "",
    pool: parameters.get("pool") ?? "",
    token: parameters.get("token") ?? "",
    user: parameters.get("user") ?? "",
  };
}
