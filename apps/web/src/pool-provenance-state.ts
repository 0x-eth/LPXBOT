import type { PoolCreationAttribution } from "@lpbot/api-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PoolProvenanceClient, PoolProvenanceRequestManager } from "./pool-provenance-client.js";

const maximumCreatorBatchSize = 100;

export interface PoolCreatorLookupState {
  malformed: ReadonlySet<string>;
  records: ReadonlyMap<string, PoolCreationAttribution | null>;
  status: "error" | "loading" | "partial" | "ready";
}

export interface PoolCreatorSelection {
  identity: string;
  poolKey: string;
  trigger: HTMLButtonElement;
}

interface StoredCreatorLookup {
  requestKey: string;
  state: PoolCreatorLookupState;
}

function emptyCreatorLookup(status: PoolCreatorLookupState["status"]): PoolCreatorLookupState {
  return { malformed: new Set(), records: new Map(), status };
}

function canonicalPoolKeys(poolKeys: readonly string[]): string[] {
  return [...new Set(poolKeys.map((poolKey) => poolKey.toLowerCase()))];
}

export function usePoolCreatorLookup(input: {
  enabled: boolean;
  poolKeys: readonly string[];
  sessionKey: string;
}): { retry(): void; state: PoolCreatorLookupState } {
  const manager = useRef<PoolProvenanceRequestManager | null>(null);
  if (manager.current === null) {
    manager.current = new PoolProvenanceRequestManager(new PoolProvenanceClient());
  }
  const [retryToken, setRetryToken] = useState(0);
  const signature = canonicalPoolKeys(input.poolKeys).join("\u0000");
  const requestKey = `${input.enabled ? "admin" : "disabled"}:${input.sessionKey}:${signature}:${retryToken}`;
  const [stored, setStored] = useState<StoredCreatorLookup | null>(null);
  const keys = useMemo(() => (signature ? signature.split("\u0000") : []), [signature]);
  const visibleState =
    stored?.requestKey === requestKey
      ? stored.state
      : emptyCreatorLookup(input.enabled && keys.length > 0 ? "loading" : "ready");

  useEffect(() => {
    const requestManager = manager.current!;
    requestManager.clear();
    if (!input.enabled || keys.length === 0) return;

    let disposed = false;
    const requestedKeys = keys.slice(0, maximumCreatorBatchSize);
    const overflowKeys = keys.slice(maximumCreatorBatchSize);

    // StrictMode cleans up its first development-only effect before this timer starts a request.
    const timer = window.setTimeout(() => {
      void requestManager
        .loadPoolCreators(requestedKeys, requestKey, (view, responseKey) => {
          if (disposed || responseKey !== requestKey) return;
          const malformed = new Set([...view.malformed, ...overflowKeys]);
          setStored({
            requestKey,
            state: {
              malformed,
              records: view.records,
              status: malformed.size > 0 ? "partial" : "ready",
            },
          });
        })
        .catch(() => {
          if (disposed) return;
          setStored({ requestKey, state: emptyCreatorLookup("error") });
        });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      requestManager.clear();
    };
  }, [input.enabled, keys, requestKey]);

  return {
    retry: useCallback(() => setRetryToken((value) => value + 1), []),
    state: visibleState,
  };
}
