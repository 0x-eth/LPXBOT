import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  LocalHelperUpgradeOperation,
  LocalHelperUpgradePreview,
  LocalHelperUpgradePreviewRequest,
  LocalHelperUpgradeStepView,
  LocalHelperUpgradeSubmitRequest,
} from "@lpbot/api-contract";
import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  validateLocalHelperUpgradeRegistry,
  type LocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import {
  localHelperUpgradePlanDigest,
  localHelperUpgradePreflightBlockers,
  localHelperUpgradeSelectorSetHash,
  localHelperUpgradeSnapshotDigest,
  validateLocalHelperUpgradePlan,
  validateLocalHelperUpgradeSnapshot,
  type LocalHelperUpgradeFeeLimit,
  type LocalHelperUpgradePlan,
  type LocalHelperUpgradeProviderView,
  type LocalHelperUpgradeSnapshot,
} from "@lpbot/domain/local-helper-upgrade";
import type {
  LocalHelperResidualSnapshot,
  LocalHelperSweepBinding,
} from "@lpbot/domain/local-helper-sweep";
import { getAddress, getContractAddress, type Hex } from "viem";

export const localHelperUpgradePreviewTtlMilliseconds = 5 * 60 * 1_000;
export const localHelperUpgradeBodyLimit = 8_192;

export type LocalHelperUpgradeErrorCode =
  | "BINDING_NOT_FOUND"
  | "CHAIN_NOT_ALLOWED"
  | "HELPER_UPGRADE_IN_PROGRESS"
  | "HELPER_UPGRADE_NOT_FOUND"
  | "HELPER_UPGRADE_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "MANUAL_RECOVERY_REQUIRED"
  | "NONCE_CONFLICT"
  | "PREFLIGHT_FAILED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "PROVIDER_DIVERGENCE"
  | "TARGET_ADDRESS_OCCUPIED"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND";

export class LocalHelperUpgradeError extends Error {
  constructor(
    readonly code: LocalHelperUpgradeErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalHelperUpgradeError";
  }
}

export interface LocalHelperUpgradeChainInspection {
  expectedAddressCode: Hex;
  expectedRuntimeCodeHash: `0x${string}`;
  feeLimit: LocalHelperUpgradeFeeLimit;
  sourceIdentity: LocalHelperUpgradeSnapshot["sourceIdentity"];
}

export interface LocalHelperUpgradeChainReader {
  inspect(input: {
    binding: LocalHelperSweepBinding;
    blockNumber: string;
    expectedAddress: `0x${string}`;
    initCode: Hex;
    walletAddress: `0x${string}`;
  }): Promise<LocalHelperUpgradeChainInspection>;
  nonceSnapshot(input: {
    chainId: 31_337;
    walletAddress: `0x${string}`;
  }): Promise<readonly LocalHelperUpgradeProviderView[]>;
}

export interface LocalHelperUpgradeResidualReader {
  scan(input: {
    binding: LocalHelperSweepBinding;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<Readonly<LocalHelperResidualSnapshot>>;
}

export interface LocalHelperUpgradeBindingStore {
  getSource(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalHelperSweepBinding | null>;
}

export interface StoredLocalHelperUpgradePreview {
  createdAt: Date;
  facts: LocalHelperUpgradePreviewFacts;
  previewDigest: `sha256:${string}`;
  request: LocalHelperUpgradePreviewRequest;
  tenantId: string;
  tokenDigest: string;
  userId: string;
}

export interface LocalHelperUpgradePreviewStore {
  get(token: string): Promise<StoredLocalHelperUpgradePreview | null>;
  put(preview: StoredLocalHelperUpgradePreview): Promise<void>;
}

export interface StoredLocalHelperUpgradeOperation extends LocalHelperUpgradeOperation {
  fencingToken: string;
  plan: LocalHelperUpgradePlan;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface LocalHelperUpgradeCreateInput {
  buildPlan(input: { fencingToken: string; operationId: string }): LocalHelperUpgradePlan;
  expectedNonce: string;
  idempotencyKey: string;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  requestId: string;
  sessionId: string;
  snapshot: LocalHelperUpgradeSnapshot;
  sourceBinding: LocalHelperSweepBinding;
  target: {
    expectedAddress: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
  };
  tenantId: string;
  userId: string;
  wallet: { address: `0x${string}`; walletId: string };
}

export interface LocalHelperUpgradeOperationStore {
  create(input: LocalHelperUpgradeCreateInput): Promise<{
    kind: "created" | "duplicate";
    operation: StoredLocalHelperUpgradeOperation;
  }>;
  findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<{
    operation: StoredLocalHelperUpgradeOperation;
    requestHash: `sha256:${string}`;
  } | null>;
  findLiveOperationIds(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<string[]>;
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalHelperUpgradeOperation | null>;
  latest(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<StoredLocalHelperUpgradeOperation | null>;
  nonceConflict(input: { chainId: 31_337; nonce: string; walletId: string }): Promise<boolean>;
}

export interface LocalHelperUpgradePreviewFacts {
  feeLimit: LocalHelperUpgradeFeeLimit;
  residual: LocalHelperResidualSnapshot;
  snapshot: LocalHelperUpgradeSnapshot;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const idempotencyPattern = /^[!-~]{16,128}$/u;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex")}`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function consensusNonce(providers: readonly LocalHelperUpgradeProviderView[]): string {
  if (providers.length < 1 || providers.length > 4) {
    throw new LocalHelperUpgradeError("PROVIDER_DIVERGENCE", true);
  }
  const ids = new Set<string>();
  const observations = new Set<string>();
  for (const provider of providers) {
    if (ids.has(provider.providerId)) {
      throw new LocalHelperUpgradeError("PROVIDER_DIVERGENCE", true);
    }
    ids.add(provider.providerId);
    try {
      const latest = BigInt(provider.latestNonce);
      const pending = BigInt(provider.pendingNonce);
      if (pending < latest) throw new Error("pending nonce behind latest");
      observations.add(
        `${provider.blockNumber}:${provider.blockHash}:${latest.toString()}:${pending.toString()}`,
      );
    } catch {
      throw new LocalHelperUpgradeError("PROVIDER_DIVERGENCE", true);
    }
  }
  if (observations.size !== 1) {
    throw new LocalHelperUpgradeError("PROVIDER_DIVERGENCE", true);
  }
  return providers[0]!.pendingNonce;
}

function steps(): LocalHelperUpgradeStepView[] {
  return [
    "preflight",
    "deploy-v2",
    "verify-v2",
    "sweep-v1",
    "final-rescan-v1",
    "atomic-binding-switch",
    "completed",
  ].map((cursor) => ({
    cursor: cursor as LocalHelperUpgradeStepView["cursor"],
    failureCode: null,
    state: "pending",
    updatedAt: null,
  }));
}

function publicOperation(
  operation: StoredLocalHelperUpgradeOperation,
): LocalHelperUpgradeOperation {
  return {
    chainId: operation.chainId,
    createdAt: operation.createdAt,
    cursor: operation.cursor,
    expectedTargetAddress: operation.expectedTargetAddress,
    failureCode: operation.failureCode,
    manualRecovery: structuredClone(operation.manualRecovery),
    nonce: operation.nonce,
    operationId: operation.operationId,
    planDigest: operation.planDigest,
    registryVersion: operation.registryVersion,
    sourceBindingId: operation.sourceBindingId,
    sourceHelperAddress: operation.sourceHelperAddress,
    state: operation.state,
    steps: structuredClone(operation.steps),
    sweepBatchId: operation.sweepBatchId,
    transactions: structuredClone(operation.transactions),
    updatedAt: operation.updatedAt,
    versions: structuredClone(operation.versions),
    walletId: operation.walletId,
  };
}

export function parseLocalHelperUpgradePreview(value: unknown): LocalHelperUpgradePreviewRequest {
  if (
    !record(value) ||
    !exact(value, ["chainId", "walletId"]) ||
    value.chainId !== 31_337 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    throw new LocalHelperUpgradeError(
      record(value) && value.chainId !== 31_337 ? "CHAIN_NOT_ALLOWED" : "PREVIEW_INVALID",
    );
  }
  return { chainId: 31_337, walletId: value.walletId.toLowerCase() };
}

export function parseLocalHelperUpgradeSubmit(value: unknown): LocalHelperUpgradeSubmitRequest {
  if (
    !record(value) ||
    !exact(value, ["chainId", "previewDigest", "previewToken", "walletId"]) ||
    value.chainId !== 31_337 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.previewDigest !== "string" ||
    !digestPattern.test(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.previewToken)
  ) {
    throw new LocalHelperUpgradeError("PREVIEW_INVALID");
  }
  return {
    chainId: 31_337,
    previewDigest: value.previewDigest as `sha256:${string}`,
    previewToken: value.previewToken,
    walletId: value.walletId.toLowerCase(),
  };
}

export function parseLocalHelperUpgradeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !idempotencyPattern.test(value)) {
    throw new LocalHelperUpgradeError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseLocalHelperUpgradeId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalHelperUpgradeError("HELPER_UPGRADE_NOT_FOUND");
  }
  return value.toLowerCase();
}

export class MemoryLocalHelperUpgradePreviewStore implements LocalHelperUpgradePreviewStore {
  readonly #values = new Map<string, StoredLocalHelperUpgradePreview>();

  async get(token: string): Promise<StoredLocalHelperUpgradePreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#values.get(tokenHash(token));
    return value ? structuredClone(value) : null;
  }

  async put(preview: StoredLocalHelperUpgradePreview): Promise<void> {
    this.#values.set(preview.tokenDigest, structuredClone(preview));
  }
}

export class MemoryLocalHelperUpgradeBindingStore implements LocalHelperUpgradeBindingStore {
  readonly #values = new Map<string, LocalHelperSweepBinding>();

  seed(input: { tenantId: string; userId: string; binding: LocalHelperSweepBinding }): void {
    this.#values.set(
      `${input.tenantId}:${input.userId}:${input.binding.walletId}`,
      structuredClone(input.binding),
    );
  }

  async getSource(input: { tenantId: string; userId: string; walletId: string }) {
    const value = this.#values.get(`${input.tenantId}:${input.userId}:${input.walletId}`);
    return value ? structuredClone(value) : null;
  }
}

export class MemoryLocalHelperUpgradeOperationStore implements LocalHelperUpgradeOperationStore {
  readonly #idempotency = new Map<
    string,
    { operationId: string; requestHash: `sha256:${string}` }
  >();
  readonly #live = new Map<string, string>();
  readonly #nonce = new Set<string>();
  readonly #operations = new Map<string, StoredLocalHelperUpgradeOperation>();
  readonly #now: () => Date;
  readonly #uuid: () => string;
  #fencingToken = 0n;
  readonly outbox: Array<{ cursor: string; operationId: string }> = [];

  constructor(input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async create(input: LocalHelperUpgradeCreateInput) {
    const idempotencyScope = `${input.tenantId}:${input.userId}:${input.wallet.walletId}:${input.idempotencyKey}`;
    const existing = this.#idempotency.get(idempotencyScope);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new LocalHelperUpgradeError("IDEMPOTENCY_CONFLICT");
      }
      return {
        kind: "duplicate" as const,
        operation: structuredClone(this.#operations.get(existing.operationId)!),
      };
    }
    const liveScope = `${input.tenantId}:${input.userId}:${input.wallet.walletId}`;
    if (this.#live.has(liveScope)) {
      throw new LocalHelperUpgradeError("HELPER_UPGRADE_IN_PROGRESS");
    }
    const nonceScope = `31337:${input.wallet.walletId}:${input.expectedNonce}`;
    if (this.#nonce.has(nonceScope)) throw new LocalHelperUpgradeError("NONCE_CONFLICT");
    this.#fencingToken += 1n;
    const operationId = this.#uuid().toLowerCase();
    const plan = input.buildPlan({
      fencingToken: this.#fencingToken.toString(),
      operationId,
    });
    const createdAt = this.#now().toISOString();
    const operation: StoredLocalHelperUpgradeOperation = {
      chainId: 31_337,
      createdAt,
      cursor: "preflight",
      expectedTargetAddress: input.target.expectedAddress,
      failureCode: null,
      fencingToken: this.#fencingToken.toString(),
      manualRecovery: { blockers: [], required: false },
      nonce: input.expectedNonce,
      operationId,
      plan,
      planDigest: plan.planDigest,
      previewDigest: input.previewDigest,
      registryVersion: "p05-local-helper-upgrade-v3",
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      sourceBindingId: input.sourceBinding.bindingId,
      sourceHelperAddress: input.sourceBinding.helperAddress,
      state: "queued",
      steps: steps(),
      sweepBatchId: null,
      tenantId: input.tenantId,
      transactions: [],
      updatedAt: createdAt,
      userId: input.userId,
      versions: {
        comparison: "upgrade-available",
        source: "WalletHelperV1",
        target: "WalletHelperV2",
      },
      walletId: input.wallet.walletId,
    };
    this.#operations.set(operationId, operation);
    this.#idempotency.set(idempotencyScope, { operationId, requestHash: input.requestHash });
    this.#live.set(liveScope, operationId);
    this.#nonce.add(nonceScope);
    this.outbox.push({ cursor: "preflight", operationId });
    return { kind: "created" as const, operation: structuredClone(operation) };
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }) {
    const value = this.#idempotency.get(
      `${input.tenantId}:${input.userId}:${input.walletId}:${input.idempotencyKey}`,
    );
    const operation = value ? this.#operations.get(value.operationId) : null;
    return value && operation
      ? { operation: structuredClone(operation), requestHash: value.requestHash }
      : null;
  }

  async findLiveOperationIds(input: { tenantId: string; userId: string; walletId: string }) {
    const operationId = this.#live.get(`${input.tenantId}:${input.userId}:${input.walletId}`);
    return operationId ? [operationId] : [];
  }

  async nonceConflict(input: { chainId: 31_337; nonce: string; walletId: string }) {
    return this.#nonce.has(`${input.chainId}:${input.walletId}:${input.nonce}`);
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const value = this.#operations.get(input.operationId);
    return value?.tenantId === input.tenantId && value.userId === input.userId
      ? structuredClone(value)
      : null;
  }

  async latest(input: { tenantId: string; userId: string; walletId: string }) {
    const values = [...this.#operations.values()]
      .filter(
        (value) =>
          value.tenantId === input.tenantId &&
          value.userId === input.userId &&
          value.walletId === input.walletId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return values[0] ? structuredClone(values[0]) : null;
  }
}

export interface LocalHelperUpgradeApplication {
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalHelperUpgradeOperation>;
  latest(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalHelperUpgradeOperation>;
  preview(input: {
    request: LocalHelperUpgradePreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperUpgradePreview>;
  submit(input: {
    idempotencyKey: string;
    request: LocalHelperUpgradeSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: LocalHelperUpgradeOperation }>;
}

export class LocalHelperUpgradeService implements LocalHelperUpgradeApplication {
  readonly #bindings: LocalHelperUpgradeBindingStore;
  readonly #chain: LocalHelperUpgradeChainReader;
  readonly #now: () => Date;
  readonly #operations: LocalHelperUpgradeOperationStore;
  readonly #previews: LocalHelperUpgradePreviewStore;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #registry: LocalHelperUpgradeRegistry;
  readonly #residuals: LocalHelperUpgradeResidualReader;
  readonly #ttl: number;

  constructor(input: {
    bindings: LocalHelperUpgradeBindingStore;
    chain: LocalHelperUpgradeChainReader;
    now?: () => Date;
    operations: LocalHelperUpgradeOperationStore;
    previews: LocalHelperUpgradePreviewStore;
    randomBytes?: (length: number) => Uint8Array;
    registry?: LocalHelperUpgradeRegistry;
    residuals: LocalHelperUpgradeResidualReader;
    ttlMilliseconds?: number;
  }) {
    this.#bindings = input.bindings;
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#previews = input.previews;
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#registry = validateLocalHelperUpgradeRegistry(
      input.registry ?? P05_LOCAL_HELPER_UPGRADE_REGISTRY,
    );
    this.#residuals = input.residuals;
    this.#ttl = input.ttlMilliseconds ?? localHelperUpgradePreviewTtlMilliseconds;
    if (this.#ttl < 1_000 || this.#ttl > 15 * 60_000) {
      throw new RangeError("local Helper upgrade preview TTL is invalid");
    }
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const operation = await this.#operations.get(input);
    if (!operation) throw new LocalHelperUpgradeError("HELPER_UPGRADE_NOT_FOUND");
    return publicOperation(operation);
  }

  async latest(input: { tenantId: string; userId: string; walletId: string }) {
    const operation = await this.#operations.latest(input);
    if (!operation) throw new LocalHelperUpgradeError("HELPER_UPGRADE_NOT_FOUND");
    return publicOperation(operation);
  }

  async preview(input: {
    request: LocalHelperUpgradePreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperUpgradePreview> {
    const wallet = this.#wallet(input.request, input.wallet);
    const createdAt = this.#now();
    const facts = await this.#facts({
      expiresAt: new Date(createdAt.getTime() + this.#ttl).toISOString(),
      tenantId: input.tenantId,
      userId: input.userId,
      wallet,
    });
    const previewDigest = hash({
      facts: this.#previewFactsDigest(facts),
      request: input.request,
      tenantId: input.tenantId,
      userId: input.userId,
    });
    const bytes = Buffer.from(this.#randomBytes(32));
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true);
    }
    const previewToken = bytes.toString("base64url");
    bytes.fill(0);
    await this.#previews.put({
      createdAt,
      facts,
      previewDigest,
      request: structuredClone(input.request),
      tenantId: input.tenantId,
      tokenDigest: tokenHash(previewToken),
      userId: input.userId,
    });
    return this.#publicPreview(facts, previewDigest, previewToken);
  }

  async submit(input: {
    idempotencyKey: string;
    request: LocalHelperUpgradeSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }) {
    const idempotencyKey = parseLocalHelperUpgradeIdempotencyKey(input.idempotencyKey);
    const wallet = this.#wallet(input.request, input.wallet);
    const stored = await this.#previews.get(input.request.previewToken);
    if (
      !stored ||
      stored.tenantId !== input.tenantId ||
      stored.userId !== input.userId ||
      stored.request.chainId !== input.request.chainId ||
      stored.request.walletId !== input.request.walletId ||
      stored.previewDigest !== input.request.previewDigest
    ) {
      throw new LocalHelperUpgradeError("PREVIEW_INVALID");
    }
    const requestHash = hash({
      previewDigest: input.request.previewDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.request.walletId,
    });
    const duplicate = await this.#operations.findIdempotency({
      idempotencyKey,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: wallet.walletId,
    });
    if (duplicate) {
      if (duplicate.requestHash !== requestHash) {
        throw new LocalHelperUpgradeError("IDEMPOTENCY_CONFLICT");
      }
      return { created: false, operation: publicOperation(duplicate.operation) };
    }
    const now = this.#now();
    if (new Date(stored.facts.snapshot.expiresAt) <= now) {
      throw new LocalHelperUpgradeError("PREVIEW_EXPIRED");
    }
    if (!stored.facts.snapshot.eligible) {
      throw new LocalHelperUpgradeError(
        stored.facts.snapshot.v1Residual.manualRecoveryRequired
          ? "MANUAL_RECOVERY_REQUIRED"
          : "PREFLIGHT_FAILED",
      );
    }
    const current = await this.#facts({
      expiresAt: stored.facts.snapshot.expiresAt,
      tenantId: input.tenantId,
      userId: input.userId,
      wallet,
    });
    this.#assertFactsStable(stored.facts, current);
    const snapshot = stored.facts.snapshot;
    const binding = snapshot.sourceBinding;
    const material = buildWalletHelperV2DeploymentMaterial(wallet.address, this.#registry);
    const adapter = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(
      ({ role }) => role === "adapter",
    )!;
    const permit2 = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(
      ({ role }) => role === "permit2",
    )!;
    const selectorSetHash = localHelperUpgradeSelectorSetHash(this.#registry.target.selectors);
    const created = await this.#operations.create({
      buildPlan: ({ fencingToken, operationId }) => {
        const plan: LocalHelperUpgradePlan = {
          chainId: 31_337,
          deadline: snapshot.expiresAt,
          feeLimit: structuredClone(stored.facts.feeLimit),
          fencingToken,
          nonce: snapshot.providers[0]!.pendingNonce,
          operationId,
          planDigest: `sha256:${"0".repeat(64)}`,
          planVersion: "p05-local-helper-upgrade-plan-v3",
          registry: {
            digest: this.#registry.registryDigest,
            rollbackVersion: this.#registry.rollbackVersion,
            version: this.#registry.registryVersion,
          },
          schemaVersion: 3,
          snapshot: {
            blockHash: snapshot.providers[0]!.blockHash,
            blockNumber: snapshot.providers[0]!.blockNumber,
            digest: snapshot.snapshotDigest,
          },
          source: {
            bindingId: binding.bindingId,
            helperAddress: binding.helperAddress,
            helperVersion: "WalletHelperV1",
            runtimeCodeHash: binding.runtimeCodeHash,
          },
          target: {
            abiHash: this.#registry.target.abiHash,
            adapter: adapter.address,
            constructorArgumentsHash: material.constructorArgumentsHash,
            creationCodeHash: this.#registry.target.creationCodeHash,
            expectedAddress: snapshot.target.expectedAddress,
            expectedRuntimeCodeHash: snapshot.target.expectedRuntimeCodeHash,
            helperVersion: "WalletHelperV2",
            owner: wallet.address,
            permit2: permit2.address,
            selectorSetHash,
            tokenA: {
              address: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].address,
              runtimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].runtimeCodeHash,
            },
            tokenB: {
              address: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1].address,
              runtimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1].runtimeCodeHash,
            },
          },
          transaction: {
            data: material.initCode,
            dataHash: material.initCodeHash,
            to: null,
            valueBaseUnit: "0",
          },
          wallet: { address: wallet.address, walletId: wallet.walletId },
        };
        plan.planDigest = localHelperUpgradePlanDigest(plan);
        validateLocalHelperUpgradePlan(
          plan,
          {
            abiHash: this.#registry.target.abiHash,
            adapter: adapter.address,
            constructorArgumentsHash: material.constructorArgumentsHash,
            creationCodeHash: this.#registry.target.creationCodeHash,
            expectedAddress: snapshot.target.expectedAddress,
            expectedRuntimeCodeHash: snapshot.target.expectedRuntimeCodeHash,
            initCode: material.initCode,
            initCodeHash: material.initCodeHash,
            owner: wallet.address,
            permit2: permit2.address,
            registryDigest: this.#registry.registryDigest,
            selectorSetHash,
            sourceBinding: binding,
            tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
            tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
          },
          now,
        );
        return plan;
      },
      expectedNonce: snapshot.providers[0]!.pendingNonce,
      idempotencyKey,
      previewDigest: stored.previewDigest,
      requestHash,
      requestId: input.requestId,
      sessionId: input.sessionId,
      snapshot,
      sourceBinding: binding,
      target: snapshot.target,
      tenantId: input.tenantId,
      userId: input.userId,
      wallet: { address: wallet.address, walletId: wallet.walletId },
    });
    return { created: created.kind === "created", operation: publicOperation(created.operation) };
  }

  async #facts(input: {
    expiresAt: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalHelperUpgradePreviewFacts> {
    const binding = await this.#bindings.getSource({
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!binding) throw new LocalHelperUpgradeError("BINDING_NOT_FOUND");
    const providers = await this.#chain.nonceSnapshot({
      chainId: 31_337,
      walletAddress: input.wallet.address,
    });
    const nonce = consensusNonce(providers);
    const expectedAddress = getContractAddress({
      from: input.wallet.address,
      nonce: BigInt(nonce),
    }).toLowerCase() as `0x${string}`;
    const material = buildWalletHelperV2DeploymentMaterial(input.wallet.address, this.#registry);
    const [inspection, residual, liveOperationIds, nonceConflict] = await Promise.all([
      this.#chain.inspect({
        binding,
        blockNumber: providers[0]!.blockNumber,
        expectedAddress,
        initCode: material.initCode,
        walletAddress: input.wallet.address,
      }),
      this.#residuals.scan({
        binding,
        tenantId: input.tenantId,
        userId: input.userId,
        wallet: input.wallet,
      }),
      this.#operations.findLiveOperationIds({
        tenantId: input.tenantId,
        userId: input.userId,
        walletId: input.wallet.walletId,
      }),
      this.#operations.nonceConflict({ chainId: 31_337, nonce, walletId: input.wallet.walletId }),
    ]);
    if (inspection.expectedAddressCode !== "0x") {
      throw new LocalHelperUpgradeError("TARGET_ADDRESS_OCCUPIED");
    }
    const observedAt = this.#now().toISOString();
    const base = {
      chainId: 31_337 as const,
      expiresAt: input.expiresAt,
      liveOperationIds,
      nonceConflict,
      observedAt,
      providers: structuredClone(providers) as LocalHelperUpgradeProviderView[],
      registry: {
        digest: this.#registry.registryDigest,
        version: this.#registry.registryVersion,
      },
      schemaVersion: 3 as const,
      snapshotVersion: this.#registry.snapshotVersion,
      sourceBinding: binding,
      sourceIdentity: inspection.sourceIdentity,
      target: {
        expectedAddress,
        expectedRuntimeCodeHash: inspection.expectedRuntimeCodeHash,
        helperVersion: "WalletHelperV2" as const,
      },
      v1Residual: {
        coverageComplete: residual.coverage.complete,
        manualRecoveryRequired: residual.manualRecoveryRequired,
        snapshotDigest: residual.snapshotDigest,
      },
      wallet: { address: input.wallet.address, walletId: input.wallet.walletId },
    };
    const context = {
      expectedSourceBinding: binding,
      registryDigest: this.#registry.registryDigest,
      target: { expectedAddress, expectedRuntimeCodeHash: inspection.expectedRuntimeCodeHash },
      wallet: base.wallet,
    };
    const blockers = localHelperUpgradePreflightBlockers(base, context);
    const snapshot: LocalHelperUpgradeSnapshot = {
      ...base,
      blockers,
      eligible: blockers.length === 0,
      snapshotDigest: `sha256:${"0".repeat(64)}`,
    };
    snapshot.snapshotDigest = localHelperUpgradeSnapshotDigest(snapshot);
    validateLocalHelperUpgradeSnapshot(snapshot, context, new Date(this.#now().getTime() - 1));
    return { feeLimit: inspection.feeLimit, residual: structuredClone(residual), snapshot };
  }

  #assertFactsStable(
    previous: LocalHelperUpgradePreviewFacts,
    current: LocalHelperUpgradePreviewFacts,
  ): void {
    const previousBlock = BigInt(previous.snapshot.providers[0]!.blockNumber);
    const currentBlock = BigInt(current.snapshot.providers[0]!.blockNumber);
    if (
      !current.snapshot.eligible ||
      currentBlock < previousBlock ||
      currentBlock - previousBlock > BigInt(this.#registry.maxBlockDrift) ||
      current.snapshot.providers[0]!.pendingNonce !==
        previous.snapshot.providers[0]!.pendingNonce ||
      !same(current.snapshot.sourceBinding, previous.snapshot.sourceBinding) ||
      current.snapshot.target.expectedAddress !== previous.snapshot.target.expectedAddress ||
      current.snapshot.target.expectedRuntimeCodeHash !==
        previous.snapshot.target.expectedRuntimeCodeHash ||
      this.#residualSemanticDigest(current.residual) !==
        this.#residualSemanticDigest(previous.residual) ||
      !same(current.feeLimit, previous.feeLimit)
    ) {
      throw new LocalHelperUpgradeError("PREVIEW_CHANGED");
    }
  }

  #previewFactsDigest(facts: LocalHelperUpgradePreviewFacts): unknown {
    return {
      feeLimit: facts.feeLimit,
      residualDigest: facts.residual.snapshotDigest,
      snapshotDigest: facts.snapshot.snapshotDigest,
    };
  }

  #residualSemanticDigest(snapshot: LocalHelperResidualSnapshot): `sha256:${string}` {
    return hash({
      allowances: snapshot.allowances,
      balances: snapshot.balances,
      binding: snapshot.binding,
      coverage: snapshot.coverage,
      identity: snapshot.identity,
      manualRecoveryRequired: snapshot.manualRecoveryRequired,
      nftCustody: snapshot.nftCustody,
      unknownTokens: snapshot.unknownTokens,
      wallet: snapshot.wallet,
    });
  }

  #publicPreview(
    facts: LocalHelperUpgradePreviewFacts,
    previewDigest: `sha256:${string}`,
    previewToken: string,
  ): LocalHelperUpgradePreview {
    const residual = facts.residual;
    return {
      blockers: [...facts.snapshot.blockers],
      chainId: 31_337,
      expectedTargetAddress: facts.snapshot.target.expectedAddress,
      expectedTargetRuntimeCodeHash: facts.snapshot.target.expectedRuntimeCodeHash,
      expiresAt: facts.snapshot.expiresAt,
      feeLimit: structuredClone(facts.feeLimit),
      nonce: facts.snapshot.providers[0]!.pendingNonce,
      previewDigest,
      previewToken,
      registryVersion: this.#registry.registryVersion,
      residual: {
        allowanceCount: residual.allowances.filter(
          ({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n,
        ).length,
        balancesAboveDust: residual.balances.filter(
          ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) > BigInt(dustBaseUnit),
        ).length,
        nftCustodyCount: residual.nftCustody.length,
        unknownTokenCount: residual.unknownTokens.filter(
          ({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n,
        ).length,
      },
      sourceHelperAddress: facts.snapshot.sourceBinding.helperAddress,
      steps: steps().map(({ cursor }) => cursor),
      upgradeable: facts.snapshot.eligible,
      versions: {
        comparison: "upgrade-available",
        source: "WalletHelperV1",
        target: "WalletHelperV2",
      },
      walletId: facts.snapshot.wallet.walletId,
    };
  }

  #wallet(request: LocalHelperUpgradePreviewRequest, wallet: CustodyWallet): CustodyWallet {
    if (request.chainId !== 31_337) throw new LocalHelperUpgradeError("CHAIN_NOT_ALLOWED");
    if (request.walletId !== wallet.walletId || !uuidPattern.test(wallet.walletId)) {
      throw new LocalHelperUpgradeError("WALLET_NOT_FOUND");
    }
    if (wallet.lockStatus !== "ready") {
      throw new LocalHelperUpgradeError("WALLET_LOCKED");
    }
    try {
      return {
        ...wallet,
        address: getAddress(wallet.address).toLowerCase() as `0x${string}`,
      };
    } catch {
      throw new LocalHelperUpgradeError("WALLET_NOT_FOUND");
    }
  }
}
