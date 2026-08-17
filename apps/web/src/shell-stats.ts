import type {
  RecommendedPoolRow,
  RecommendedPoolsSnapshotEvent,
  ShellGasStats,
  ShellStats,
  ShellStatsEvent,
  ShellStatsPatch,
  ShellTaskCounts,
} from "@lpbot/api-contract";
import type { PoolEligibilityPolicy } from "@lpbot/domain";
import { Decimal } from "decimal.js";

export type RecommendedPoolsStatus =
  "loading" | "ready" | "empty" | "unavailable" | "reconnecting" | "stale";

export interface RecommendedPoolsState {
  cursor: string | null;
  observedAt: string | null;
  pools: RecommendedPoolRow[];
  selectionHash: string | null;
  sourceVersion: string | null;
  sourceWindowEnd: string | null;
  status: RecommendedPoolsStatus;
}

export interface ShellStatsState {
  connected: boolean;
  observedAt: string | null;
  recommendations: RecommendedPoolsState;
  sequence: number;
  stats: ShellStats | null;
}

export interface ShellStatsDisplay {
  baseGas: string;
  ethereumGas: string;
  fps: string;
  online: string;
  paused: string;
  ping: string;
  recommendationStatus: RecommendedPoolsStatus;
  recommendedPools: RecommendedPoolRow[];
  running: string;
  stopped: string;
}

export interface ApiShellStatsProviderOptions {
  fetcher?: typeof fetch;
  initialRetryMs?: number;
  maxRetryMs?: number;
  now?: () => Date;
  recommendationChain?: "bsc" | null;
  recommendationLimit?: number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

type ShellStatsListener = (state: ShellStatsState) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function validObservedAt(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseGas(value: unknown, complete: boolean): Partial<ShellGasStats> | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["baseGwei", "ethereumGwei"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (complete && (!Object.hasOwn(value, "baseGwei") || !Object.hasOwn(value, "ethereumGwei"))) {
    return null;
  }
  if (Object.hasOwn(value, "baseGwei") && !isNullableNumber(value.baseGwei)) return null;
  if (Object.hasOwn(value, "ethereumGwei") && !isNullableNumber(value.ethereumGwei)) return null;
  return value as Partial<ShellGasStats>;
}

function parseCounts(value: unknown, complete: boolean): Partial<ShellTaskCounts> | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["paused", "running", "stopped"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (
    complete &&
    (!Object.hasOwn(value, "paused") ||
      !Object.hasOwn(value, "running") ||
      !Object.hasOwn(value, "stopped"))
  ) {
    return null;
  }
  for (const key of allowed) {
    if (Object.hasOwn(value, key) && !isCount(value[key])) return null;
  }
  return value as Partial<ShellTaskCounts>;
}

function parseStats(value: unknown, complete: boolean): ShellStats | ShellStatsPatch | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["fps", "gas", "online", "pingMs", "taskCounts"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (complete && [...allowed].some((key) => !Object.hasOwn(value, key))) return null;
  if (Object.hasOwn(value, "fps") && !isNullableNumber(value.fps)) return null;
  if (Object.hasOwn(value, "pingMs") && !isNullableNumber(value.pingMs)) return null;
  if (
    Object.hasOwn(value, "online") &&
    value.online !== null &&
    typeof value.online !== "boolean"
  ) {
    return null;
  }
  const gas = Object.hasOwn(value, "gas") ? parseGas(value.gas, complete) : undefined;
  const taskCounts = Object.hasOwn(value, "taskCounts")
    ? parseCounts(value.taskCounts, complete)
    : undefined;
  if (gas === null || taskCounts === null) return null;
  return value as unknown as ShellStats | ShellStatsPatch;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const poolIdPattern = /^0x[0-9a-f]{64}$/u;
const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const protocols = new Set(["pcsv3", "univ3", "pcsv4", "univ4"]);
const recommendationRowKeys = [
  "chainId",
  "feePips",
  "feesUsd",
  "poolAddress",
  "poolId",
  "poolKey",
  "protocol",
  "token0Address",
  "token0Symbol",
  "token1Address",
  "token1Symbol",
] as const;

function validSymbol(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 64 &&
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0)!;
        return codePoint <= 31 || codePoint === 127;
      }))
  );
}

function validPositiveDecimal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() && decimal.gt(0);
  } catch {
    return false;
  }
}

function parseRecommendedPoolRow(value: unknown): RecommendedPoolRow | null {
  if (!isRecord(value) || !hasExactKeys(value, recommendationRowKeys)) return null;
  if (
    value.chainId !== 56 ||
    typeof value.protocol !== "string" ||
    !protocols.has(value.protocol) ||
    !addressPattern.test(String(value.token0Address)) ||
    !addressPattern.test(String(value.token1Address)) ||
    !validSymbol(value.token0Symbol) ||
    !validSymbol(value.token1Symbol) ||
    !validPositiveDecimal(value.feesUsd) ||
    (value.feePips !== null &&
      (typeof value.feePips !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value.feePips)))
  ) {
    return null;
  }
  const v3 = value.protocol === "pcsv3" || value.protocol === "univ3";
  const identity = v3 ? value.poolAddress : value.poolId;
  if (
    (v3 &&
      (typeof value.poolAddress !== "string" ||
        !addressPattern.test(value.poolAddress) ||
        value.poolId !== null)) ||
    (!v3 &&
      (typeof value.poolId !== "string" ||
        !poolIdPattern.test(value.poolId) ||
        value.poolAddress !== null)) ||
    typeof value.poolKey !== "string" ||
    value.poolKey !== `56:${identity}`
  ) {
    return null;
  }
  return value as unknown as RecommendedPoolRow;
}

function decodeBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = globalThis.atob(padded);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

function validRecommendationCursor(event: RecommendedPoolsSnapshotEvent): boolean {
  const parts = event.cursor.split(":");
  const [prefix, version, chain, limit] = parts;
  if (
    prefix !== "rec-pools" ||
    (version !== "v1" && version !== "v2") ||
    chain !== "bsc" ||
    typeof limit !== "string" ||
    !/^(?:[1-9]|1[0-9]|20)$/u.test(limit)
  ) {
    return false;
  }
  const offset = version === "v2" ? 1 : 0;
  if (version === "v2" && !/^[0-9a-f]{64}$/u.test(parts[4] ?? "")) return false;
  const sourceVersion = parts[4 + offset];
  const sourceWindowEnd = parts[5 + offset];
  const hash = parts[6 + offset];
  return (
    typeof sourceVersion === "string" &&
    decodeBase64Url(sourceVersion) === event.sourceVersion &&
    typeof sourceWindowEnd === "string" &&
    decodeBase64Url(sourceWindowEnd) === event.sourceWindowEnd &&
    hash === event.selectionHash.slice("sha256:".length) &&
    parts.length === 7 + offset
  );
}

function parseRecommendationEvent(
  value: Record<string, unknown>,
): RecommendedPoolsSnapshotEvent | null {
  if (
    !hasExactKeys(value, [
      "cursor",
      "observedAt",
      "pools",
      "selectionHash",
      "sourceVersion",
      "sourceWindow",
      "sourceWindowEnd",
      "type",
    ]) ||
    value.type !== "rec_pools_snapshot" ||
    typeof value.cursor !== "string" ||
    !validObservedAt(value.observedAt) ||
    !Array.isArray(value.pools) ||
    value.pools.length > 20 ||
    !hashPattern.test(String(value.selectionHash)) ||
    typeof value.sourceVersion !== "string" ||
    value.sourceVersion.length < 1 ||
    value.sourceVersion.length > 256 ||
    value.sourceWindow !== 5 ||
    !validObservedAt(value.sourceWindowEnd)
  ) {
    return null;
  }
  const pools = value.pools.map(parseRecommendedPoolRow);
  if (pools.some((pool) => pool === null)) return null;
  const event = { ...value, pools } as unknown as RecommendedPoolsSnapshotEvent;
  return validRecommendationCursor(event) ? event : null;
}

export function parseShellStatsEvent(value: unknown): ShellStatsEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "rec_pools_snapshot") return parseRecommendationEvent(value);
  if (!validObservedAt(value.observedAt)) return null;
  if (value.type === "snapshot") {
    if (
      !hasExactKeys(value, ["observedAt", "sequence", "stats", "type"]) ||
      !validSequence(value.sequence)
    ) {
      return null;
    }
    const stats = parseStats(value.stats, true);
    if (!stats) return null;
    return {
      observedAt: value.observedAt,
      sequence: value.sequence,
      stats: stats as ShellStats,
      type: value.type,
    };
  }
  if (value.type === "update") {
    if (
      !hasExactKeys(value, ["observedAt", "sequence", "stats", "type"]) ||
      !validSequence(value.sequence)
    ) {
      return null;
    }
    const stats = parseStats(value.stats, false);
    if (!stats) return null;
    return {
      observedAt: value.observedAt,
      sequence: value.sequence,
      stats: stats as ShellStatsPatch,
      type: value.type,
    };
  }
  if (value.type === "heartbeat") {
    if (
      !hasExactKeys(value, ["observedAt", "sequence", "type"]) ||
      (value.sequence !== null && !validSequence(value.sequence))
    ) {
      return null;
    }
    return { observedAt: value.observedAt, sequence: value.sequence, type: value.type };
  }
  return null;
}

export function createShellStatsState(): ShellStatsState {
  return {
    connected: false,
    observedAt: null,
    recommendations: {
      cursor: null,
      observedAt: null,
      pools: [],
      selectionHash: null,
      sourceVersion: null,
      sourceWindowEnd: null,
      status: "loading",
    },
    sequence: -1,
    stats: null,
  };
}

function mergeStats(current: ShellStats, patch: ShellStatsPatch): ShellStats {
  return {
    ...current,
    ...patch,
    gas: { ...current.gas, ...patch.gas },
    taskCounts: { ...current.taskCounts, ...patch.taskCounts },
  };
}

export function reduceShellStatsEvent(
  state: ShellStatsState,
  event: ShellStatsEvent,
): ShellStatsState {
  if (event.type === "rec_pools_snapshot") {
    const current = state.recommendations;
    if (event.cursor === current.cursor) return state;
    if (current.sourceWindowEnd !== null) {
      const windowOrder = Date.parse(event.sourceWindowEnd) - Date.parse(current.sourceWindowEnd);
      if (windowOrder < 0) return state;
      if (windowOrder === 0 && current.sourceVersion !== null) {
        try {
          if (BigInt(event.sourceVersion) < BigInt(current.sourceVersion)) return state;
        } catch {
          // Opaque source versions are ordered by the server cursor.
        }
      }
    }
    return {
      ...state,
      connected: true,
      observedAt: event.observedAt,
      recommendations: {
        cursor: event.cursor,
        observedAt: event.observedAt,
        pools: structuredClone(event.pools),
        selectionHash: event.selectionHash,
        sourceVersion: event.sourceVersion,
        sourceWindowEnd: event.sourceWindowEnd,
        status: event.pools.length === 0 ? "empty" : "ready",
      },
    };
  }
  if (event.type === "heartbeat") {
    if (event.sequence === null) {
      return { ...state, connected: true, observedAt: event.observedAt };
    }
    if (event.sequence < state.sequence || event.sequence === state.sequence) return state;
    return { ...state, connected: true, observedAt: event.observedAt, sequence: event.sequence };
  }
  if (event.sequence < state.sequence) return state;
  if (event.sequence === state.sequence && event.type !== "snapshot") return state;
  if (event.type === "snapshot") {
    return {
      connected: true,
      observedAt: event.observedAt,
      recommendations: state.recommendations,
      sequence: event.sequence,
      stats: structuredClone(event.stats),
    };
  }
  if (!state.stats) return state;
  return {
    ...state,
    connected: true,
    observedAt: event.observedAt,
    sequence: event.sequence,
    stats: mergeStats(state.stats, event.stats),
  };
}

export function markShellStatsDisconnected(
  state: ShellStatsState,
  now = new Date(),
): ShellStatsState {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Stats disconnect clock is invalid");
  const recommendationObservedAt = state.recommendations.observedAt;
  const stale =
    recommendationObservedAt !== null &&
    now.getTime() - Date.parse(recommendationObservedAt) > 30_000;
  return {
    ...state,
    connected: false,
    recommendations: {
      ...state.recommendations,
      status: stale ? "stale" : "reconnecting",
    },
  };
}

function valueOrUnavailable(value: number | null, suffix = ""): string {
  return value === null ? "--" : `${value}${suffix}`;
}

function abbreviatedAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function recommendedPoolDisplay(row: RecommendedPoolRow): { fees: string; pair: string } {
  const fixed = new Decimal(row.feesUsd).toFixed(2);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return {
    fees: `$${grouped}.${fraction}`,
    pair: `${row.token0Symbol ?? abbreviatedAddress(row.token0Address)} / ${
      row.token1Symbol ?? abbreviatedAddress(row.token1Address)
    }`,
  };
}

export function recommendedPoolSearchPath(row: RecommendedPoolRow): string {
  const parameters = new URLSearchParams({
    pool_search_mode: "pool",
    pool_search: row.poolAddress ?? row.poolId!,
  });
  return `/pools?${parameters.toString()}`;
}

export function shellStatsDisplay(
  state: ShellStatsState,
  eligibility?: Pick<PoolEligibilityPolicy, "filter">,
): ShellStatsDisplay {
  const stats = state.connected ? state.stats : null;
  const recommendedPools = eligibility
    ? eligibility.filter(state.recommendations.pools).candidates.slice(0, 3)
    : state.recommendations.pools.slice(0, 3);
  const recommendationStatus =
    state.recommendations.status === "ready" && recommendedPools.length === 0
      ? "empty"
      : state.recommendations.status;
  return {
    baseGas: valueOrUnavailable(stats?.gas.baseGwei ?? null),
    ethereumGas: valueOrUnavailable(stats?.gas.ethereumGwei ?? null),
    fps: valueOrUnavailable(stats?.fps ?? null),
    online: stats?.online === true ? "在线" : stats?.online === false ? "离线" : "不可用",
    paused: valueOrUnavailable(stats?.taskCounts.paused ?? null),
    ping: valueOrUnavailable(stats?.pingMs ?? null, "ms"),
    recommendationStatus,
    recommendedPools,
    running: valueOrUnavailable(stats?.taskCounts.running ?? null),
    stopped: valueOrUnavailable(stats?.taskCounts.stopped ?? null),
  };
}

async function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export class ApiShellStatsProvider {
  readonly #fetcher: typeof fetch;
  readonly #initialRetryMs: number;
  readonly #listeners = new Set<ShellStatsListener>();
  readonly #maxRetryMs: number;
  readonly #now: () => Date;
  readonly #recommendationChain: "bsc" | null;
  readonly #recommendationLimit: number;
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #controller: AbortController | null = null;
  #running = false;
  #state = createShellStatsState();

  constructor(options: ApiShellStatsProviderOptions = {}) {
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#initialRetryMs = options.initialRetryMs ?? 1_000;
    this.#maxRetryMs = options.maxRetryMs ?? 30_000;
    this.#now = options.now ?? (() => new Date());
    this.#recommendationChain =
      options.recommendationChain === undefined ? "bsc" : options.recommendationChain;
    this.#recommendationLimit = options.recommendationLimit ?? 3;
    this.#sleep = options.sleep ?? defaultSleep;
    if (
      !Number.isSafeInteger(this.#initialRetryMs) ||
      !Number.isSafeInteger(this.#maxRetryMs) ||
      this.#initialRetryMs <= 0 ||
      this.#maxRetryMs < this.#initialRetryMs ||
      !Number.isSafeInteger(this.#recommendationLimit) ||
      this.#recommendationLimit < 1 ||
      this.#recommendationLimit > 20
    ) {
      throw new RangeError("Stats retry delays are invalid");
    }
  }

  subscribe(listener: ShellStatsListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    if (!this.#running) {
      this.#running = true;
      void this.#connectLoop();
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#running = false;
        this.#controller?.abort();
      }
    };
  }

  async #connectLoop(): Promise<void> {
    let attempt = 0;
    while (this.#running) {
      const controller = new AbortController();
      this.#controller = controller;
      try {
        const path =
          this.#recommendationChain === null
            ? `/api/stats/stream?limit=${this.#recommendationLimit}`
            : `/api/stats/stream?chain=${this.#recommendationChain}&limit=${this.#recommendationLimit}`;
        const headers: Record<string, string> = { Accept: "text/event-stream" };
        if (this.#recommendationChain !== null && this.#state.recommendations.cursor !== null) {
          headers["Last-Event-ID"] = this.#state.recommendations.cursor;
        }
        const response = await this.#fetcher(path, {
          credentials: "include",
          headers,
          signal: controller.signal,
        });
        if (!response.ok || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
          if (response.status === 503 && this.#recommendationChain !== null) {
            this.#state = {
              ...this.#state,
              connected: false,
              recommendations: { ...this.#state.recommendations, status: "unavailable" },
            };
            this.#emit();
          }
          throw new Error("Stats stream response is invalid");
        }
        await this.#consume(response, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || !this.#running) break;
        if (!(error instanceof Error)) break;
      }
      if (!this.#running) break;
      if (this.#state.connected) {
        this.#state = markShellStatsDisconnected(this.#state, this.#now());
        this.#emit();
      }
      const delay = Math.min(this.#maxRetryMs, this.#initialRetryMs * 2 ** attempt);
      attempt += 1;
      await this.#sleep(delay, controller.signal);
    }
    this.#controller = null;
  }

  async #consume(response: Response, signal: AbortSignal): Promise<void> {
    if (!response.body) throw new Error("Stats stream body is missing");
    const reader = response.body.getReader();
    const cancel = () => void reader.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.#acceptFrame(frame);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }

  #acceptFrame(frame: string): void {
    const lines = frame.split("\n");
    const eventLines = lines.filter((line) => line.startsWith("event:"));
    const idLines = lines.filter((line) => line.startsWith("id:"));
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    if (eventLines.length !== 1 || idLines.length > 1 || dataLines.length === 0) return;
    const eventName = eventLines[0]!.slice(6).trim();
    const identifier = idLines[0]?.slice(3).trim() ?? null;
    const data = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      return;
    }
    const event = parseShellStatsEvent(decoded);
    if (!event) return;
    if (event.type !== eventName) return;
    if (event.type === "rec_pools_snapshot" && identifier !== event.cursor) return;
    if (
      event.type !== "rec_pools_snapshot" &&
      identifier !== null &&
      event.sequence !== null &&
      identifier !== String(event.sequence)
    ) {
      return;
    }
    const next = reduceShellStatsEvent(this.#state, event);
    if (next === this.#state) return;
    this.#state = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#state);
  }
}
