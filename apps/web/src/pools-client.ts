import type {
  LiquidityFlowProtocol,
  MarketPoolDiff,
  MarketPoolByTokenRow,
  MarketPoolByTokenSort,
  MarketPoolRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
  MarketWindowMinutes,
  SuccessEnvelope,
} from "@lpbot/api-contract";
import {
  canonicalizeLiquidityProtocols,
  liquidityFlowProtocols,
  poolLabelIds,
} from "@lpbot/api-contract";

export interface PoolStreamSubscription {
  close(): void;
}

export interface PoolStreamCallbacks {
  onError(): void;
  onEvent(event: MarketStreamEnvelope): void;
  onOpen(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/u.test(value);
}

function isPoolId(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value);
}

function parsePoolRow(value: unknown): MarketPoolRow | null {
  if (!isRecord(value)) return null;
  const poolAddress =
    value.poolAddress === null
      ? null
      : isAddress(value.poolAddress)
        ? value.poolAddress
        : undefined;
  const poolId = value.poolId === null ? null : isPoolId(value.poolId) ? value.poolId : undefined;
  const identity = poolAddress ?? poolId;
  if (
    value.chainId !== 56 ||
    poolAddress === undefined ||
    poolId === undefined ||
    !identity ||
    (poolAddress !== null && poolId !== null) ||
    value.poolKey !== `56:${identity}` ||
    typeof value.protocol !== "string" ||
    !liquidityFlowProtocols.includes(value.protocol as LiquidityFlowProtocol) ||
    !(value.hooks === null || isAddress(value.hooks)) ||
    !(value.token0Address === null || isAddress(value.token0Address)) ||
    !(value.token1Address === null || isAddress(value.token1Address)) ||
    typeof value.labelRuleVersion !== "string" ||
    value.labelRuleVersion.length === 0 ||
    !Array.isArray(value.labels)
  ) {
    return null;
  }
  for (const key of [
    "fdvUsd",
    "feePips",
    "feesUsd",
    "feeTvl",
    "tickSpacing",
    "token0Symbol",
    "token1Symbol",
    "transactionCount",
    "tvlUsd",
    "volumeUsd",
  ] as const) {
    if (!nullableString(value[key])) return null;
  }
  if (value.activeTvlUsd !== null || value.feeActiveTvl !== null) return null;

  const seen = new Set<string>();
  let lastPriority = -1;
  for (const label of value.labels) {
    if (
      !isRecord(label) ||
      typeof label.id !== "string" ||
      !poolLabelIds.includes(label.id as (typeof poolLabelIds)[number]) ||
      typeof label.label !== "string" ||
      label.label.length === 0 ||
      !Number.isInteger(label.score) ||
      (label.score as number) < 0 ||
      (label.score as number) > 100 ||
      !Array.isArray(label.reasons) ||
      label.reasons.length === 0 ||
      label.ruleVersion !== value.labelRuleVersion ||
      !isTimestamp(label.computedAt) ||
      seen.has(label.id)
    ) {
      return null;
    }
    const priority = poolLabelIds.indexOf(label.id as (typeof poolLabelIds)[number]);
    if (priority < lastPriority) return null;
    lastPriority = priority;
    seen.add(label.id);
    for (const reason of label.reasons) {
      if (
        !isRecord(reason) ||
        typeof reason.code !== "string" ||
        !/^[A-Z][A-Z0-9_]*$/u.test(reason.code) ||
        typeof reason.observed !== "string" ||
        typeof reason.threshold !== "string" ||
        typeof reason.window !== "string" ||
        !/^(?:1|5|15|30|60)m$/u.test(reason.window) ||
        (reason.operator !== ">=" && reason.operator !== "<=" && reason.operator !== "abs<=")
      ) {
        return null;
      }
    }
  }
  return value as unknown as MarketPoolRow;
}

export function parseMarketPoolSnapshot(value: unknown): MarketPoolSnapshot {
  if (
    !isRecord(value) ||
    value.chainId !== 56 ||
    typeof value.canonicalRevision !== "string" ||
    value.canonicalRevision.length === 0 ||
    typeof value.metricVersion !== "string" ||
    value.metricVersion.length === 0 ||
    !isTimestamp(value.generatedAt) ||
    ![1, 5, 15, 30, 60].includes(value.minutes as number) ||
    typeof value.version !== "string" ||
    !isTimestamp(value.windowStart) ||
    !isTimestamp(value.windowEnd) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("MARKET_RESPONSE_INVALID");
  }
  const rows = value.rows.map(parsePoolRow);
  if (rows.some((row) => row === null)) throw new Error("MARKET_RESPONSE_INVALID");
  for (const row of rows as MarketPoolRow[]) {
    if (row.labels.some(({ computedAt }) => computedAt !== value.windowEnd)) {
      throw new Error("MARKET_RESPONSE_INVALID");
    }
  }
  return { ...value, rows } as unknown as MarketPoolSnapshot;
}

function parseMarketPoolDiff(value: unknown): MarketPoolDiff | null {
  if (
    !isRecord(value) ||
    typeof value.canonicalRevision !== "string" ||
    value.canonicalRevision.length === 0 ||
    typeof value.metricVersion !== "string" ||
    value.metricVersion.length === 0 ||
    !Array.isArray(value.tombstones) ||
    value.tombstones.some((key) => typeof key !== "string") ||
    !Array.isArray(value.upserts) ||
    typeof value.version !== "string" ||
    !isTimestamp(value.windowEnd)
  ) {
    return null;
  }
  const upserts = value.upserts.map(parsePoolRow);
  if (upserts.some((row) => row === null)) return null;
  if (
    (upserts as MarketPoolRow[]).some((row) =>
      row.labels.some(({ computedAt }) => computedAt !== value.windowEnd),
    )
  ) {
    return null;
  }
  return { ...value, upserts } as unknown as MarketPoolDiff;
}

export function parseMarketStreamEnvelope(value: unknown): MarketStreamEnvelope {
  if (
    !isRecord(value) ||
    typeof value.cursor !== "string" ||
    typeof value.emittedAt !== "string" ||
    typeof value.epoch !== "string" ||
    typeof value.sequence !== "string" ||
    typeof value.streamKey !== "string" ||
    value.schemaVersion !== "1.0.0" ||
    (value.eventType !== "pools.snapshot" &&
      value.eventType !== "pools.diff" &&
      value.eventType !== "heartbeat") ||
    (value.mode !== "snapshot" && value.mode !== "diff")
  ) {
    throw new Error("MARKET_STREAM_RESPONSE_INVALID");
  }
  let data: MarketStreamEnvelope["data"] | undefined;
  try {
    data =
      value.eventType === "pools.snapshot"
        ? parseMarketPoolSnapshot(value.data)
        : value.eventType === "pools.diff"
          ? parseMarketPoolDiff(value.data)
          : value.data === null
            ? null
            : undefined;
  } catch {
    data = undefined;
  }
  if (
    data === undefined ||
    (value.eventType === "pools.snapshot" && value.mode !== "snapshot") ||
    (value.eventType !== "pools.snapshot" && value.mode !== "diff")
  ) {
    throw new Error("MARKET_STREAM_RESPONSE_INVALID");
  }
  return { ...value, data } as unknown as MarketStreamEnvelope;
}

export function buildMarketPoolsUrl(
  minutes: MarketWindowMinutes,
  protocols: readonly string[],
  stream: boolean,
): string {
  const selected = canonicalizeLiquidityProtocols(protocols);
  const path = `/api/pools/top-fees/${minutes}${stream ? "/stream" : ""}`;
  const parameters = new URLSearchParams({ chainId: "56" });
  if (selected.length !== liquidityFlowProtocols.length) parameters.set("dex", selected.join(","));
  return `${path}?${parameters.toString()}`;
}

export function buildPoolsByTokenUrl(
  address: string,
  protocols: readonly string[],
  limit: number,
  sort: MarketPoolByTokenSort,
): string {
  const selected = canonicalizeLiquidityProtocols(protocols);
  const parameters = new URLSearchParams({
    chain: "bsc",
    dex: selected.join(","),
    limit: String(limit),
    sort,
  });
  return `/api/pools/by-token/${address.toLowerCase()}?${parameters.toString()}`;
}

export class PoolsClient {
  async getByToken(
    address: string,
    signal: AbortSignal,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
    limit = 100,
    sort: MarketPoolByTokenSort = "fees",
  ): Promise<MarketPoolByTokenRow[]> {
    const response = await fetch(buildPoolsByTokenUrl(address, protocols, limit, sort), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`MARKET_TOKEN_HTTP_${response.status}`);
    const envelope = (await response.json()) as SuccessEnvelope<unknown>;
    if (!envelope.success || !Array.isArray(envelope.data)) {
      throw new Error("MARKET_TOKEN_RESPONSE_INVALID");
    }
    return envelope.data as MarketPoolByTokenRow[];
  }

  async getSnapshot(
    minutes: MarketWindowMinutes,
    signal: AbortSignal,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
  ): Promise<MarketPoolSnapshot> {
    const response = await fetch(buildMarketPoolsUrl(minutes, protocols, false), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error(`MARKET_HTTP_${response.status}`);
    const envelope = (await response.json()) as SuccessEnvelope<unknown>;
    let snapshot: MarketPoolSnapshot;
    try {
      snapshot = envelope.success
        ? parseMarketPoolSnapshot(envelope.data)
        : parseMarketPoolSnapshot(null);
    } catch {
      throw new Error("MARKET_RESPONSE_INVALID");
    }
    if (snapshot.minutes !== minutes) throw new Error("MARKET_RESPONSE_INVALID");
    return snapshot;
  }

  subscribe(
    minutes: MarketWindowMinutes,
    callbacks: PoolStreamCallbacks,
    protocols: readonly LiquidityFlowProtocol[] = liquidityFlowProtocols,
  ): PoolStreamSubscription {
    const source = new EventSource(buildMarketPoolsUrl(minutes, protocols, true), {
      withCredentials: true,
    });
    const receive = (message: MessageEvent<string>) => {
      try {
        callbacks.onEvent(parseMarketStreamEnvelope(JSON.parse(message.data)));
      } catch {
        callbacks.onError();
      }
    };
    source.addEventListener("pools.snapshot", receive as EventListener);
    source.addEventListener("pools.diff", receive as EventListener);
    source.addEventListener("heartbeat", receive as EventListener);
    source.onopen = callbacks.onOpen;
    source.onerror = callbacks.onError;
    return { close: () => source.close() };
  }
}
