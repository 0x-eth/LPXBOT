import { createHash } from "node:crypto";

import type {
  MarketPoolRow,
  MarketPoolSnapshot,
  RecommendedPoolRow,
  RecommendedPoolsSnapshotEvent,
} from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

import type { MarketPoolsProvider } from "./market-pools.js";

const evmAddressPattern = /^0x[0-9a-f]{40}$/u;
const poolIdPattern = /^0x[0-9a-f]{64}$/u;
const selectionHashPattern = /^sha256:[0-9a-f]{64}$/u;

export interface RecommendedPoolsScheduler {
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  now(): Date;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
}

export interface RecommendedPoolsEventStreamOptions {
  chain: "bsc";
  heartbeatMilliseconds?: number;
  limit: number;
  pollMilliseconds?: number;
  provider: MarketPoolsProvider;
  scheduler?: RecommendedPoolsScheduler;
  signal: AbortSignal;
}

export type RecommendedPoolsStreamEvent =
  | RecommendedPoolsSnapshotEvent
  | { observedAt: string; sequence: null; type: "heartbeat" };

const systemScheduler: RecommendedPoolsScheduler = {
  clearInterval: (handle) => clearInterval(handle),
  now: () => new Date(),
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
};

class AsyncEventQueue<T> {
  readonly #pending: Array<{
    reject(error: unknown): void;
    resolve(result: IteratorResult<T>): void;
  }> = [];
  readonly #values: T[] = [];
  #closed = false;
  #error: unknown = null;

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const { resolve } of this.#pending.splice(0)) resolve({ done: true, value: undefined });
  }

  fail(error: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#error = error;
    for (const { reject } of this.#pending.splice(0)) reject(error);
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.#error !== null) return Promise.reject(this.#error);
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.#pending.push({ reject, resolve }));
  }

  push(value: T): void {
    if (this.#closed) return;
    const pending = this.#pending.shift();
    if (pending) pending.resolve({ done: false, value });
    else this.#values.push(value);
  }
}

function normalizedIdentity(row: MarketPoolRow): string | null {
  if (
    row.chainId !== 56 ||
    !row.token0Address ||
    !evmAddressPattern.test(row.token0Address) ||
    !row.token1Address ||
    !evmAddressPattern.test(row.token1Address)
  ) {
    return null;
  }

  if (row.protocol === "pcsv3" || row.protocol === "univ3") {
    if (!row.poolAddress || !evmAddressPattern.test(row.poolAddress) || row.poolId !== null) {
      return null;
    }
    return row.poolAddress;
  }
  if (!row.poolId || !poolIdPattern.test(row.poolId) || row.poolAddress !== null) return null;
  return row.poolId;
}

function candidate(row: MarketPoolRow, index: number) {
  const identity = normalizedIdentity(row);
  if (!identity || row.poolKey !== `56:${identity}` || row.feesUsd === null) return null;

  let fees: Decimal;
  try {
    fees = new Decimal(row.feesUsd);
  } catch {
    return null;
  }
  if (!fees.isFinite() || !fees.gt(0)) return null;
  return { fees, index, row };
}

export function recommendationSelectionHash(rows: readonly RecommendedPoolRow[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`;
}

function validNow(scheduler: RecommendedPoolsScheduler): Date {
  const now = scheduler.now();
  if (!Number.isFinite(now.getTime())) throw new RangeError("RECOMMENDATION_CLOCK_INVALID");
  return now;
}

function cursorPart(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeCursorPart(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded && cursorPart(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
}

export function recommendedPoolsCursor(input: {
  chain: "bsc";
  limit: number;
  selectionHash: string;
  sourceVersion: string;
  sourceWindowEnd: string;
}): string {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 20 ||
    input.sourceVersion.length === 0 ||
    !Number.isFinite(Date.parse(input.sourceWindowEnd)) ||
    !selectionHashPattern.test(input.selectionHash)
  ) {
    throw new RangeError("RECOMMENDATION_CURSOR_INPUT_INVALID");
  }
  return [
    "rec-pools",
    "v1",
    input.chain,
    String(input.limit),
    cursorPart(input.sourceVersion),
    cursorPart(input.sourceWindowEnd),
    input.selectionHash.slice("sha256:".length),
  ].join(":");
}

export function parseRecommendedPoolsCursor(
  cursor: string,
  filter: { chain: "bsc"; limit: number },
): { selectionHash: string; sourceVersion: string; sourceWindowEnd: string } | null {
  const [prefix, version, chain, limit, encodedVersion, encodedWindowEnd, hash, ...extra] =
    cursor.split(":");
  if (
    prefix !== "rec-pools" ||
    version !== "v1" ||
    chain !== filter.chain ||
    limit !== String(filter.limit) ||
    !encodedVersion ||
    !encodedWindowEnd ||
    !hash ||
    extra.length > 0
  ) {
    return null;
  }
  const sourceVersion = decodeCursorPart(encodedVersion);
  const sourceWindowEnd = decodeCursorPart(encodedWindowEnd);
  const selectionHash = `sha256:${hash}`;
  if (
    !sourceVersion ||
    !sourceWindowEnd ||
    !Number.isFinite(Date.parse(sourceWindowEnd)) ||
    !selectionHashPattern.test(selectionHash)
  ) {
    return null;
  }
  return { selectionHash, sourceVersion, sourceWindowEnd };
}

function snapshotEvent(
  snapshot: MarketPoolSnapshot,
  chain: "bsc",
  limit: number,
  scheduler: RecommendedPoolsScheduler,
): RecommendedPoolsSnapshotEvent {
  const pools = selectRecommendedPools(snapshot, limit);
  const selectionHash = recommendationSelectionHash(pools);
  return {
    cursor: recommendedPoolsCursor({
      chain,
      limit,
      selectionHash,
      sourceVersion: snapshot.version,
      sourceWindowEnd: snapshot.windowEnd,
    }),
    observedAt: validNow(scheduler).toISOString(),
    pools,
    selectionHash,
    sourceVersion: snapshot.version,
    sourceWindow: 5,
    sourceWindowEnd: snapshot.windowEnd,
    type: "rec_pools_snapshot",
  };
}

export async function* createRecommendedPoolsEventStream(
  options: RecommendedPoolsEventStreamOptions,
): AsyncIterable<RecommendedPoolsStreamEvent> {
  const scheduler = options.scheduler ?? systemScheduler;
  const pollMilliseconds = options.pollMilliseconds ?? 5_000;
  const heartbeatMilliseconds = options.heartbeatMilliseconds ?? 25_000;
  if (
    !Number.isSafeInteger(pollMilliseconds) ||
    pollMilliseconds < 1 ||
    !Number.isSafeInteger(heartbeatMilliseconds) ||
    heartbeatMilliseconds < 1
  ) {
    throw new RangeError("RECOMMENDATION_INTERVAL_INVALID");
  }
  if (options.signal.aborted) return;

  const read = async () =>
    snapshotEvent(
      await options.provider.getTopFees({
        chainId: 56,
        minutes: 5,
        protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
        signal: options.signal,
      }),
      options.chain,
      options.limit,
      scheduler,
    );
  const initial = await read();
  let selectionHash = initial.selectionHash;
  yield initial;
  if (options.signal.aborted) return;

  const queue = new AsyncEventQueue<RecommendedPoolsStreamEvent>();
  let checking = false;
  const check = async () => {
    if (checking || options.signal.aborted) return;
    checking = true;
    try {
      const event = await read();
      if (event.selectionHash !== selectionHash) {
        selectionHash = event.selectionHash;
        queue.push(event);
      }
    } catch (error) {
      if (!options.signal.aborted) queue.fail(error);
    } finally {
      checking = false;
    }
  };
  const pollTimer = scheduler.setInterval(() => void check(), pollMilliseconds);
  const heartbeatTimer = scheduler.setInterval(
    () =>
      queue.push({
        observedAt: validNow(scheduler).toISOString(),
        sequence: null,
        type: "heartbeat",
      }),
    heartbeatMilliseconds,
  );
  const abort = () => {
    scheduler.clearInterval(pollTimer);
    scheduler.clearInterval(heartbeatTimer);
    queue.close();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    while (!options.signal.aborted) {
      const event = await queue.next();
      if (event.done) break;
      yield event.value;
    }
  } finally {
    options.signal.removeEventListener("abort", abort);
    abort();
  }
}

function toWireRow(row: MarketPoolRow): RecommendedPoolRow {
  return {
    chainId: 56,
    feePips: row.feePips,
    feesUsd: row.feesUsd!,
    poolAddress: row.poolAddress,
    poolId: row.poolId,
    poolKey: row.poolKey,
    protocol: row.protocol,
    token0Address: row.token0Address!,
    token0Symbol: row.token0Symbol,
    token1Address: row.token1Address!,
    token1Symbol: row.token1Symbol,
  };
}

export function selectRecommendedPools(
  snapshot: MarketPoolSnapshot,
  limit: number,
): RecommendedPoolRow[] {
  if (snapshot.chainId !== 56 || snapshot.minutes !== 5) {
    throw new RangeError("RECOMMENDATION_SOURCE_INVALID");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("RECOMMENDATION_LIMIT_INVALID");
  }

  const ordered = snapshot.rows
    .map(candidate)
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => {
      const feeOrder = right.fees.comparedTo(left.fees);
      return feeOrder || left.row.poolKey.localeCompare(right.row.poolKey) || left.index - right.index;
    });
  const seen = new Set<string>();
  const selected: RecommendedPoolRow[] = [];
  for (const { row } of ordered) {
    if (seen.has(row.poolKey)) continue;
    seen.add(row.poolKey);
    selected.push(toWireRow(row));
    if (selected.length === limit) break;
  }
  return selected;
}
