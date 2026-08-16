import type { LiquidityFlowEvent, LiquidityFlowRecord } from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

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
