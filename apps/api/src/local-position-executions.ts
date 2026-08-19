import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  LocalPositionCollectFeesPreview,
  LocalPositionCollectFeesPreviewRequest,
  LocalPositionCollectFeesRequest,
  LocalPositionExecutionOperation,
  LocalPositionExecutionPreview,
  LocalPositionOperationStep,
  LocalPositionRemoveLiquidityPreview,
  LocalPositionRemoveLiquidityPreviewRequest,
  LocalPositionRemoveLiquidityRequest,
  LocalPositionStepKind,
  PositionPlatformId,
} from "@lpbot/api-contract";
import {
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
  validateLocalPositionExecutionRegistry,
  type LocalPositionExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  LOCAL_POSITION_EXECUTION_PLAN_VERSION,
  localPositionAccounting,
  localPositionExecutionPlanDigest,
  localPositionSnapshotDigest,
  localPositionStepSemanticDigest,
  validateLocalPositionExecutionPlan,
  validateLocalPositionSnapshot,
  type LocalPositionAccounting,
  type LocalPositionExecutionPlan,
  type LocalPositionFeeLimit,
  type LocalPositionPlanStep,
  type LocalPositionSnapshot,
} from "@lpbot/domain/local-position-execution";
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";

export const localPositionExecutionBodyLimit = 8_192;
export const localPositionPreviewTtlMilliseconds = 20_000;
export const localPositionIdempotencyRetentionHours = 24;

export type LocalPositionExecutionErrorCode =
  | "BURN_NOT_ALLOWED"
  | "CHAIN_NOT_ALLOWED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "LOCAL_POSITION_NOT_FOUND"
  | "LOCAL_POSITION_UNAVAILABLE"
  | "MANAGER_IDENTITY_MISMATCH"
  | "NONCE_DRIFT"
  | "NONCE_RECONCILIATION_REQUIRED"
  | "OWNER_APPROVAL_MISMATCH"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "REGISTRY_MISMATCH"
  | "SNAPSHOT_CHANGED"
  | "SNAPSHOT_EXPIRED"
  | "SNAPSHOT_NOT_FOUND"
  | "SNAPSHOT_REORGED"
  | "SNAPSHOT_STALE"
  | "TOKEN_IDENTITY_MISMATCH"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND"
  | "ZERO_LIQUIDITY_DELTA";

export class LocalPositionExecutionError extends Error {
  constructor(
    readonly code: LocalPositionExecutionErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalPositionExecutionError";
  }
}

export interface LocalPositionNonceView {
  latest: string;
  pending: string;
  providerId: string;
}

export interface LocalPositionChainInspection {
  blockHash: Hex;
  blockNumber: string;
  headBlockNumber: string;
  manager: {
    address: Address;
    runtimeCodeHash: Hex | null;
  };
  nonceViews: readonly LocalPositionNonceView[];
  position: LocalPositionSnapshot["position"];
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalPositionExecutionChainReader {
  inspect(input: {
    snapshot: Readonly<LocalPositionSnapshot>;
    walletAddress: Address;
  }): Promise<LocalPositionChainInspection>;
}

export interface LocalPositionSnapshotStore {
  append(input: {
    snapshot: Readonly<LocalPositionSnapshot>;
    tenantId: string;
    userId: string;
  }): Promise<void>;
  get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalPositionSnapshot> | null>;
}

export class MemoryLocalPositionSnapshotStore implements LocalPositionSnapshotStore {
  readonly #snapshots = new Map<string, LocalPositionSnapshot>();

  constructor(
    values: readonly {
      snapshot: Readonly<LocalPositionSnapshot>;
      tenantId: string;
      userId: string;
    }[] = [],
  ) {
    for (const value of values) void this.append(value);
  }

  async append(input: {
    snapshot: Readonly<LocalPositionSnapshot>;
    tenantId: string;
    userId: string;
  }): Promise<void> {
    const key = this.#key({
      snapshotDigest: input.snapshot.snapshotDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.snapshot.wallet.walletId,
    });
    if (!this.#snapshots.has(key)) this.#snapshots.set(key, structuredClone(input.snapshot));
  }

  async get(input: {
    snapshotDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalPositionSnapshot> | null> {
    const value = this.#snapshots.get(this.#key(input));
    return value ? structuredClone(value) : null;
  }

  #key(input: {
    snapshotDigest: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}:${input.snapshotDigest}`;
  }
}

export function buildLocalPositionSnapshot(
  input: Omit<LocalPositionSnapshot, "schemaVersion" | "snapshotDigest" | "snapshotVersion">,
): LocalPositionSnapshot {
  const snapshot: LocalPositionSnapshot = {
    ...structuredClone(input),
    schemaVersion: 2,
    snapshotDigest: `sha256:${"00".repeat(32)}`,
    snapshotVersion: "p05-local-position-snapshot-v2",
  };
  snapshot.snapshotDigest = localPositionSnapshotDigest(snapshot);
  return snapshot;
}

interface PreviewFacts {
  accounting: LocalPositionAccounting;
  action: LocalPositionExecutionPlan["action"];
  blockHash: Hex;
  blockNumber: string;
  expiresAt: string;
  feeLimits: Record<LocalPositionStepKind, LocalPositionFeeLimit>;
  headBlockNumber: string;
  nonce: string;
  nonceViews: readonly LocalPositionNonceView[];
  stepKinds: LocalPositionStepKind[];
}

export interface StoredLocalPositionPreview {
  createdAt: Date;
  facts: PreviewFacts;
  previewDigest: `sha256:${string}`;
  request:
    | LocalPositionCollectFeesPreviewRequest
    | LocalPositionRemoveLiquidityPreviewRequest;
  tenantId: string;
  tokenDigest: string;
  userId: string;
}

export interface LocalPositionPreviewStore {
  get(token: string): Promise<StoredLocalPositionPreview | null>;
  put(preview: StoredLocalPositionPreview): Promise<void>;
}

export class MemoryLocalPositionPreviewStore implements LocalPositionPreviewStore {
  readonly #values = new Map<string, StoredLocalPositionPreview>();

  async get(token: string): Promise<StoredLocalPositionPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#values.get(rawSha256(token));
    return value ? structuredClone(value) : null;
  }

  async put(preview: StoredLocalPositionPreview): Promise<void> {
    if (!this.#values.has(preview.tokenDigest)) {
      this.#values.set(preview.tokenDigest, structuredClone(preview));
    }
  }
}

export interface LocalPositionStepReservation {
  fencingToken: string;
  kind: LocalPositionStepKind;
  nonce: string;
  ordinal: number;
  stepId: string;
}

export interface StoredLocalPositionOperation extends LocalPositionExecutionOperation {
  accounting: LocalPositionAccounting;
  plan: LocalPositionExecutionPlan;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface LocalPositionIdempotencyRecord {
  operation: StoredLocalPositionOperation;
  requestHash: `sha256:${string}`;
}

export interface LocalPositionOperationStore {
  create(input: {
    buildPlan(input: {
      operationId: string;
      reservations: readonly LocalPositionStepReservation[];
    }): LocalPositionExecutionPlan;
    expectedNonce: string;
    idempotencyKey: string;
    nonceViews: readonly LocalPositionNonceView[];
    previewDigest: `sha256:${string}`;
    requestHash: `sha256:${string}`;
    requestId: string;
    sessionId: string;
    snapshotDigest: `sha256:${string}`;
    stepKinds: readonly LocalPositionStepKind[];
    tenantId: string;
    userId: string;
    walletAddress: Address;
    walletId: string;
  }): Promise<{ kind: "created" | "duplicate"; operation: StoredLocalPositionOperation }>;
  findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalPositionIdempotencyRecord | null>;
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalPositionOperation | null>;
}

export class MemoryLocalPositionOperationStore implements LocalPositionOperationStore {
  readonly #idempotency = new Map<
    string,
    { operationId: string; requestHash: `sha256:${string}` }
  >();
  readonly #ledgers = new Map<string, { fencingToken: bigint; nextNonce: bigint | null }>();
  readonly #operations = new Map<string, StoredLocalPositionOperation>();
  readonly #now: () => Date;
  readonly #uuid: () => string;
  readonly outbox: Array<{ operationId: string; state: string; stepId: string }> = [];

  constructor(input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalPositionIdempotencyRecord | null> {
    const value = this.#idempotency.get(this.#scope(input));
    const operation = value ? this.#operations.get(value.operationId) : null;
    return value && operation
      ? { operation: structuredClone(operation), requestHash: value.requestHash }
      : null;
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const operation = this.#operations.get(input.operationId);
    return operation?.tenantId === input.tenantId && operation.userId === input.userId
      ? structuredClone(operation)
      : null;
  }

  async create(input: Parameters<LocalPositionOperationStore["create"]>[0]) {
    const scope = this.#scope(input);
    const existing = this.#idempotency.get(scope);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new LocalPositionExecutionError("IDEMPOTENCY_CONFLICT");
      }
      return {
        kind: "duplicate" as const,
        operation: structuredClone(this.#operations.get(existing.operationId)!),
      };
    }
    const nonce = consensusNonce(input.nonceViews);
    const ledgerScope = `31337:${input.walletId}`;
    const ledger = this.#ledgers.get(ledgerScope) ?? { fencingToken: 0n, nextNonce: null };
    if (ledger.nextNonce === null) ledger.nextNonce = BigInt(nonce);
    if (nonce !== input.expectedNonce || ledger.nextNonce.toString() !== input.expectedNonce) {
      throw new LocalPositionExecutionError("NONCE_DRIFT");
    }
    const reservations = input.stepKinds.map((kind, ordinal) => {
      ledger.fencingToken += 1n;
      const reservation: LocalPositionStepReservation = {
        fencingToken: ledger.fencingToken.toString(),
        kind,
        nonce: ledger.nextNonce!.toString(),
        ordinal,
        stepId: this.#uuid().toLowerCase(),
      };
      ledger.nextNonce! += 1n;
      return reservation;
    });
    this.#ledgers.set(ledgerScope, ledger);
    const operationId = this.#uuid().toLowerCase();
    const plan = input.buildPlan({ operationId, reservations });
    const createdAt = this.#now().toISOString();
    const steps: LocalPositionOperationStep[] = plan.steps.map((step, ordinal) => ({
      failureCode: null,
      feeLimit: structuredClone(step.feeLimit),
      kind: step.kind,
      nonce: step.nonce,
      ordinal,
      state: ordinal === 0 ? "queued" : "blocked",
      stepId: step.stepId,
      transactions: [],
    }));
    const operation: StoredLocalPositionOperation = {
      accounting: structuredClone(plan.accounting),
      burnIfEmpty: plan.action.burnIfEmpty,
      chainId: 31_337,
      createdAt,
      failureCode: null,
      managerAddress: plan.manager.address,
      operationId,
      operationKind:
        plan.action.kind === "collect-fees"
          ? "position-collect-fees"
          : "position-remove-liquidity",
      percent: plan.action.percent,
      plan,
      planDigest: plan.planDigest,
      platformId: plan.snapshot.position.platformId,
      previewDigest: input.previewDigest,
      reconciliationReason: null,
      registryVersion: "p05-local-position-execution-v2",
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      slippageBps: plan.action.slippageBps,
      snapshotDigest: plan.snapshot.snapshotDigest,
      state: "queued",
      steps,
      tenantId: input.tenantId,
      tokenId: plan.snapshot.position.tokenId,
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    };
    this.#operations.set(operationId, operation);
    this.#idempotency.set(scope, { operationId, requestHash: input.requestHash });
    this.outbox.push({ operationId, state: "queued", stepId: steps[0]!.stepId });
    return { kind: "created" as const, operation: structuredClone(operation) };
  }

  #scope(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}:${input.idempotencyKey}`;
  }
}

export interface LocalPositionExecutionApplication {
  collectFees(input: {
    idempotencyKey: string;
    request: LocalPositionCollectFeesRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: LocalPositionExecutionOperation }>;
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalPositionExecutionOperation>;
  previewCollectFees(input: {
    request: LocalPositionCollectFeesPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalPositionCollectFeesPreview>;
  previewRemoveLiquidity(input: {
    request: LocalPositionRemoveLiquidityPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalPositionRemoveLiquidityPreview>;
  removeLiquidity(input: {
    idempotencyKey: string;
    request: LocalPositionRemoveLiquidityRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: LocalPositionExecutionOperation }>;
}

const managerAbi = parseAbi([
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) returns (uint256 amount0,uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) returns (uint256 amount0,uint256 amount1)",
  "function burn(uint256 tokenId)",
]);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const idempotencyPattern = /^[!-~]{16,128}$/u;
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

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function parseWalletId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
  }
  return value.toLowerCase();
}

function parsePlatformId(value: unknown): PositionPlatformId {
  if (value !== 1 && value !== 2 && value !== 4 && value !== 5) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return value;
}

function parseTokenId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value) || value.length > 78) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return value;
}

function parseSnapshotDigest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return value as `sha256:${string}`;
}

export function parseLocalPositionCollectFeesPreview(
  value: unknown,
): LocalPositionCollectFeesPreviewRequest {
  const input = record(value);
  if (!exactKeys(input, ["platformId", "snapshotDigest", "tokenId", "walletId"])) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return {
    platformId: parsePlatformId(input.platformId),
    snapshotDigest: parseSnapshotDigest(input.snapshotDigest),
    tokenId: parseTokenId(input.tokenId),
    walletId: parseWalletId(input.walletId),
  };
}

export function parseLocalPositionCollectFees(value: unknown): LocalPositionCollectFeesRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "platformId",
      "previewDigest",
      "previewToken",
      "snapshotDigest",
      "tokenId",
      "walletId",
    ]) ||
    typeof input.previewDigest !== "string" ||
    !digestPattern.test(input.previewDigest) ||
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken)
  ) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return {
    ...parseLocalPositionCollectFeesPreview({
      platformId: input.platformId,
      snapshotDigest: input.snapshotDigest,
      tokenId: input.tokenId,
      walletId: input.walletId,
    }),
    previewDigest: input.previewDigest as `sha256:${string}`,
    previewToken: input.previewToken,
  };
}

export function parseLocalPositionRemoveLiquidityPreview(
  value: unknown,
): LocalPositionRemoveLiquidityPreviewRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "burnIfEmpty",
      "percent",
      "platformId",
      "slippageBps",
      "snapshotDigest",
      "tokenId",
      "walletId",
    ]) ||
    typeof input.burnIfEmpty !== "boolean" ||
    !Number.isSafeInteger(input.percent) ||
    Number(input.percent) < 1 ||
    Number(input.percent) > 100 ||
    !Number.isSafeInteger(input.slippageBps) ||
    Number(input.slippageBps) < 1 ||
    Number(input.slippageBps) > 500
  ) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  if (input.burnIfEmpty && input.percent !== 100) {
    throw new LocalPositionExecutionError("BURN_NOT_ALLOWED");
  }
  return {
    burnIfEmpty: input.burnIfEmpty,
    percent: Number(input.percent),
    platformId: parsePlatformId(input.platformId),
    slippageBps: Number(input.slippageBps),
    snapshotDigest: parseSnapshotDigest(input.snapshotDigest),
    tokenId: parseTokenId(input.tokenId),
    walletId: parseWalletId(input.walletId),
  };
}

export function parseLocalPositionRemoveLiquidity(
  value: unknown,
): LocalPositionRemoveLiquidityRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "burnIfEmpty",
      "percent",
      "platformId",
      "previewDigest",
      "previewToken",
      "slippageBps",
      "snapshotDigest",
      "tokenId",
      "walletId",
    ]) ||
    typeof input.previewDigest !== "string" ||
    !digestPattern.test(input.previewDigest) ||
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken)
  ) {
    throw new LocalPositionExecutionError("PREVIEW_INVALID");
  }
  return {
    ...parseLocalPositionRemoveLiquidityPreview({
      burnIfEmpty: input.burnIfEmpty,
      percent: input.percent,
      platformId: input.platformId,
      slippageBps: input.slippageBps,
      snapshotDigest: input.snapshotDigest,
      tokenId: input.tokenId,
      walletId: input.walletId,
    }),
    previewDigest: input.previewDigest as `sha256:${string}`,
    previewToken: input.previewToken,
  };
}

export function parseLocalPositionIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !idempotencyPattern.test(value)) {
    throw new LocalPositionExecutionError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseLocalPositionOperationId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalPositionExecutionError("LOCAL_POSITION_NOT_FOUND");
  }
  return value.toLowerCase();
}

function decimal(value: string, code: LocalPositionExecutionErrorCode): bigint {
  if (!decimalPattern.test(value) || value.length > 78) {
    throw new LocalPositionExecutionError(code, true);
  }
  return BigInt(value);
}

function consensusNonce(views: readonly LocalPositionNonceView[]): string {
  if (views.length < 1 || views.length > 4) {
    throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const providers = new Set<string>();
  const values = new Set<string>();
  for (const view of views) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(view.providerId) ||
      providers.has(view.providerId)
    ) {
      throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providers.add(view.providerId);
    const latest = decimal(view.latest, "NONCE_RECONCILIATION_REQUIRED");
    const pending = decimal(view.pending, "NONCE_RECONCILIATION_REQUIRED");
    if (pending < latest) {
      throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    values.add(`${latest}:${pending}`);
  }
  if (values.size !== 1) {
    throw new LocalPositionExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return views[0]!.pending;
}

function feeLimit(kind: LocalPositionStepKind): LocalPositionFeeLimit {
  const gasLimit = kind === "decrease" ? 220_000n : kind === "collect" ? 180_000n : 100_000n;
  const maxFee = 4_000_000_000n;
  const maxPriority = 2_000_000_000n;
  return {
    feeCapBaseUnit: (gasLimit * maxFee).toString(),
    gasLimit: gasLimit.toString(),
    maxFeePerGasBaseUnit: maxFee.toString(),
    maxPriorityFeePerGasBaseUnit: maxPriority.toString(),
  };
}

function publicOperation(operation: StoredLocalPositionOperation): LocalPositionExecutionOperation {
  return {
    burnIfEmpty: operation.burnIfEmpty,
    chainId: 31_337,
    createdAt: operation.createdAt,
    failureCode: operation.failureCode,
    managerAddress: operation.managerAddress,
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    percent: operation.percent,
    planDigest: operation.planDigest,
    platformId: operation.platformId,
    reconciliationReason: operation.reconciliationReason,
    registryVersion: operation.registryVersion,
    slippageBps: operation.slippageBps,
    snapshotDigest: operation.snapshotDigest,
    state: operation.state,
    steps: structuredClone(operation.steps),
    tokenId: operation.tokenId,
    updatedAt: operation.updatedAt,
    walletId: operation.walletId,
  };
}

export class LocalPositionExecutionService implements LocalPositionExecutionApplication {
  readonly #chain: LocalPositionExecutionChainReader;
  readonly #now: () => Date;
  readonly #operations: LocalPositionOperationStore;
  readonly #previews: LocalPositionPreviewStore;
  readonly #randomBytes: (size: number) => Uint8Array;
  readonly #registry: LocalPositionExecutionRegistry;
  readonly #snapshots: LocalPositionSnapshotStore;

  constructor(input: {
    chain: LocalPositionExecutionChainReader;
    now?: () => Date;
    operations: LocalPositionOperationStore;
    previews: LocalPositionPreviewStore;
    randomBytes?: (size: number) => Uint8Array;
    registry?: LocalPositionExecutionRegistry;
    snapshots: LocalPositionSnapshotStore;
  }) {
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#previews = input.previews;
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#registry = validateLocalPositionExecutionRegistry(
      input.registry ?? P05_LOCAL_POSITION_EXECUTION_REGISTRY,
    );
    this.#snapshots = input.snapshots;
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const operation = await this.#operations.get(input);
    if (!operation) throw new LocalPositionExecutionError("LOCAL_POSITION_NOT_FOUND");
    return publicOperation(operation);
  }

  async previewCollectFees(input: {
    request: LocalPositionCollectFeesPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalPositionCollectFeesPreview> {
    const action = {
      burnIfEmpty: false,
      kind: "collect-fees",
      percent: null,
      slippageBps: null,
    } as const;
    return (await this.#preview(input, action)) as LocalPositionCollectFeesPreview;
  }

  async previewRemoveLiquidity(input: {
    request: LocalPositionRemoveLiquidityPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalPositionRemoveLiquidityPreview> {
    const action = {
      burnIfEmpty: input.request.burnIfEmpty,
      kind: "remove-liquidity",
      percent: input.request.percent,
      slippageBps: input.request.slippageBps,
    } as const;
    if (action.burnIfEmpty && action.percent !== 100) {
      throw new LocalPositionExecutionError("BURN_NOT_ALLOWED");
    }
    return (await this.#preview(input, action)) as LocalPositionRemoveLiquidityPreview;
  }

  async collectFees(input: {
    idempotencyKey: string;
    request: LocalPositionCollectFeesRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }) {
    return this.#submit(input, "collect-fees");
  }

  async removeLiquidity(input: {
    idempotencyKey: string;
    request: LocalPositionRemoveLiquidityRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }) {
    return this.#submit(input, "remove-liquidity");
  }

  async #preview(
    input: {
      request:
        | LocalPositionCollectFeesPreviewRequest
        | LocalPositionRemoveLiquidityPreviewRequest;
      tenantId: string;
      userId: string;
      wallet: CustodyWallet;
    },
    action: LocalPositionExecutionPlan["action"],
  ): Promise<LocalPositionExecutionPreview> {
    this.#assertWallet(input.request.walletId, input.wallet);
    const snapshot = await this.#snapshot(input, input.request);
    let accounting: LocalPositionAccounting;
    try {
      accounting = localPositionAccounting(snapshot, action);
    } catch (error) {
      if (error instanceof RangeError && error.message === "LOCAL_POSITION_ZERO_LIQUIDITY_DELTA") {
        throw new LocalPositionExecutionError("ZERO_LIQUIDITY_DELTA");
      }
      throw error;
    }
    const inspection = await this.#chain.inspect({
      snapshot,
      walletAddress: input.wallet.address.toLowerCase() as Address,
    });
    this.#verifyInspection(snapshot, inspection);
    const now = this.#now();
    const expiresAt = new Date(
      Math.min(Date.parse(snapshot.expiresAt), now.getTime() + localPositionPreviewTtlMilliseconds),
    ).toISOString();
    const stepKinds: LocalPositionStepKind[] =
      action.kind === "collect-fees"
        ? ["collect"]
        : action.burnIfEmpty
          ? ["decrease", "collect", "burn"]
          : ["decrease", "collect"];
    const facts: PreviewFacts = {
      accounting,
      action,
      blockHash: inspection.blockHash,
      blockNumber: inspection.blockNumber,
      expiresAt,
      feeLimits: {
        burn: feeLimit("burn"),
        collect: feeLimit("collect"),
        decrease: feeLimit("decrease"),
      },
      headBlockNumber: inspection.headBlockNumber,
      nonce: consensusNonce(inspection.nonceViews),
      nonceViews: structuredClone(inspection.nonceViews),
      stepKinds,
    };
    const previewDigest = digest({ facts, request: input.request });
    const bytes = Buffer.from(this.#randomBytes(32));
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true);
    }
    const previewToken = bytes.toString("base64url");
    bytes.fill(0);
    await this.#previews.put({
      createdAt: now,
      facts,
      previewDigest,
      request: structuredClone(input.request),
      tenantId: input.tenantId,
      tokenDigest: rawSha256(previewToken),
      userId: input.userId,
    });
    return this.#publicPreview(input.request, snapshot, facts, previewDigest, previewToken);
  }

  async #submit(
    input: {
      idempotencyKey: string;
      request: LocalPositionCollectFeesRequest | LocalPositionRemoveLiquidityRequest;
      requestId: string;
      sessionId: string;
      tenantId: string;
      userId: string;
      wallet: CustodyWallet;
    },
    expectedKind: "collect-fees" | "remove-liquidity",
  ): Promise<{ created: boolean; operation: LocalPositionExecutionOperation }> {
    const idempotencyKey = parseLocalPositionIdempotencyKey(input.idempotencyKey);
    this.#assertWallet(input.request.walletId, input.wallet);
    const preview = await this.#previews.get(input.request.previewToken);
    const requestWithoutOpaque = this.#withoutOpaque(input.request);
    if (
      !preview ||
      preview.tenantId !== input.tenantId ||
      preview.userId !== input.userId ||
      preview.previewDigest !== input.request.previewDigest ||
      preview.facts.action.kind !== expectedKind ||
      !same(preview.request, requestWithoutOpaque)
    ) {
      throw new LocalPositionExecutionError("PREVIEW_INVALID");
    }
    const requestHash = digest({
      action: preview.facts.action,
      previewDigest: preview.previewDigest,
      snapshotDigest: input.request.snapshotDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.request.walletId,
    });
    const existing = await this.#operations.findIdempotency({
      idempotencyKey,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.request.walletId,
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new LocalPositionExecutionError("IDEMPOTENCY_CONFLICT");
      }
      return { created: false, operation: publicOperation(existing.operation) };
    }
    const now = this.#now();
    if (new Date(preview.facts.expiresAt) <= now) {
      throw new LocalPositionExecutionError("PREVIEW_EXPIRED");
    }
    const snapshot = await this.#snapshot(input, input.request);
    const inspection = await this.#chain.inspect({
      snapshot,
      walletAddress: input.wallet.address.toLowerCase() as Address,
    });
    this.#verifyInspection(snapshot, inspection);
    if (consensusNonce(inspection.nonceViews) !== preview.facts.nonce) {
      throw new LocalPositionExecutionError("NONCE_DRIFT");
    }
    const currentFacts: PreviewFacts = {
      ...structuredClone(preview.facts),
      blockHash: inspection.blockHash,
      blockNumber: inspection.blockNumber,
      headBlockNumber: inspection.headBlockNumber,
      nonce: consensusNonce(inspection.nonceViews),
      nonceViews: structuredClone(inspection.nonceViews),
    };
    if (digest({ facts: currentFacts, request: preview.request }) !== preview.previewDigest) {
      throw new LocalPositionExecutionError("PREVIEW_CHANGED");
    }
    const result = await this.#operations.create({
      buildPlan: ({ operationId, reservations }) =>
        this.#buildPlan({ facts: currentFacts, operationId, reservations, snapshot }),
      expectedNonce: currentFacts.nonce,
      idempotencyKey,
      nonceViews: currentFacts.nonceViews,
      previewDigest: preview.previewDigest,
      requestHash,
      requestId: input.requestId,
      sessionId: input.sessionId,
      snapshotDigest: snapshot.snapshotDigest,
      stepKinds: currentFacts.stepKinds,
      tenantId: input.tenantId,
      userId: input.userId,
      walletAddress: snapshot.wallet.address,
      walletId: snapshot.wallet.walletId,
    });
    return { created: result.kind === "created", operation: publicOperation(result.operation) };
  }

  #withoutOpaque(
    request: LocalPositionCollectFeesRequest | LocalPositionRemoveLiquidityRequest,
  ):
    | LocalPositionCollectFeesPreviewRequest
    | LocalPositionRemoveLiquidityPreviewRequest {
    const { previewDigest: _previewDigest, previewToken: _previewToken, ...result } = request;
    return result;
  }

  #assertWallet(walletId: string, wallet: CustodyWallet): void {
    if (wallet.walletId !== walletId) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
    if (wallet.lockStatus !== "ready") throw new LocalPositionExecutionError("WALLET_LOCKED");
  }

  async #snapshot(
    input: { tenantId: string; userId: string; wallet: CustodyWallet },
    request: {
      platformId: PositionPlatformId;
      snapshotDigest: `sha256:${string}`;
      tokenId: string;
      walletId: string;
    },
  ): Promise<LocalPositionSnapshot> {
    const snapshot = await this.#snapshots.get({
      snapshotDigest: request.snapshotDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!snapshot) throw new LocalPositionExecutionError("SNAPSHOT_NOT_FOUND");
    try {
      validateLocalPositionSnapshot(snapshot, this.#now());
    } catch {
      throw new LocalPositionExecutionError("SNAPSHOT_EXPIRED");
    }
    if (
      snapshot.snapshotDigest !== request.snapshotDigest ||
      localPositionSnapshotDigest(snapshot) !== request.snapshotDigest ||
      snapshot.wallet.walletId !== input.wallet.walletId ||
      snapshot.wallet.address !== input.wallet.address.toLowerCase() ||
      snapshot.position.owner !== snapshot.wallet.address ||
      snapshot.position.platformId !== request.platformId ||
      snapshot.position.tokenId !== request.tokenId
    ) {
      throw new LocalPositionExecutionError("SNAPSHOT_CHANGED");
    }
    if (
      snapshot.registry.version !== this.#registry.registryVersion ||
      snapshot.registry.digest !== this.#registry.registryDigest
    ) {
      throw new LocalPositionExecutionError("REGISTRY_MISMATCH");
    }
    if (
      snapshot.manager.address !== this.#registry.manager.address ||
      snapshot.manager.abiHash !== this.#registry.manager.abiHash ||
      snapshot.manager.runtimeCodeHash !== this.#registry.manager.runtimeCodeHash
    ) {
      throw new LocalPositionExecutionError("MANAGER_IDENTITY_MISMATCH");
    }
    for (const [index, address] of [
      snapshot.position.pool.token0,
      snapshot.position.pool.token1,
    ].entries()) {
      const expected = this.#registry.tokenPolicy.tokens.find((token) => token.address === address);
      if (
        !expected ||
        snapshot.tokens[index]?.address !== expected.address ||
        snapshot.tokens[index]?.runtimeCodeHash !== expected.runtimeCodeHash
      ) {
        throw new LocalPositionExecutionError("TOKEN_IDENTITY_MISMATCH");
      }
    }
    return structuredClone(snapshot);
  }

  #verifyInspection(
    snapshot: LocalPositionSnapshot,
    inspection: LocalPositionChainInspection,
  ): void {
    if (inspection.blockNumber !== snapshot.block.number) {
      throw new LocalPositionExecutionError("SNAPSHOT_CHANGED");
    }
    if (inspection.blockHash !== snapshot.block.hash) {
      throw new LocalPositionExecutionError("SNAPSHOT_REORGED");
    }
    if (
      decimal(inspection.headBlockNumber, "LOCAL_POSITION_UNAVAILABLE") <
        decimal(snapshot.block.number, "LOCAL_POSITION_UNAVAILABLE") ||
      BigInt(inspection.headBlockNumber) >
        BigInt(snapshot.block.number) + BigInt(this.#registry.maxBlockDrift)
    ) {
      throw new LocalPositionExecutionError("SNAPSHOT_STALE");
    }
    if (
      inspection.manager.address !== snapshot.manager.address ||
      inspection.manager.runtimeCodeHash !== snapshot.manager.runtimeCodeHash
    ) {
      throw new LocalPositionExecutionError("MANAGER_IDENTITY_MISMATCH");
    }
    if (!same(inspection.position, snapshot.position)) {
      const ownerOrApprovalChanged =
        inspection.position.owner !== snapshot.position.owner ||
        !same(inspection.position.approval, snapshot.position.approval);
      throw new LocalPositionExecutionError(
        ownerOrApprovalChanged ? "OWNER_APPROVAL_MISMATCH" : "SNAPSHOT_CHANGED",
      );
    }
    for (const expected of snapshot.tokens) {
      const actual = inspection.tokenCode.find(({ address }) => address === expected.address);
      if (!actual || actual.runtimeCodeHash !== expected.runtimeCodeHash) {
        throw new LocalPositionExecutionError("TOKEN_IDENTITY_MISMATCH");
      }
    }
  }

  #publicPreview(
    request:
      | LocalPositionCollectFeesPreviewRequest
      | LocalPositionRemoveLiquidityPreviewRequest,
    snapshot: LocalPositionSnapshot,
    facts: PreviewFacts,
    previewDigest: `sha256:${string}`,
    previewToken: string,
  ): LocalPositionExecutionPreview {
    const steps = facts.stepKinds.map((kind, ordinal) => ({
      feeLimit: structuredClone(facts.feeLimits[kind]),
      kind,
      ordinal,
    }));
    const common = {
      ...request,
      chainId: 31_337 as const,
      deadline: new Date(
        this.#now().getTime() + this.#registry.maxDeadlineSeconds * 1_000,
      ).toISOString(),
      expectedToken0DeltaBaseUnit: facts.accounting.collectTotal0BaseUnit,
      expectedToken1DeltaBaseUnit: facts.accounting.collectTotal1BaseUnit,
      expiresAt: facts.expiresAt,
      feeLimitTotalBaseUnit: steps
        .reduce((total, step) => total + BigInt(step.feeLimit.feeCapBaseUnit), 0n)
        .toString(),
      feeProceeds0BaseUnit: facts.accounting.feeProceeds0BaseUnit,
      feeProceeds1BaseUnit: facts.accounting.feeProceeds1BaseUnit,
      liquidityDelta: facts.accounting.liquidityDelta,
      managerAddress: snapshot.manager.address,
      minPrincipal0BaseUnit: facts.accounting.minPrincipal0BaseUnit,
      minPrincipal1BaseUnit: facts.accounting.minPrincipal1BaseUnit,
      previewDigest,
      previewToken,
      principal0BaseUnit: facts.accounting.principal0BaseUnit,
      principal1BaseUnit: facts.accounting.principal1BaseUnit,
      remainingLiquidity: facts.accounting.remainingLiquidity,
      serviceFeeBps: 0 as const,
      steps,
    };
    return facts.action.kind === "collect-fees"
      ? {
          ...common,
          burnIfEmpty: false,
          operationKind: "position-collect-fees",
          percent: null,
          slippageBps: null,
        }
      : {
          ...common,
          burnIfEmpty: facts.action.burnIfEmpty,
          operationKind: "position-remove-liquidity",
          percent: facts.action.percent,
          slippageBps: facts.action.slippageBps,
        };
  }

  #buildPlan(input: {
    facts: PreviewFacts;
    operationId: string;
    reservations: readonly LocalPositionStepReservation[];
    snapshot: LocalPositionSnapshot;
  }): LocalPositionExecutionPlan {
    const deadline = new Date(
      this.#now().getTime() + this.#registry.maxDeadlineSeconds * 1_000,
    ).toISOString();
    const deadlineSeconds = BigInt(Math.floor(Date.parse(deadline) / 1_000));
    const accounting = input.facts.accounting;
    const data = (kind: LocalPositionStepKind): Hex => {
      if (kind === "decrease") {
        return encodeFunctionData({
          abi: managerAbi,
          args: [
            {
              amount0Min: BigInt(accounting.minPrincipal0BaseUnit),
              amount1Min: BigInt(accounting.minPrincipal1BaseUnit),
              deadline: deadlineSeconds,
              liquidity: BigInt(accounting.liquidityDelta),
              tokenId: BigInt(input.snapshot.position.tokenId),
            },
          ],
          functionName: "decreaseLiquidity",
        });
      }
      if (kind === "collect") {
        return encodeFunctionData({
          abi: managerAbi,
          args: [
            {
              amount0Max: BigInt(accounting.collectTotal0BaseUnit),
              amount1Max: BigInt(accounting.collectTotal1BaseUnit),
              recipient: getAddress(input.snapshot.wallet.address),
              tokenId: BigInt(input.snapshot.position.tokenId),
            },
          ],
          functionName: "collect",
        });
      }
      return encodeFunctionData({
        abi: managerAbi,
        args: [BigInt(input.snapshot.position.tokenId)],
        functionName: "burn",
      });
    };
    const steps: LocalPositionPlanStep[] = input.reservations.map((reservation) => {
      const transactionData = data(reservation.kind);
      const step: LocalPositionPlanStep = {
        feeLimit: structuredClone(input.facts.feeLimits[reservation.kind]),
        fencingToken: reservation.fencingToken,
        kind: reservation.kind,
        nonce: reservation.nonce,
        ordinal: reservation.ordinal,
        runCondition: "always",
        semanticDigest: `sha256:${"00".repeat(32)}`,
        stepId: reservation.stepId,
        transaction: {
          data: transactionData,
          dataDigest: digest(transactionData),
          to: input.snapshot.manager.address,
          valueBaseUnit: "0",
        },
      };
      step.semanticDigest = localPositionStepSemanticDigest(step);
      return step;
    });
    const manager: LocalPositionExecutionPlan["manager"] = {
      ...structuredClone(input.snapshot.manager),
      selectors: structuredClone(this.#registry.manager.selectors),
    };
    const plan: LocalPositionExecutionPlan = {
      accounting: structuredClone(accounting),
      action: structuredClone(input.facts.action),
      chainId: 31_337,
      deadline,
      manager,
      operationId: input.operationId,
      planDigest: `sha256:${"00".repeat(32)}`,
      planVersion: LOCAL_POSITION_EXECUTION_PLAN_VERSION,
      registry: {
        digest: this.#registry.registryDigest,
        rollbackVersion: this.#registry.rollbackVersion,
        version: this.#registry.registryVersion,
      },
      schemaVersion: 2,
      serviceFeeBps: 0,
      snapshot: structuredClone(input.snapshot),
      steps,
      wallet: structuredClone(input.snapshot.wallet),
    };
    plan.planDigest = localPositionExecutionPlanDigest(plan);
    validateLocalPositionExecutionPlan(
      plan,
      {
        currentBlockHash: input.facts.blockHash,
        currentBlockNumber: input.facts.blockNumber,
        expectedAccounting: structuredClone(accounting),
        expectedAction: structuredClone(input.facts.action),
        expectedManager: structuredClone(manager),
        expectedSnapshot: structuredClone(input.snapshot),
        expectedSteps: structuredClone(steps),
        expectedWallet: structuredClone(input.snapshot.wallet),
        registryDigest: this.#registry.registryDigest,
      },
      this.#now(),
    );
    return plan;
  }
}
