import type {
  ShellGasStats,
  ShellStats,
  ShellStatsEvent,
  ShellStatsPatch,
  ShellTaskCounts,
} from "@lpbot/api-contract";

export interface ShellStatsState {
  connected: boolean;
  observedAt: string | null;
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
  recommendedPools: string[];
  running: string;
  stopped: string;
}

export interface ApiShellStatsProviderOptions {
  fetcher?: typeof fetch;
  initialRetryMs?: number;
  maxRetryMs?: number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

type ShellStatsListener = (state: ShellStatsState) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parsePools(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    !value.every((pool) => typeof pool === "string" && pool.length >= 1 && pool.length <= 64)
  ) {
    return undefined;
  }
  return value;
}

function parseStats(value: unknown, complete: boolean): ShellStats | ShellStatsPatch | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(["fps", "gas", "online", "pingMs", "recommendedPools", "taskCounts"]);
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
  const recommendedPools = Object.hasOwn(value, "recommendedPools")
    ? parsePools(value.recommendedPools)
    : undefined;
  if (gas === null || taskCounts === null || recommendedPools === undefined) return null;
  return value as unknown as ShellStats | ShellStatsPatch;
}

export function parseShellStatsEvent(value: unknown): ShellStatsEvent | null {
  if (
    !isRecord(value) ||
    !validObservedAt(value.observedAt) ||
    !validSequence(value.sequence) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  if (value.type === "snapshot") {
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
    const stats = parseStats(value.stats, false);
    if (!stats) return null;
    return {
      observedAt: value.observedAt,
      sequence: value.sequence,
      stats: stats as ShellStatsPatch,
      type: value.type,
    };
  }
  if (value.type === "rec_pools_snapshot") {
    const recommendedPools = parsePools(value.recommendedPools);
    if (recommendedPools === undefined) return null;
    return {
      observedAt: value.observedAt,
      recommendedPools,
      sequence: value.sequence,
      type: value.type,
    };
  }
  if (value.type === "heartbeat") {
    return { observedAt: value.observedAt, sequence: value.sequence, type: value.type };
  }
  return null;
}

export function createShellStatsState(): ShellStatsState {
  return { connected: false, observedAt: null, sequence: -1, stats: null };
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
  if (event.sequence < state.sequence) return state;
  if (event.sequence === state.sequence && event.type !== "snapshot") return state;
  if (event.type === "snapshot") {
    return {
      connected: true,
      observedAt: event.observedAt,
      sequence: event.sequence,
      stats: structuredClone(event.stats),
    };
  }
  if (event.type === "heartbeat") {
    return { ...state, connected: true, observedAt: event.observedAt, sequence: event.sequence };
  }
  if (!state.stats) return state;
  if (event.type === "rec_pools_snapshot") {
    return {
      ...state,
      connected: true,
      observedAt: event.observedAt,
      sequence: event.sequence,
      stats: { ...state.stats, recommendedPools: event.recommendedPools },
    };
  }
  return {
    ...state,
    connected: true,
    observedAt: event.observedAt,
    sequence: event.sequence,
    stats: mergeStats(state.stats, event.stats),
  };
}

function valueOrUnavailable(value: number | null, suffix = ""): string {
  return value === null ? "--" : `${value}${suffix}`;
}

export function shellStatsDisplay(state: ShellStatsState): ShellStatsDisplay {
  const stats = state.connected ? state.stats : null;
  return {
    baseGas: valueOrUnavailable(stats?.gas.baseGwei ?? null),
    ethereumGas: valueOrUnavailable(stats?.gas.ethereumGwei ?? null),
    fps: valueOrUnavailable(stats?.fps ?? null),
    online: stats?.online === true ? "在线" : stats?.online === false ? "离线" : "不可用",
    paused: valueOrUnavailable(stats?.taskCounts.paused ?? null),
    ping: valueOrUnavailable(stats?.pingMs ?? null, "ms"),
    recommendedPools: stats?.recommendedPools ?? [],
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
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #controller: AbortController | null = null;
  #running = false;
  #state = createShellStatsState();

  constructor(options: ApiShellStatsProviderOptions = {}) {
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#initialRetryMs = options.initialRetryMs ?? 1_000;
    this.#maxRetryMs = options.maxRetryMs ?? 30_000;
    this.#sleep = options.sleep ?? defaultSleep;
    if (
      !Number.isSafeInteger(this.#initialRetryMs) ||
      !Number.isSafeInteger(this.#maxRetryMs) ||
      this.#initialRetryMs <= 0 ||
      this.#maxRetryMs < this.#initialRetryMs
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
        const response = await this.#fetcher("/api/stats/stream", {
          credentials: "include",
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
          throw new Error("Stats stream response is invalid");
        }
        await this.#consume(response, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || !this.#running) break;
        if (!(error instanceof Error)) break;
      }
      if (!this.#running) break;
      if (this.#state.connected) {
        this.#state = { ...this.#state, connected: false };
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
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(data);
    } catch {
      return;
    }
    const event = parseShellStatsEvent(decoded);
    if (!event) return;
    const next = reduceShellStatsEvent(this.#state, event);
    if (next === this.#state) return;
    this.#state = next;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#state);
  }
}
