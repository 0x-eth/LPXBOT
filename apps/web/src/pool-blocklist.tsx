import type {
  PoolBlocklistEntry,
  PoolBlocklistOperation,
  PoolBlocklistSnapshot,
} from "@lpbot/api-contract";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { PoolBlocklistClient, PoolBlocklistRequestError } from "./pool-blocklist-client.js";
import {
  initialPoolBlocklistState,
  poolBlocklistContains,
  reducePoolBlocklist,
  type PoolBlocklistStatus,
} from "./pool-blocklist-state.js";

export interface PoolBlocklistContextValue {
  block(entry: PoolBlocklistEntry): Promise<boolean>;
  contains(entry: Pick<PoolBlocklistEntry, "chainId" | "identity" | "scope">): boolean;
  entries: PoolBlocklistEntry[];
  errorCode: string | null;
  loaded: boolean;
  mutate(operation: PoolBlocklistOperation): Promise<boolean>;
  pendingCount: number;
  restore(entry: Omit<PoolBlocklistEntry, "label">): Promise<boolean>;
  retryLoad(): void;
  snapshot: PoolBlocklistSnapshot | null;
  status: PoolBlocklistStatus;
}

const PoolBlocklistContext = createContext<PoolBlocklistContextValue | null>(null);

export function PoolBlocklistProvider({
  children,
  client: suppliedClient,
  userId,
}: {
  children: ReactNode;
  client?: PoolBlocklistClient;
  userId: string;
}) {
  const client = useMemo(() => suppliedClient ?? new PoolBlocklistClient(), [suppliedClient]);
  const [state, dispatch] = useReducer(reducePoolBlocklist, userId, initialPoolBlocklistState);
  const authority = useRef<PoolBlocklistSnapshot | null>(null);
  const generation = useRef(0);
  const loadSequence = useRef(0);
  const mutationSequence = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const activeUser = useRef(userId);

  const load = useCallback(
    (targetUserId: string) => {
      const currentGeneration = ++generation.current;
      activeUser.current = targetUserId;
      authority.current = null;
      queue.current = Promise.resolve();
      const requestId = `blocklist-load-${++loadSequence.current}`;
      const controller = new AbortController();
      dispatch({ requestId, type: "load-start", userId: targetUserId });
      void client.get(controller.signal).then(
        (snapshot) => {
          if (
            generation.current !== currentGeneration ||
            activeUser.current !== targetUserId
          ) {
            return;
          }
          authority.current = snapshot;
          dispatch({ requestId, snapshot, type: "load-success", userId: targetUserId });
        },
        (error: unknown) => {
          if (
            controller.signal.aborted ||
            generation.current !== currentGeneration ||
            activeUser.current !== targetUserId
          ) {
            return;
          }
          dispatch({
            code: error instanceof PoolBlocklistRequestError ? error.code : "NETWORK_ERROR",
            requestId,
            type: "load-failure",
            userId: targetUserId,
          });
        },
      );
      return controller;
    },
    [client],
  );

  useEffect(() => {
    const controller = load(userId);
    return () => controller.abort();
  }, [load, userId]);

  const mutate = useCallback(
    (operation: PoolBlocklistOperation): Promise<boolean> => {
      if (!authority.current || activeUser.current !== userId) return Promise.resolve(false);
      const mutationId = `blocklist-${generation.current}-${++mutationSequence.current}`;
      const mutationGeneration = generation.current;
      dispatch({ mutationId, operation, type: "mutation-optimistic" });

      let resolveResult: (result: boolean) => void = () => undefined;
      const result = new Promise<boolean>((resolve) => {
        resolveResult = resolve;
      });
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (
            generation.current !== mutationGeneration ||
            activeUser.current !== userId ||
            !authority.current
          ) {
            resolveResult(false);
            return;
          }
          try {
            const snapshot = await client.patch({
              expectedRevision: authority.current.revision,
              operation,
            });
            if (generation.current !== mutationGeneration || activeUser.current !== userId) {
              resolveResult(false);
              return;
            }
            authority.current = snapshot;
            dispatch({ mutationId, snapshot, type: "mutation-success" });
            resolveResult(true);
          } catch (error) {
            if (generation.current !== mutationGeneration || activeUser.current !== userId) {
              resolveResult(false);
              return;
            }
            const requestError =
              error instanceof PoolBlocklistRequestError
                ? error
                : new PoolBlocklistRequestError("NETWORK_ERROR", 0);
            if (requestError.current) authority.current = requestError.current;
            dispatch({
              code: requestError.code,
              ...(requestError.current ? { current: requestError.current } : {}),
              mutationId,
              type: "mutation-failure",
            });
            resolveResult(false);
          }
        });
      return result;
    },
    [client, userId],
  );

  const value = useMemo<PoolBlocklistContextValue>(
    () => ({
      block: (entry) => mutate({ entry, type: "block" }),
      contains: (entry) => poolBlocklistContains(state.entries, entry),
      entries: state.entries,
      errorCode: state.errorCode,
      loaded: state.authoritative !== null,
      mutate,
      pendingCount: state.pending.length,
      restore: (entry) => mutate({ entry, type: "restore" }),
      retryLoad: () => {
        load(userId);
      },
      snapshot: state.authoritative,
      status: state.status,
    }),
    [load, mutate, state, userId],
  );

  return <PoolBlocklistContext.Provider value={value}>{children}</PoolBlocklistContext.Provider>;
}

// Provider and hook intentionally share one context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function usePoolBlocklist(): PoolBlocklistContextValue {
  const value = useContext(PoolBlocklistContext);
  if (!value) throw new Error("PoolBlocklistProvider is missing");
  return value;
}
