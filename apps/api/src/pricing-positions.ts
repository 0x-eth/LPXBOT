import { randomUUID } from "node:crypto";

import type {
  EvmAddress,
  ImportPricingPositionRequest,
  PricingPosition,
  PricingPositionCostBasis,
  PricingPositionCostBasisInput,
  PricingPositionObservation,
  PricingPositionPage,
  PricingPositionStatus,
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

export class MemoryPricingPositionStore implements PricingPositionStore {
  readonly #byIdentity = new Map<string, string>();
  readonly #byPricingId = new Map<string, StoredPricingPosition>();
  readonly #epoch: string;
  readonly #id: () => string;
  readonly #outbox: PricingPositionOutboxEvent[] = [];
  #sequence = 0n;

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

  #appendOutbox(
    stored: StoredPricingPosition,
    eventType: PricingPositionOutboxEvent["eventType"],
    now: Date,
  ): void {
    this.#sequence += 1n;
    this.#outbox.push({
      createdAt: now.toISOString(),
      epoch: this.#epoch,
      eventId: this.#nextId(),
      eventType,
      payload: publicClone(stored.position),
      pricingId: stored.position.pricingId,
      revision: stored.position.revision,
      sequence: this.#sequence.toString(),
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
