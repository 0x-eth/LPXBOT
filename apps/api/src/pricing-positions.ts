import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  EvmAddress,
  ImportPricingPositionRequest,
  PricingPosition,
  PricingPositionCostBasis,
  PricingPositionCostBasisInput,
  PricingPositionObservation,
  PricingPositionPage,
  PricingPositionStatus,
  PricingPositionStreamEvent,
  WalletPosition,
} from "@lpbot/api-contract";
import { getBscPositionReadDeployment } from "@lpbot/chain-registry";

const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const decimalValuePattern = /^(?:0|[1-9][0-9]{0,37})(?:\.[0-9]{1,18})?$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const sourcePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const importKeys = [
  "chainId",
  "costBasis",
  "platformId",
  "snapshotDigest",
  "tokenId",
  "walletId",
] as const;
const costBasisKeys = [
  "amount0BaseUnit",
  "amount1BaseUnit",
  "priceObservedAt",
  "priceSource",
  "usdValueDecimal",
] as const;

export type PricingPositionErrorCode =
  | "PRICING_POSITION_INVALID"
  | "PRICING_POSITION_NOT_FOUND"
  | "PRICING_POSITION_REVISION_CONFLICT"
  | "PRICING_SNAPSHOT_NOT_FOUND"
  | "PRICING_SNAPSHOT_QUARANTINED"
  | "PRICING_SNAPSHOT_STALE";

export class PricingPositionError extends Error {
  readonly code: PricingPositionErrorCode;

  constructor(code: PricingPositionErrorCode) {
    super(code);
    this.name = "PricingPositionError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function parseImportPricingPositionRequest(value: unknown): ImportPricingPositionRequest {
  const input = record(value);
  const costBasis = input ? record(input.costBasis) : null;
  if (!input || !exactKeys(input, importKeys) || !costBasis || !exactKeys(costBasis, costBasisKeys)) {
    throw new PricingPositionError("PRICING_POSITION_INVALID");
  }
  const priceFields = [
    costBasis.usdValueDecimal,
    costBasis.priceObservedAt,
    costBasis.priceSource,
  ];
  const priceMissing = priceFields.every((entry) => entry === null);
  const priceComplete = priceFields.every((entry) => typeof entry === "string");
  if (
    input.chainId !== 56 ||
    !([1, 2, 4, 5] as const).includes(input.platformId as 1 | 2 | 4 | 5) ||
    typeof input.walletId !== "string" ||
    !uuidPattern.test(input.walletId) ||
    typeof input.snapshotDigest !== "string" ||
    !hashPattern.test(input.snapshotDigest) ||
    typeof input.tokenId !== "string" ||
    !decimalPattern.test(input.tokenId) ||
    typeof costBasis.amount0BaseUnit !== "string" ||
    !decimalPattern.test(costBasis.amount0BaseUnit) ||
    typeof costBasis.amount1BaseUnit !== "string" ||
    !decimalPattern.test(costBasis.amount1BaseUnit) ||
    (!priceMissing && !priceComplete) ||
    (priceComplete &&
      (!decimalValuePattern.test(costBasis.usdValueDecimal as string) ||
        !sourcePattern.test(costBasis.priceSource as string) ||
        !Number.isFinite(Date.parse(costBasis.priceObservedAt as string))))
  ) {
    throw new PricingPositionError("PRICING_POSITION_INVALID");
  }
  return {
    chainId: 56,
    costBasis: {
      amount0BaseUnit: costBasis.amount0BaseUnit,
      amount1BaseUnit: costBasis.amount1BaseUnit,
      priceObservedAt: costBasis.priceObservedAt as string | null,
      priceSource: costBasis.priceSource as string | null,
      usdValueDecimal: costBasis.usdValueDecimal as string | null,
    },
    platformId: input.platformId as 1 | 2 | 4 | 5,
    snapshotDigest: input.snapshotDigest as `0x${string}`,
    tokenId: input.tokenId,
    walletId: input.walletId.toLowerCase(),
  };
}

export function parsePricingPositionId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
  }
  return value.toLowerCase();
}

export function parseMarkPricingPositionWithdrawnRequest(value: unknown): {
  expectedRevision: number;
} {
  const input = record(value);
  if (
    !input ||
    !exactKeys(input, ["expectedRevision"]) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 1
  ) {
    throw new PricingPositionError("PRICING_POSITION_INVALID");
  }
  return { expectedRevision: Number(input.expectedRevision) };
}

export interface PricingPositionSourceSnapshot {
  pageSnapshotDigest: `0x${string}`;
  position: WalletPosition;
  state: "quarantined" | "stale" | "verified";
  userId: string;
  walletAddress: EvmAddress;
  walletId: string;
}

export interface PricingPositionSource {
  findImportSnapshot(input: {
    chainId: 56;
    platformId: ImportPricingPositionRequest["platformId"];
    snapshotDigest: `0x${string}`;
    tokenId: string;
    userId: string;
    walletId: string;
  }): Promise<PricingPositionSourceSnapshot | null>;
  findLatestSnapshot(input: {
    chainId: 56;
    platformId: ImportPricingPositionRequest["platformId"];
    pricingId: string;
    tokenId: string;
    userId: string;
    walletId: string;
  }): Promise<PricingPositionSourceSnapshot | null>;
}

export interface PricingPositionOutboxEvent {
  createdAt: string;
  epoch: string;
  eventId: string;
  eventType: "diff" | "tombstone";
  payload: Readonly<PricingPosition>;
  pricingId: string;
  revision: number;
  sequence: string;
  tenantId: string;
  userId: string;
}

interface PricingPositionScope {
  tenantId: string;
  userId: string;
}

interface PricingPositionStoreImportInput extends PricingPositionScope {
  costBasis: PricingPositionCostBasis;
  now: Date;
  observation: PricingPositionObservation;
  position: WalletPosition;
  walletAddress: EvmAddress;
  walletId: string;
}

interface PricingPositionStoreTransitionInput extends PricingPositionScope {
  expectedRevision: number;
  now: Date;
  observation: PricingPositionObservation;
  pricingId: string;
  status: Exclude<PricingPositionStatus, "active">;
}

export interface PricingPositionStore {
  get(input: PricingPositionScope & { pricingId: string }): Promise<Readonly<PricingPosition> | null>;
  importPosition(input: PricingPositionStoreImportInput): Promise<Readonly<PricingPosition>>;
  list(input: PricingPositionScope): Promise<Readonly<PricingPositionPage>>;
  transition(input: PricingPositionStoreTransitionInput): Promise<Readonly<PricingPosition>>;
}

export interface PricingPositionStreamSnapshot {
  epoch: string;
  items: Readonly<PricingPosition[]>;
  latestSequence: string;
  oldestSequence: string;
}

export interface PricingPositionEventStore {
  readOutbox(input: PricingPositionScope & {
    afterSequence: string;
    limit: number;
  }): Promise<Readonly<PricingPositionOutboxEvent[]>>;
  readStreamSnapshot(input: PricingPositionScope): Promise<PricingPositionStreamSnapshot>;
}

interface StoredPricingPosition {
  position: PricingPosition;
  tenantId: string;
  tombstones: Array<{ createdAt: string; revision: number; status: "withdrawn" }>;
  userId: string;
}

function freezePosition(value: PricingPosition): Readonly<PricingPosition> {
  Object.freeze(value.costBasis);
  for (const observation of value.observations) Object.freeze(observation);
  Object.freeze(value.observations);
  Object.freeze(value.pool);
  return Object.freeze(value);
}

function publicClone(value: PricingPosition): Readonly<PricingPosition> {
  return freezePosition(structuredClone(value));
}

function scopeKey(input: PricingPositionScope): string {
  return `${input.tenantId}\u0000${input.userId}`;
}

function identityKey(input: PricingPositionScope & {
  chainId: number;
  platformId: number;
  positionManager: string;
  tokenId: string;
  walletId: string;
}): string {
  return `${scopeKey(input)}\u0000${input.walletId}\u0000${input.chainId}\u0000${input.platformId}\u0000${input.positionManager}\u0000${input.tokenId}`;
}

export class MemoryPricingPositionStore
  implements PricingPositionStore, PricingPositionEventStore
{
  readonly #byIdentity = new Map<string, string>();
  readonly #byPricingId = new Map<string, StoredPricingPosition>();
  readonly #epoch: string;
  readonly #id: () => string;
  readonly #outbox: PricingPositionOutboxEvent[] = [];
  readonly #retentionFloor = new Map<string, bigint>();
  readonly #sequences = new Map<string, bigint>();

  constructor(options: { epoch?: string; id?: () => string } = {}) {
    this.#epoch = options.epoch ?? randomUUID();
    this.#id = options.id ?? randomUUID;
    if (!uuidPattern.test(this.#epoch)) throw new RangeError("PRICING_EPOCH_INVALID");
  }

  async get(
    input: PricingPositionScope & { pricingId: string },
  ): Promise<Readonly<PricingPosition> | null> {
    const stored = this.#byPricingId.get(input.pricingId);
    return stored && stored.tenantId === input.tenantId && stored.userId === input.userId
      ? publicClone(stored.position)
      : null;
  }

  async importPosition(input: PricingPositionStoreImportInput): Promise<Readonly<PricingPosition>> {
    const key = identityKey({
      ...input,
      chainId: input.position.chainId,
      platformId: input.position.platformId,
      positionManager: input.position.snapshot.positionManager,
      tokenId: input.position.tokenId,
    });
    const existingId = this.#byIdentity.get(key);
    if (existingId) {
      const stored = this.#byPricingId.get(existingId)!;
      if (
        stored.position.observations.some(
          ({ snapshotDigest }) => snapshotDigest === input.observation.snapshotDigest,
        )
      ) {
        return publicClone(stored.position);
      }
      stored.position.observations.push(structuredClone(input.observation));
      stored.position.revision += 1;
      stored.position.updatedAt = input.now.toISOString();
      this.#appendOutbox(stored, "diff", input.now);
      return publicClone(stored.position);
    }

    const pricingId = this.#nextId();
    const createdAt = input.now.toISOString();
    const position: PricingPosition = {
      chainId: 56,
      costBasis: structuredClone(input.costBasis),
      importedAt: createdAt,
      observations: [structuredClone(input.observation)],
      platformId: input.position.platformId,
      pool: {
        poolAddress: input.position.pool.poolAddress,
        poolId: input.position.pool.poolId,
        token0: input.position.pool.token0,
        token1: input.position.pool.token1,
      },
      positionManager: input.position.snapshot.positionManager,
      pricingId,
      revision: 1,
      status: "active",
      tokenId: input.position.tokenId,
      updatedAt: createdAt,
      walletAddress: input.walletAddress,
      walletId: input.walletId,
    };
    const stored: StoredPricingPosition = {
      position,
      tenantId: input.tenantId,
      tombstones: [],
      userId: input.userId,
    };
    this.#byIdentity.set(key, pricingId);
    this.#byPricingId.set(pricingId, stored);
    this.#appendOutbox(stored, "diff", input.now);
    return publicClone(position);
  }

  async list(input: PricingPositionScope): Promise<Readonly<PricingPositionPage>> {
    const items = [...this.#byPricingId.values()]
      .filter(({ tenantId, userId }) => tenantId === input.tenantId && userId === input.userId)
      .map(({ position }) => publicClone(position))
      .sort((left, right) =>
        left.importedAt === right.importedAt
          ? left.pricingId.localeCompare(right.pricingId)
          : left.importedAt.localeCompare(right.importedAt),
      );
    return Object.freeze({ items: Object.freeze(items) as unknown as PricingPosition[] });
  }

  async transition(
    input: PricingPositionStoreTransitionInput,
  ): Promise<Readonly<PricingPosition>> {
    const stored = this.#byPricingId.get(input.pricingId);
    if (!stored || stored.tenantId !== input.tenantId || stored.userId !== input.userId) {
      throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
    }
    if (stored.position.revision !== input.expectedRevision) {
      throw new PricingPositionError("PRICING_POSITION_REVISION_CONFLICT");
    }
    const hasObservation = stored.position.observations.some(
      ({ snapshotDigest }) => snapshotDigest === input.observation.snapshotDigest,
    );
    if (stored.position.status === input.status && hasObservation) {
      return publicClone(stored.position);
    }
    if (!hasObservation) stored.position.observations.push(structuredClone(input.observation));
    stored.position.revision += 1;
    stored.position.status = input.status;
    stored.position.updatedAt = input.now.toISOString();
    if (input.status === "withdrawn") {
      stored.tombstones.push({
        createdAt: input.now.toISOString(),
        revision: stored.position.revision,
        status: "withdrawn",
      });
    }
    this.#appendOutbox(stored, input.status === "withdrawn" ? "tombstone" : "diff", input.now);
    return publicClone(stored.position);
  }

  outboxFor(input: PricingPositionScope): Readonly<PricingPositionOutboxEvent[]> {
    return Object.freeze(
      this.#outbox
        .filter(({ tenantId, userId }) => tenantId === input.tenantId && userId === input.userId)
        .map((event) => Object.freeze({ ...event, payload: publicClone(event.payload) })),
    );
  }

  async readOutbox(
    input: PricingPositionScope & { afterSequence: string; limit: number },
  ): Promise<Readonly<PricingPositionOutboxEvent[]>> {
    if (
      !decimalPattern.test(input.afterSequence) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      throw new RangeError("PRICING_OUTBOX_QUERY_INVALID");
    }
    const after = BigInt(input.afterSequence);
    return Object.freeze(
      this.#outbox
        .filter(
          ({ sequence, tenantId, userId }) =>
            tenantId === input.tenantId &&
            userId === input.userId &&
            BigInt(sequence) > after,
        )
        .sort((left, right) => Number(BigInt(left.sequence) - BigInt(right.sequence)))
        .slice(0, input.limit)
        .map((event) => Object.freeze({ ...event, payload: publicClone(event.payload) })),
    );
  }

  async readStreamSnapshot(input: PricingPositionScope): Promise<PricingPositionStreamSnapshot> {
    const key = scopeKey(input);
    const page = await this.list(input);
    return Object.freeze({
      epoch: this.#epoch,
      items: page.items,
      latestSequence: (this.#sequences.get(key) ?? 0n).toString(),
      oldestSequence: (this.#retentionFloor.get(key) ?? 1n).toString(),
    });
  }

  pruneOutboxBefore(input: PricingPositionScope & { sequence: string }): void {
    if (!decimalPattern.test(input.sequence) || BigInt(input.sequence) < 1n) {
      throw new RangeError("PRICING_OUTBOX_RETENTION_INVALID");
    }
    const floor = BigInt(input.sequence);
    const key = scopeKey(input);
    this.#retentionFloor.set(key, floor);
    for (let index = this.#outbox.length - 1; index >= 0; index -= 1) {
      const event = this.#outbox[index]!;
      if (
        event.tenantId === input.tenantId &&
        event.userId === input.userId &&
        BigInt(event.sequence) < floor
      ) {
        this.#outbox.splice(index, 1);
      }
    }
  }

  #appendOutbox(
    stored: StoredPricingPosition,
    eventType: PricingPositionOutboxEvent["eventType"],
    now: Date,
  ): void {
    const key = scopeKey(stored);
    const sequence = (this.#sequences.get(key) ?? 0n) + 1n;
    this.#sequences.set(key, sequence);
    this.#outbox.push({
      createdAt: now.toISOString(),
      epoch: this.#epoch,
      eventId: this.#nextId(),
      eventType,
      payload: publicClone(stored.position),
      pricingId: stored.position.pricingId,
      revision: stored.position.revision,
      sequence: sequence.toString(),
      tenantId: stored.tenantId,
      userId: stored.userId,
    });
  }

  #nextId(): string {
    const value = this.#id();
    if (!uuidPattern.test(value)) throw new RangeError("PRICING_ID_INVALID");
    return value.toLowerCase();
  }
}

interface PricingCursorPayload {
  epoch: string;
  sequence: string;
  tenantId: string;
  userId: string;
  version: 1;
}

export class PricingPositionCursorError extends Error {
  readonly code: "PRICING_CURSOR_EXPIRED" | "PRICING_CURSOR_INVALID";

  constructor(code: "PRICING_CURSOR_EXPIRED" | "PRICING_CURSOR_INVALID") {
    super(code);
    this.name = "PricingPositionCursorError";
    this.code = code;
  }
}

export interface PricingPositionStreamOpen {
  afterSequence: string;
  epoch: string;
  initialEvent: PricingPositionStreamEvent | null;
}

export interface PricingPositionStreamProvider {
  open(input: PricingPositionScope & {
    lastEventId: string | null;
  }): Promise<PricingPositionStreamOpen>;
  subscribe(input: PricingPositionScope &
    Pick<PricingPositionStreamOpen, "afterSequence" | "epoch"> & {
      signal: AbortSignal;
    }): AsyncIterable<PricingPositionStreamEvent>;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
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

export class PricingPositionStreamService implements PricingPositionStreamProvider {
  readonly #backfillLimit: number;
  readonly #cursorSecret: Uint8Array;
  readonly #finite: boolean;
  readonly #heartbeatMilliseconds: number;
  readonly #now: () => Date;
  readonly #pollMilliseconds: number;
  readonly #store: PricingPositionEventStore;

  constructor(options: {
    backfillLimit?: number;
    cursorSecret: string | Uint8Array;
    finite?: boolean;
    heartbeatMilliseconds?: number;
    now?: () => Date;
    pollMilliseconds?: number;
    store: PricingPositionEventStore;
  }) {
    this.#backfillLimit = options.backfillLimit ?? 200;
    this.#cursorSecret =
      typeof options.cursorSecret === "string"
        ? new TextEncoder().encode(options.cursorSecret)
        : new Uint8Array(options.cursorSecret);
    this.#finite = options.finite ?? false;
    this.#heartbeatMilliseconds = options.heartbeatMilliseconds ?? 15_000;
    this.#now = options.now ?? (() => new Date());
    this.#pollMilliseconds = options.pollMilliseconds ?? 1_000;
    this.#store = options.store;
    if (
      !Number.isSafeInteger(this.#backfillLimit) ||
      this.#backfillLimit < 1 ||
      this.#backfillLimit > 1_000 ||
      this.#cursorSecret.byteLength < 32 ||
      !Number.isSafeInteger(this.#heartbeatMilliseconds) ||
      this.#heartbeatMilliseconds < 1 ||
      !Number.isSafeInteger(this.#pollMilliseconds) ||
      this.#pollMilliseconds < 1 ||
      this.#pollMilliseconds > this.#heartbeatMilliseconds
    ) {
      throw new RangeError("PRICING_STREAM_CONFIG_INVALID");
    }
  }

  async open(
    input: PricingPositionScope & { lastEventId: string | null },
  ): Promise<PricingPositionStreamOpen> {
    const snapshot = await this.#store.readStreamSnapshot(input);
    if (input.lastEventId === null) {
      const cursor = this.#encodeCursor({
        epoch: snapshot.epoch,
        sequence: snapshot.latestSequence,
        tenantId: input.tenantId,
        userId: input.userId,
        version: 1,
      });
      return Object.freeze({
        afterSequence: snapshot.latestSequence,
        epoch: snapshot.epoch,
        initialEvent: Object.freeze({
          cursor,
          epoch: snapshot.epoch,
          items: [...snapshot.items],
          sequence: snapshot.latestSequence,
          type: "snapshot" as const,
        }),
      });
    }
    const cursor = this.#decodeCursor(input.lastEventId);
    if (cursor.tenantId !== input.tenantId || cursor.userId !== input.userId) {
      throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    }
    if (cursor.epoch !== snapshot.epoch) {
      throw new PricingPositionCursorError("PRICING_CURSOR_EXPIRED");
    }
    const sequence = BigInt(cursor.sequence);
    const latest = BigInt(snapshot.latestSequence);
    const oldest = BigInt(snapshot.oldestSequence);
    if (sequence > latest) throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    if (sequence < oldest - 1n) {
      throw new PricingPositionCursorError("PRICING_CURSOR_EXPIRED");
    }
    return Object.freeze({
      afterSequence: cursor.sequence,
      epoch: cursor.epoch,
      initialEvent: null,
    });
  }

  async *subscribe(
    input: PricingPositionScope &
      Pick<PricingPositionStreamOpen, "afterSequence" | "epoch"> & { signal: AbortSignal },
  ): AsyncIterable<PricingPositionStreamEvent> {
    let emitted = 0;
    let sequence = input.afterSequence;
    let lastHeartbeat = this.#now().getTime();
    while (!input.signal.aborted) {
      const snapshot = await this.#store.readStreamSnapshot(input);
      if (snapshot.epoch !== input.epoch) {
        throw new PricingPositionCursorError("PRICING_CURSOR_EXPIRED");
      }
      const remaining = this.#backfillLimit - emitted;
      if (remaining <= 0) return;
      const events = await this.#store.readOutbox({
        afterSequence: sequence,
        limit: remaining,
        tenantId: input.tenantId,
        userId: input.userId,
      });
      if (events.length > 0) {
        for (const event of events) {
          if (BigInt(event.sequence) <= BigInt(sequence)) continue;
          sequence = event.sequence;
          emitted += 1;
          const cursor = this.#encodeCursor({
            epoch: event.epoch,
            sequence,
            tenantId: input.tenantId,
            userId: input.userId,
            version: 1,
          });
          if (event.eventType === "tombstone") {
            yield Object.freeze({
              cursor,
              epoch: event.epoch,
              pricingId: event.pricingId,
              revision: event.revision,
              sequence,
              status: "withdrawn" as const,
              type: "tombstone" as const,
            });
          } else {
            yield Object.freeze({
              cursor,
              epoch: event.epoch,
              position: publicClone(event.payload),
              sequence,
              type: "diff" as const,
            });
          }
        }
        if (emitted >= this.#backfillLimit) return;
        continue;
      }
      const currentTime = this.#now().getTime();
      if (this.#finite || currentTime - lastHeartbeat >= this.#heartbeatMilliseconds) {
        lastHeartbeat = currentTime;
        yield Object.freeze({
          cursor: this.#encodeCursor({
            epoch: input.epoch,
            sequence,
            tenantId: input.tenantId,
            userId: input.userId,
            version: 1,
          }),
          epoch: input.epoch,
          observedAt: new Date(currentTime).toISOString(),
          sequence,
          type: "heartbeat" as const,
        });
        if (this.#finite) return;
      }
      await abortableDelay(this.#pollMilliseconds, input.signal);
    }
  }

  #decodeCursor(value: string): PricingCursorPayload {
    if (value.length > 1_024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) {
      throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    }
    const [encoded, signature] = value.split(".");
    const expected = createHmac("sha256", this.#cursorSecret).update(encoded!).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature!, "base64url");
    } catch {
      throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    }
    try {
      const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8")) as unknown;
      const valueRecord = record(payload);
      if (
        !valueRecord ||
        !exactKeys(valueRecord, ["epoch", "sequence", "tenantId", "userId", "version"]) ||
        valueRecord.version !== 1 ||
        typeof valueRecord.epoch !== "string" ||
        !uuidPattern.test(valueRecord.epoch) ||
        typeof valueRecord.sequence !== "string" ||
        !decimalPattern.test(valueRecord.sequence) ||
        typeof valueRecord.tenantId !== "string" ||
        typeof valueRecord.userId !== "string" ||
        !uuidPattern.test(valueRecord.userId)
      ) {
        throw new Error("invalid");
      }
      return valueRecord as unknown as PricingCursorPayload;
    } catch {
      throw new PricingPositionCursorError("PRICING_CURSOR_INVALID");
    }
  }

  #encodeCursor(payload: PricingCursorPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#cursorSecret)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }
}

function normalizeCostBasis(
  input: PricingPositionCostBasisInput,
  now: Date,
  maxAgeMs: number,
): PricingPositionCostBasis {
  if (
    !input ||
    !decimalPattern.test(input.amount0BaseUnit) ||
    !decimalPattern.test(input.amount1BaseUnit)
  ) {
    throw new PricingPositionError("PRICING_POSITION_INVALID");
  }
  const priceFields = [input.usdValueDecimal, input.priceObservedAt, input.priceSource];
  const missing = priceFields.every((value) => value === null);
  const complete = priceFields.every((value) => typeof value === "string");
  if (!missing && !complete) throw new PricingPositionError("PRICING_POSITION_INVALID");
  if (missing) {
    return Object.freeze({ ...input, priceStatus: "missing" });
  }
  if (
    !decimalValuePattern.test(input.usdValueDecimal!) ||
    !sourcePattern.test(input.priceSource!) ||
    !Number.isFinite(Date.parse(input.priceObservedAt!))
  ) {
    throw new PricingPositionError("PRICING_POSITION_INVALID");
  }
  const age = now.getTime() - Date.parse(input.priceObservedAt!);
  if (age < 0) throw new PricingPositionError("PRICING_POSITION_INVALID");
  const stale = age > maxAgeMs;
  return Object.freeze({
    ...input,
    priceStatus: stale ? "stale" : "current",
    usdValueDecimal: stale ? null : input.usdValueDecimal,
  });
}

function observation(
  snapshot: PricingPositionSourceSnapshot,
  now: Date,
  id: string,
): PricingPositionObservation {
  const { position } = snapshot;
  return Object.freeze({
    blockHash: position.snapshot.blockHash,
    blockNumber: position.snapshot.blockNumber,
    liquidityAmount0BaseUnit: position.liquidity.amount0BaseUnit,
    liquidityAmount1BaseUnit: position.liquidity.amount1BaseUnit,
    liquidityRaw: position.liquidity.raw,
    observationId: id,
    observedAt: position.snapshot.blockTimestamp,
    observedFee0BaseUnit: position.fees.owed0BaseUnit,
    observedFee1BaseUnit: position.fees.owed1BaseUnit,
    pageSnapshotDigest: snapshot.pageSnapshotDigest,
    recordedAt: now.toISOString(),
    snapshotDigest: position.snapshot.digest,
  });
}

function validSourceSnapshot(
  snapshot: PricingPositionSourceSnapshot,
  input: {
    pageSnapshotDigest?: string;
    platformId: number;
    tokenId: string;
    userId: string;
    walletId: string;
  },
): boolean {
  const { position } = snapshot;
  const deployment = getBscPositionReadDeployment({
    blockNumber: position.snapshot.blockNumber,
    chainId: position.chainId,
    platformId: position.platformId,
    registryVersion: position.snapshot.registryVersion,
  });
  return (
    snapshot.userId === input.userId &&
    snapshot.walletId === input.walletId &&
    (input.pageSnapshotDigest === undefined ||
      snapshot.pageSnapshotDigest === input.pageSnapshotDigest) &&
    position.chainId === 56 &&
    position.platformId === input.platformId &&
    position.tokenId === input.tokenId &&
    position.owner.toLowerCase() === snapshot.walletAddress.toLowerCase() &&
    position.approval.nftOwner.toLowerCase() === snapshot.walletAddress.toLowerCase() &&
    deployment !== null &&
    deployment.positionManager.address === position.snapshot.positionManager &&
    deployment.positionManager.runtimeCodeHash === position.snapshot.positionManagerCodeHash &&
    hashPattern.test(position.snapshot.digest) &&
    decimalPattern.test(position.liquidity.raw) &&
    decimalPattern.test(position.fees.owed0BaseUnit) &&
    decimalPattern.test(position.fees.owed1BaseUnit)
  );
}

function requireVerifiedSnapshot(
  snapshot: PricingPositionSourceSnapshot | null,
  input: Parameters<typeof validSourceSnapshot>[1],
): PricingPositionSourceSnapshot {
  if (!snapshot) throw new PricingPositionError("PRICING_SNAPSHOT_NOT_FOUND");
  if (snapshot.state === "quarantined") {
    throw new PricingPositionError("PRICING_SNAPSHOT_QUARANTINED");
  }
  if (snapshot.state === "stale") throw new PricingPositionError("PRICING_SNAPSHOT_STALE");
  if (!validSourceSnapshot(snapshot, input)) {
    throw new PricingPositionError("PRICING_SNAPSHOT_QUARANTINED");
  }
  return snapshot;
}

export interface PricingPositionApplication {
  importPosition(input: {
    request: ImportPricingPositionRequest;
    userId: string;
  }): Promise<Readonly<PricingPosition>>;
  list(input: { userId: string }): Promise<Readonly<PricingPositionPage>>;
  markWithdrawn(input: {
    expectedRevision: number;
    pricingId: string;
    userId: string;
  }): Promise<Readonly<PricingPosition>>;
}

export class PricingPositionService implements PricingPositionApplication {
  readonly #id: () => string;
  readonly #now: () => Date;
  readonly #priceMaxAgeMs: number;
  readonly #source: PricingPositionSource;
  readonly #store: PricingPositionStore;
  readonly #tenantId: string;

  constructor(options: {
    id?: () => string;
    now?: () => Date;
    priceMaxAgeMs?: number;
    source: PricingPositionSource;
    store: PricingPositionStore;
    tenantId: string;
  }) {
    this.#id = options.id ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#priceMaxAgeMs = options.priceMaxAgeMs ?? 300_000;
    this.#source = options.source;
    this.#store = options.store;
    this.#tenantId = options.tenantId;
    if (
      this.#tenantId.length < 1 ||
      this.#tenantId.length > 128 ||
      !Number.isSafeInteger(this.#priceMaxAgeMs) ||
      this.#priceMaxAgeMs < 1
    ) {
      throw new RangeError("PRICING_POSITION_SERVICE_CONFIG_INVALID");
    }
  }

  async importPosition(input: {
    request: ImportPricingPositionRequest;
    userId: string;
  }): Promise<Readonly<PricingPosition>> {
    this.#validateRequest(input.request);
    const now = this.#now();
    const costBasis = normalizeCostBasis(input.request.costBasis, now, this.#priceMaxAgeMs);
    const snapshot = requireVerifiedSnapshot(
      await this.#source.findImportSnapshot({
        chainId: 56,
        platformId: input.request.platformId,
        snapshotDigest: input.request.snapshotDigest,
        tokenId: input.request.tokenId,
        userId: input.userId,
        walletId: input.request.walletId,
      }),
      {
        pageSnapshotDigest: input.request.snapshotDigest,
        platformId: input.request.platformId,
        tokenId: input.request.tokenId,
        userId: input.userId,
        walletId: input.request.walletId,
      },
    );
    return this.#store.importPosition({
      costBasis,
      now,
      observation: observation(snapshot, now, this.#nextId()),
      position: snapshot.position,
      tenantId: this.#tenantId,
      userId: input.userId,
      walletAddress: snapshot.walletAddress,
      walletId: input.request.walletId,
    });
  }

  async list(input: { userId: string }): Promise<Readonly<PricingPositionPage>> {
    return this.#store.list({ tenantId: this.#tenantId, userId: input.userId });
  }

  async markWithdrawn(input: {
    expectedRevision: number;
    pricingId: string;
    userId: string;
  }): Promise<Readonly<PricingPosition>> {
    if (
      !uuidPattern.test(input.pricingId) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
    }
    const current = await this.#store.get({
      pricingId: input.pricingId,
      tenantId: this.#tenantId,
      userId: input.userId,
    });
    if (!current) throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
    const snapshot = requireVerifiedSnapshot(
      await this.#source.findLatestSnapshot({
        chainId: 56,
        platformId: current.platformId,
        pricingId: current.pricingId,
        tokenId: current.tokenId,
        userId: input.userId,
        walletId: current.walletId,
      }),
      {
        platformId: current.platformId,
        tokenId: current.tokenId,
        userId: input.userId,
        walletId: current.walletId,
      },
    );
    if (
      snapshot.position.snapshot.positionManager !== current.positionManager ||
      snapshot.walletAddress !== current.walletAddress
    ) {
      throw new PricingPositionError("PRICING_SNAPSHOT_QUARANTINED");
    }
    const now = this.#now();
    return this.#store.transition({
      expectedRevision: input.expectedRevision,
      now,
      observation: observation(snapshot, now, this.#nextId()),
      pricingId: current.pricingId,
      status: BigInt(snapshot.position.liquidity.raw) === 0n ? "withdrawn" : "hidden",
      tenantId: this.#tenantId,
      userId: input.userId,
    });
  }

  #nextId(): string {
    const value = this.#id();
    if (!uuidPattern.test(value)) throw new RangeError("PRICING_OBSERVATION_ID_INVALID");
    return value.toLowerCase();
  }

  #validateRequest(input: ImportPricingPositionRequest): void {
    if (
      input.chainId !== 56 ||
      !([1, 2, 4, 5] as const).includes(input.platformId) ||
      !uuidPattern.test(input.walletId) ||
      !hashPattern.test(input.snapshotDigest) ||
      !decimalPattern.test(input.tokenId)
    ) {
      throw new PricingPositionError("PRICING_POSITION_INVALID");
    }
  }
}
