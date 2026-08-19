import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  LocalSwapAuthorizationMode,
  LocalSwapExecutePreview,
  LocalSwapExecutePreviewRequest,
  LocalSwapExecuteRequest,
  LocalSwapExecutionOperation,
  LocalSwapFeeLimit,
  LocalSwapOperationStep,
  LocalSwapQuoteRequest,
  LocalSwapQuoteView,
  LocalSwapStepKind,
} from "@lpbot/api-contract";
import {
  isLocalSwapQuoteCurrent,
  verifyLocalSwapQuoteDigest,
  type LocalSwapQuote,
  type LocalSwapQuoteAdapter,
} from "@lpbot/chain-adapters";
import {
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
  type LocalSwapExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  LOCAL_SWAP_EXECUTION_PLAN_VERSION,
  localSwapExecutionPlanDigest,
  localSwapStepSemanticDigest,
  validateLocalSwapExecutionPlan,
  type LocalSwapExecutionPlan,
  type LocalSwapPlanStep,
} from "@lpbot/domain/local-swap-execution";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

export const localSwapExecutionBodyLimit = 8_192;
export const localSwapPreviewTtlMilliseconds = 20_000;
export const localSwapIdempotencyRetentionHours = 24;

export type LocalSwapExecutionErrorCode =
  | "CHAIN_NOT_ALLOWED"
  | "HELPER_BINDING_MISMATCH"
  | "HELPER_NOT_ACTIVE"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "INSUFFICIENT_BALANCE"
  | "LOCAL_SWAP_NOT_FOUND"
  | "LOCAL_SWAP_UNAVAILABLE"
  | "NONCE_DRIFT"
  | "NONCE_RECONCILIATION_REQUIRED"
  | "PERMIT2_AUTHORIZATION_INVALID"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "QUOTE_CHANGED"
  | "QUOTE_EXPIRED"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_STALE"
  | "REGISTRY_MISMATCH"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND";

export class LocalSwapExecutionError extends Error {
  constructor(
    readonly code: LocalSwapExecutionErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalSwapExecutionError";
  }
}

export class LocalSwapQuoteValidationError extends Error {
  constructor(readonly code: "LOCAL_SWAP_QUOTE_INVALID" | "WALLET_NOT_FOUND") {
    super(code);
    this.name = "LocalSwapQuoteValidationError";
  }
}

export interface LocalSwapQuoteApplication {
  quote(
    input: LocalSwapQuoteRequest & { tenantId: string; userId: string; walletAddress: Address },
  ): Promise<Readonly<LocalSwapQuoteView>>;
}

export interface LocalSwapQuoteStore {
  append(input: {
    quote: Readonly<LocalSwapQuote>;
    tenantId: string;
    userId: string;
  }): Promise<void>;
  get(input: {
    quoteDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalSwapQuote> | null>;
}

export class MemoryLocalSwapQuoteStore implements LocalSwapQuoteStore {
  readonly #quotes = new Map<string, LocalSwapQuote>();

  async append(input: {
    quote: Readonly<LocalSwapQuote>;
    tenantId: string;
    userId: string;
  }): Promise<void> {
    const key = this.#key({
      ...input,
      quoteDigest: input.quote.quoteDigest,
      walletId: input.quote.walletId,
    });
    if (!this.#quotes.has(key)) this.#quotes.set(key, structuredClone(input.quote));
  }

  async get(input: {
    quoteDigest: `sha256:${string}`;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<Readonly<LocalSwapQuote> | null> {
    const value = this.#quotes.get(this.#key(input));
    return value ? structuredClone(value) : null;
  }

  #key(input: { quoteDigest: string; tenantId: string; userId: string; walletId: string }): string {
    return `${input.tenantId}:${input.userId}:${input.walletId}:${input.quoteDigest}`;
  }
}

function publicQuote(quote: LocalSwapQuote): LocalSwapQuoteView {
  return {
    amountInBaseUnit: quote.amountInBaseUnit,
    amountOutBaseUnit: quote.amountOutBaseUnit,
    blockNumber: quote.blockNumber,
    chainId: 31_337,
    deadline: quote.deadline,
    executionEnabled: true,
    expiresAt: quote.expiresAt,
    gas: structuredClone(quote.gas),
    maxBlockNumber: quote.maxBlockNumber,
    minOutBaseUnit: quote.minOutBaseUnit,
    quoteDigest: quote.quoteDigest,
    quoteVersion: quote.quoteVersion,
    quotedAt: quote.quotedAt,
    registryVersion: quote.registryVersion,
    serviceFeeBps: 0,
    slippageBps: quote.slippageBps,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    walletAddress: quote.walletAddress,
    walletId: quote.walletId,
  };
}

export class ControlledLocalSwapQuoteService implements LocalSwapQuoteApplication {
  readonly #adapter: Pick<LocalSwapQuoteAdapter, "quote">;
  readonly #store: LocalSwapQuoteStore;

  constructor(input: {
    adapter: Pick<LocalSwapQuoteAdapter, "quote">;
    store: LocalSwapQuoteStore;
  }) {
    this.#adapter = input.adapter;
    this.#store = input.store;
  }

  async quote(
    input: LocalSwapQuoteRequest & { tenantId: string; userId: string; walletAddress: Address },
  ) {
    const quote = await this.#adapter.quote(input);
    await this.#store.append({ quote, tenantId: input.tenantId, userId: input.userId });
    return publicQuote(quote as LocalSwapQuote);
  }
}

export interface LocalSwapHelperBinding {
  adapterAddress: Address;
  bindingId: string;
  chainId: 31_337;
  helperAddress: Address;
  helperVersion: "WalletHelperV1";
  ownerAddress: Address;
  permit2Address: Address;
  registryVersion: "p05-local-helper-deployment-v2";
  runtimeCodeHash: Hex;
  state: "active";
  verifiedBlockNumber: string;
  walletId: string;
}

export interface LocalSwapHelperBindingStore {
  getActive(input: {
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalSwapHelperBinding | null>;
}

export class MemoryLocalSwapHelperBindingStore implements LocalSwapHelperBindingStore {
  readonly #bindings = new Map<string, LocalSwapHelperBinding>();

  constructor(
    bindings: readonly (LocalSwapHelperBinding & { tenantId: string; userId: string })[] = [],
  ) {
    for (const binding of bindings) this.put(binding);
  }

  async getActive(input: { tenantId: string; userId: string; walletId: string }) {
    const value = this.#bindings.get(`${input.tenantId}:${input.userId}:${input.walletId}`);
    return value ? structuredClone(value) : null;
  }

  put(binding: LocalSwapHelperBinding & { tenantId: string; userId: string }): void {
    this.#bindings.set(
      `${binding.tenantId}:${binding.userId}:${binding.walletId}`,
      structuredClone(binding),
    );
  }
}

export interface LocalSwapNonceView {
  latest: string;
  pending: string;
  providerId: string;
}

export interface LocalSwapChainInspection {
  allowanceBaseUnit: string;
  blockHash: Hex;
  blockNumber: string;
  blockTimestamp: string;
  componentCode: readonly {
    address: Address;
    role: "adapter" | "permit2" | "router";
    runtimeCodeHash: Hex | null;
  }[];
  helper: {
    adapter: Address;
    codeHash: Hex | null;
    owner: Address;
    permit2: Address;
  };
  nonceViews: readonly LocalSwapNonceView[];
  ownerInputBalanceBaseUnit: string;
  ownerOutputBalanceBaseUnit: string;
  permit2: { domainSeparator: Hex; nonce: string };
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalSwapExecutionChainReader {
  inspect(input: {
    approvalSpender: Address;
    binding: LocalSwapHelperBinding;
    quote: Readonly<LocalSwapQuote>;
    walletAddress: Address;
  }): Promise<LocalSwapChainInspection>;
}

export interface LocalSwapPermit2SignatureProvider {
  sign(input: {
    amountBaseUnit: string;
    domainSeparator: Hex;
    expiration: string;
    nonce: string;
    permit2: Address;
    quoteDigest: `sha256:${string}`;
    reauthenticatedSessionId: string;
    sigDeadline: string;
    spender: Address;
    tenantId: string;
    token: Address;
    userId: string;
    walletId: string;
  }): Promise<{ signature: Hex }>;
}

interface PreviewFacts {
  allowanceBaseUnit: string;
  approvalSpender: Address;
  binding: LocalSwapHelperBinding;
  blockHash: Hex;
  blockNumber: string;
  blockTimestamp: string;
  expiresAt: string;
  feeLimits: Record<LocalSwapStepKind, LocalSwapFeeLimit>;
  nonce: string;
  nonceViews: readonly LocalSwapNonceView[];
  ownerInputBalanceBaseUnit: string;
  ownerOutputBalanceBaseUnit: string;
  permit2: { domainSeparator: Hex; expiration: string; nonce: string; sigDeadline: string } | null;
  stepKinds: LocalSwapStepKind[];
}

export interface StoredLocalSwapPreview {
  createdAt: Date;
  facts: PreviewFacts;
  previewDigest: `sha256:${string}`;
  request: LocalSwapExecutePreviewRequest;
  tenantId: string;
  tokenDigest: string;
  userId: string;
}

export interface LocalSwapPreviewStore {
  get(token: string): Promise<StoredLocalSwapPreview | null>;
  put(preview: StoredLocalSwapPreview): Promise<void>;
}

export class MemoryLocalSwapPreviewStore implements LocalSwapPreviewStore {
  readonly #values = new Map<string, StoredLocalSwapPreview>();

  async get(token: string): Promise<StoredLocalSwapPreview | null> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#values.get(sha256(token));
    return value ? structuredClone(value) : null;
  }

  async put(preview: StoredLocalSwapPreview): Promise<void> {
    if (!this.#values.has(preview.tokenDigest)) {
      this.#values.set(preview.tokenDigest, structuredClone(preview));
    }
  }
}

export interface LocalSwapStepReservation {
  fencingToken: string;
  kind: LocalSwapStepKind;
  nonce: string;
  ordinal: number;
  stepId: string;
}

export interface StoredLocalSwapOperation extends LocalSwapExecutionOperation {
  plan: LocalSwapExecutionPlan;
  previewDigest: `sha256:${string}`;
  requestHash: `sha256:${string}`;
  sessionId: string;
  tenantId: string;
  userId: string;
}

export interface LocalSwapIdempotencyRecord {
  operation: StoredLocalSwapOperation;
  requestHash: `sha256:${string}`;
}

export interface LocalSwapOperationStore {
  create(input: {
    buildPlan(input: {
      operationId: string;
      reservations: readonly LocalSwapStepReservation[];
    }): LocalSwapExecutionPlan;
    expectedNonce: string;
    idempotencyKey: string;
    nonceViews: readonly LocalSwapNonceView[];
    previewDigest: `sha256:${string}`;
    quoteDigest: `sha256:${string}`;
    requestHash: `sha256:${string}`;
    requestId: string;
    sessionId: string;
    stepKinds: readonly LocalSwapStepKind[];
    tenantId: string;
    userId: string;
    walletAddress: Address;
    walletId: string;
  }): Promise<{ kind: "created" | "duplicate"; operation: StoredLocalSwapOperation }>;
  findIdempotency(input: {
    idempotencyKey: string;
    tenantId: string;
    userId: string;
    walletId: string;
  }): Promise<LocalSwapIdempotencyRecord | null>;
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<StoredLocalSwapOperation | null>;
}

export class MemoryLocalSwapOperationStore implements LocalSwapOperationStore {
  readonly #idempotency = new Map<
    string,
    { operationId: string; requestHash: `sha256:${string}` }
  >();
  readonly #ledgers = new Map<string, { fencingToken: bigint; nextNonce: bigint | null }>();
  readonly #operations = new Map<string, StoredLocalSwapOperation>();
  readonly #uuid: () => string;
  readonly #now: () => Date;
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
  }) {
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

  async create(input: Parameters<LocalSwapOperationStore["create"]>[0]) {
    const scope = this.#scope(input);
    const existing = this.#idempotency.get(scope);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new LocalSwapExecutionError("IDEMPOTENCY_CONFLICT");
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
      throw new LocalSwapExecutionError("NONCE_DRIFT");
    }
    const reservations = input.stepKinds.map((kind, ordinal) => {
      ledger.fencingToken += 1n;
      const reservation = {
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
    const steps: LocalSwapOperationStep[] = plan.steps.map((step, ordinal) => ({
      failureCode: null,
      feeLimit: structuredClone(step.feeLimit),
      kind: step.kind,
      nonce: step.nonce,
      ordinal,
      state: ordinal === 0 ? "queued" : "blocked",
      stepId: step.stepId,
      transactions: [],
    }));
    const operation: StoredLocalSwapOperation = {
      authorizationMode: plan.authorization.mode,
      chainId: 31_337,
      createdAt,
      failureCode: null,
      helperAddress: plan.helper.address,
      operationId,
      operationKind: "local-swap",
      plan,
      planDigest: plan.planDigest,
      previewDigest: input.previewDigest,
      quoteDigest: input.quoteDigest,
      reconciliationReason: null,
      registryVersion: "p05-local-swap-execution-v2",
      requestHash: input.requestHash,
      sessionId: input.sessionId,
      state: "queued",
      steps,
      tenantId: input.tenantId,
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    };
    this.#operations.set(operationId, operation);
    this.#idempotency.set(scope, { operationId, requestHash: input.requestHash });
    this.outbox.push({ operationId, state: "queued" });
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

export interface LocalSwapExecutionApplication {
  get(input: {
    operationId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalSwapExecutionOperation>;
  preview(input: {
    request: LocalSwapExecutePreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalSwapExecutePreview>;
  submit(input: {
    idempotencyKey: string;
    request: LocalSwapExecuteRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: LocalSwapExecutionOperation }>;
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const idempotencyPattern = /^[!-~]{16,128}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;

function sha256(value: string | Uint8Array): string {
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
  return `sha256:${sha256(JSON.stringify(canonical(value)))}`;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LocalSwapExecutionError("PREVIEW_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function walletId(
  value: unknown,
  ErrorType: typeof LocalSwapExecutionError | typeof LocalSwapQuoteValidationError,
): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw ErrorType === LocalSwapExecutionError
      ? new LocalSwapExecutionError("WALLET_NOT_FOUND")
      : new LocalSwapQuoteValidationError("WALLET_NOT_FOUND");
  }
  return value.toLowerCase();
}

function canonicalAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !addressPattern.test(value)) return null;
  try {
    return getAddress(value).toLowerCase() as Address;
  } catch {
    return null;
  }
}

export function parseLocalSwapQuoteRequest(value: unknown): LocalSwapQuoteRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "amountInBaseUnit",
      "chainId",
      "slippageBps",
      "tokenIn",
      "tokenOut",
      "walletId",
    ])
  ) {
    throw new LocalSwapQuoteValidationError("LOCAL_SWAP_QUOTE_INVALID");
  }
  const tokenIn = canonicalAddress(input.tokenIn);
  const tokenOut = canonicalAddress(input.tokenOut);
  if (
    input.chainId !== 31_337 ||
    typeof input.amountInBaseUnit !== "string" ||
    !/^[1-9][0-9]*$/u.test(input.amountInBaseUnit) ||
    !Number.isSafeInteger(input.slippageBps) ||
    Number(input.slippageBps) < 1 ||
    Number(input.slippageBps) > 500 ||
    !tokenIn ||
    !tokenOut ||
    tokenIn === tokenOut
  ) {
    throw new LocalSwapQuoteValidationError("LOCAL_SWAP_QUOTE_INVALID");
  }
  return {
    amountInBaseUnit: input.amountInBaseUnit,
    chainId: 31_337,
    slippageBps: Number(input.slippageBps),
    tokenIn,
    tokenOut,
    walletId: walletId(input.walletId, LocalSwapQuoteValidationError),
  };
}

export function parseLocalSwapExecutePreview(value: unknown): LocalSwapExecutePreviewRequest {
  const input = record(value);
  if (
    !exactKeys(input, ["authorizationMode", "quoteDigest", "walletId"]) ||
    (input.authorizationMode !== "direct" && input.authorizationMode !== "permit2") ||
    typeof input.quoteDigest !== "string" ||
    !digestPattern.test(input.quoteDigest)
  ) {
    throw new LocalSwapExecutionError("PREVIEW_INVALID");
  }
  return {
    authorizationMode: input.authorizationMode,
    quoteDigest: input.quoteDigest as `sha256:${string}`,
    walletId: walletId(input.walletId, LocalSwapExecutionError),
  };
}

export function parseLocalSwapExecute(value: unknown): LocalSwapExecuteRequest {
  const input = record(value);
  if (
    !exactKeys(input, [
      "authorizationMode",
      "previewDigest",
      "previewToken",
      "quoteDigest",
      "walletId",
    ]) ||
    typeof input.previewDigest !== "string" ||
    !digestPattern.test(input.previewDigest) ||
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken)
  ) {
    throw new LocalSwapExecutionError("PREVIEW_INVALID");
  }
  return {
    ...parseLocalSwapExecutePreview({
      authorizationMode: input.authorizationMode,
      quoteDigest: input.quoteDigest,
      walletId: input.walletId,
    }),
    previewDigest: input.previewDigest as `sha256:${string}`,
    previewToken: input.previewToken,
  };
}

export function parseLocalSwapIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !idempotencyPattern.test(value)) {
    throw new LocalSwapExecutionError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseLocalSwapOperationId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new LocalSwapExecutionError("LOCAL_SWAP_NOT_FOUND");
  }
  return value.toLowerCase();
}

function decimal(value: string, code: LocalSwapExecutionErrorCode): bigint {
  if (!decimalPattern.test(value) || value.length > 78)
    throw new LocalSwapExecutionError(code, true);
  return BigInt(value);
}

function consensusNonce(views: readonly LocalSwapNonceView[]): string {
  if (views.length < 1 || views.length > 4) {
    throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  }
  const providers = new Set<string>();
  const values = new Set<string>();
  for (const view of views) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(view.providerId) ||
      providers.has(view.providerId)
    ) {
      throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    }
    providers.add(view.providerId);
    const latest = decimal(view.latest, "NONCE_RECONCILIATION_REQUIRED");
    const pending = decimal(view.pending, "NONCE_RECONCILIATION_REQUIRED");
    if (pending < latest) throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
    values.add(`${latest}:${pending}`);
  }
  if (values.size !== 1) throw new LocalSwapExecutionError("NONCE_RECONCILIATION_REQUIRED", true);
  return views[0]!.pending;
}

function feeLimit(kind: LocalSwapStepKind, quote: LocalSwapQuote): LocalSwapFeeLimit {
  const gasLimit = kind === "swap" ? BigInt(quote.gas.gasLimit) : 70_000n;
  const quotedMax = BigInt(quote.gas.maxFeePerGasBaseUnit);
  const quotedPriority = BigInt(quote.gas.maxPriorityFeePerGasBaseUnit);
  const maxFee = quotedMax * 2n;
  const maxPriority = quotedPriority * 2n;
  return {
    feeCapBaseUnit: (gasLimit * maxFee).toString(),
    gasLimit: gasLimit.toString(),
    maxFeePerGasBaseUnit: maxFee.toString(),
    maxPriorityFeePerGasBaseUnit: maxPriority.toString(),
  };
}

function publicOperation(operation: StoredLocalSwapOperation): LocalSwapExecutionOperation {
  return {
    authorizationMode: operation.authorizationMode,
    chainId: 31_337,
    createdAt: operation.createdAt,
    failureCode: operation.failureCode,
    helperAddress: operation.helperAddress,
    operationId: operation.operationId,
    operationKind: "local-swap",
    planDigest: operation.planDigest,
    quoteDigest: operation.quoteDigest,
    reconciliationReason: operation.reconciliationReason,
    registryVersion: operation.registryVersion,
    state: operation.state,
    steps: structuredClone(operation.steps),
    updatedAt: operation.updatedAt,
    walletId: operation.walletId,
  };
}

const erc20ApproveAbi = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const helperSwapAbi = [
  {
    inputs: [
      { name: "planDigest", type: "bytes32" },
      {
        name: "plan",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "serviceFeeBps", type: "uint16" },
        ],
      },
      {
        name: "authorization",
        type: "tuple",
        components: [
          { name: "enabled", type: "bool" },
          {
            name: "permitSingle",
            type: "tuple",
            components: [
              {
                name: "details",
                type: "tuple",
                components: [
                  { name: "token", type: "address" },
                  { name: "amount", type: "uint160" },
                  { name: "expiration", type: "uint48" },
                  { name: "nonce", type: "uint48" },
                ],
              },
              { name: "spender", type: "address" },
              { name: "sigDeadline", type: "uint256" },
            ],
          },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    name: "executeSwap",
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export class LocalSwapExecutionService implements LocalSwapExecutionApplication {
  readonly #bindings: LocalSwapHelperBindingStore;
  readonly #chain: LocalSwapExecutionChainReader;
  readonly #now: () => Date;
  readonly #operations: LocalSwapOperationStore;
  readonly #permit2Signatures: LocalSwapPermit2SignatureProvider | null;
  readonly #previews: LocalSwapPreviewStore;
  readonly #quotes: LocalSwapQuoteStore;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(input: {
    bindings: LocalSwapHelperBindingStore;
    chain: LocalSwapExecutionChainReader;
    now?: () => Date;
    operations: LocalSwapOperationStore;
    permit2Signatures?: LocalSwapPermit2SignatureProvider;
    previews: LocalSwapPreviewStore;
    quotes: LocalSwapQuoteStore;
    randomBytes?: (length: number) => Uint8Array;
    registry?: LocalSwapExecutionRegistry;
  }) {
    this.#bindings = input.bindings;
    this.#chain = input.chain;
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#permit2Signatures = input.permit2Signatures ?? null;
    this.#previews = input.previews;
    this.#quotes = input.quotes;
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#registry = validateLocalSwapExecutionRegistry(
      input.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
  }

  async get(input: { operationId: string; tenantId: string; userId: string }) {
    const operation = await this.#operations.get(input);
    if (!operation) throw new LocalSwapExecutionError("LOCAL_SWAP_NOT_FOUND");
    return publicOperation(operation);
  }

  async preview(input: {
    request: LocalSwapExecutePreviewRequest;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalSwapExecutePreview> {
    this.#assertWallet(input.request.walletId, input.wallet);
    const quote = await this.#quote(input);
    const binding = await this.#binding(input, quote);
    const createdAt = this.#now();
    const facts = await this.#facts(input.request.authorizationMode, quote, binding, createdAt);
    const previewDigest = digest({ facts, quoteDigest: quote.quoteDigest, request: input.request });
    const bytes = Buffer.from(this.#randomBytes(32));
    if (bytes.length !== 32) {
      bytes.fill(0);
      throw new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true);
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
    return this.#publicPreview(input.request, quote, facts, previewDigest, previewToken);
  }

  async submit(input: {
    idempotencyKey: string;
    request: LocalSwapExecuteRequest;
    requestId: string;
    sessionId: string;
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: LocalSwapExecutionOperation }> {
    const idempotencyKey = parseLocalSwapIdempotencyKey(input.idempotencyKey);
    this.#assertWallet(input.request.walletId, input.wallet);
    const stored = await this.#previews.get(input.request.previewToken);
    if (
      !stored ||
      stored.tenantId !== input.tenantId ||
      stored.userId !== input.userId ||
      stored.request.walletId !== input.wallet.walletId ||
      stored.request.quoteDigest !== input.request.quoteDigest ||
      stored.request.authorizationMode !== input.request.authorizationMode ||
      stored.previewDigest !== input.request.previewDigest
    ) {
      throw new LocalSwapExecutionError("PREVIEW_INVALID");
    }
    const requestHash = digest({
      authorizationMode: input.request.authorizationMode,
      previewDigest: input.request.previewDigest,
      quoteDigest: input.request.quoteDigest,
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
      if (existing.requestHash !== requestHash)
        throw new LocalSwapExecutionError("IDEMPOTENCY_CONFLICT");
      return { created: false, operation: publicOperation(existing.operation) };
    }
    const now = this.#now();
    if (new Date(stored.facts.expiresAt) <= now)
      throw new LocalSwapExecutionError("PREVIEW_EXPIRED");
    const quote = await this.#quote(input);
    const binding = await this.#binding(input, quote);
    const current = await this.#facts(
      input.request.authorizationMode,
      quote,
      binding,
      now,
      stored.facts.expiresAt,
    );
    if (consensusNonce(currentNonceViews(current)) !== stored.facts.nonce) {
      throw new LocalSwapExecutionError("NONCE_DRIFT");
    }
    if (
      digest({ facts: current, quoteDigest: quote.quoteDigest, request: stored.request }) !==
      stored.previewDigest
    ) {
      throw new LocalSwapExecutionError("PREVIEW_CHANGED");
    }
    const signature = await this.#permit2Signature(input, quote, current);
    const result = await this.#operations.create({
      buildPlan: ({ operationId, reservations }) =>
        this.#buildPlan({
          binding,
          facts: current,
          operationId,
          quote,
          reservations,
          signature,
          wallet: input.wallet,
        }),
      expectedNonce: current.nonce,
      idempotencyKey,
      nonceViews: currentNonceViews(current),
      previewDigest: stored.previewDigest,
      quoteDigest: quote.quoteDigest,
      requestHash,
      requestId: input.requestId,
      sessionId: input.sessionId,
      stepKinds: current.stepKinds,
      tenantId: input.tenantId,
      userId: input.userId,
      walletAddress: quote.walletAddress,
      walletId: input.wallet.walletId,
    });
    return { created: result.kind === "created", operation: publicOperation(result.operation) };
  }

  #assertWallet(walletIdValue: string, wallet: CustodyWallet): void {
    if (wallet.walletId !== walletIdValue) throw new LocalSwapExecutionError("WALLET_NOT_FOUND");
    if (wallet.lockStatus !== "ready") throw new LocalSwapExecutionError("WALLET_LOCKED");
  }

  async #quote(input: {
    request: { quoteDigest: `sha256:${string}`; walletId: string };
    tenantId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<LocalSwapQuote> {
    const quote = await this.#quotes.get({
      quoteDigest: input.request.quoteDigest,
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.request.walletId,
    });
    if (!quote) throw new LocalSwapExecutionError("QUOTE_NOT_FOUND");
    if (
      quote.walletAddress !== input.wallet.address.toLowerCase() ||
      quote.walletId !== input.wallet.walletId ||
      quote.registryVersion !== this.#registry.registryVersion ||
      quote.registryDigest !== this.#registry.registryDigest ||
      !verifyLocalSwapQuoteDigest(quote)
    ) {
      throw new LocalSwapExecutionError("QUOTE_CHANGED");
    }
    const now = this.#now();
    if (now >= new Date(quote.expiresAt) || now >= new Date(quote.deadline)) {
      throw new LocalSwapExecutionError("QUOTE_EXPIRED");
    }
    return structuredClone(quote);
  }

  async #binding(
    input: { tenantId: string; userId: string; wallet: CustodyWallet },
    quote: LocalSwapQuote,
  ): Promise<LocalSwapHelperBinding> {
    const binding = await this.#bindings.getActive({
      tenantId: input.tenantId,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!binding) throw new LocalSwapExecutionError("HELPER_NOT_ACTIVE");
    if (
      binding.chainId !== 31_337 ||
      binding.walletId !== input.wallet.walletId ||
      binding.ownerAddress !== quote.walletAddress ||
      binding.helperVersion !== "WalletHelperV1" ||
      binding.registryVersion !== "p05-local-helper-deployment-v2" ||
      binding.adapterAddress !== localSwapComponent("adapter", this.#registry).address ||
      binding.permit2Address !== localSwapComponent("permit2", this.#registry).address
    ) {
      throw new LocalSwapExecutionError("HELPER_BINDING_MISMATCH");
    }
    return binding;
  }

  async #facts(
    mode: LocalSwapAuthorizationMode,
    quote: LocalSwapQuote,
    binding: LocalSwapHelperBinding,
    now: Date,
    fixedExpiresAt?: string,
  ): Promise<PreviewFacts> {
    const approvalSpender = mode === "direct" ? binding.helperAddress : binding.permit2Address;
    const inspection = await this.#chain.inspect({
      approvalSpender,
      binding,
      quote,
      walletAddress: quote.walletAddress,
    });
    this.#verifyInspection(inspection, binding, quote, now);
    if (
      decimal(inspection.ownerInputBalanceBaseUnit, "LOCAL_SWAP_UNAVAILABLE") <
      BigInt(quote.amountInBaseUnit)
    ) {
      throw new LocalSwapExecutionError("INSUFFICIENT_BALANCE");
    }
    const allowance = decimal(inspection.allowanceBaseUnit, "LOCAL_SWAP_UNAVAILABLE");
    const stepKinds: LocalSwapStepKind[] = [];
    if (allowance !== 0n && allowance !== BigInt(quote.amountInBaseUnit))
      stepKinds.push("allowance-reset");
    stepKinds.push("approve", "swap", "cleanup");
    const quoteDeadline = Math.floor(Date.parse(quote.deadline) / 1_000);
    const permitExpiration = Math.min(
      quoteDeadline,
      Math.floor(now.getTime() / 1_000) + this.#registry.maxPermit2ExpirationSeconds,
    );
    const expiresAt =
      fixedExpiresAt ??
      new Date(
        Math.min(Date.parse(quote.expiresAt), now.getTime() + localSwapPreviewTtlMilliseconds),
      ).toISOString();
    return {
      allowanceBaseUnit: inspection.allowanceBaseUnit,
      approvalSpender,
      binding: structuredClone(binding),
      blockHash: inspection.blockHash,
      blockNumber: inspection.blockNumber,
      blockTimestamp: inspection.blockTimestamp,
      expiresAt,
      feeLimits: {
        "allowance-reset": feeLimit("allowance-reset", quote),
        approve: feeLimit("approve", quote),
        cleanup: feeLimit("cleanup", quote),
        swap: feeLimit("swap", quote),
      },
      nonce: consensusNonce(inspection.nonceViews),
      nonceViews: structuredClone(inspection.nonceViews),
      ownerInputBalanceBaseUnit: inspection.ownerInputBalanceBaseUnit,
      ownerOutputBalanceBaseUnit: inspection.ownerOutputBalanceBaseUnit,
      permit2:
        mode === "permit2"
          ? {
              domainSeparator: inspection.permit2.domainSeparator,
              expiration: permitExpiration.toString(),
              nonce: inspection.permit2.nonce,
              sigDeadline: quoteDeadline.toString(),
            }
          : null,
      stepKinds,
    };
  }

  #verifyInspection(
    inspection: LocalSwapChainInspection,
    binding: LocalSwapHelperBinding,
    quote: LocalSwapQuote,
    now: Date,
  ): void {
    if (
      !decimalPattern.test(inspection.blockNumber) ||
      !isLocalSwapQuoteCurrent(quote, { blockNumber: inspection.blockNumber, now })
    ) {
      throw new LocalSwapExecutionError("QUOTE_STALE");
    }
    if (
      inspection.helper.codeHash !== binding.runtimeCodeHash ||
      inspection.helper.owner !== binding.ownerAddress ||
      inspection.helper.adapter !== binding.adapterAddress ||
      inspection.helper.permit2 !== binding.permit2Address
    ) {
      throw new LocalSwapExecutionError("HELPER_BINDING_MISMATCH");
    }
    for (const expected of this.#registry.components) {
      const actual = inspection.componentCode.find(({ role }) => role === expected.role);
      if (
        !actual ||
        actual.address !== expected.address ||
        actual.runtimeCodeHash !== expected.runtimeCodeHash
      ) {
        throw new LocalSwapExecutionError("REGISTRY_MISMATCH");
      }
    }
    for (const expected of this.#registry.tokens) {
      const actual = inspection.tokenCode.find(({ address }) => address === expected.address);
      if (!actual || actual.runtimeCodeHash !== expected.runtimeCodeHash) {
        throw new LocalSwapExecutionError("REGISTRY_MISMATCH");
      }
    }
  }

  #publicPreview(
    request: LocalSwapExecutePreviewRequest,
    quote: LocalSwapQuote,
    facts: PreviewFacts,
    previewDigest: `sha256:${string}`,
    previewToken: string,
  ): LocalSwapExecutePreview {
    const steps = facts.stepKinds.map((kind, ordinal) => ({
      amountBaseUnit: kind === "approve" || kind === "swap" ? quote.amountInBaseUnit : "0",
      feeLimit: structuredClone(facts.feeLimits[kind]),
      kind,
      ordinal,
    }));
    return {
      ...request,
      chainId: 31_337,
      deadline: quote.deadline,
      expiresAt: facts.expiresAt,
      feeLimitTotalBaseUnit: steps
        .reduce((total, step) => total + BigInt(step.feeLimit.feeCapBaseUnit), 0n)
        .toString(),
      helperAddress: facts.binding.helperAddress,
      minOutBaseUnit: quote.minOutBaseUnit,
      previewDigest,
      previewToken,
      serviceFeeBps: 0,
      steps,
    };
  }

  async #permit2Signature(
    input: {
      request: LocalSwapExecuteRequest;
      sessionId: string;
      tenantId: string;
      userId: string;
      wallet: CustodyWallet;
    },
    quote: LocalSwapQuote,
    facts: PreviewFacts,
  ): Promise<Hex | null> {
    if (input.request.authorizationMode === "direct") return null;
    if (!facts.permit2 || !this.#permit2Signatures) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    const result = await this.#permit2Signatures.sign({
      amountBaseUnit: quote.amountInBaseUnit,
      domainSeparator: facts.permit2.domainSeparator,
      expiration: facts.permit2.expiration,
      nonce: facts.permit2.nonce,
      permit2: facts.binding.permit2Address,
      quoteDigest: quote.quoteDigest,
      reauthenticatedSessionId: input.sessionId,
      sigDeadline: facts.permit2.sigDeadline,
      spender: facts.binding.helperAddress,
      tenantId: input.tenantId,
      token: quote.tokenIn,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (!/^0x[0-9a-f]{130}$/u.test(result.signature)) {
      throw new LocalSwapExecutionError("PERMIT2_AUTHORIZATION_INVALID");
    }
    return result.signature;
  }

  #buildPlan(input: {
    binding: LocalSwapHelperBinding;
    facts: PreviewFacts;
    operationId: string;
    quote: LocalSwapQuote;
    reservations: readonly LocalSwapStepReservation[];
    signature: Hex | null;
    wallet: CustodyWallet;
  }): LocalSwapExecutionPlan {
    const { binding, facts, quote } = input;
    const helperPlanDigest = keccak256(
      stringToHex(
        JSON.stringify(
          canonical({
            authorizationMode: facts.permit2 ? "permit2" : "direct",
            bindingId: binding.bindingId,
            helperAddress: binding.helperAddress,
            quoteDigest: quote.quoteDigest,
            serviceFeeBps: 0,
            walletId: quote.walletId,
          }),
        ),
      ),
    );
    const permit = facts.permit2;
    const signature = input.signature ?? "0x";
    const swapData = encodeFunctionData({
      abi: helperSwapAbi,
      args: [
        helperPlanDigest,
        {
          amountIn: BigInt(quote.amountInBaseUnit),
          deadline: BigInt(Math.floor(Date.parse(quote.deadline) / 1_000)),
          minAmountOut: BigInt(quote.minOutBaseUnit),
          serviceFeeBps: 0,
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
        },
        {
          enabled: permit !== null,
          permitSingle: {
            details: {
              amount: BigInt(permit?.expiration ? quote.amountInBaseUnit : "0"),
              expiration: Number(permit?.expiration ?? "0"),
              nonce: Number(permit?.nonce ?? "0"),
              token: permit ? quote.tokenIn : "0x0000000000000000000000000000000000000000",
            },
            sigDeadline: BigInt(permit?.sigDeadline ?? "0"),
            spender: permit ? binding.helperAddress : "0x0000000000000000000000000000000000000000",
          },
          signature,
        },
      ],
      functionName: "executeSwap",
    });
    const stepData = (kind: LocalSwapStepKind): { data: Hex; to: Address } => {
      if (kind === "swap") return { data: swapData, to: binding.helperAddress };
      const amount = kind === "approve" ? BigInt(quote.amountInBaseUnit) : 0n;
      return {
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          args: [facts.approvalSpender, amount],
          functionName: "approve",
        }),
        to: quote.tokenIn,
      };
    };
    const steps: LocalSwapPlanStep[] = input.reservations.map((reservation) => {
      const transaction = stepData(reservation.kind);
      const step: LocalSwapPlanStep = {
        feeLimit: structuredClone(facts.feeLimits[reservation.kind]),
        fencingToken: reservation.fencingToken,
        kind: reservation.kind,
        nonce: reservation.nonce,
        ordinal: reservation.ordinal,
        runCondition: reservation.kind === "cleanup" ? "swap-failed-after-approval" : "always",
        semanticDigest: `sha256:${"00".repeat(32)}`,
        stepId: reservation.stepId,
        transaction: {
          data: transaction.data,
          dataDigest: digest(transaction.data),
          to: transaction.to,
          valueBaseUnit: "0",
        },
      };
      step.semanticDigest = localSwapStepSemanticDigest(step);
      return step;
    });
    const quoteBinding: LocalSwapExecutionPlan["quote"] = {
      amountInBaseUnit: quote.amountInBaseUnit,
      amountOutBaseUnit: quote.amountOutBaseUnit,
      blockHash: quote.blockHash,
      blockNumber: quote.blockNumber,
      deadline: quote.deadline,
      expiresAt: quote.expiresAt,
      maxBlockNumber: quote.maxBlockNumber,
      minOutBaseUnit: quote.minOutBaseUnit,
      quoteDigest: quote.quoteDigest,
      quoteVersion: quote.quoteVersion,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
    };
    const helperBinding: LocalSwapExecutionPlan["helper"] = {
      adapter: binding.adapterAddress,
      address: binding.helperAddress,
      bindingId: binding.bindingId,
      helperVersion: binding.helperVersion,
      owner: binding.ownerAddress,
      permit2: binding.permit2Address,
      runtimeCodeHash: binding.runtimeCodeHash,
      verifiedBlockNumber: binding.verifiedBlockNumber,
    };
    const authorization: LocalSwapExecutionPlan["authorization"] = permit
      ? {
          approvalSpender: binding.permit2Address,
          mode: "permit2",
          permit2: {
            amountBaseUnit: quote.amountInBaseUnit,
            domainSeparator: permit.domainSeparator,
            expiration: permit.expiration,
            nonce: permit.nonce,
            permit2: binding.permit2Address,
            sigDeadline: permit.sigDeadline,
            signature: input.signature!,
            signatureDigest: `sha256:${sha256(Buffer.from(input.signature!.slice(2), "hex"))}`,
            spender: binding.helperAddress,
            token: quote.tokenIn,
          },
        }
      : { approvalSpender: binding.helperAddress, mode: "direct", permit2: null };
    const plan: LocalSwapExecutionPlan = {
      authorization,
      chainId: 31_337,
      deadline: quote.deadline,
      helper: helperBinding,
      helperPlanDigest,
      operationId: input.operationId,
      planDigest: `sha256:${"00".repeat(32)}`,
      planVersion: LOCAL_SWAP_EXECUTION_PLAN_VERSION,
      quote: quoteBinding,
      registry: {
        digest: this.#registry.registryDigest,
        rollbackVersion: this.#registry.rollbackVersion,
        version: this.#registry.registryVersion,
      },
      schemaVersion: 2,
      serviceFeeBps: 0,
      steps,
      wallet: { address: quote.walletAddress, walletId: quote.walletId },
    };
    plan.planDigest = localSwapExecutionPlanDigest(plan);
    validateLocalSwapExecutionPlan(
      plan,
      {
        authorizationMode: authorization.mode,
        currentBlockNumber: facts.blockNumber,
        expectedHelper: structuredClone(helperBinding),
        expectedHelperPlanDigest: helperPlanDigest,
        expectedQuote: structuredClone(quoteBinding),
        expectedSteps: structuredClone(steps),
        expectedWallet: structuredClone(plan.wallet),
        registryDigest: this.#registry.registryDigest,
        registryRollbackVersion: this.#registry.rollbackVersion,
        registryVersion: this.#registry.registryVersion,
      },
      this.#now(),
    );
    return plan;
  }
}

// Preview facts intentionally store the provider nonce views only as a consensus identity.
function currentNonceViews(facts: PreviewFacts): readonly LocalSwapNonceView[] {
  return structuredClone(facts.nonceViews);
}
