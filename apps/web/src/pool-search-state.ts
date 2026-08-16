import type { EvmAddress, MarketPoolRow } from "@lpbot/api-contract";

export type PoolSearchMode = "pool" | "token";
export type PoolSearchStatus =
  | "pristine"
  | "loading"
  | "ready"
  | "no-results"
  | "invalid"
  | "error"
  | "reconnecting";

export interface PoolSearchParameters {
  mode: PoolSearchMode;
  query: string;
  valid: boolean;
}

export interface PoolSearchState {
  errorCode: string | null;
  mode: PoolSearchMode | null;
  query: string;
  requestId: number | null;
  rows: MarketPoolRow[];
  status: PoolSearchStatus;
}

export type PoolSearchAction =
  | { mode: PoolSearchMode; query: string; requestId: number; type: "start" }
  | { requestId: number; rows: MarketPoolRow[]; type: "success" }
  | { requestId: number; type: "invalid" }
  | { code: string; requestId: number; type: "error" }
  | { type: "reconnecting" }
  | { type: "clear" };

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const poolIdentityPattern = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;

export function initialPoolSearchState(): PoolSearchState {
  return {
    errorCode: null,
    mode: null,
    query: "",
    requestId: null,
    rows: [],
    status: "pristine",
  };
}

export function parsePoolSearchParameters(search: string): PoolSearchParameters | null {
  const parameters = new URLSearchParams(search);
  const mode = parameters.get("pool_search_mode");
  const query = parameters.get("pool_search");
  if (query === null || (mode !== "pool" && mode !== "token")) return null;
  const valid = mode === "token" ? addressPattern.test(query) : poolIdentityPattern.test(query);
  return { mode, query: valid ? query.toLowerCase() : query, valid };
}

export function writePoolSearchParameters(
  search: string,
  value: { mode: PoolSearchMode; query: string } | null,
): string {
  const parameters = new URLSearchParams(search);
  parameters.delete("pool_search_mode");
  parameters.delete("pool_search");
  if (value) {
    parameters.set("pool_search_mode", value.mode);
    parameters.set("pool_search", value.query.toLowerCase());
  }
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

export function filterPoolsByIdentity(
  rows: readonly MarketPoolRow[],
  query: string,
): MarketPoolRow[] {
  const identity = query.toLowerCase();
  if (!poolIdentityPattern.test(identity)) return [];
  return rows.filter(
    (row) => (row.poolAddress ?? row.poolId)?.toLowerCase() === identity,
  );
}

export function reducePoolSearch(state: PoolSearchState, action: PoolSearchAction): PoolSearchState {
  if (action.type === "clear") return initialPoolSearchState();
  if (action.type === "reconnecting") {
    return state.status === "pristine" ? state : { ...state, status: "reconnecting" };
  }
  if (action.type === "start") {
    return {
      errorCode: null,
      mode: action.mode,
      query: action.query,
      requestId: action.requestId,
      rows: [],
      status: "loading",
    };
  }
  if (state.requestId !== action.requestId) return state;
  if (action.type === "success") {
    return {
      ...state,
      errorCode: null,
      rows: action.rows,
      status: action.rows.length === 0 ? "no-results" : "ready",
    };
  }
  if (action.type === "invalid") {
    return { ...state, errorCode: null, rows: [], status: "invalid" };
  }
  return { ...state, errorCode: action.code, rows: [], status: "error" };
}

export class PoolSearchRequestManager {
  #controller: AbortController | null = null;
  #generation = 0;
  #requestId: number | null = null;

  start(): { requestId: number; signal: AbortSignal } {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#generation += 1;
    this.#requestId = this.#generation;
    return { requestId: this.#requestId, signal: this.#controller.signal };
  }

  isCurrent(requestId: number): boolean {
    return this.#requestId === requestId && this.#controller?.signal.aborted === false;
  }

  clear(): void {
    this.#controller?.abort();
    this.#controller = null;
    this.#requestId = null;
  }
}

export function validTokenSearchAddress(query: string): EvmAddress | null {
  return addressPattern.test(query) ? (query.toLowerCase() as EvmAddress) : null;
}
