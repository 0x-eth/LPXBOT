import type {
  HelperDeploymentFeeLimit,
  HelperDeploymentOperation,
  HelperDeploymentPreview,
  HelperDeploymentPreviewRequest,
  HelperDeploymentState,
  HelperDeploymentSubmitRequest,
  HelperDeploymentTransactionView,
} from "@lpbot/api-contract";

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const unsignedPattern = /^(?:0|[1-9][0-9]*)$/u;
const previewTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const operationStates = new Set<HelperDeploymentState>([
  "queued",
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "succeeded",
  "failed",
  "dropped",
  "reconciling",
]);
const transactionStates = new Set<HelperDeploymentTransactionView["state"]>([
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "failed",
  "dropped",
  "replaced",
]);

export class HelperDeploymentRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(code);
    this.name = "HelperDeploymentRequestError";
  }
}

function invalid(status = 0): never {
  throw new HelperDeploymentRequestError("HELPER_DEPLOYMENT_RESPONSE_INVALID", true, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function unsigned(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= 78 &&
    unsignedPattern.test(value) &&
    (!positive || BigInt(value) > 0n)
  );
}

function feeLimit(value: unknown): value is HelperDeploymentFeeLimit {
  if (
    !record(value) ||
    !exact(value, [
      "feeCapBaseUnit",
      "gasLimit",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
    ]) ||
    !unsigned(value.feeCapBaseUnit, true) ||
    !unsigned(value.gasLimit, true) ||
    !unsigned(value.maxFeePerGasBaseUnit, true) ||
    !unsigned(value.maxPriorityFeePerGasBaseUnit)
  ) {
    return false;
  }
  return (
    BigInt(value.maxPriorityFeePerGasBaseUnit) <= BigInt(value.maxFeePerGasBaseUnit) &&
    BigInt(value.feeCapBaseUnit) === BigInt(value.gasLimit) * BigInt(value.maxFeePerGasBaseUnit)
  );
}

export function parseHelperDeploymentPreview(
  value: unknown,
  status = 0,
): HelperDeploymentPreview {
  if (
    !record(value) ||
    !exact(value, [
      "chainId",
      "constructor",
      "expectedAddress",
      "expectedRuntimeCodeHash",
      "expiresAt",
      "feeLimit",
      "helperVersion",
      "nonce",
      "previewDigest",
      "previewToken",
      "registryVersion",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.helperVersion !== "WalletHelperV1" ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.expectedAddress !== "string" ||
    !addressPattern.test(value.expectedAddress) ||
    typeof value.expectedRuntimeCodeHash !== "string" ||
    !hashPattern.test(value.expectedRuntimeCodeHash) ||
    !timestamp(value.expiresAt) ||
    !unsigned(value.nonce) ||
    typeof value.previewDigest !== "string" ||
    !digestPattern.test(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !previewTokenPattern.test(value.previewToken) ||
    typeof value.registryVersion !== "string" ||
    value.registryVersion.length < 1 ||
    value.registryVersion.length > 64 ||
    !feeLimit(value.feeLimit) ||
    !record(value.constructor) ||
    !exact(value.constructor, ["adapter", "owner", "permit2"])
  ) {
    invalid(status);
  }
  for (const key of ["adapter", "owner", "permit2"] as const) {
    if (typeof value.constructor[key] !== "string" || !addressPattern.test(value.constructor[key])) {
      invalid(status);
    }
  }
  return structuredClone(value) as unknown as HelperDeploymentPreview;
}

function transaction(value: unknown, status: number): HelperDeploymentTransactionView {
  if (
    !record(value) ||
    !exact(value, ["active", "generation", "state", "transactionHash"]) ||
    typeof value.active !== "boolean" ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0 ||
    !transactionStates.has(value.state as HelperDeploymentTransactionView["state"]) ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" || !hashPattern.test(value.transactionHash)))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as HelperDeploymentTransactionView;
}

export function parseHelperDeploymentOperation(
  value: unknown,
  status = 0,
): HelperDeploymentOperation {
  if (
    !record(value) ||
    !exact(value, [
      "chainId",
      "createdAt",
      "expectedAddress",
      "failureCode",
      "feeLimit",
      "helperVersion",
      "nonce",
      "operationId",
      "planDigest",
      "reconciliationReason",
      "registryVersion",
      "state",
      "transactions",
      "updatedAt",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.helperVersion !== "WalletHelperV1" ||
    typeof value.operationId !== "string" ||
    !uuidPattern.test(value.operationId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.expectedAddress !== "string" ||
    !addressPattern.test(value.expectedAddress) ||
    !unsigned(value.nonce) ||
    !feeLimit(value.feeLimit) ||
    typeof value.planDigest !== "string" ||
    !digestPattern.test(value.planDigest) ||
    typeof value.registryVersion !== "string" ||
    value.registryVersion.length < 1 ||
    value.registryVersion.length > 64 ||
    !operationStates.has(value.state as HelperDeploymentState) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    !Array.isArray(value.transactions) ||
    (value.failureCode !== null && typeof value.failureCode !== "string") ||
    (value.reconciliationReason !== null && typeof value.reconciliationReason !== "string")
  ) {
    invalid(status);
  }
  const transactions = value.transactions.map((entry) => transaction(entry, status));
  if (
    new Set(transactions.map(({ generation }) => generation)).size !== transactions.length ||
    transactions.filter(({ active }) => active).length > 1 ||
    transactions.some(({ generation }, index) => generation !== index)
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as HelperDeploymentOperation),
    transactions,
  };
}

export class HelperDeploymentClient {
  readonly #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async preview(request: HelperDeploymentPreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/wallets/helper/deploy/preview", {
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseHelperDeploymentPreview(response.data, response.status);
  }

  async submit(request: HelperDeploymentSubmitRequest, idempotencyKey: string) {
    if (!/^[!-~]{16,128}$/u.test(idempotencyKey)) {
      throw new HelperDeploymentRequestError("IDEMPOTENCY_KEY_REQUIRED", false, 0);
    }
    const response = await this.#request("/api/wallets/helper/deploy", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    return parseHelperDeploymentOperation(response.data, response.status);
  }

  async operation(operationId: string, signal?: AbortSignal) {
    if (!uuidPattern.test(operationId)) {
      throw new HelperDeploymentRequestError("HELPER_DEPLOYMENT_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/chain-operations/${operationId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseHelperDeploymentOperation(response.data, response.status);
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
      throw new HelperDeploymentRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new HelperDeploymentRequestError(
        typeof error?.code === "string" ? error.code : "HELPER_DEPLOYMENT_REQUEST_FAILED",
        error?.retryable === true,
        response.status,
      );
    }
    if (!record(envelope) || envelope.success !== true || !("data" in envelope)) {
      invalid(response.status);
    }
    return { data: envelope.data, status: response.status };
  }
}
