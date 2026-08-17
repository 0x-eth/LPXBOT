import type {
  PoolBlocklistEntry,
  PoolBlocklistOperation,
  PoolBlocklistSnapshot,
} from "@lpbot/api-contract";

export type PoolBlocklistStatus = "conflict" | "error" | "loading" | "ready" | "saving";

export interface PendingPoolBlocklistMutation {
  mutationId: string;
  operation: PoolBlocklistOperation;
}

export interface PoolBlocklistState {
  authoritative: PoolBlocklistSnapshot | null;
  entries: PoolBlocklistEntry[];
  errorCode: string | null;
  loadRequestId: string | null;
  pending: PendingPoolBlocklistMutation[];
  status: PoolBlocklistStatus;
  userId: string;
}

export type PoolBlocklistAction =
  | { requestId: string; type: "load-start"; userId: string }
  | {
      requestId: string;
      snapshot: PoolBlocklistSnapshot;
      type: "load-success";
      userId: string;
    }
  | { code: string; requestId: string; type: "load-failure"; userId: string }
  | { mutationId: string; operation: PoolBlocklistOperation; type: "mutation-optimistic" }
  | { mutationId: string; snapshot: PoolBlocklistSnapshot; type: "mutation-success" }
  | {
      code: string;
      current?: PoolBlocklistSnapshot;
      mutationId: string;
      type: "mutation-failure";
    }
  | { type: "dismiss-error" };

function entryKey(entry: Pick<PoolBlocklistEntry, "chainId" | "identity" | "scope">): string {
  return `${entry.chainId}\u0000${entry.scope}\u0000${entry.identity}`;
}

function sortEntries(entries: readonly PoolBlocklistEntry[]): PoolBlocklistEntry[] {
  return entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right), "en"));
}

function applyOperation(
  entries: readonly PoolBlocklistEntry[],
  operation: PoolBlocklistOperation,
): PoolBlocklistEntry[] {
  const key = entryKey(operation.entry);
  const exists = entries.some((entry) => entryKey(entry) === key);
  if (operation.type === "block") {
    return exists ? sortEntries(entries) : sortEntries([...entries, operation.entry]);
  }
  return exists
    ? sortEntries(entries.filter((entry) => entryKey(entry) !== key))
    : sortEntries(entries);
}

function project(
  authoritative: PoolBlocklistSnapshot | null,
  pending: readonly PendingPoolBlocklistMutation[],
): PoolBlocklistEntry[] {
  return pending.reduce(
    (entries, mutation) => applyOperation(entries, mutation.operation),
    sortEntries(authoritative?.entries ?? []),
  );
}

export function initialPoolBlocklistState(userId: string): PoolBlocklistState {
  return {
    authoritative: null,
    entries: [],
    errorCode: null,
    loadRequestId: null,
    pending: [],
    status: "loading",
    userId,
  };
}

export function reducePoolBlocklist(
  state: PoolBlocklistState,
  action: PoolBlocklistAction,
): PoolBlocklistState {
  if (action.type === "load-start") {
    if (action.userId !== state.userId) {
      return { ...initialPoolBlocklistState(action.userId), loadRequestId: action.requestId };
    }
    return {
      ...state,
      errorCode: null,
      loadRequestId: action.requestId,
      status: "loading",
    };
  }
  if (action.type === "load-success") {
    if (action.userId !== state.userId || action.requestId !== state.loadRequestId) return state;
    const authoritative = structuredClone(action.snapshot);
    return {
      ...state,
      authoritative,
      entries: sortEntries(authoritative.entries),
      errorCode: null,
      loadRequestId: null,
      pending: [],
      status: "ready",
    };
  }
  if (action.type === "load-failure") {
    if (action.userId !== state.userId || action.requestId !== state.loadRequestId) return state;
    return {
      ...state,
      entries: [],
      errorCode: action.code,
      loadRequestId: null,
      status: "error",
    };
  }
  if (action.type === "mutation-optimistic") {
    if (
      !state.authoritative ||
      state.pending.some(({ mutationId }) => mutationId === action.mutationId)
    ) {
      return state;
    }
    const pending = [
      ...state.pending,
      { mutationId: action.mutationId, operation: structuredClone(action.operation) },
    ];
    return {
      ...state,
      entries: project(state.authoritative, pending),
      errorCode: null,
      pending,
      status: "saving",
    };
  }
  if (action.type === "mutation-success") {
    if (!state.pending.some(({ mutationId }) => mutationId === action.mutationId)) return state;
    const pending = state.pending.filter(({ mutationId }) => mutationId !== action.mutationId);
    const authoritative = structuredClone(action.snapshot);
    return {
      ...state,
      authoritative,
      entries: project(authoritative, pending),
      errorCode: null,
      pending,
      status: pending.length > 0 ? "saving" : "ready",
    };
  }
  if (action.type === "mutation-failure") {
    if (!state.pending.some(({ mutationId }) => mutationId === action.mutationId)) return state;
    const pending = state.pending.filter(({ mutationId }) => mutationId !== action.mutationId);
    const authoritative = action.current ? structuredClone(action.current) : state.authoritative;
    return {
      ...state,
      authoritative,
      entries: project(authoritative, pending),
      errorCode: action.code,
      pending,
      status: action.code === "REVISION_CONFLICT" ? "conflict" : "error",
    };
  }
  return {
    ...state,
    errorCode: null,
    status: state.pending.length > 0 ? "saving" : state.authoritative ? "ready" : "loading",
  };
}

export function poolBlocklistContains(
  entries: readonly PoolBlocklistEntry[],
  entry: Pick<PoolBlocklistEntry, "chainId" | "identity" | "scope">,
): boolean {
  const key = entryKey(entry);
  return entries.some((candidate) => entryKey(candidate) === key);
}
