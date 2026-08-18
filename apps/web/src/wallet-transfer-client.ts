import {
  walletTransferSecretMediaType,
  walletTransferStates,
  type EvmAddress,
  type WalletTransferAsset,
  type WalletTransferFeeLimit,
  type WalletTransferOperation,
  type WalletTransferPreview,
  type WalletTransferPreviewRequest,
  type WalletTransferState,
  type WalletTransferSubmitRequest,
  type WalletTransferTransactionView,
} from "@lpbot/api-contract";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const baseUnitPattern = /^(?:0|[1-9][0-9]*)$/u;
const states = new Set<WalletTransferState>(walletTransferStates);

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function canonicalBaseUnit(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    baseUnitPattern.test(value) &&
    (!positive || value !== "0")
  );
}

function address(value: unknown): value is EvmAddress {
  return typeof value === "string" && addressPattern.test(value);
}

function asset(value: unknown): value is WalletTransferAsset {
  if (!record(value)) return false;
  return value.kind === "native"
    ? exact(value, ["kind"])
    : value.kind === "erc20" && exact(value, ["kind", "tokenAddress"]) && address(value.tokenAddress);
}

function feeLimit(value: unknown): value is WalletTransferFeeLimit {
  if (
    !record(value) ||
    !exact(value, [
      "feeCapBaseUnit",
      "gasLimit",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
    ]) ||
    !canonicalBaseUnit(value.feeCapBaseUnit, true) ||
    !canonicalBaseUnit(value.gasLimit, true) ||
    !canonicalBaseUnit(value.maxFeePerGasBaseUnit, true) ||
    !canonicalBaseUnit(value.maxPriorityFeePerGasBaseUnit)
  ) {
    return false;
  }
  return (
    BigInt(value.gasLimit) * BigInt(value.maxFeePerGasBaseUnit) ===
      BigInt(value.feeCapBaseUnit) &&
    BigInt(value.maxPriorityFeePerGasBaseUnit) <= BigInt(value.maxFeePerGasBaseUnit)
  );
}

export class WalletTransferRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "WalletTransferRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function invalid(status: number): never {
  throw new WalletTransferRequestError("TRANSFER_RESPONSE_INVALID", true, status);
}

export function parseWalletTransferPreview(
  value: unknown,
  status = 0,
): WalletTransferPreview {
  if (
    !record(value) ||
    !exact(value, [
      "addressClassification",
      "amountBaseUnit",
      "asset",
      "balanceChange",
      "chainId",
      "expiresAt",
      "feeLimit",
      "policyDigest",
      "policyVersion",
      "previewDigest",
      "previewToken",
      "recipient",
      "registryVersion",
      "requiresSecurityPassword",
      "walletId",
    ]) ||
    !["known-external", "new-external", "own-wallet"].includes(
      String(value.addressClassification),
    ) ||
    !canonicalBaseUnit(value.amountBaseUnit, true) ||
    !record(value.asset) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    !canonicalTimestamp(value.expiresAt) ||
    !feeLimit(value.feeLimit) ||
    typeof value.policyDigest !== "string" ||
    !digestPattern.test(value.policyDigest) ||
    typeof value.previewDigest !== "string" ||
    !digestPattern.test(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.previewToken) ||
    !address(value.recipient) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.requiresSecurityPassword !== "boolean" ||
    typeof value.policyVersion !== "string" ||
    typeof value.registryVersion !== "string"
  ) {
    invalid(status);
  }
  const metadataKeys =
    value.asset.kind === "native"
      ? ["decimals", "kind", "name", "symbol"]
      : ["decimals", "kind", "name", "symbol", "tokenAddress"];
  if (
    !exact(value.asset, metadataKeys) ||
    (value.asset.kind !== "native" &&
      (value.asset.kind !== "erc20" || !address(value.asset.tokenAddress))) ||
    !Number.isInteger(value.asset.decimals) ||
    Number(value.asset.decimals) < 0 ||
    Number(value.asset.decimals) > 255 ||
    typeof value.asset.name !== "string" ||
    typeof value.asset.symbol !== "string" ||
    !record(value.balanceChange) ||
    !exact(value.balanceChange, [
      "assetAfterBaseUnit",
      "assetBeforeBaseUnit",
      "assetDeltaBaseUnit",
      "nativeAfterMinimumBaseUnit",
      "nativeBeforeBaseUnit",
      "nativeDeltaMaximumBaseUnit",
      "recipientAssetDeltaBaseUnit",
    ])
  ) {
    invalid(status);
  }
  for (const key of [
    "assetAfterBaseUnit",
    "assetBeforeBaseUnit",
    "nativeAfterMinimumBaseUnit",
    "nativeBeforeBaseUnit",
    "recipientAssetDeltaBaseUnit",
  ] as const) {
    if (!canonicalBaseUnit(value.balanceChange[key])) invalid(status);
  }
  if (
    value.balanceChange.assetDeltaBaseUnit !== `-${value.amountBaseUnit}` ||
    typeof value.balanceChange.nativeDeltaMaximumBaseUnit !== "string" ||
    !/^-?[0-9]+$/u.test(value.balanceChange.nativeDeltaMaximumBaseUnit) ||
    value.requiresSecurityPassword !== (value.addressClassification === "new-external")
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as WalletTransferPreview;
}

function parseTransaction(value: unknown, status: number): WalletTransferTransactionView {
  if (
    !record(value) ||
    !exact(value, [
      "active",
      "createdAt",
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "nonce",
      "replacedByTransactionId",
      "replacesTransactionId",
      "state",
      "transactionHash",
      "transactionId",
    ]) ||
    typeof value.active !== "boolean" ||
    !canonicalTimestamp(value.createdAt) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0 ||
    !canonicalBaseUnit(value.maxFeePerGasBaseUnit, true) ||
    !canonicalBaseUnit(value.maxPriorityFeePerGasBaseUnit) ||
    !canonicalBaseUnit(value.nonce) ||
    !["signed", "broadcast", "pending", "confirmed", "failed", "dropped", "replaced"].includes(
      String(value.state),
    ) ||
    typeof value.transactionId !== "string" ||
    !uuidPattern.test(value.transactionId) ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" || !hashPattern.test(value.transactionHash))) ||
    (value.replacesTransactionId !== null &&
      (typeof value.replacesTransactionId !== "string" ||
        !uuidPattern.test(value.replacesTransactionId))) ||
    (value.replacedByTransactionId !== null &&
      (typeof value.replacedByTransactionId !== "string" ||
        !uuidPattern.test(value.replacedByTransactionId)))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as WalletTransferTransactionView;
}

export function parseWalletTransferOperation(
  value: unknown,
  status = 0,
): WalletTransferOperation {
  if (
    !record(value) ||
    !exact(value, [
      "activeTransactionId",
      "addressClassification",
      "amountBaseUnit",
      "asset",
      "chainId",
      "createdAt",
      "failureCode",
      "feeLimit",
      "nonce",
      "operationId",
      "planDigest",
      "policyDigest",
      "recipient",
      "reconciliationReason",
      "state",
      "transactions",
      "updatedAt",
      "walletId",
    ]) ||
    typeof value.operationId !== "string" ||
    !uuidPattern.test(value.operationId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !states.has(value.state as WalletTransferState) ||
    !asset(value.asset) ||
    !address(value.recipient) ||
    !canonicalBaseUnit(value.amountBaseUnit, true) ||
    (value.nonce !== null && !canonicalBaseUnit(value.nonce)) ||
    !feeLimit(value.feeLimit) ||
    typeof value.planDigest !== "string" ||
    !digestPattern.test(value.planDigest) ||
    typeof value.policyDigest !== "string" ||
    !digestPattern.test(value.policyDigest) ||
    !canonicalTimestamp(value.createdAt) ||
    !canonicalTimestamp(value.updatedAt) ||
    !Array.isArray(value.transactions) ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    !["known-external", "new-external", "own-wallet"].includes(
      String(value.addressClassification),
    ) ||
    (value.failureCode !== null && typeof value.failureCode !== "string") ||
    (value.reconciliationReason !== null && typeof value.reconciliationReason !== "string") ||
    (value.activeTransactionId !== null &&
      (typeof value.activeTransactionId !== "string" || !uuidPattern.test(value.activeTransactionId)))
  ) {
    invalid(status);
  }
  const transactions = value.transactions.map((entry) => parseTransaction(entry, status));
  if (
    new Set(transactions.map(({ generation }) => generation)).size !== transactions.length ||
    transactions.filter(({ active }) => active).length > 1 ||
    (value.activeTransactionId === null) !== (transactions.filter(({ active }) => active).length === 0) ||
    (value.activeTransactionId !== null &&
      !transactions.some(
        ({ active, transactionId }) => active && transactionId === value.activeTransactionId,
      )) ||
    (value.nonce !== null && transactions.some(({ nonce }) => nonce !== value.nonce))
  ) {
    invalid(status);
  }
  return { ...(structuredClone(value) as unknown as WalletTransferOperation), transactions };
}

export class WalletTransferClient {
  readonly #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async preview(request: WalletTransferPreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/wallets/transfers/preview", {
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseWalletTransferPreview(response.data, response.status);
  }

  async submit(
    request: WalletTransferSubmitRequest,
    idempotencyKey: string,
    securityPassword?: string,
  ) {
    const body = securityPassword
      ? new TextEncoder().encode(JSON.stringify({ ...request, securityPassword }))
      : null;
    try {
      const response = await this.#request("/api/wallets/transfers", {
        body: body ? (body as unknown as BodyInit) : JSON.stringify(request),
        headers: {
          "Content-Type": body ? walletTransferSecretMediaType : "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        method: "POST",
      });
      return parseWalletTransferOperation(response.data, response.status);
    } finally {
      body?.fill(0);
    }
  }

  async operation(operationId: string, signal?: AbortSignal) {
    if (!uuidPattern.test(operationId)) {
      throw new WalletTransferRequestError("TRANSFER_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/wallets/transfers/${operationId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseWalletTransferOperation(response.data, response.status);
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.#fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", "Cache-Control": "no-store", ...init.headers },
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new WalletTransferRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new WalletTransferRequestError(
        typeof error?.code === "string" ? error.code : "TRANSFER_REQUEST_FAILED",
        error?.retryable === true,
        response.status,
      );
    }
    if (!record(envelope) || envelope.success !== true || !Object.hasOwn(envelope, "data")) {
      invalid(response.status);
    }
    return { data: envelope.data, status: response.status };
  }
}
