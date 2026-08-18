import { createHash, randomBytes as systemRandomBytes, randomUUID } from "node:crypto";

import type {
  CustodyWallet,
  EvmAddress,
  WalletTokenDefinition,
  WalletTransferAddressClassification,
  WalletTransferAmount,
  WalletTransferAsset,
  WalletTransferFeeLimit,
  WalletTransferOperation,
  WalletTransferPreview,
  WalletTransferPreviewRequest,
  WalletTransferState,
  WalletTransferSubmitRequest,
} from "@lpbot/api-contract";
import {
  canonicalBaseUnit,
  canonicalTransferAddress,
  resolveWalletTransferAmount,
  transferDigestPattern,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  walletTransferPreviewDigest,
  walletTransferRequestHash,
  type WalletTransferPlan,
  type WalletTransferPreviewFacts,
} from "@lpbot/domain/wallet-transfer";
import { encodeFunctionData, getAddress, type Hex } from "viem";

import type { SecurityPasswordApplication, WalletDirectory } from "./wallets.js";

export const walletTransferBodyLimit = 8_192;
export const walletTransferPreviewTtlMilliseconds = 90_000;
export const walletTransferIdempotencyRetentionHours = 168;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const idempotencyKeyPattern = /^[\x21-\x7e]{16,128}$/u;
const erc20TransferAbi = [
  {
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export type WalletTransferErrorCode =
  | "CHAIN_NOT_ALLOWED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "NONCE_RECONCILIATION_REQUIRED"
  | "PREVIEW_CHANGED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_INVALID"
  | "SECURITY_PASSWORD_REQUIRED"
  | "TOKEN_FEE_ON_TRANSFER_UNSUPPORTED"
  | "TOKEN_NOT_FOUND"
  | "TRANSFER_ADDRESS_INVALID"
  | "TRANSFER_AMOUNT_INVALID"
  | "TRANSFER_BALANCE_INSUFFICIENT"
  | "TRANSFER_GAS_INSUFFICIENT"
  | "TRANSFER_NOT_FOUND"
  | "TRANSFER_SELF_FORBIDDEN"
  | "TRANSFER_UNAVAILABLE"
  | "WALLET_LOCKED"
  | "WALLET_NOT_FOUND";

export class WalletTransferError extends Error {
  readonly code: WalletTransferErrorCode;
  readonly retryable: boolean;

  constructor(code: WalletTransferErrorCode, retryable = false, options?: ErrorOptions) {
    super(code, options);
    this.name = "WalletTransferError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface WalletTransferPolicySnapshot {
  executionMode: "approval-required" | "local-auto";
  policyDigest: `sha256:${string}`;
  policyVersion: string;
  registryVersion: string;
}

export interface WalletTransferPolicySource {
  current(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferPolicySnapshot>;
}

export interface WalletTransferAssetDefinition extends WalletTokenDefinition {
  feeOnTransfer: boolean;
}

export interface WalletTransferAssetRegistry {
  native(chainId: number): Promise<{
    decimals: number;
    name: string;
    symbol: string;
  } | null>;
  token(input: {
    chainId: number;
    tokenAddress: EvmAddress;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferAssetDefinition | null>;
}

export interface WalletTransferChainAssetState {
  assetBalanceBaseUnit: string;
  blockNumber: string;
  nativeBalanceBaseUnit: string;
  tokenCodePresent: boolean;
  tokenMetadataMatches: boolean;
}

export interface WalletTransferNonceView {
  latest: string;
  pending: string;
  providerId: string;
}

export interface WalletTransferChainReader {
  estimateFee(input: {
    amountBaseUnit: string;
    asset: WalletTransferAsset;
    chainId: number;
    recipient: EvmAddress;
    walletAddress: EvmAddress;
  }): Promise<WalletTransferFeeLimit>;
  nonceViews(input: {
    chainId: number;
    walletAddress: EvmAddress;
  }): Promise<WalletTransferNonceView[]>;
  readAssetState(input: {
    asset: WalletTransferAsset;
    chainId: number;
    tokenDefinition: WalletTransferAssetDefinition | null;
    walletAddress: EvmAddress;
  }): Promise<WalletTransferChainAssetState>;
}

export interface WalletTransferAddressClassifier {
  classify(input: {
    address: EvmAddress;
    chainId: number;
    userId: string;
  }): Promise<WalletTransferAddressClassification>;
}

export interface StoredWalletTransferOperation extends WalletTransferOperation {
  fencingToken: string | null;
  plan: WalletTransferPlan | null;
  reauthenticatedSessionId: string;
  requestHash: `sha256:${string}`;
  securityPasswordVersion: number | null;
  userId: string;
}

export interface WalletTransferIdempotencyRecord {
  operation: StoredWalletTransferOperation;
  requestHash: `sha256:${string}`;
}

export interface WalletTransferCreateInput {
  addressClassification: WalletTransferAddressClassification;
  amountBaseUnit: string;
  asset: WalletTransferAsset;
  chainId: number;
  executionMode: WalletTransferPolicySnapshot["executionMode"];
  feeLimit: WalletTransferFeeLimit;
  idempotencyKey: string;
  nonceViews: readonly WalletTransferNonceView[];
  policyDigest: `sha256:${string}`;
  policyVersion: string;
  previewDigest: `sha256:${string}`;
  recipient: EvmAddress;
  requestHash: `sha256:${string}`;
  requestId: string;
  registryVersion: string;
  securityPasswordVersion: number | null;
  sessionId: string;
  userId: string;
  walletAddress: EvmAddress;
  walletId: string;
  buildPlan(input: {
    fencingToken: string;
    nonce: string;
    operationId: string;
  }): WalletTransferPlan;
}

export type WalletTransferCreateResult =
  | { kind: "created"; operation: StoredWalletTransferOperation }
  | { kind: "duplicate"; operation: StoredWalletTransferOperation };

export interface WalletTransferOperationStore {
  create(input: WalletTransferCreateInput): Promise<WalletTransferCreateResult>;
  findIdempotency(input: {
    commandType: "wallet.transfer";
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferIdempotencyRecord | null>;
  get(input: {
    operationId: string;
    userId: string;
  }): Promise<StoredWalletTransferOperation | null>;
}

interface StoredPreview {
  createdAt: Date;
  facts: WalletTransferPreviewFacts;
  previewDigest: `sha256:${string}`;
  request: WalletTransferPreviewRequest;
  tokenDigest: string;
  userId: string;
}

export interface WalletTransferPreviewStore {
  get(token: string): Promise<StoredPreview | null>;
  put(input: StoredPreview): Promise<void>;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function approvalPlanDigest(previewDigest: string): `sha256:${string}` {
  return `sha256:${sha256(`wallet-transfer-approval/v1\n${previewDigest}`)}`;
}

function cloneOperation(operation: StoredWalletTransferOperation): StoredWalletTransferOperation {
  return structuredClone(operation);
}

function publicOperation(operation: StoredWalletTransferOperation): WalletTransferOperation {
  const value = cloneOperation(operation);
  return {
    activeTransactionId: value.activeTransactionId,
    addressClassification: value.addressClassification,
    amountBaseUnit: value.amountBaseUnit,
    asset: value.asset,
    chainId: value.chainId,
    createdAt: value.createdAt,
    failureCode: value.failureCode,
    feeLimit: value.feeLimit,
    nonce: value.nonce,
    operationId: value.operationId,
    planDigest: value.planDigest,
    policyDigest: value.policyDigest,
    recipient: value.recipient,
    reconciliationReason: value.reconciliationReason,
    state: value.state,
    transactions: value.transactions,
    updatedAt: value.updatedAt,
    walletId: value.walletId,
  };
}

function operationScope(input: {
  idempotencyKey: string;
  userId: string;
  walletId: string;
}): string {
  return `${input.userId}\u0000wallet.transfer\u0000${input.walletId}\u0000${input.idempotencyKey}`;
}

export interface MemoryWalletTransferOutboxEvent {
  aggregateId: string;
  createdAt: string;
  eventId: string;
  eventType:
    "wallet-transfer.queued" | "wallet-transfer.ready-for-approval" | "wallet-transfer.reconciling";
  payload: {
    chainId: number;
    operationId: string;
    state: WalletTransferState;
    walletId: string;
  };
}

interface MemoryNonceLedger {
  fencingToken: bigint;
  nextNonce: bigint | null;
  reservations: Set<bigint>;
}

export class MemoryWalletTransferOperationStore implements WalletTransferOperationStore {
  readonly outbox: MemoryWalletTransferOutboxEvent[] = [];
  readonly #idempotency = new Map<
    string,
    { operationId: string; requestHash: `sha256:${string}` }
  >();
  readonly #ledgers = new Map<string, MemoryNonceLedger>();
  readonly #now: () => Date;
  readonly #operations = new Map<string, StoredWalletTransferOperation>();
  readonly #uuid: () => string;

  constructor(input: { now?: () => Date; uuid?: () => string } = {}) {
    this.#now = input.now ?? (() => new Date());
    this.#uuid = input.uuid ?? randomUUID;
  }

  async findIdempotency(input: {
    commandType: "wallet.transfer";
    idempotencyKey: string;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferIdempotencyRecord | null> {
    const reservation = this.#idempotency.get(operationScope(input));
    const operation = reservation ? this.#operations.get(reservation.operationId) : null;
    return reservation && operation
      ? { operation: cloneOperation(operation), requestHash: reservation.requestHash }
      : null;
  }

  async get(input: {
    operationId: string;
    userId: string;
  }): Promise<StoredWalletTransferOperation | null> {
    const operation = this.#operations.get(input.operationId);
    return operation?.userId === input.userId ? cloneOperation(operation) : null;
  }

  async create(input: WalletTransferCreateInput): Promise<WalletTransferCreateResult> {
    const scope = operationScope(input);
    const existing = this.#idempotency.get(scope);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new WalletTransferError("IDEMPOTENCY_CONFLICT");
      }
      const operation = this.#operations.get(existing.operationId);
      if (!operation) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
      return { kind: "duplicate", operation: cloneOperation(operation) };
    }

    const operationId = this.#uuid().toLowerCase();
    if (!uuidPattern.test(operationId)) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
    const createdAt = this.#now().toISOString();
    let fencingToken: string | null = null;
    let nonce: string | null = null;
    let plan: WalletTransferPlan | null = null;
    let state: WalletTransferState =
      input.executionMode === "approval-required" ? "ready-for-approval" : "queued";
    let reconciliationReason: string | null = null;

    if (input.executionMode === "local-auto") {
      const nonceDecision = this.#reserveNonce(input.chainId, input.walletId, input.nonceViews);
      if (nonceDecision.kind === "reconciling") {
        state = "reconciling";
        reconciliationReason = nonceDecision.reason;
      } else {
        nonce = nonceDecision.nonce;
        fencingToken = nonceDecision.fencingToken;
        plan = input.buildPlan({ fencingToken, nonce, operationId });
        validateWalletTransferPlan(plan, new Date(createdAt));
      }
    }

    const operation: StoredWalletTransferOperation = {
      activeTransactionId: null,
      addressClassification: input.addressClassification,
      amountBaseUnit: input.amountBaseUnit,
      asset: structuredClone(input.asset),
      chainId: input.chainId,
      createdAt,
      failureCode: null,
      feeLimit: structuredClone(input.feeLimit),
      fencingToken,
      nonce,
      operationId,
      plan,
      planDigest: plan ? walletTransferPlanDigest(plan) : approvalPlanDigest(input.previewDigest),
      policyDigest: input.policyDigest,
      reauthenticatedSessionId: input.sessionId,
      recipient: input.recipient,
      reconciliationReason,
      requestHash: input.requestHash,
      securityPasswordVersion: input.securityPasswordVersion,
      state,
      transactions: [],
      updatedAt: createdAt,
      userId: input.userId,
      walletId: input.walletId,
    };

    this.#operations.set(operationId, operation);
    this.#idempotency.set(scope, { operationId, requestHash: input.requestHash });
    const eventType =
      state === "queued"
        ? "wallet-transfer.queued"
        : state === "ready-for-approval"
          ? "wallet-transfer.ready-for-approval"
          : "wallet-transfer.reconciling";
    this.outbox.push({
      aggregateId: operationId,
      createdAt,
      eventId: this.#uuid().toLowerCase(),
      eventType,
      payload: { chainId: input.chainId, operationId, state, walletId: input.walletId },
    });
    return { kind: "created", operation: cloneOperation(operation) };
  }

  #reserveNonce(
    chainId: number,
    walletId: string,
    views: readonly WalletTransferNonceView[],
  ):
    | { kind: "reserved"; fencingToken: string; nonce: string }
    | { kind: "reconciling"; reason: string } {
    if (views.length < 1) return { kind: "reconciling", reason: "NONCE_PROVIDER_UNAVAILABLE" };
    let parsed: Array<{ latest: bigint; pending: bigint }>;
    try {
      parsed = views.map((view) => ({
        latest: BigInt(canonicalBaseUnit(view.latest)),
        pending: BigInt(canonicalBaseUnit(view.pending)),
      }));
    } catch {
      return { kind: "reconciling", reason: "NONCE_PROVIDER_INVALID" };
    }
    if (
      new Set(parsed.map(({ latest }) => latest.toString())).size !== 1 ||
      new Set(parsed.map(({ pending }) => pending.toString())).size !== 1
    ) {
      return { kind: "reconciling", reason: "NONCE_PROVIDER_DIVERGENCE" };
    }
    const latest = parsed[0]!.latest;
    const pending = parsed[0]!.pending;
    if (pending < latest) return { kind: "reconciling", reason: "NONCE_PENDING_BEHIND_LATEST" };
    const key = `${chainId}:${walletId}`;
    const ledger = this.#ledgers.get(key) ?? {
      fencingToken: 0n,
      nextNonce: null,
      reservations: new Set<bigint>(),
    };
    for (const reserved of ledger.reservations) {
      if (reserved < latest) ledger.reservations.delete(reserved);
    }
    if (ledger.nextNonce === null) ledger.nextNonce = pending;
    if (pending > ledger.nextNonce) {
      return { kind: "reconciling", reason: "NONCE_GAP_DETECTED" };
    }
    if (latest > ledger.nextNonce) {
      return { kind: "reconciling", reason: "NONCE_LEDGER_BEHIND_LATEST" };
    }
    const nonce = ledger.nextNonce;
    ledger.nextNonce += 1n;
    ledger.fencingToken += 1n;
    ledger.reservations.add(nonce);
    this.#ledgers.set(key, ledger);
    return {
      fencingToken: ledger.fencingToken.toString(),
      kind: "reserved",
      nonce: nonce.toString(),
    };
  }
}

export class MemoryWalletTransferPreviewStore implements WalletTransferPreviewStore {
  readonly #previews = new Map<string, StoredPreview>();

  async get(token: string): Promise<StoredPreview | null> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const value = this.#previews.get(sha256(token));
    return value ? structuredClone(value) : null;
  }

  async put(input: StoredPreview): Promise<void> {
    this.#previews.set(input.tokenDigest, structuredClone(input));
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WalletTransferError("PREVIEW_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function transferWalletId(value: unknown, code: WalletTransferErrorCode = "WALLET_NOT_FOUND") {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new WalletTransferError(code);
  return value.toLowerCase();
}

function transferAddress(value: unknown): EvmAddress {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new WalletTransferError("TRANSFER_ADDRESS_INVALID");
  }
  try {
    return getAddress(value).toLowerCase() as EvmAddress;
  } catch (error) {
    throw new WalletTransferError("TRANSFER_ADDRESS_INVALID", false, { cause: error });
  }
}

function transferAmount(value: unknown): WalletTransferAmount {
  const input = plainRecord(value);
  if (input.kind === "exact" && exactKeys(input, ["amountBaseUnit", "kind"])) {
    try {
      return {
        amountBaseUnit: canonicalBaseUnit(input.amountBaseUnit, { positive: true }),
        kind: "exact",
      };
    } catch (error) {
      throw new WalletTransferError("TRANSFER_AMOUNT_INVALID", false, { cause: error });
    }
  }
  if (
    input.kind === "preset" &&
    exactKeys(input, ["kind", "preset"]) &&
    (input.preset === "25" ||
      input.preset === "50" ||
      input.preset === "75" ||
      input.preset === "MAX")
  ) {
    return { kind: "preset", preset: input.preset };
  }
  throw new WalletTransferError("TRANSFER_AMOUNT_INVALID");
}

function transferAsset(value: unknown): WalletTransferAsset {
  const input = plainRecord(value);
  if (input.kind === "native" && exactKeys(input, ["kind"])) return { kind: "native" };
  if (input.kind === "erc20" && exactKeys(input, ["kind", "tokenAddress"])) {
    return { kind: "erc20", tokenAddress: transferAddress(input.tokenAddress) };
  }
  throw new WalletTransferError("PREVIEW_INVALID");
}

export function parseWalletTransferPreviewRequest(value: unknown): WalletTransferPreviewRequest {
  const input = plainRecord(value);
  if (
    !exactKeys(input, ["amount", "asset", "chainId", "recipient", "walletId"]) ||
    !Number.isSafeInteger(input.chainId) ||
    Number(input.chainId) < 1
  ) {
    throw new WalletTransferError("PREVIEW_INVALID");
  }
  return {
    amount: transferAmount(input.amount),
    asset: transferAsset(input.asset),
    chainId: Number(input.chainId),
    recipient: transferAddress(input.recipient),
    walletId: transferWalletId(input.walletId),
  };
}

export interface ParsedWalletTransferSubmit {
  password: string | null;
  request: WalletTransferSubmitRequest;
}

export function parseWalletTransferSubmit(value: unknown): ParsedWalletTransferSubmit {
  let parsed = value;
  if (value instanceof Uint8Array) {
    try {
      parsed = JSON.parse(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8"),
      );
    } catch (error) {
      throw new WalletTransferError("PREVIEW_INVALID", false, { cause: error });
    }
  }
  const input = plainRecord(parsed);
  const keys = Object.keys(input).sort().join(",");
  if (
    keys !== "previewDigest,previewToken,walletId" &&
    keys !== "previewDigest,previewToken,securityPassword,walletId"
  ) {
    throw new WalletTransferError("PREVIEW_INVALID");
  }
  if (
    typeof input.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.previewToken) ||
    typeof input.previewDigest !== "string" ||
    !transferDigestPattern.test(input.previewDigest) ||
    (Object.hasOwn(input, "securityPassword") &&
      (typeof input.securityPassword !== "string" ||
        [...input.securityPassword].length < 1 ||
        [...input.securityPassword].length > 256))
  ) {
    throw new WalletTransferError("PREVIEW_INVALID");
  }
  const password = typeof input.securityPassword === "string" ? input.securityPassword : null;
  input.securityPassword = "";
  return {
    password,
    request: {
      previewDigest: input.previewDigest as `sha256:${string}`,
      previewToken: input.previewToken,
      walletId: transferWalletId(input.walletId),
    },
  };
}

export function parseWalletTransferIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !idempotencyKeyPattern.test(value)) {
    throw new WalletTransferError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return value;
}

export function parseWalletTransferOperationId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new WalletTransferError("TRANSFER_NOT_FOUND");
  }
  return value.toLowerCase();
}

function feeLimit(value: WalletTransferFeeLimit): WalletTransferFeeLimit {
  try {
    const parsed = {
      feeCapBaseUnit: canonicalBaseUnit(value.feeCapBaseUnit, { positive: true }),
      gasLimit: canonicalBaseUnit(value.gasLimit, { positive: true }),
      maxFeePerGasBaseUnit: canonicalBaseUnit(value.maxFeePerGasBaseUnit, { positive: true }),
      maxPriorityFeePerGasBaseUnit: canonicalBaseUnit(value.maxPriorityFeePerGasBaseUnit),
    };
    if (
      BigInt(parsed.maxPriorityFeePerGasBaseUnit) > BigInt(parsed.maxFeePerGasBaseUnit) ||
      BigInt(parsed.gasLimit) * BigInt(parsed.maxFeePerGasBaseUnit) !==
        BigInt(parsed.feeCapBaseUnit)
    ) {
      throw new RangeError("fee mismatch");
    }
    return parsed;
  } catch (error) {
    throw new WalletTransferError("TRANSFER_UNAVAILABLE", true, { cause: error });
  }
}

function mapAmountError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message === "TRANSFER_GAS_INSUFFICIENT") {
    throw new WalletTransferError("TRANSFER_GAS_INSUFFICIENT");
  }
  if (message === "TRANSFER_BALANCE_INSUFFICIENT") {
    throw new WalletTransferError("TRANSFER_BALANCE_INSUFFICIENT");
  }
  throw new WalletTransferError("TRANSFER_AMOUNT_INVALID");
}

export interface WalletTransferApplication {
  get(input: { operationId: string; userId: string }): Promise<WalletTransferOperation>;
  preview(input: {
    request: WalletTransferPreviewRequest;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletTransferPreview>;
  submit(input: {
    idempotencyKey: string;
    password: string | null;
    request: WalletTransferSubmitRequest;
    requestId: string;
    secretIngress: boolean;
    sessionId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: WalletTransferOperation }>;
}

export class WalletTransferService implements WalletTransferApplication {
  readonly #addresses: WalletTransferAddressClassifier;
  readonly #assets: WalletTransferAssetRegistry;
  readonly #chain: WalletTransferChainReader;
  readonly #localChainIds: ReadonlySet<number>;
  readonly #now: () => Date;
  readonly #operations: WalletTransferOperationStore;
  readonly #policies: WalletTransferPolicySource;
  readonly #previews: WalletTransferPreviewStore;
  readonly #previewTtlMilliseconds: number;
  readonly #randomBytes: (length: number) => Uint8Array;
  readonly #securityPassword: SecurityPasswordApplication | null;

  constructor(input: {
    addresses: WalletTransferAddressClassifier;
    assets: WalletTransferAssetRegistry;
    chain: WalletTransferChainReader;
    localChainIds: readonly number[];
    now?: () => Date;
    operations: WalletTransferOperationStore;
    policies: WalletTransferPolicySource;
    previews: WalletTransferPreviewStore;
    previewTtlMilliseconds?: number;
    randomBytes?: (length: number) => Uint8Array;
    securityPassword?: SecurityPasswordApplication;
  }) {
    this.#addresses = input.addresses;
    this.#assets = input.assets;
    this.#chain = input.chain;
    if (
      input.localChainIds.length < 1 ||
      input.localChainIds.some((chainId) => !Number.isSafeInteger(chainId) || chainId < 1) ||
      new Set(input.localChainIds).size !== input.localChainIds.length
    ) {
      throw new RangeError("localChainIds must contain unique positive chain identifiers");
    }
    this.#localChainIds = new Set(input.localChainIds);
    this.#now = input.now ?? (() => new Date());
    this.#operations = input.operations;
    this.#policies = input.policies;
    this.#previews = input.previews;
    this.#previewTtlMilliseconds =
      input.previewTtlMilliseconds ?? walletTransferPreviewTtlMilliseconds;
    if (
      !Number.isSafeInteger(this.#previewTtlMilliseconds) ||
      this.#previewTtlMilliseconds < 1_000
    ) {
      throw new RangeError("previewTtlMilliseconds must be at least one second");
    }
    this.#randomBytes = input.randomBytes ?? systemRandomBytes;
    this.#securityPassword = input.securityPassword ?? null;
  }

  async get(input: { operationId: string; userId: string }): Promise<WalletTransferOperation> {
    const operation = await this.#operations.get(input);
    if (!operation) throw new WalletTransferError("TRANSFER_NOT_FOUND");
    return publicOperation(operation);
  }

  async preview(input: {
    request: WalletTransferPreviewRequest;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletTransferPreview> {
    this.#assertWallet(input.request, input.wallet);
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + this.#previewTtlMilliseconds).toISOString();
    const facts = await this.#previewFacts({ ...input, expiresAt });
    const previewDigest = walletTransferPreviewDigest(facts);
    const tokenBytes = Buffer.from(this.#randomBytes(32));
    if (tokenBytes.length !== 32) {
      tokenBytes.fill(0);
      throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
    }
    const previewToken = tokenBytes.toString("base64url");
    tokenBytes.fill(0);
    await this.#previews.put({
      createdAt,
      facts,
      previewDigest,
      request: structuredClone(input.request),
      tokenDigest: sha256(previewToken),
      userId: input.userId,
    });
    return this.#publicPreview(facts, previewDigest, previewToken);
  }

  async submit(input: {
    idempotencyKey: string;
    password: string | null;
    request: WalletTransferSubmitRequest;
    requestId: string;
    secretIngress: boolean;
    sessionId: string;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<{ created: boolean; operation: WalletTransferOperation }> {
    const idempotencyKey = parseWalletTransferIdempotencyKey(input.idempotencyKey);
    this.#assertWalletId(input.request.walletId, input.wallet);
    const stored = await this.#previews.get(input.request.previewToken);
    if (
      !stored ||
      stored.userId !== input.userId ||
      stored.request.walletId !== input.wallet.walletId ||
      stored.previewDigest !== input.request.previewDigest
    ) {
      throw new WalletTransferError("PREVIEW_INVALID");
    }
    const requestHash = walletTransferRequestHash({
      amountBaseUnit: stored.facts.amountBaseUnit,
      asset: stored.request.asset,
      chainId: stored.request.chainId,
      previewDigest: stored.previewDigest,
      recipient: stored.request.recipient,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    const reservation = await this.#operations.findIdempotency({
      commandType: "wallet.transfer",
      idempotencyKey,
      userId: input.userId,
      walletId: input.wallet.walletId,
    });
    if (reservation) {
      if (reservation.requestHash !== requestHash) {
        throw new WalletTransferError("IDEMPOTENCY_CONFLICT");
      }
      return { created: false, operation: publicOperation(reservation.operation) };
    }
    const now = this.#now();
    if (new Date(stored.facts.expiresAt).getTime() <= now.getTime()) {
      throw new WalletTransferError("PREVIEW_EXPIRED");
    }
    this.#assertWallet(stored.request, input.wallet);
    const currentFacts = await this.#previewFacts({
      expiresAt: stored.facts.expiresAt,
      request: stored.request,
      userId: input.userId,
      wallet: input.wallet,
    });
    if (walletTransferPreviewDigest(currentFacts) !== stored.previewDigest) {
      throw new WalletTransferError("PREVIEW_CHANGED");
    }

    let securityPasswordVersion: number | null = null;
    let passwordIngress: Buffer | null = null;
    try {
      if (stored.facts.addressClassification === "new-external") {
        if (!input.secretIngress || !input.password) {
          throw new WalletTransferError("SECURITY_PASSWORD_REQUIRED");
        }
        if (!this.#securityPassword) throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
        passwordIngress = Buffer.from(JSON.stringify({ password: input.password }), "utf8");
        input.password = null;
        const verified = await this.#securityPassword.verifySecurityPassword({
          ingress: passwordIngress,
          userId: input.userId,
        });
        if (
          verified.verified !== true ||
          !Number.isSafeInteger(verified.version) ||
          verified.version < 1
        ) {
          throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
        }
        securityPasswordVersion = verified.version;
      } else if (input.password !== null || input.secretIngress) {
        throw new WalletTransferError("PREVIEW_INVALID");
      }

      const nonceViews =
        currentFacts.executionMode === "local-auto"
          ? await this.#chain.nonceViews({
              chainId: stored.request.chainId,
              walletAddress: canonicalTransferAddress(input.wallet.address),
            })
          : [];
      const result = await this.#operations.create({
        addressClassification: stored.facts.addressClassification,
        amountBaseUnit: stored.facts.amountBaseUnit,
        asset: stored.request.asset,
        buildPlan: ({ fencingToken, nonce, operationId }) =>
          this.#buildPlan({
            amountBaseUnit: stored.facts.amountBaseUnit,
            asset: stored.request.asset,
            chainId: stored.request.chainId,
            deadline: stored.facts.expiresAt,
            feeLimit: stored.facts.feeLimit,
            fencingToken,
            nonce,
            operationId,
            policyDigest: stored.facts.policyDigest,
            recipient: stored.request.recipient,
            walletAddress: canonicalTransferAddress(input.wallet.address),
            walletId: input.wallet.walletId,
          }),
        chainId: stored.request.chainId,
        executionMode: currentFacts.executionMode,
        feeLimit: stored.facts.feeLimit,
        idempotencyKey,
        nonceViews,
        policyDigest: stored.facts.policyDigest,
        policyVersion: stored.facts.policyVersion,
        previewDigest: stored.previewDigest,
        recipient: stored.request.recipient,
        requestHash,
        requestId: input.requestId,
        registryVersion: stored.facts.registryVersion,
        securityPasswordVersion,
        sessionId: input.sessionId,
        userId: input.userId,
        walletAddress: canonicalTransferAddress(input.wallet.address),
        walletId: input.wallet.walletId,
      });
      return { created: result.kind === "created", operation: publicOperation(result.operation) };
    } finally {
      input.password = null;
      passwordIngress?.fill(0);
    }
  }

  #assertWallet(request: WalletTransferPreviewRequest, wallet: CustodyWallet): void {
    this.#assertWalletId(request.walletId, wallet);
    if (wallet.lockStatus !== "ready") throw new WalletTransferError("WALLET_LOCKED");
    const walletAddress = canonicalTransferAddress(wallet.address);
    if (walletAddress === request.recipient)
      throw new WalletTransferError("TRANSFER_SELF_FORBIDDEN");
  }

  #assertWalletId(walletId: string, wallet: CustodyWallet): void {
    if (wallet.walletId !== walletId) throw new WalletTransferError("WALLET_NOT_FOUND");
  }

  async #previewFacts(input: {
    expiresAt: string;
    request: WalletTransferPreviewRequest;
    userId: string;
    wallet: CustodyWallet;
  }): Promise<WalletTransferPreviewFacts> {
    const { request } = input;
    const walletAddress = canonicalTransferAddress(input.wallet.address);
    const [policy, classification, resolvedAsset] = await Promise.all([
      this.#currentPolicy({
        chainId: request.chainId,
        userId: input.userId,
        walletId: request.walletId,
      }),
      this.#addresses.classify({
        address: request.recipient,
        chainId: request.chainId,
        userId: input.userId,
      }),
      this.#resolveAsset(request.asset, request.chainId, input.userId, request.walletId),
    ]);
    const state = await this.#chain.readAssetState({
      asset: request.asset,
      chainId: request.chainId,
      tokenDefinition: resolvedAsset.tokenDefinition,
      walletAddress,
    });
    try {
      canonicalBaseUnit(state.assetBalanceBaseUnit);
      canonicalBaseUnit(state.nativeBalanceBaseUnit);
      canonicalBaseUnit(state.blockNumber);
    } catch (error) {
      throw new WalletTransferError("TRANSFER_UNAVAILABLE", true, { cause: error });
    }
    if (
      request.asset.kind === "erc20" &&
      (!state.tokenCodePresent || !state.tokenMetadataMatches)
    ) {
      throw new WalletTransferError("TOKEN_NOT_FOUND");
    }
    const provisionalAmount = request.amount.kind === "exact" ? request.amount.amountBaseUnit : "1";
    let fees = feeLimit(
      await this.#chain.estimateFee({
        amountBaseUnit: provisionalAmount,
        asset: request.asset,
        chainId: request.chainId,
        recipient: request.recipient,
        walletAddress,
      }),
    );
    let amountBaseUnit: string;
    try {
      amountBaseUnit = resolveWalletTransferAmount({
        amount: request.amount,
        assetBalanceBaseUnit: state.assetBalanceBaseUnit,
        assetKind: request.asset.kind,
        feeCapBaseUnit: fees.feeCapBaseUnit,
        nativeBalanceBaseUnit: state.nativeBalanceBaseUnit,
      });
    } catch (error) {
      mapAmountError(error);
    }
    fees = feeLimit(
      await this.#chain.estimateFee({
        amountBaseUnit,
        asset: request.asset,
        chainId: request.chainId,
        recipient: request.recipient,
        walletAddress,
      }),
    );
    try {
      amountBaseUnit = resolveWalletTransferAmount({
        amount: request.amount,
        assetBalanceBaseUnit: state.assetBalanceBaseUnit,
        assetKind: request.asset.kind,
        feeCapBaseUnit: fees.feeCapBaseUnit,
        nativeBalanceBaseUnit: state.nativeBalanceBaseUnit,
      });
    } catch (error) {
      mapAmountError(error);
    }
    return {
      addressClassification: classification,
      amountBaseUnit,
      asset: {
        ...request.asset,
        decimals: resolvedAsset.decimals,
        name: resolvedAsset.name,
        symbol: resolvedAsset.symbol,
      },
      assetBalanceBaseUnit: state.assetBalanceBaseUnit,
      blockNumber: state.blockNumber,
      chainId: request.chainId,
      executionMode: policy.executionMode,
      expiresAt: input.expiresAt,
      feeLimit: fees,
      nativeBalanceBaseUnit: state.nativeBalanceBaseUnit,
      policyDigest: policy.policyDigest,
      policyVersion: policy.policyVersion,
      recipient: request.recipient,
      registryVersion: policy.registryVersion,
      walletAddress,
      walletId: request.walletId,
    };
  }

  async #currentPolicy(input: {
    chainId: number;
    userId: string;
    walletId: string;
  }): Promise<WalletTransferPolicySnapshot> {
    const policy = await this.#policies.current(input);
    if (policy.executionMode !== "approval-required" && policy.executionMode !== "local-auto") {
      throw new WalletTransferError("TRANSFER_UNAVAILABLE", true);
    }
    return {
      ...policy,
      executionMode: this.#localChainIds.has(input.chainId)
        ? policy.executionMode
        : "approval-required",
    };
  }

  async #resolveAsset(
    asset: WalletTransferAsset,
    chainId: number,
    userId: string,
    walletId: string,
  ): Promise<{
    decimals: number;
    name: string;
    symbol: string;
    tokenDefinition: WalletTransferAssetDefinition | null;
  }> {
    if (asset.kind === "native") {
      const native = await this.#assets.native(chainId);
      if (!native) throw new WalletTransferError("CHAIN_NOT_ALLOWED");
      return { ...native, tokenDefinition: null };
    }
    const token = await this.#assets.token({
      chainId,
      tokenAddress: asset.tokenAddress,
      userId,
      walletId,
    });
    if (!token) throw new WalletTransferError("TOKEN_NOT_FOUND");
    if (token.feeOnTransfer) throw new WalletTransferError("TOKEN_FEE_ON_TRANSFER_UNSUPPORTED");
    return {
      decimals: token.decimals,
      name: token.name,
      symbol: token.symbol,
      tokenDefinition: token,
    };
  }

  #buildPlan(
    input: Omit<
      WalletTransferPlan,
      "transactionData" | "transactionTarget" | "transactionValueBaseUnit"
    >,
  ): WalletTransferPlan {
    const native = input.asset.kind === "native";
    const transactionTarget =
      input.asset.kind === "native" ? input.recipient : input.asset.tokenAddress;
    const plan: WalletTransferPlan = {
      ...input,
      transactionData: native
        ? "0x"
        : (encodeFunctionData({
            abi: erc20TransferAbi,
            args: [getAddress(input.recipient), BigInt(input.amountBaseUnit)],
            functionName: "transfer",
          }).toLowerCase() as Hex),
      transactionTarget,
      transactionValueBaseUnit: native ? input.amountBaseUnit : "0",
    };
    validateWalletTransferPlan(plan, this.#now());
    return plan;
  }

  #publicPreview(
    facts: WalletTransferPreviewFacts,
    previewDigest: `sha256:${string}`,
    previewToken: string,
  ): WalletTransferPreview {
    const assetBefore = BigInt(facts.assetBalanceBaseUnit);
    const nativeBefore = BigInt(facts.nativeBalanceBaseUnit);
    const amount = BigInt(facts.amountBaseUnit);
    const fee = BigInt(facts.feeLimit.feeCapBaseUnit);
    const nativeAsset = facts.asset.kind === "native";
    return {
      addressClassification: facts.addressClassification,
      amountBaseUnit: facts.amountBaseUnit,
      asset: structuredClone(facts.asset),
      balanceChange: {
        assetAfterBaseUnit: (assetBefore - amount).toString(),
        assetBeforeBaseUnit: facts.assetBalanceBaseUnit,
        assetDeltaBaseUnit: `-${facts.amountBaseUnit}`,
        nativeAfterMinimumBaseUnit: (nativeBefore - fee - (nativeAsset ? amount : 0n)).toString(),
        nativeBeforeBaseUnit: facts.nativeBalanceBaseUnit,
        nativeDeltaMaximumBaseUnit: `-${(fee + (nativeAsset ? amount : 0n)).toString()}`,
        recipientAssetDeltaBaseUnit: facts.amountBaseUnit,
      },
      chainId: facts.chainId,
      expiresAt: facts.expiresAt,
      feeLimit: structuredClone(facts.feeLimit),
      policyDigest: facts.policyDigest,
      policyVersion: facts.policyVersion,
      previewDigest,
      previewToken,
      recipient: facts.recipient,
      registryVersion: facts.registryVersion,
      requiresSecurityPassword: facts.addressClassification === "new-external",
      walletId: facts.walletId,
    };
  }
}

export class DirectoryWalletTransferAddressClassifier implements WalletTransferAddressClassifier {
  readonly #addresses: {
    list(input: { chainId: number; userId: string }): Promise<Array<{ address: EvmAddress }>>;
  };
  readonly #wallets: WalletDirectory;

  constructor(input: {
    addresses: {
      list(input: { chainId: number; userId: string }): Promise<Array<{ address: EvmAddress }>>;
    };
    wallets: WalletDirectory;
  }) {
    this.#addresses = input.addresses;
    this.#wallets = input.wallets;
  }

  async classify(input: {
    address: EvmAddress;
    chainId: number;
    userId: string;
  }): Promise<WalletTransferAddressClassification> {
    const [entries, wallets] = await Promise.all([
      this.#addresses.list({ chainId: input.chainId, userId: input.userId }),
      this.#wallets.listWallets(input.userId),
    ]);
    const address = canonicalTransferAddress(input.address);
    if (wallets.items.some((wallet) => canonicalTransferAddress(wallet.address) === address)) {
      return "own-wallet";
    }
    return entries.some((entry) => canonicalTransferAddress(entry.address) === address)
      ? "known-external"
      : "new-external";
  }
}
