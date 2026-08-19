import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  HelperDeploymentFeeLimit,
  HelperDeploymentOperation,
  HelperDeploymentPreview,
  HelperDeploymentPreviewRequest,
  HelperDeploymentSubmitRequest,
} from "@lpbot/api-contract";
import {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  validateHelperDeploymentRegistry,
  type HelperDeploymentRegistry,
} from "@lpbot/chain-registry";
import {
  HELPER_DEPLOYMENT_PLAN_VERSION,
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
  type HelperDeploymentPlanValidationContext,
} from "@lpbot/domain/helper-deployment";
import { getAddress, getContractAddress, type Hex } from "viem";

export const helperDeploymentPreviewTtlMilliseconds = 5 * 60 * 1_000;
export const helperDeploymentIdempotencyRetentionHours = 24;
export const helperDeploymentBodyLimit = 8_192;

export type HelperDeploymentErrorCode =
  | "CHAIN_NOT_ALLOWED"
  | "HELPER_ADDRESS_OCCUPIED"
  | "HELPER_ALREADY_ACTIVE"
  | "HELPER_CODE_IDENTITY_MISMATCH"
  | "HELPER_DEPLOYMENT_IN_PROGRESS"
  | "HELPER_DEPLOYMENT_NOT_FOUND"
  | "HELPER_DEPLOYMENT_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "NONCE_DRIFT"
  | "NONCE_RECONCILIATION_REQUIRED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "REGISTRY_MISMATCH"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND";

export class HelperDeploymentError extends Error {
  constructor(
    readonly code: HelperDeploymentErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "HelperDeploymentError";
  }
}

export interface HelperDeploymentNonceView {
  latest: string;
  pending: string;
  providerId: string;
}

export interface HelperDeploymentNonceSnapshot {
  blockHash: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  chainId: number;
  views: readonly HelperDeploymentNonceView[];
}

export interface HelperDeploymentInspection {
  componentCode: readonly {
    address: `0x${string}`;
    role: "adapter" | "permit2";
    runtimeCodeHash: `0x${string}` | null;
  }[];
  expectedAddressCode: Hex;
  expectedRuntimeCodeHash: `0x${string}`;
  feeLimit: HelperDeploymentFeeLimit;
  tokenCode: readonly {
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}` | null;
  }[];
}

export interface HelperDeploymentChainReader {
  inspectDeployment(input: {
    blockNumber: string;
    chainId: 31_337;
    expectedAddress: `0x${string}`;
    initCode: Hex;
    walletAddress: `0x${string}`;
  }): Promise<HelperDeploymentInspection>;
  nonceSnapshot(input: {
    chainId: 31_337;
    walletAddress: `0x${string}`;
  }): Promise<HelperDeploymentNonceSnapshot>;
}

export interface StoredHelperDeploymentPreview {
  createdAt: Date;
  facts: HelperDeploymentPreviewFacts;
  previewDigest: `sha256:${string}`;
  request: HelperDeploymentPreviewRequest;
  tenantId: string;
  tokenDigest: string;
  userId: string;
}

export interface HelperDeploymentPreviewStore {
  get(token: string): Promise<StoredHelperDeploymentPreview | null>;
  put(preview: StoredHelperDeploymentPreview): Promise<void>;
}

export interface StoredHelperDeploymentOperation extends HelperDeploymentOperation {
  fencingToken: string;
  plan: HelperDeploymentPlan;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface HelperDeploymentIdempotencyRecord {
  operation: StoredHelperDeploymentOperation;
  requestHash: `sha256:${string}`;
}

export interface HelperDeploymentCreateInput {
  buildPlan(input: {
    fencingToken: string;
    nonce: string;
    operationId: string;
  }): HelperDeploymentPlan;
  chainId: 31_337;
  expectedAddress: `0x${string}`;
  expectedNonce: string;
  expectedRuntimeCodeHash: `0x${string}`;
  feeLimit: HelperDeploymentFeeLimit;
  helperVersion: "WalletHelperV1";
  idempotencyKey: string;
  nonceViews: readonly HelperDeploymentNonceView[];
  previewDigest: `sha256:${string}`;
  registryVersion: string;
  requestHash: `sha256:${string}`;
  requestId: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  walletAddress: `0x${string}`;
  walletId: string;
}

export interface HelperDeploymentOperationStore {
  create(
    input: HelperDeploymentCreateInput,
  ): Promise<{ kind: "created" | "duplicate"; operation: StoredHelperDeploymentOperation }>;
  findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<HelperDeploymentIdempotencyRecord | null>;
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredHelperDeploymentOperation | null>;
}

interface HelperDeploymentPreviewFacts {
  blockHash: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  constructorArgumentsHash: `sha256:${string}`;
  expectedAddress: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  expiresAt: string;
  feeLimit: HelperDeploymentFeeLimit;
  initCode: Hex;
  initCodeHash: `0x${string}`;
  nonce: string;
  owner: `0x${string}`;
  snapshotDigest: `sha256:${string}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const idempotencyPattern = /^[!-~]{16,128}$/u;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
  return `sha256:${sha256(JSON.stringify(canonical(value)))}`;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HelperDeploymentError("PREVIEW_INVALID");
  }
  return value as Record<string, unknown>;
}

function walletId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new HelperDeploymentError("WALLET_NOT_FOUND");
  }
  return value.toLowerCase();
}

function canonicalAddress(value: string): `0x${string}` {
  try {
    return getAddress(value).toLowerCase() as `0x${string}`;
  } catch (error) {
    throw new HelperDeploymentError("WALLET_NOT_FOUND", false, { cause: error });
  }
}

function decimal(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
  }
  return BigInt(value);
}

function feeLimit(value: HelperDeploymentFeeLimit): HelperDeploymentFeeLimit {
  const gasLimit = decimal(value.gasLimit);
  const maxFee = decimal(value.maxFeePerGasBaseUnit);
  const priority = decimal(value.maxPriorityFeePerGasBaseUnit);
  if (
    gasLimit === 0n ||
    maxFee === 0n ||
    priority > maxFee ||
    value.feeCapBaseUnit !== (gasLimit * maxFee).toString()
  ) {
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
  }
  return structuredClone(value);
}

export function parseHelperDeploymentPreviewRequest(
  value: unknown,
): HelperDeploymentPreviewRequest {
  const input = record(value);
  if (
    !exactKeys(input, ["chainId", "helperVersion", "walletId"]) ||
    input.chainId !== 31_337 ||
    input.helperVersion !== "WalletHelperV1"
  ) {
    throw new HelperDeploymentError(
      input.chainId === 31_337 ? "PREVIEW_INVALID" : "CHAIN_NOT_ALLOWED",
    );
  }
  return { chainId: 31_337, helperVersion: "WalletHelperV1", walletId: walletId(input.walletId) };
}

export function parseHelperDeploymentSubmit(value: unknown): HelperDeploymentSubmitRequest {
  const input = record(value);
  if (
    !exactKeys(input, ["chainId", "helperVersion", "previewDigest", "previewToken", "walletId"]) ||
    typeof input.previewDigest !== "string" ||
    !digestPattern.test(input.previewDigest) ||
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken)
  ) {
    throw new HelperDeploymentError("PREVIEW_INVALID");
  }
  return {
    ...parseHelperDeploymentPreviewRequest({
      chainId: input.chainId,
      helperVersion: input.helperVersion,
      walletId: input.walletId,
    }),
    previewDigest: input.previewDigest as `sha256:${string}`,
    previewToken: input.previewToken,
  };
}

export function parseHelperDeploymentIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !idempotencyPattern.test(value)) {
    throw new HelperDeploymentError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseChainOperationId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new HelperDeploymentError("HELPER_DEPLOYMENT_NOT_FOUND");
  }
  return value.toLowerCase();
}

export function buildHelperDeploymentMaterial(
  owner: `0x${string}`,
  registry: HelperDeploymentRegistry = P05_HELPER_DEPLOYMENT_REGISTRY,
): {
  constructorArgumentsHash: `sha256:${string}`;
  initCode: Hex;
  initCodeHash: `0x${string}`;
} {
  return buildWalletHelperV1DeploymentMaterial(owner, registry);
}

function consensusNonce(views: readonly HelperDeploymentNonceView[]): string {
  if (views.length < 1 || views.length > 4) {
    throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const identities = new Set<string>();
  const providers = new Set<string>();
  for (const view of views) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(view.providerId) ||
      providers.has(view.providerId)
    ) {
      throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providers.add(view.providerId);
    const latest = decimal(view.latest);
    const pending = decimal(view.pending);
    if (pending < latest) throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
    identities.add(`${latest}:${pending}`);
  }
  if (identities.size !== 1) {
    throw new HelperDeploymentError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  return views[0]!.pending;
}

function publicOperation(operation: StoredHelperDeploymentOperation): HelperDeploymentOperation {
  return {
    chainId: operation.chainId,
    createdAt: operation.createdAt,
    expectedAddress: operation.expectedAddress,
    failureCode: operation.failureCode,
    feeLimit: structuredClone(operation.feeLimit),
    helperVersion: operation.helperVersion,
    nonce: operation.nonce,
    operationId: operation.operationId,
    planDigest: operation.planDigest,
    reconciliationReason: operation.reconciliationReason,
    registryVersion: operation.registryVersion,
    state: operation.state,
    transactions: structuredClone(operation.transactions),
    updatedAt: operation.updatedAt,
    walletId: operation.walletId,
  };
}

export class MemoryHelperDeploymentPreviewStore implements HelperDeploymentPreviewStore {
  readonly #previews = new Map<string, StoredHelperDeploymentPreview>();

  async get(token: string): Promise<StoredHelperDeploymentPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#previews.get(sha256(token));
    return value ? structuredClone(value) : null;
  }

  async put(preview: StoredHelperDeploymentPreview): Promise<void> {
    this.#previews.set(preview.tokenDigest, structuredClone(preview));
  }
}

export class MemoryHelperDeploymentOperationStore implements HelperDeploymentOperationStore {
  readonly #bindings = new Map<string, string>();
  readonly #idempotency = new Map<
    string,
    { operationId: string; requestHash: `sha256:${string}` }
  >();
  readonly #ledgers = new Map<string, { fencingToken: bigint; nextNonce: bigint | null }>();
  readonly #now: () => Date;
  readonly #operations = new Map<string, StoredHelperDeploymentOperation>();
  readonly #uuid: () => string;
  readonly outbox: Array<{ operationId: string; state: string }> = [];

  constructor(input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<HelperDeploymentIdempotencyRecord | null> {
    const value = this.#idempotency.get(this.#idempotencyScope(input));
    const operation = value ? this.#operations.get(value.operationId) : null;
    return value && operation
      ? { operation: structuredClone(operation), requestHash: value.requestHash }
      : null;
  }

  async get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredHelperDeploymentOperation | null> {
    const operation = this.#operations.get(input.operationId);
    return operation?.tenantId === input.tenantId && operation.userId === input.userId
      ? structuredClone(operation)
      : null;
  }

  async create(input: HelperDeploymentCreateInput) {
    const scope = this.#idempotencyScope(input);
    const existing = this.#idempotency.get(scope);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new HelperDeploymentError("IDEMPOTENCY_CONFLICT");
      }
      return {
        kind: "duplicate" as const,
        operation: structuredClone(this.#operations.get(existing.operationId)!),
      };
    }
    const bindingScope = `${input.tenantId}:${input.walletId}:${input.chainId}:${input.helperVersion}`;
    const boundOperation = this.#bindings.get(bindingScope);
    if (boundOperation) throw new HelperDeploymentError("HELPER_DEPLOYMENT_IN_PROGRESS");
    const nonce = consensusNonce(input.nonceViews);
    const ledgerScope = `${input.chainId}:${input.walletId}`;
    const ledger = this.#ledgers.get(ledgerScope) ?? { fencingToken: 0n, nextNonce: null };
    if (ledger.nextNonce === null) ledger.nextNonce = BigInt(nonce);
    if (ledger.nextNonce.toString() !== input.expectedNonce || nonce !== input.expectedNonce) {
      throw new HelperDeploymentError("NONCE_DRIFT");
    }
    const reservedNonce = ledger.nextNonce.toString();
    ledger.nextNonce += 1n;
    ledger.fencingToken += 1n;
    this.#ledgers.set(ledgerScope, ledger);
    const operationId = this.#uuid().toLowerCase();
    const plan = input.buildPlan({
      fencingToken: ledger.fencingToken.toString(),
      nonce: reservedNonce,
      operationId,
    });
    const createdAt = this.#now().toISOString();
    const operation: StoredHelperDeploymentOperation = {
      chainId: input.chainId,
      createdAt,
      expectedAddress: input.expectedAddress,
      failureCode: null,
      feeLimit: structuredClone(input.feeLimit),
      fencingToken: ledger.fencingToken.toString(),
      helperVersion: input.helperVersion,
      nonce: reservedNonce,
      operationId,
      plan,
      planDigest: helperDeploymentPlanDigest(plan),
      previewDigest: input.previewDigest,
      reconciliationReason: null,
      registryVersion: input.registryVersion,
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      state: "queued",
      tenantId: input.tenantId,
      transactions: [],
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    };
    this.#operations.set(operationId, operation);
    this.#idempotency.set(scope, { operationId, requestHash: input.requestHash });
    this.#bindings.set(bindingScope, operationId);
    this.outbox.push({ operationId, state: "queued" });
    return { kind: "created" as const, operation: structuredClone(operation) };
  }

  #idempotencyScope(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}:${input.idempotencyKey}`;
  }
}

export interface HelperDeploymentApplication {
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<HelperDeploymentOperation>;
  preview(input: {
    request: HelperDeploymentPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<HelperDeploymentPreview>;
  submit(input: {
    idempotencyKey: string;
    request: HelperDeploymentSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: HelperDeploymentOperation }>;
}

export class HelperDeploymentService implements HelperDeploymentApplication {
  readonly #chain: HelperDeploymentChainReader;
  readonly #now: () => Date;
  readonly #operations: HelperDeploymentOperationStore;
  readonly #previews: HelperDeploymentPreviewStore;
  readonly #previewTtlMilliseconds: number;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #registry: HelperDeploymentRegistry;

  constructor(input: {
    chain: HelperDeploymentChainReader;
    now?: () => Date;
    operations: HelperDeploymentOperationStore;
    previews: HelperDeploymentPreviewStore;
    previewTtlMilliseconds?: number;
    randomBytes?: (length: number) => Uint8Array;
    registry?: HelperDeploymentRegistry;
  }) {
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#previews = input.previews;
    this.#previewTtlMilliseconds =
      input.previewTtlMilliseconds ?? helperDeploymentPreviewTtlMilliseconds;
    if (this.#previewTtlMilliseconds < 1_000 || this.#previewTtlMilliseconds > 15 * 60 * 1_000) {
      throw new RangeError("helper deployment preview TTL is invalid");
    }
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#registry = validateHelperDeploymentRegistry(
      input.registry ?? P05_HELPER_DEPLOYMENT_REGISTRY,
    );
  }

  async get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<HelperDeploymentOperation> {
    const operation = await this.#operations.get(input);
    if (!operation) throw new HelperDeploymentError("HELPER_DEPLOYMENT_NOT_FOUND");
    return publicOperation(operation);
  }

  async preview(input: {
    request: HelperDeploymentPreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<HelperDeploymentPreview> {
    this.#assertWallet(input.request, input.wallet);
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + this.#previewTtlMilliseconds).toISOString();
    const facts = await this.#facts(input.wallet, expiresAt);
    const previewDigest = this.#previewDigest(input.request, facts);
    const bytes = Buffer.from(this.#randomBytes(32));
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new HelperDeploymentError("HELPER_DEPLOYMENT_UNAVAILABLE", true);
    }
    const previewToken = bytes.toString("base64url");
    bytes.fill(0);
    await this.#previews.put({
      createdAt,
      facts,
      previewDigest,
      request: structuredClone(input.request),
      tenantId: input.tenantId,
      tokenDigest: sha256(previewToken),
      userId: input.userId,
    });
    return this.#publicPreview(input.request, facts, previewDigest, previewToken);
  }

  async submit(input: {
    idempotencyKey: string;
    request: HelperDeploymentSubmitRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: HelperDeploymentOperation }> {
    const idempotencyKey = parseHelperDeploymentIdempotencyKey(input.idempotencyKey);
    this.#assertWallet(input.request, input.wallet);
    const stored = await this.#previews.get(input.request.previewToken);
    if (
      !stored ||
      stored.tenantId !== input.tenantId ||
      stored.userId !== input.userId ||
      stored.request.walletId !== input.wallet.walletId ||
      stored.previewDigest !== input.request.previewDigest ||
      stored.request.chainId !== input.request.chainId ||
      stored.request.helperVersion !== input.request.helperVersion
    ) {
      throw new HelperDeploymentError("PREVIEW_INVALID");
    }
    const requestHash = digest({
      chainId: input.request.chainId,
      helperVersion: input.request.helperVersion,
      previewDigest: stored.previewDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    const existing = await this.#operations.findIdempotency({
      idempotencyKey,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new HelperDeploymentError("IDEMPOTENCY_CONFLICT");
      }
      return { created: false, operation: publicOperation(existing.operation) };
    }
    const now = this.#now();
    if (new Date(stored.facts.expiresAt) <= now) {
      throw new HelperDeploymentError("PREVIEW_EXPIRED");
    }
    const current = await this.#facts(input.wallet, stored.facts.expiresAt);
    if (current.nonce !== stored.facts.nonce) throw new HelperDeploymentError("NONCE_DRIFT");
    if (this.#previewDigest(stored.request, current) !== stored.previewDigest) {
      throw new HelperDeploymentError("PREVIEW_CHANGED");
    }
    const snapshot = await this.#chain.nonceSnapshot({
      chainId: 31_337,
      walletAddress: current.owner,
    });
    if (consensusNonce(snapshot.views) !== current.nonce) {
      throw new HelperDeploymentError("NONCE_DRIFT");
    }
    const result = await this.#operations.create({
      buildPlan: ({ fencingToken, nonce, operationId }) =>
        this.#buildPlan({
          facts: current,
          fencingToken,
          nonce,
          operationId,
          walletId: input.wallet.walletId,
        }),
      chainId: 31_337,
      expectedAddress: current.expectedAddress,
      expectedNonce: current.nonce,
      expectedRuntimeCodeHash: current.expectedRuntimeCodeHash,
      feeLimit: current.feeLimit,
      helperVersion: "WalletHelperV1",
      idempotencyKey,
      nonceViews: snapshot.views,
      previewDigest: stored.previewDigest,
      registryVersion: this.#registry.registryVersion,
      requestHash,
      requestId: input.requestId,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      userId: input.userId,
      walletAddress: current.owner,
      walletId: input.wallet.walletId,
    });
    return { created: result.kind === "created", operation: publicOperation(result.operation) };
  }

  async #facts(wallet: CustodyWallet, expiresAt: string): Promise<HelperDeploymentPreviewFacts> {
    const owner = canonicalAddress(wallet.address);
    const snapshot = await this.#chain.nonceSnapshot({ chainId: 31_337, walletAddress: owner });
    if (snapshot.chainId !== 31_337) throw new HelperDeploymentError("CHAIN_NOT_ALLOWED");
    const nonce = consensusNonce(snapshot.views);
    if (
      decimal(snapshot.blockNumber) < BigInt(this.#registry.validFromBlock) ||
      decimal(snapshot.blockNumber) > BigInt(this.#registry.validToBlock)
    ) {
      throw new HelperDeploymentError("REGISTRY_MISMATCH");
    }
    const material = buildHelperDeploymentMaterial(owner, this.#registry);
    const expectedAddress = getContractAddress({
      from: owner,
      nonce: BigInt(nonce),
    }).toLowerCase() as `0x${string}`;
    const inspected = await this.#chain.inspectDeployment({
      blockNumber: snapshot.blockNumber,
      chainId: 31_337,
      expectedAddress,
      initCode: material.initCode,
      walletAddress: owner,
    });
    this.#validateCode(inspected);
    if (inspected.expectedAddressCode !== "0x") {
      throw new HelperDeploymentError("HELPER_ADDRESS_OCCUPIED");
    }
    const fees = feeLimit(inspected.feeLimit);
    const snapshotDigest = digest({
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      blockTimestamp: snapshot.blockTimestamp,
      componentCode: inspected.componentCode,
      expectedAddress,
      expectedRuntimeCodeHash: inspected.expectedRuntimeCodeHash,
      nonce,
      tokenCode: inspected.tokenCode,
    });
    return {
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      blockTimestamp: snapshot.blockTimestamp,
      constructorArgumentsHash: material.constructorArgumentsHash,
      expectedAddress,
      expectedRuntimeCodeHash: inspected.expectedRuntimeCodeHash,
      expiresAt,
      feeLimit: fees,
      initCode: material.initCode,
      initCodeHash: material.initCodeHash,
      nonce,
      owner,
      snapshotDigest,
    };
  }

  #buildPlan(input: {
    facts: HelperDeploymentPreviewFacts;
    fencingToken: string;
    nonce: string;
    operationId: string;
    walletId: string;
  }): HelperDeploymentPlan {
    if (input.nonce !== input.facts.nonce) throw new HelperDeploymentError("NONCE_DRIFT");
    const adapter = helperDeploymentComponent("adapter", this.#registry).address;
    const permit2 = helperDeploymentComponent("permit2", this.#registry).address;
    const [tokenA, tokenB] = this.#registry.tokens;
    const plan: HelperDeploymentPlan = {
      chainId: 31_337,
      deadline: input.facts.expiresAt,
      deployment: {
        adapter,
        constructorArgumentsHash: input.facts.constructorArgumentsHash,
        creationCodeHash: this.#registry.helperTemplate.creationCodeHash,
        expectedAddress: input.facts.expectedAddress,
        expectedRuntimeCodeHash: input.facts.expectedRuntimeCodeHash,
        helperVersion: "WalletHelperV1",
        owner: input.facts.owner,
        permit2,
        tokenA: { address: tokenA.address, runtimeCodeHash: tokenA.runtimeCodeHash },
        tokenB: { address: tokenB.address, runtimeCodeHash: tokenB.runtimeCodeHash },
      },
      feeLimit: input.facts.feeLimit,
      fencingToken: input.fencingToken,
      nonce: input.nonce,
      operationId: input.operationId,
      planDigest: `sha256:${"0".repeat(64)}`,
      planVersion: HELPER_DEPLOYMENT_PLAN_VERSION,
      registry: {
        blockNumber: input.facts.blockNumber,
        digest: this.#registry.registryDigest,
        rollbackVersion: this.#registry.rollbackVersion,
        version: this.#registry.registryVersion,
      },
      schemaVersion: 2,
      snapshotDigest: input.facts.snapshotDigest,
      transaction: {
        data: input.facts.initCode,
        dataHash: input.facts.initCodeHash,
        to: null,
        valueBaseUnit: "0",
      },
      wallet: { address: input.facts.owner, walletId: input.walletId },
    };
    plan.planDigest = helperDeploymentPlanDigest(plan);
    const context: HelperDeploymentPlanValidationContext = {
      adapter,
      chainId: 31_337,
      constructorArgumentsHash: input.facts.constructorArgumentsHash,
      creationCodeHash: this.#registry.helperTemplate.creationCodeHash,
      expectedAddress: input.facts.expectedAddress,
      expectedRuntimeCodeHash: input.facts.expectedRuntimeCodeHash,
      helperVersion: "WalletHelperV1",
      initCode: input.facts.initCode,
      initCodeHash: input.facts.initCodeHash,
      owner: input.facts.owner,
      permit2,
      registryDigest: this.#registry.registryDigest,
      registryRollbackVersion: this.#registry.rollbackVersion,
      registryValidFromBlock: this.#registry.validFromBlock,
      registryValidToBlock: this.#registry.validToBlock,
      registryVersion: this.#registry.registryVersion,
      tokenA,
      tokenB,
    };
    validateHelperDeploymentPlan(plan, context, this.#now());
    return plan;
  }

  #previewDigest(
    request: HelperDeploymentPreviewRequest,
    facts: HelperDeploymentPreviewFacts,
  ): `sha256:${string}` {
    return digest({
      chainId: request.chainId,
      constructorArgumentsHash: facts.constructorArgumentsHash,
      expectedAddress: facts.expectedAddress,
      expectedRuntimeCodeHash: facts.expectedRuntimeCodeHash,
      expiresAt: facts.expiresAt,
      feeLimit: facts.feeLimit,
      helperVersion: request.helperVersion,
      initCodeHash: facts.initCodeHash,
      nonce: facts.nonce,
      owner: facts.owner,
      registryDigest: this.#registry.registryDigest,
      registryVersion: this.#registry.registryVersion,
      walletId: request.walletId,
    });
  }

  #publicPreview(
    request: HelperDeploymentPreviewRequest,
    facts: HelperDeploymentPreviewFacts,
    previewDigest: `sha256:${string}`,
    previewToken: string,
  ): HelperDeploymentPreview {
    return {
      chainId: 31_337,
      constructor: {
        adapter: helperDeploymentComponent("adapter", this.#registry).address,
        owner: facts.owner,
        permit2: helperDeploymentComponent("permit2", this.#registry).address,
      },
      expectedAddress: facts.expectedAddress,
      expectedRuntimeCodeHash: facts.expectedRuntimeCodeHash,
      expiresAt: facts.expiresAt,
      feeLimit: structuredClone(facts.feeLimit),
      helperVersion: "WalletHelperV1",
      nonce: facts.nonce,
      previewDigest,
      previewToken,
      registryVersion: this.#registry.registryVersion,
      walletId: request.walletId,
    };
  }

  #validateCode(inspected: HelperDeploymentInspection): void {
    if (
      !/^0x[0-9a-f]{64}$/u.test(inspected.expectedRuntimeCodeHash) ||
      inspected.componentCode.length !== this.#registry.components.length ||
      inspected.tokenCode.length !== this.#registry.tokens.length
    ) {
      throw new HelperDeploymentError("HELPER_CODE_IDENTITY_MISMATCH");
    }
    for (const expected of this.#registry.components) {
      const actual = inspected.componentCode.find(({ role }) => role === expected.role);
      if (
        !actual ||
        actual.address !== expected.address ||
        actual.runtimeCodeHash !== expected.runtimeCodeHash
      ) {
        throw new HelperDeploymentError("HELPER_CODE_IDENTITY_MISMATCH");
      }
    }
    for (const expected of this.#registry.tokens) {
      const actual = inspected.tokenCode.find(({ address }) => address === expected.address);
      if (!actual || actual.runtimeCodeHash !== expected.runtimeCodeHash) {
        throw new HelperDeploymentError("HELPER_CODE_IDENTITY_MISMATCH");
      }
    }
  }

  #assertWallet(request: HelperDeploymentPreviewRequest, wallet: CustodyWallet): void {
    if (request.chainId !== 31_337) throw new HelperDeploymentError("CHAIN_NOT_ALLOWED");
    if (request.walletId !== wallet.walletId) throw new HelperDeploymentError("WALLET_NOT_FOUND");
    if (wallet.lockStatus !== "ready") throw new HelperDeploymentError("WALLET_LOCKED");
    canonicalAddress(wallet.address);
  }
}
