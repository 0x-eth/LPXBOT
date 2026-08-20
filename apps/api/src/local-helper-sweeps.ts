import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  LocalHelperResidualSnapshot as LocalHelperResidualSnapshotView,
  LocalHelperSweepBatch,
  LocalHelperSweepOperation,
  LocalHelperSweepPreview,
  LocalHelperSweepPreviewRequest,
  LocalHelperSweepSubmitRequest,
  LocalSwapFeeLimit,
} from "@lpbot/api-contract";
import {
  localHelperSweepComponent,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  validateLocalHelperSweepRegistry,
  type LocalHelperSweepComponentRole,
  type LocalHelperSweepRegistry,
} from "@lpbot/chain-registry";
import {
  localHelperResidualSnapshotDigest,
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  validateLocalHelperResidualSnapshot,
  validateLocalHelperSweepPlan,
  type LocalHelperResidualAllowance,
  type LocalHelperResidualBalance,
  type LocalHelperResidualNftCustody,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepAsset,
  type LocalHelperSweepBinding,
  type LocalHelperSweepFeeLimit,
  type LocalHelperSweepPlan,
  type LocalHelperUnknownTokenResidual,
} from "@lpbot/domain/local-helper-sweep";
import type { Address, Hex } from "viem";

export const localHelperSweepBodyLimit = 8_192;
export const localHelperResidualSnapshotTtlMilliseconds = 30_000;
export const localHelperSweepPreviewTtlMilliseconds = 20_000;
export const localHelperSweepIdempotencyRetentionHours = 24;

export type LocalHelperSweepErrorCode =
  | "ASSET_ALREADY_CONFIRMED"
  | "BATCH_IN_PROGRESS"
  | "CHAIN_NOT_ALLOWED"
  | "DUPLICATE_ASSET_ID"
  | "HELPER_BINDING_MISMATCH"
  | "HELPER_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "LOCAL_HELPER_SWEEP_NOT_FOUND"
  | "LOCAL_HELPER_SWEEP_UNAVAILABLE"
  | "MANUAL_RECOVERY_REQUIRED"
  | "NONCE_DRIFT"
  | "NONCE_RECONCILIATION_REQUIRED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "REGISTRY_MISMATCH"
  | "SNAPSHOT_CHANGED"
  | "SNAPSHOT_EXPIRED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_REORGED"
  | "SNAPSHOT_STALE"
  | "UNKNOWN_ASSET"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND"
  | "ZERO_BALANCE";

export class LocalHelperSweepError extends Error {
  constructor(
    readonly code: LocalHelperSweepErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalHelperSweepError";
  }
}

export interface LocalHelperSweepNonceView {
  latest: string;
  pending: string;
  providerId: string;
}

export interface LocalHelperResidualChainInspection {
  allowances: readonly {
    amountBaseUnit: string;
    spenderAddress: Address;
    spenderRole: LocalHelperSweepComponentRole;
    tokenAddress: Address;
  }[];
  block: { hash: Hex; number: string; timestamp: string };
  componentCode: readonly {
    address: Address;
    role: LocalHelperSweepComponentRole;
    runtimeCodeHash: Hex | null;
  }[];
  coverage: LocalHelperResidualSnapshot["coverage"];
  feeLimits: readonly { assetId: string; feeLimit: LocalHelperSweepFeeLimit }[];
  headBlockNumber: string;
  helper: { owner: Address | null; runtimeCodeHash: Hex | null };
  nativeBalanceBaseUnit: string;
  nftCustody: readonly { managerAddress: Address; tokenId: string }[];
  nonceViews: readonly LocalHelperSweepNonceView[];
  referencedBlockHash: Hex | null;
  tokenBalances: readonly {
    address: Address;
    amountBaseUnit: string;
    runtimeCodeHash: Hex | null;
  }[];
  unknownTokens: readonly {
    address: Address;
    amountBaseUnit: string;
    runtimeCodeHash: Hex | null;
  }[];
}

export interface LocalHelperResidualChainReader {
  inspect(input: {
    binding: LocalHelperSweepBinding;
    referencedBlockNumber: string | null;
    walletAddress: Address;
  }): Promise<LocalHelperResidualChainInspection>;
}

export interface LocalHelperSweepBindingStore {
  get(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalHelperSweepBinding | null>;
  transition(input: {
    bindingId: string;
    failureCode: string | null;
    state: "active" | "degraded";
    tenantId: string;
    userId: string;
    verifiedBlockNumber: string;
    walletId: string;
  }): Promise<LocalHelperSweepBinding>;
}

export class MemoryLocalHelperSweepBindingStore implements LocalHelperSweepBindingStore {
  readonly #bindings = new Map<
    string,
    LocalHelperSweepBinding & { failureCode: string | null; tenantId: string; userId: string }
  >();

  constructor(
    bindings: readonly (LocalHelperSweepBinding & {
      failureCode?: string | null;
      tenantId: string;
      userId: string;
    })[] = [],
  ) {
    for (const binding of bindings) this.put(binding);
  }

  async get(input: { tenantId: string; userId: string; walletId: string }) {
    const value = this.#bindings.get(this.#key(input));
    return value ? this.#public(value) : null;
  }

  put(
    binding: LocalHelperSweepBinding & {
      failureCode?: string | null;
      tenantId: string;
      userId: string;
    },
  ): void {
    this.#bindings.set(this.#key(binding), {
      ...structuredClone(binding),
      failureCode: binding.failureCode ?? null,
    });
  }

  async transition(input: Parameters<LocalHelperSweepBindingStore["transition"]>[0]) {
    const key = this.#key(input);
    const value = this.#bindings.get(key);
    if (!value || value.bindingId !== input.bindingId) {
      throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
    }
    value.state = input.state;
    value.failureCode = input.failureCode;
    value.verifiedBlockNumber = input.verifiedBlockNumber;
    return this.#public(value);
  }

  #key(input: { tenantId: string; userId: string; walletId: string }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}`;
  }

  #public(
    value: LocalHelperSweepBinding & { failureCode: string | null; tenantId: string; userId: string },
  ): LocalHelperSweepBinding {
    const {
      failureCode: _failureCode,
      tenantId: _tenantId,
      userId: _userId,
      ...binding
    } = value;
    return structuredClone(binding);
  }
}

export interface LocalHelperResidualSnapshotStore {
  append(input: {
    idempotencyKey: string;
    snapshot: Readonly<LocalHelperResidualSnapshot>;
    tenantId: string;
    userId: string;
  }): Promise<Readonly<LocalHelperResidualSnapshot>>;
  findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalHelperResidualSnapshot> | null>;
  get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalHelperResidualSnapshot> | null>;
  latest(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalHelperResidualSnapshot> | null>;
}

export class MemoryLocalHelperResidualSnapshotStore implements LocalHelperResidualSnapshotStore {
  readonly #idempotency = new Map<string, string>();
  readonly #snapshots = new Map<string, LocalHelperResidualSnapshot>();

  async append(input: Parameters<LocalHelperResidualSnapshotStore["append"]>[0]) {
    const scope = this.#idempotencyKey(input);
    const existingDigest = this.#idempotency.get(scope);
    if (existingDigest) {
      return structuredClone(this.#snapshots.get(this.#snapshotKey({
        ...input,
        snapshotDigest: existingDigest,
        walletId: input.snapshot.wallet.walletId,
      }))!);
    }
    const key = this.#snapshotKey({
      ...input,
      snapshotDigest: input.snapshot.snapshotDigest,
      walletId: input.snapshot.wallet.walletId,
    });
    if (!this.#snapshots.has(key)) this.#snapshots.set(key, structuredClone(input.snapshot));
    this.#idempotency.set(scope, input.snapshot.snapshotDigest);
    return structuredClone(this.#snapshots.get(key)!);
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const value = this.#idempotency.get(this.#idempotencyKey(input));
    return value
      ? this.get({ ...input, snapshotDigest: value as `sha256:${string}` })
      : null;
  }

  async get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const value = this.#snapshots.get(this.#snapshotKey(input));
    return value ? structuredClone(value) : null;
  }

  async latest(input: { tenantId: string; userId: string; walletId: string }) {
    const prefix = `${input.tenantId}:${input.userId}:${input.walletId}:`;
    let latest: LocalHelperResidualSnapshot | null = null;
    for (const [key, value] of this.#snapshots) {
      if (!key.startsWith(prefix) || (latest && latest.observedAt >= value.observedAt)) continue;
      latest = value;
    }
    return latest ? structuredClone(latest) : null;
  }

  #idempotencyKey(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId?: string;
    snapshot?: Readonly<LocalHelperResidualSnapshot>;
  }): string {
    const walletId = input.walletId ?? input.snapshot!.wallet.walletId;
    return `${input.tenantId}:${input.userId}:${walletId}:${input.idempotencyKey}`;
  }

  #snapshotKey(input: {
    snapshotDigest: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}:${input.snapshotDigest}`;
  }
}

interface LocalHelperSweepPreviewFacts {
  assets: LocalHelperSweepAsset[];
  binding: LocalHelperSweepBinding;
  blockHash: Hex;
  blockNumber: string;
  deadline: string;
  expiresAt: string;
  feeLimits: Record<string, LocalHelperSweepFeeLimit>;
  nonce: string;
  nonceViews: readonly LocalHelperSweepNonceView[];
  observationDigest: `sha256:${string}`;
}

export interface StoredLocalHelperSweepPreview {
  createdAt: Date;
  facts: LocalHelperSweepPreviewFacts;
  previewDigest: `sha256:${string}`;
  request: LocalHelperSweepPreviewRequest;
  tenantId: string;
  tokenDigest: string;
  userId: string;
}

export interface LocalHelperSweepPreviewStore {
  get(token: string): Promise<StoredLocalHelperSweepPreview | null>;
  put(preview: StoredLocalHelperSweepPreview): Promise<void>;
}

export class MemoryLocalHelperSweepPreviewStore implements LocalHelperSweepPreviewStore {
  readonly #previews = new Map<string, StoredLocalHelperSweepPreview>();

  async get(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#previews.get(rawSha256(token));
    return value ? structuredClone(value) : null;
  }

  async put(preview: StoredLocalHelperSweepPreview): Promise<void> {
    if (!this.#previews.has(preview.tokenDigest)) {
      this.#previews.set(preview.tokenDigest, structuredClone(preview));
    }
  }
}

export interface LocalHelperSweepReservation {
  fencingToken: string;
  nonce: string;
  operationId: string;
  ordinal: number;
}

export interface StoredLocalHelperSweepOperation extends LocalHelperSweepOperation {
  plan: LocalHelperSweepPlan;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface StoredLocalHelperSweepBatch extends Omit<LocalHelperSweepBatch, "operations"> {
  operations: StoredLocalHelperSweepOperation[];
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface LocalHelperSweepOperationStore {
  create(input: {
    assetIds: readonly string[];
    buildPlans(input: {
      batchId: string;
      reservations: readonly LocalHelperSweepReservation[];
    }): readonly LocalHelperSweepPlan[];
    expectedNonce: string;
    helperAddress: Address;
    idempotencyKey: string;
    nonceViews: readonly LocalHelperSweepNonceView[];
    previewDigest: `sha256:${string}`;
    requestHash: `sha256:${string}`;
    requestId: string;
    sessionId: string;
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletAddress: Address;
    walletId: string;
  }): Promise<{ batch: StoredLocalHelperSweepBatch; kind: "created" | "duplicate" }>;
  getBatch(input: {
    batchId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalHelperSweepBatch | null>;
  getOperation(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalHelperSweepOperation | null>;
}

export class MemoryLocalHelperSweepOperationStore implements LocalHelperSweepOperationStore {
  readonly #batches = new Map<string, StoredLocalHelperSweepBatch>();
  readonly #confirmed = new Set<string>();
  readonly #idempotency = new Map<string, { batchId: string; requestHash: string }>();
  readonly #ledgers = new Map<string, { fencingToken: bigint; nextNonce: bigint | null }>();
  readonly #operations = new Map<string, StoredLocalHelperSweepOperation>();
  readonly #now: () => Date;
  readonly #uuid: () => string;
  readonly outbox: Array<{ batchId: string; operationId: string; state: "queued" }> = [];

  constructor(input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async create(input: Parameters<LocalHelperSweepOperationStore["create"]>[0]) {
    const idempotencyScope = `${input.tenantId}:${input.userId}:${input.walletId}:${input.idempotencyKey}`;
    const existing = this.#idempotency.get(idempotencyScope);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new LocalHelperSweepError("IDEMPOTENCY_CONFLICT");
      }
      return { batch: structuredClone(this.#batches.get(existing.batchId)!), kind: "duplicate" as const };
    }
    if (
      [...this.#batches.values()].some(
        (batch) =>
          batch.tenantId === input.tenantId &&
          batch.userId === input.userId &&
          batch.walletId === input.walletId &&
          !["failed", "manual-recovery-required", "partial", "succeeded"].includes(batch.state),
      )
    ) {
      throw new LocalHelperSweepError("BATCH_IN_PROGRESS");
    }
    if (
      input.assetIds.some((assetId) =>
        this.#confirmed.has(`${input.walletId}:${input.snapshotDigest}:${assetId}`),
      )
    ) {
      throw new LocalHelperSweepError("ASSET_ALREADY_CONFIRMED");
    }
    const nonce = consensusNonce(input.nonceViews);
    const ledgerKey = `31337:${input.walletId}`;
    const ledger = this.#ledgers.get(ledgerKey) ?? { fencingToken: 0n, nextNonce: null };
    if (ledger.nextNonce === null) ledger.nextNonce = BigInt(nonce);
    if (nonce !== input.expectedNonce || ledger.nextNonce.toString() !== input.expectedNonce) {
      throw new LocalHelperSweepError("NONCE_DRIFT");
    }
    const batchId = this.#uuid().toLowerCase();
    const reservations = input.assetIds.map((_, ordinal) => {
      ledger.fencingToken += 1n;
      const value: LocalHelperSweepReservation = {
        fencingToken: ledger.fencingToken.toString(),
        nonce: ledger.nextNonce!.toString(),
        operationId: this.#uuid().toLowerCase(),
        ordinal,
      };
      ledger.nextNonce! += 1n;
      return value;
    });
    const plans = input.buildPlans({ batchId, reservations });
    if (plans.length !== input.assetIds.length) throw new LocalHelperSweepError("PREVIEW_CHANGED");
    this.#ledgers.set(ledgerKey, ledger);
    const createdAt = this.#now().toISOString();
    const operations = plans.map((plan): StoredLocalHelperSweepOperation => ({
      amountBaseUnit: plan.asset.amountBaseUnit,
      assetId: plan.asset.assetId,
      assetKind: plan.asset.kind,
      batchId,
      chainId: 31_337,
      createdAt,
      failureCode: null,
      feeLimit: structuredClone(plan.feeLimit),
      helperAddress: plan.helper.helperAddress,
      nonce: plan.nonce,
      operationId: plan.operationId,
      operationKind: "helper-residual-sweep",
      plan,
      planDigest: plan.planDigest,
      previewDigest: input.previewDigest,
      recipient: plan.recipient,
      reconciliationReason: null,
      registryVersion: "p05-local-helper-sweep-v2",
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      snapshotDigest: input.snapshotDigest,
      state: "queued",
      tenantId: input.tenantId,
      tokenAddress: plan.asset.tokenAddress,
      transactions: [],
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    }));
    const batch: StoredLocalHelperSweepBatch = {
      batchId,
      chainId: 31_337,
      createdAt,
      helperAddress: input.helperAddress,
      operations,
      registryVersion: "p05-local-helper-sweep-v2",
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      snapshotDigest: input.snapshotDigest,
      state: "queued",
      tenantId: input.tenantId,
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    };
    this.#batches.set(batchId, batch);
    for (const operation of operations) {
      this.#operations.set(operation.operationId, operation);
      this.outbox.push({ batchId, operationId: operation.operationId, state: "queued" });
    }
    this.#idempotency.set(idempotencyScope, { batchId, requestHash: input.requestHash });
    return { batch: structuredClone(batch), kind: "created" as const };
  }

  async getBatch(input: { batchId: string; tenantId: string; userId: string }) {
    const value = this.#batches.get(input.batchId);
    return value?.tenantId === input.tenantId && value.userId === input.userId
      ? structuredClone(value)
      : null;
  }

  async getOperation(input: { operationId: string; tenantId: string; userId: string }) {
    const value = this.#operations.get(input.operationId);
    return value?.tenantId === input.tenantId && value.userId === input.userId
      ? structuredClone(value)
      : null;
  }

  markSucceeded(operationId: string): void {
    const operation = this.#operations.get(operationId);
    if (!operation || operation.state === "succeeded") return;
    operation.state = "succeeded";
    operation.updatedAt = this.#now().toISOString();
    this.#confirmed.add(`${operation.walletId}:${operation.snapshotDigest}:${operation.assetId}`);
    const batch = this.#batches.get(operation.batchId)!;
    batch.state = batch.operations.every(({ state }) => state === "succeeded") ? "succeeded" : "running";
    batch.updatedAt = operation.updatedAt;
  }
}

export interface LocalHelperSweepApplication {
  getBatch(input: {
    batchId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalHelperSweepBatch>;
  getOperation(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalHelperSweepOperation>;
  latest(input: {
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperResidualSnapshotView | null>;
  preview(input: {
    request: LocalHelperSweepPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperSweepPreview>;
  scan(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperResidualSnapshotView>;
  sweep(input: {
    idempotencyKey: string;
    request: LocalHelperSweepSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ batch: LocalHelperSweepBatch; created: boolean }>;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const idempotencyPattern = /^[!-~]{16,128}$/u;
const scanIdempotencyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function rawSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${rawSha256(JSON.stringify(canonical(value)))}`;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalHelperSweepError("PREVIEW_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function parseAssetIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > P05_LOCAL_HELPER_SWEEP_REGISTRY.maxAssetsPerBatch ||
    !value.every(
      (assetId) =>
        assetId === "native:31337" ||
        (typeof assetId === "string" && /^token:0x[0-9a-f]{40}$/u.test(assetId)),
    )
  ) {
    throw new LocalHelperSweepError("PREVIEW_INVALID");
  }
  if (new Set(value).size !== value.length) {
    throw new LocalHelperSweepError("DUPLICATE_ASSET_ID");
  }
  return [...value].sort((left, right) => left.localeCompare(right));
}

export function parseLocalHelperSweepPreview(value: unknown): LocalHelperSweepPreviewRequest {
  const input = record(value);
  if (
    !exactKeys(input, ["assetIds", "chainId", "snapshotDigest", "walletId"]) ||
    input.chainId !== 31_337 ||
    typeof input.walletId !== "string" ||
    !uuidPattern.test(input.walletId) ||
    typeof input.snapshotDigest !== "string" ||
    !digestPattern.test(input.snapshotDigest)
  ) {
    throw new LocalHelperSweepError("PREVIEW_INVALID");
  }
  return {
    assetIds: parseAssetIds(input.assetIds),
    chainId: 31_337,
    snapshotDigest: input.snapshotDigest as `sha256:${string}`,
    walletId: input.walletId.toLowerCase(),
  };
}

export function parseLocalHelperSweepSubmit(value: unknown): LocalHelperSweepSubmitRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "assetIds",
      "chainId",
      "previewDigest",
      "previewToken",
      "snapshotDigest",
      "walletId",
    ]) ||
    typeof input.previewDigest !== "string" ||
    !digestPattern.test(input.previewDigest) ||
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken)
  ) {
    throw new LocalHelperSweepError("PREVIEW_INVALID");
  }
  const request = parseLocalHelperSweepPreview({
    assetIds: input.assetIds,
    chainId: input.chainId,
    snapshotDigest: input.snapshotDigest,
    walletId: input.walletId,
  });
  return {
    ...request,
    previewDigest: input.previewDigest as `sha256:${string}`,
    previewToken: input.previewToken,
  };
}

export function parseLocalHelperSweepIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !idempotencyPattern.test(value)) {
    throw new LocalHelperSweepError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseLocalHelperSweepId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_NOT_FOUND");
  }
  return value.toLowerCase();
}

function consensusNonce(views: readonly LocalHelperSweepNonceView[]): string {
  if (views.length < 1 || views.length > 4) {
    throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const identities = new Set<string>();
  for (const view of views) {
    if (
      !decimalPattern.test(view.latest) ||
      !decimalPattern.test(view.pending) ||
      BigInt(view.pending) < BigInt(view.latest) ||
      typeof view.providerId !== "string" ||
      view.providerId.length < 1
    ) {
      throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    identities.add(`${view.latest}:${view.pending}`);
  }
  if (identities.size !== 1) {
    throw new LocalHelperSweepError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return views[0]!.pending;
}

function publicBatch(batch: StoredLocalHelperSweepBatch): LocalHelperSweepBatch {
  return {
    batchId: batch.batchId,
    chainId: batch.chainId,
    createdAt: batch.createdAt,
    helperAddress: batch.helperAddress,
    operations: batch.operations.map(publicOperation),
    registryVersion: batch.registryVersion,
    snapshotDigest: batch.snapshotDigest,
    state: batch.state,
    updatedAt: batch.updatedAt,
    walletId: batch.walletId,
  };
}

function publicOperation(operation: StoredLocalHelperSweepOperation): LocalHelperSweepOperation {
  const {
    plan: _plan,
    previewDigest: _previewDigest,
    requestHash: _requestHash,
    sessionId: _sessionId,
    tenantId: _tenantId,
    userId: _userId,
    ...value
  } = operation;
  return structuredClone(value);
}

export class LocalHelperSweepService implements LocalHelperSweepApplication {
  readonly #bindings: LocalHelperSweepBindingStore;
  readonly #chain: LocalHelperResidualChainReader;
  readonly #now: () => Date;
  readonly #operations: LocalHelperSweepOperationStore;
  readonly #previews: LocalHelperSweepPreviewStore;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #registry: LocalHelperSweepRegistry;
  readonly #snapshots: LocalHelperResidualSnapshotStore;

  constructor(input: {
    bindings: LocalHelperSweepBindingStore;
    chain: LocalHelperResidualChainReader;
    now?: () => Date;
    operations: LocalHelperSweepOperationStore;
    previews: LocalHelperSweepPreviewStore;
    randomBytes?: (size: number) => Uint8Array;
    registry?: LocalHelperSweepRegistry;
    snapshots: LocalHelperResidualSnapshotStore;
  }) {
    this.#bindings = input.bindings;
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#previews = input.previews;
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#registry = validateLocalHelperSweepRegistry(
      input.registry ?? P05_LOCAL_HELPER_SWEEP_REGISTRY,
    );
    this.#snapshots = input.snapshots;
  }

  async scan(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperResidualSnapshotView> {
    if (!scanIdempotencyPattern.test(input.idempotencyKey)) {
      throw new LocalHelperSweepError("PREVIEW_INVALID");
    }
    this.#wallet(input.wallet);
    const existing = await this.#snapshots.findIdempotency({
      idempotencyKey: input.idempotencyKey,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (existing) return structuredClone(existing) as LocalHelperResidualSnapshotView;
    const binding = await this.#binding(input);
    const inspection = await this.#chain.inspect({
      binding,
      referencedBlockNumber: null,
      walletAddress: input.wallet.address,
    });
    const snapshot = await this.#snapshot(input, binding, inspection);
    const stored = await this.#snapshots.append({
      idempotencyKey: input.idempotencyKey,
      snapshot,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    return structuredClone(stored) as LocalHelperResidualSnapshotView;
  }

  async latest(input: { tenantId: string; userId: string; wallet: CustodyWallet }) {
    this.#wallet(input.wallet);
    return (await this.#snapshots.latest({
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    })) as LocalHelperResidualSnapshotView | null;
  }

  async preview(input: {
    request: LocalHelperSweepPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperSweepPreview> {
    const request = parseLocalHelperSweepPreview(input.request);
    this.#wallet(input.wallet);
    if (request.walletId !== input.wallet.walletId) {
      throw new LocalHelperSweepError("WALLET_NOT_FOUND");
    }
    const { facts, snapshot } = await this.#facts({ ...input, request });
    const previewDigest = digest({ facts, request, registryDigest: this.#registry.registryDigest });
    const previewToken = Buffer.from(this.#randomBytes(32)).toString("base64url");
    const stored: StoredLocalHelperSweepPreview = {
      createdAt: this.#now(),
      facts,
      previewDigest,
      request,
      tenantId: input.tenantId,
      tokenDigest: rawSha256(previewToken),
      userId: input.userId,
    };
    await this.#previews.put(stored);
    return this.#publicPreview(request, snapshot, stored, previewToken);
  }

  async sweep(input: {
    idempotencyKey: string;
    request: LocalHelperSweepSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }) {
    const idempotencyKey = parseLocalHelperSweepIdempotencyKey(input.idempotencyKey);
    const request = parseLocalHelperSweepSubmit(input.request);
    this.#wallet(input.wallet);
    if (request.walletId !== input.wallet.walletId) {
      throw new LocalHelperSweepError("WALLET_NOT_FOUND");
    }
    const preview = await this.#previews.get(request.previewToken);
    if (!preview) throw new LocalHelperSweepError("PREVIEW_INVALID");
    if (preview.createdAt.getTime() + localHelperSweepPreviewTtlMilliseconds <= this.#now().getTime()) {
      throw new LocalHelperSweepError("PREVIEW_EXPIRED");
    }
    const baseRequest: LocalHelperSweepPreviewRequest = {
      assetIds: request.assetIds,
      chainId: request.chainId,
      snapshotDigest: request.snapshotDigest,
      walletId: request.walletId,
    };
    if (
      preview.tenantId !== input.tenantId ||
      preview.userId !== input.userId ||
      preview.previewDigest !== request.previewDigest ||
      !same(preview.request, baseRequest)
    ) {
      throw new LocalHelperSweepError("PREVIEW_INVALID");
    }
    const current = await this.#facts({ ...input, request: baseRequest });
    if (!same(current.facts, preview.facts)) {
      throw new LocalHelperSweepError("PREVIEW_CHANGED");
    }
    const requestHash = digest({ idempotencyKey, request: baseRequest });
    const result = await this.#operations.create({
      assetIds: baseRequest.assetIds,
      buildPlans: ({ batchId, reservations }) =>
        reservations.map((reservation) => {
          const asset = preview.facts.assets[reservation.ordinal]!;
          const plan = this.#plan({
            asset,
            batchId,
            binding: preview.facts.binding,
            deadline: preview.facts.deadline,
            feeLimit: preview.facts.feeLimits[asset.assetId]!,
            operationId: reservation.operationId,
            reservation,
            snapshot: current.snapshot,
            wallet: input.wallet,
          });
          validateLocalHelperSweepPlan(
            plan,
            {
              currentBlockHash: preview.facts.blockHash,
              currentBlockNumber: preview.facts.blockNumber,
              expectedAsset: asset,
              expectedBinding: preview.facts.binding,
              expectedWallet: { address: input.wallet.address, walletId: input.wallet.walletId },
              registryDigest: this.#registry.registryDigest,
            },
            this.#now(),
          );
          return plan;
        }),
      expectedNonce: preview.facts.nonce,
      helperAddress: preview.facts.binding.helperAddress,
      idempotencyKey,
      nonceViews: current.facts.nonceViews,
      previewDigest: preview.previewDigest,
      requestHash,
      requestId: input.requestId,
      sessionId: input.sessionId,
      snapshotDigest: request.snapshotDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletAddress: input.wallet.address,
      walletId: input.wallet.walletId,
    });
    return { batch: publicBatch(result.batch), created: result.kind === "created" };
  }

  async getBatch(input: { batchId: string; tenantId: string; userId: string }) {
    const batch = await this.#operations.getBatch({
      ...input,
      batchId: parseLocalHelperSweepId(input.batchId),
    });
    if (!batch) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_NOT_FOUND");
    return publicBatch(batch);
  }

  async getOperation(input: { operationId: string; tenantId: string; userId: string }) {
    const operation = await this.#operations.getOperation({
      ...input,
      operationId: parseLocalHelperSweepId(input.operationId),
    });
    if (!operation) throw new LocalHelperSweepError("LOCAL_HELPER_SWEEP_NOT_FOUND");
    return publicOperation(operation);
  }

  async #binding(input: { tenantId: string; userId: string; wallet: CustodyWallet }) {
    const binding = await this.#bindings.get({
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!binding) throw new LocalHelperSweepError("HELPER_NOT_FOUND");
    return binding;
  }

  async #snapshot(
    input: { tenantId: string; userId: string; wallet: CustodyWallet },
    binding: LocalHelperSweepBinding,
    inspection: LocalHelperResidualChainInspection,
  ): Promise<LocalHelperResidualSnapshot> {
    const observedAt = this.#now();
    const identity = this.#identity(binding, inspection, input.wallet);
    const balances = this.#balances(inspection);
    const allowances = this.#allowances(inspection);
    const nftCustody = this.#nfts(inspection);
    const unknownTokens = this.#unknownTokens(inspection);
    const manualRecoveryRequired =
      allowances.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n) ||
      nftCustody.length > 0 ||
      unknownTokens.length > 0;
    const reasons = new Set<string>();
    if (!inspection.coverage.complete) reasons.add("coverage-incomplete");
    if (Object.entries(identity).some(([key, value]) => key.endsWith("Matches") && value === false)) {
      reasons.add("identity-mismatch");
    }
    if (balances.some((asset) => BigInt(asset.amountBaseUnit) > BigInt(asset.dustBaseUnit))) {
      reasons.add("residual-above-dust");
    }
    if (allowances.some(({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n)) {
      reasons.add("nonzero-allowance");
    }
    if (nftCustody.length > 0) reasons.add("nft-custody");
    if (unknownTokens.length > 0) reasons.add("unknown-token");
    const degradationReasons = [...reasons].sort((left, right) => left.localeCompare(right));
    const desiredState = degradationReasons.length === 0 ? "active" : "degraded";
    const transitioned = await this.#bindings.transition({
      bindingId: binding.bindingId,
      failureCode: degradationReasons[0] ?? null,
      state: desiredState,
      tenantId: input.tenantId,
      userId: input.userId,
      verifiedBlockNumber: inspection.block.number,
      walletId: input.wallet.walletId,
    });
    const snapshot: LocalHelperResidualSnapshot = {
      allowances,
      balances,
      binding: transitioned,
      block: structuredClone(inspection.block),
      chainId: 31_337,
      coverage: structuredClone(inspection.coverage),
      degradationReasons,
      expiresAt: new Date(
        observedAt.getTime() + localHelperResidualSnapshotTtlMilliseconds,
      ).toISOString(),
      identity,
      manualRecoveryRequired,
      nftCustody,
      observedAt: observedAt.toISOString(),
      registry: { digest: this.#registry.registryDigest, version: this.#registry.registryVersion },
      schemaVersion: 2,
      snapshotDigest: `sha256:${"00".repeat(32)}`,
      snapshotVersion: this.#registry.snapshotVersion,
      unknownTokens,
      wallet: { address: input.wallet.address, walletId: input.wallet.walletId },
    };
    snapshot.snapshotDigest = localHelperResidualSnapshotDigest(snapshot);
    validateLocalHelperResidualSnapshot(
      snapshot,
      {
        binding: transitioned,
        nativeDustBaseUnit: this.#registry.dustPolicy.nativeDustBaseUnit,
        registryDigest: this.#registry.registryDigest,
        registryVersion: this.#registry.registryVersion,
        tokenPolicy: this.#registry.tokens,
        wallet: snapshot.wallet,
      },
      observedAt,
    );
    return snapshot;
  }

  async #facts(input: {
    request: LocalHelperSweepPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ facts: LocalHelperSweepPreviewFacts; snapshot: LocalHelperResidualSnapshot }> {
    const now = this.#now();
    const snapshot = await this.#snapshots.get({
      snapshotDigest: input.request.snapshotDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!snapshot) throw new LocalHelperSweepError("SNAPSHOT_NOT_FOUND");
    if (Date.parse(snapshot.expiresAt) <= now.getTime()) {
      throw new LocalHelperSweepError("SNAPSHOT_EXPIRED");
    }
    if (!snapshot.coverage.complete) throw new LocalHelperSweepError("SNAPSHOT_STALE", true);
    if (snapshot.manualRecoveryRequired) {
      throw new LocalHelperSweepError("MANUAL_RECOVERY_REQUIRED");
    }
    if (
      !snapshot.identity.bindingMatches ||
      !snapshot.identity.componentsMatch ||
      !snapshot.identity.ownerMatches ||
      !snapshot.identity.registryMatches ||
      !snapshot.identity.runtimeMatches ||
      !snapshot.identity.tokensMatch
    ) {
      throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
    }
    const binding = await this.#binding(input);
    if (binding.bindingId !== snapshot.binding.bindingId || binding.state !== "degraded") {
      throw new LocalHelperSweepError("HELPER_BINDING_MISMATCH");
    }
    const inspection = await this.#chain.inspect({
      binding,
      referencedBlockNumber: snapshot.block.number,
      walletAddress: input.wallet.address,
    });
    if (inspection.referencedBlockHash !== snapshot.block.hash) {
      throw new LocalHelperSweepError("SNAPSHOT_REORGED", true);
    }
    if (BigInt(inspection.headBlockNumber) - BigInt(snapshot.block.number) > BigInt(this.#registry.maxBlockDrift)) {
      throw new LocalHelperSweepError("SNAPSHOT_STALE");
    }
    const observationDigest = this.#observationDigest(binding, inspection, input.wallet);
    const snapshotObservationDigest = this.#snapshotObservationDigest(snapshot);
    if (observationDigest !== snapshotObservationDigest) {
      throw new LocalHelperSweepError("SNAPSHOT_CHANGED");
    }
    const selected = input.request.assetIds.map((assetId) => {
      const balance = snapshot.balances.find((candidate) => candidate.assetId === assetId);
      if (!balance) throw new LocalHelperSweepError("UNKNOWN_ASSET");
      if (BigInt(balance.amountBaseUnit) <= BigInt(balance.dustBaseUnit)) {
        throw new LocalHelperSweepError("ZERO_BALANCE");
      }
      return this.#asset(balance);
    });
    const feeLimits: Record<string, LocalHelperSweepFeeLimit> = {};
    for (const asset of selected) {
      const fee = inspection.feeLimits.find((candidate) => candidate.assetId === asset.assetId)?.feeLimit;
      if (!fee) throw new LocalHelperSweepError("PREVIEW_CHANGED");
      this.#fee(fee);
      feeLimits[asset.assetId] = structuredClone(fee);
    }
    const nonce = consensusNonce(inspection.nonceViews);
    const expiresAt = new Date(
      Math.min(Date.parse(snapshot.expiresAt), now.getTime() + localHelperSweepPreviewTtlMilliseconds),
    ).toISOString();
    const deadline = new Date(
      Math.min(
        Date.parse(snapshot.expiresAt) + (this.#registry.maxDeadlineSeconds - 30) * 1_000,
        now.getTime() + this.#registry.maxDeadlineSeconds * 1_000,
      ),
    ).toISOString();
    return {
      facts: {
        assets: selected,
        binding,
        blockHash: snapshot.block.hash,
        blockNumber: snapshot.block.number,
        deadline,
        expiresAt,
        feeLimits,
        nonce,
        nonceViews: structuredClone(inspection.nonceViews),
        observationDigest,
      },
      snapshot: structuredClone(snapshot),
    };
  }

  #identity(
    binding: LocalHelperSweepBinding,
    inspection: LocalHelperResidualChainInspection,
    wallet: Pick<CustodyWallet, "address" | "walletId">,
  ) {
    const expectedComponents = this.#registry.components;
    const bindingMatches =
      binding.deploymentRegistryVersion === this.#registry.helper.bindingRegistryVersion &&
      binding.helperVersion === this.#registry.helper.helperVersion &&
      binding.walletId === wallet.walletId &&
      binding.ownerAddress === wallet.address &&
      binding.adapterAddress === localHelperSweepComponent("adapter", this.#registry).address &&
      binding.permit2Address === localHelperSweepComponent("permit2", this.#registry).address;
    const componentsMatch = expectedComponents.every((expected) => {
      const observed = inspection.componentCode.find(({ role }) => role === expected.role);
      return (
        observed?.address === expected.address && observed.runtimeCodeHash === expected.runtimeCodeHash
      );
    });
    const tokensMatch = this.#registry.tokens.every((expected) => {
      const observed = inspection.tokenBalances.find(({ address }) => address === expected.address);
      return observed?.runtimeCodeHash === expected.runtimeCodeHash;
    });
    return {
      bindingMatches,
      componentsMatch,
      observedOwner: inspection.helper.owner,
      observedRuntimeCodeHash: inspection.helper.runtimeCodeHash,
      ownerMatches: inspection.helper.owner === binding.ownerAddress,
      registryMatches:
        binding.deploymentRegistryVersion === this.#registry.helper.bindingRegistryVersion,
      runtimeMatches: inspection.helper.runtimeCodeHash === binding.runtimeCodeHash,
      tokensMatch,
    };
  }

  #balances(inspection: LocalHelperResidualChainInspection): LocalHelperResidualBalance[] {
    const balances: LocalHelperResidualBalance[] = [
      {
        amountBaseUnit: inspection.nativeBalanceBaseUnit,
        assetId: "native:31337",
        dustBaseUnit: this.#registry.dustPolicy.nativeDustBaseUnit,
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
    ];
    for (const token of this.#registry.tokens) {
      const observed = inspection.tokenBalances.find(({ address }) => address === token.address);
      balances.push({
        amountBaseUnit: observed?.amountBaseUnit ?? "0",
        assetId: `token:${token.address}`,
        dustBaseUnit: token.dustBaseUnit,
        fixture: token.fixture,
        kind: "token",
        runtimeCodeHash: observed?.runtimeCodeHash ?? null,
        tokenAddress: token.address,
      });
    }
    return balances;
  }

  #allowances(inspection: LocalHelperResidualChainInspection): LocalHelperResidualAllowance[] {
    return inspection.allowances
      .map((value) => ({
        amountBaseUnit: value.amountBaseUnit,
        assetId: `allowance:${value.tokenAddress}:${value.spenderAddress}`,
        spenderAddress: value.spenderAddress,
        spenderRole: value.spenderRole,
        tokenAddress: value.tokenAddress,
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
  }

  #nfts(inspection: LocalHelperResidualChainInspection): LocalHelperResidualNftCustody[] {
    return inspection.nftCustody
      .map(({ managerAddress, tokenId }) => ({
        assetId: `nft:${managerAddress}:${tokenId}`,
        managerAddress,
        tokenId,
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
  }

  #unknownTokens(inspection: LocalHelperResidualChainInspection): LocalHelperUnknownTokenResidual[] {
    return inspection.unknownTokens
      .filter(
        ({ address, amountBaseUnit, runtimeCodeHash }) =>
          BigInt(amountBaseUnit) > 0n &&
          runtimeCodeHash !== null &&
          !this.#registry.tokens.some((token) => token.address === address),
      )
      .map(({ address, amountBaseUnit, runtimeCodeHash }) => ({
        amountBaseUnit,
        assetId: `unknown-token:${address}`,
        runtimeCodeHash: runtimeCodeHash!,
        tokenAddress: address,
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
  }

  #observationDigest(
    binding: LocalHelperSweepBinding,
    inspection: LocalHelperResidualChainInspection,
    wallet: Pick<CustodyWallet, "address" | "walletId">,
  ): `sha256:${string}` {
    return digest({
      allowances: this.#allowances(inspection),
      balances: this.#balances(inspection),
      binding: { ...binding, state: undefined },
      coverage: inspection.coverage,
      helper: inspection.helper,
      identity: this.#identity(binding, inspection, wallet),
      nftCustody: this.#nfts(inspection),
      unknownTokens: this.#unknownTokens(inspection),
    });
  }

  #snapshotObservationDigest(snapshot: LocalHelperResidualSnapshot): `sha256:${string}` {
    return digest({
      allowances: snapshot.allowances,
      balances: snapshot.balances,
      binding: { ...snapshot.binding, state: undefined },
      coverage: snapshot.coverage,
      helper: {
        owner: snapshot.identity.observedOwner,
        runtimeCodeHash: snapshot.identity.observedRuntimeCodeHash,
      },
      identity: snapshot.identity,
      nftCustody: snapshot.nftCustody,
      unknownTokens: snapshot.unknownTokens,
    });
  }

  #asset(balance: LocalHelperResidualBalance): LocalHelperSweepAsset {
    return {
      amountBaseUnit: balance.amountBaseUnit,
      assetId: balance.assetId,
      dustBaseUnit: balance.dustBaseUnit,
      fixture: balance.fixture,
      kind: balance.kind,
      tokenAddress: balance.tokenAddress,
    };
  }

  #fee(fee: LocalHelperSweepFeeLimit): void {
    if (
      !decimalPattern.test(fee.gasLimit) ||
      !decimalPattern.test(fee.maxFeePerGasBaseUnit) ||
      !decimalPattern.test(fee.maxPriorityFeePerGasBaseUnit) ||
      !decimalPattern.test(fee.feeCapBaseUnit) ||
      BigInt(fee.gasLimit) === 0n ||
      BigInt(fee.maxFeePerGasBaseUnit) === 0n ||
      BigInt(fee.maxPriorityFeePerGasBaseUnit) > BigInt(fee.maxFeePerGasBaseUnit) ||
      BigInt(fee.gasLimit) * BigInt(fee.maxFeePerGasBaseUnit) !== BigInt(fee.feeCapBaseUnit)
    ) {
      throw new LocalHelperSweepError("PREVIEW_CHANGED");
    }
  }

  #plan(input: {
    asset: LocalHelperSweepAsset;
    batchId: string;
    binding: LocalHelperSweepBinding;
    deadline: string;
    feeLimit: LocalHelperSweepFeeLimit;
    operationId: string;
    reservation: LocalHelperSweepReservation;
    snapshot: LocalHelperResidualSnapshot;
    wallet: CustodyWallet;
  }): LocalHelperSweepPlan {
    const helper: LocalHelperSweepPlan["helper"] = {
      adapterAddress: input.binding.adapterAddress,
      bindingId: input.binding.bindingId,
      deploymentRegistryVersion: input.binding.deploymentRegistryVersion,
      helperAddress: input.binding.helperAddress,
      helperVersion: input.binding.helperVersion,
      ownerAddress: input.binding.ownerAddress,
      permit2Address: input.binding.permit2Address,
      runtimeCodeHash: input.binding.runtimeCodeHash,
      verifiedBlockNumber: input.binding.verifiedBlockNumber,
      walletId: input.binding.walletId,
    };
    const selector =
      input.asset.kind === "native"
        ? this.#registry.helper.selectors.sweepNative
        : this.#registry.helper.selectors.sweepToken;
    const plan: LocalHelperSweepPlan = {
      asset: structuredClone(input.asset),
      batchId: input.batchId,
      chainId: 31_337,
      deadline: input.deadline,
      feeLimit: structuredClone(input.feeLimit),
      fencingToken: input.reservation.fencingToken,
      helper,
      nonce: input.reservation.nonce,
      operationId: input.operationId,
      planDigest: `sha256:${"00".repeat(32)}`,
      planVersion: this.#registry.planVersion,
      recipient: input.binding.ownerAddress,
      registry: {
        digest: this.#registry.registryDigest,
        rollbackVersion: this.#registry.rollbackVersion,
        version: this.#registry.registryVersion,
      },
      schemaVersion: 2,
      semanticDigest: `sha256:${"00".repeat(32)}`,
      serviceFeeBps: 0,
      snapshot: {
        blockHash: input.snapshot.block.hash,
        blockNumber: input.snapshot.block.number,
        digest: input.snapshot.snapshotDigest,
      },
      transaction: {
        data: "0x",
        dataDigest: `sha256:${"00".repeat(32)}`,
        selector,
        to: input.binding.helperAddress,
        valueBaseUnit: "0",
      },
      wallet: { address: input.wallet.address, walletId: input.wallet.walletId },
    };
    plan.planDigest = localHelperSweepPlanDigest(plan);
    plan.transaction.data = localHelperSweepCalldata(plan.planDigest, plan.asset);
    plan.transaction.dataDigest = localHelperSweepDataDigest(plan.transaction.data);
    plan.semanticDigest = localHelperSweepSemanticDigest(plan);
    return plan;
  }

  #publicPreview(
    request: LocalHelperSweepPreviewRequest,
    snapshot: LocalHelperResidualSnapshot,
    preview: StoredLocalHelperSweepPreview,
    previewToken: string,
  ): LocalHelperSweepPreview {
    const assets = preview.facts.assets.map((asset) => ({
      amountBaseUnit: asset.amountBaseUnit,
      assetId: asset.assetId,
      dustBaseUnit: asset.dustBaseUnit,
      feeLimit: structuredClone(preview.facts.feeLimits[asset.assetId]!) as LocalSwapFeeLimit,
      kind: asset.kind,
      recipient: snapshot.binding.ownerAddress,
      tokenAddress: asset.tokenAddress,
    }));
    return {
      assets,
      chainId: 31_337,
      deadline: preview.facts.deadline,
      expiresAt: preview.facts.expiresAt,
      feeLimitTotalBaseUnit: assets
        .reduce((sum, asset) => sum + BigInt(asset.feeLimit.feeCapBaseUnit), 0n)
        .toString(),
      helperAddress: snapshot.binding.helperAddress,
      manualRecoveryRequired: false,
      previewDigest: preview.previewDigest,
      previewToken,
      recipient: snapshot.binding.ownerAddress,
      registryVersion: this.#registry.registryVersion,
      snapshotDigest: request.snapshotDigest,
      walletId: request.walletId,
    };
  }

  #wallet(wallet: CustodyWallet): void {
    if (!uuidPattern.test(wallet.walletId) || !addressPattern.test(wallet.address)) {
      throw new LocalHelperSweepError("WALLET_NOT_FOUND");
    }
    if (wallet.lockStatus !== "ready") throw new LocalHelperSweepError("WALLET_LOCKED");
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
