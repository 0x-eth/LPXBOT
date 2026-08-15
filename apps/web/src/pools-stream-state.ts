import type {
  MarketPoolDiff,
  MarketPoolRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "@lpbot/api-contract";

export type PoolConnectionState =
  | "loading"
  | "empty"
  | "ready"
  | "error"
  | "stale"
  | "reconnecting";

export interface PoolStreamState {
  connection: PoolConnectionState;
  cursor: string | null;
  epoch: string | null;
  errorCode: string | null;
  lastEventFingerprint: string | null;
  rows: MarketPoolRow[];
  sequence: string | null;
  snapshot: MarketPoolSnapshot | null;
}

export type PoolStreamAction =
  | { event: MarketStreamEnvelope; type: "event" }
  | { snapshot: MarketPoolSnapshot; type: "http-snapshot" }
  | { code: string; type: "error" }
  | { type: "loading" }
  | { type: "reconnecting" }
  | { type: "stale" };

export function initialPoolStreamState(): PoolStreamState {
  return {
    connection: "loading",
    cursor: null,
    epoch: null,
    errorCode: null,
    lastEventFingerprint: null,
    rows: [],
    sequence: null,
    snapshot: null,
  };
}

function poolKey(row: Pick<MarketPoolRow, "chainId" | "poolAddress" | "poolId">): string {
  const identity = row.poolAddress ?? row.poolId;
  if (!identity) throw new RangeError("Pool stream row has no identity");
  return `${row.chainId}:${identity.toLowerCase()}`;
}

function fingerprint(event: MarketStreamEnvelope): string {
  return JSON.stringify(event);
}

function connectionForRows(rows: readonly MarketPoolRow[]): PoolConnectionState {
  return rows.length === 0 ? "empty" : "ready";
}

function isSnapshot(data: MarketStreamEnvelope["data"]): data is MarketPoolSnapshot {
  return !!data && "rows" in data && "minutes" in data;
}

function isDiff(data: MarketStreamEnvelope["data"]): data is MarketPoolDiff {
  return !!data && "upserts" in data && "tombstones" in data;
}

function applyDiff(rows: readonly MarketPoolRow[], diff: MarketPoolDiff): MarketPoolRow[] {
  const next = new Map(rows.map((row) => [poolKey(row), row]));
  for (const key of diff.tombstones) next.delete(key.toLowerCase());
  for (const row of diff.upserts) next.set(poolKey(row), row);
  return [...next.values()].sort((left, right) => {
    if (left.feesUsd === null || right.feesUsd === null) {
      if (left.feesUsd === right.feesUsd) return poolKey(left).localeCompare(poolKey(right));
      return left.feesUsd === null ? 1 : -1;
    }
    if (left.feesUsd.length !== right.feesUsd.length) {
      return right.feesUsd.length - left.feesUsd.length;
    }
    const valueOrder = right.feesUsd.localeCompare(left.feesUsd);
    return valueOrder === 0 ? poolKey(left).localeCompare(poolKey(right)) : valueOrder;
  });
}

export function reducePoolStream(
  state: PoolStreamState,
  action: PoolStreamAction,
): PoolStreamState {
  if (action.type === "loading") return initialPoolStreamState();
  if (action.type === "http-snapshot") {
    return {
      ...state,
      connection: connectionForRows(action.snapshot.rows),
      errorCode: null,
      rows: action.snapshot.rows,
      snapshot: action.snapshot,
    };
  }
  if (action.type === "error") {
    return {
      ...state,
      connection: state.rows.length === 0 ? "error" : "reconnecting",
      errorCode: action.code,
    };
  }
  if (action.type === "reconnecting") return { ...state, connection: "reconnecting" };
  if (action.type === "stale") {
    return state.rows.length === 0 ? state : { ...state, connection: "stale" };
  }

  const event = action.event;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(event.sequence)) {
    return { ...state, connection: "reconnecting", errorCode: "STREAM_SEQUENCE_INVALID" };
  }
  const nextFingerprint = fingerprint(event);
  if (state.epoch === event.epoch && state.sequence === event.sequence) {
    if (state.lastEventFingerprint === nextFingerprint) return state;
    return { ...state, connection: "error", errorCode: "STREAM_INTEGRITY_CONFLICT" };
  }
  if (state.epoch !== null && state.epoch !== event.epoch && event.eventType !== "pools.snapshot") {
    return { ...state, connection: "reconnecting", errorCode: "STREAM_EPOCH_GAP" };
  }
  if (state.epoch === event.epoch && state.sequence !== null) {
    const current = BigInt(state.sequence);
    const next = BigInt(event.sequence);
    if (next < current) return state;
    if (next > current + 1n) {
      return { ...state, connection: "reconnecting", errorCode: "STREAM_SEQUENCE_GAP" };
    }
  }

  let rows = state.rows;
  let snapshot = state.snapshot;
  if (event.eventType === "pools.snapshot") {
    if (!isSnapshot(event.data)) {
      return { ...state, connection: "error", errorCode: "STREAM_SNAPSHOT_INVALID" };
    }
    rows = event.data.rows;
    snapshot = event.data;
  } else if (event.eventType === "pools.diff") {
    if (!isDiff(event.data) || state.epoch === null) {
      return { ...state, connection: "reconnecting", errorCode: "STREAM_DIFF_WITHOUT_BASE" };
    }
    rows = applyDiff(rows, event.data);
    if (snapshot) snapshot = { ...snapshot, rows, version: event.data.version };
  } else if (event.data !== null) {
    return { ...state, connection: "error", errorCode: "STREAM_HEARTBEAT_INVALID" };
  }

  return {
    ...state,
    connection: connectionForRows(rows),
    cursor: event.cursor,
    epoch: event.epoch,
    errorCode: null,
    lastEventFingerprint: nextFingerprint,
    rows,
    sequence: event.sequence,
    snapshot,
  };
}

