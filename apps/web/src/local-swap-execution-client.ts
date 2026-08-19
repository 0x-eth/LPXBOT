import type {
  LocalSwapExecutePreview,
  LocalSwapExecutePreviewRequest,
  LocalSwapExecuteRequest,
  LocalSwapExecutionOperation,
  LocalSwapFeeLimit,
  LocalSwapOperationStep,
  LocalSwapQuoteRequest,
  LocalSwapQuoteView,
  LocalSwapStepTransactionView,
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
const authorizationModes = new Set(["direct", "permit2"]);
const operationStates = new Set([
  "queued",
  "signing",
  "broadcast",
  "pending",
  "reconciling",
  "succeeded",
  "failed",
]);
const stepKinds = new Set(["allowance-reset", "approve", "swap", "cleanup"]);
const stepStates = new Set([
  "blocked",
  "queued",
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "succeeded",
  "failed",
  "dropped",
  "replaced",
  "skipped",
  "reconciling",
]);
const transactionStates = new Set([
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "succeeded",
  "failed",
  "dropped",
  "replaced",
]);

export class LocalSwapExecutionRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(code);
    this.name = "LocalSwapExecutionRequestError";
  }
}

function invalid(status = 0): never {
  throw new LocalSwapExecutionRequestError("LOCAL_SWAP_RESPONSE_INVALID", true, status);
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

function feeLimit(value: unknown): value is LocalSwapFeeLimit {
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

export function parseLocalSwapQuoteView(value: unknown, status = 0): LocalSwapQuoteView {
  if (
    !record(value) ||
    !exact(value, [
      "amountInBaseUnit",
      "amountOutBaseUnit",
      "blockNumber",
      "chainId",
      "deadline",
      "executionEnabled",
      "expiresAt",
      "gas",
      "helperAddress",
      "maxBlockNumber",
      "minOutBaseUnit",
      "quoteDigest",
      "quoteVersion",
      "quotedAt",
      "registryVersion",
      "serviceFeeBps",
      "slippageBps",
      "tokenIn",
      "tokenOut",
      "walletAddress",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.executionEnabled !== true ||
    value.quoteVersion !== "p05-local-swap-quote-v2" ||
    value.registryVersion !== "p05-local-swap-execution-v2" ||
    value.serviceFeeBps !== 0 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.walletAddress !== "string" ||
    !addressPattern.test(value.walletAddress) ||
    typeof value.helperAddress !== "string" ||
    !addressPattern.test(value.helperAddress) ||
    typeof value.tokenIn !== "string" ||
    !addressPattern.test(value.tokenIn) ||
    typeof value.tokenOut !== "string" ||
    !addressPattern.test(value.tokenOut) ||
    value.tokenIn === value.tokenOut ||
    typeof value.quoteDigest !== "string" ||
    !digestPattern.test(value.quoteDigest) ||
    !unsigned(value.amountInBaseUnit, true) ||
    !unsigned(value.amountOutBaseUnit, true) ||
    !unsigned(value.minOutBaseUnit, true) ||
    BigInt(value.minOutBaseUnit) > BigInt(value.amountOutBaseUnit) ||
    !unsigned(value.blockNumber) ||
    !unsigned(value.maxBlockNumber) ||
    BigInt(value.maxBlockNumber) < BigInt(value.blockNumber) ||
    !timestamp(value.quotedAt) ||
    !timestamp(value.expiresAt) ||
    !timestamp(value.deadline) ||
    Date.parse(value.quotedAt) >= Date.parse(value.expiresAt) ||
    Date.parse(value.expiresAt) > Date.parse(value.deadline) ||
    !Number.isSafeInteger(value.slippageBps) ||
    Number(value.slippageBps) < 1 ||
    Number(value.slippageBps) > 500 ||
    !record(value.gas) ||
    !exact(value.gas, [
      "estimatedFeeBaseUnit",
      "gasLimit",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
    ]) ||
    !unsigned(value.gas.estimatedFeeBaseUnit, true) ||
    !unsigned(value.gas.gasLimit, true) ||
    !unsigned(value.gas.maxFeePerGasBaseUnit, true) ||
    !unsigned(value.gas.maxPriorityFeePerGasBaseUnit) ||
    BigInt(value.gas.maxPriorityFeePerGasBaseUnit) > BigInt(value.gas.maxFeePerGasBaseUnit) ||
    BigInt(value.gas.estimatedFeeBaseUnit) !==
      BigInt(value.gas.gasLimit) * BigInt(value.gas.maxFeePerGasBaseUnit)
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalSwapQuoteView;
}

export function parseLocalSwapExecutePreview(
  value: unknown,
  status = 0,
): LocalSwapExecutePreview {
  if (
    !record(value) ||
    !exact(value, [
      "authorizationMode",
      "chainId",
      "deadline",
      "expiresAt",
      "feeLimitTotalBaseUnit",
      "helperAddress",
      "minOutBaseUnit",
      "previewDigest",
      "previewToken",
      "quoteDigest",
      "serviceFeeBps",
      "steps",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.serviceFeeBps !== 0 ||
    !authorizationModes.has(value.authorizationMode as string) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.helperAddress !== "string" ||
    !addressPattern.test(value.helperAddress) ||
    typeof value.quoteDigest !== "string" ||
    !digestPattern.test(value.quoteDigest) ||
    typeof value.previewDigest !== "string" ||
    !digestPattern.test(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !previewTokenPattern.test(value.previewToken) ||
    !timestamp(value.expiresAt) ||
    !timestamp(value.deadline) ||
    Date.parse(value.expiresAt) > Date.parse(value.deadline) ||
    !unsigned(value.minOutBaseUnit, true) ||
    !unsigned(value.feeLimitTotalBaseUnit, true) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 3 ||
    value.steps.length > 4
  ) {
    invalid(status);
  }
  const steps: LocalSwapExecutePreview["steps"] = value.steps.map((entry, ordinal) => {
    if (
      !record(entry) ||
      !exact(entry, ["amountBaseUnit", "feeLimit", "kind", "ordinal"]) ||
      entry.ordinal !== ordinal ||
      !stepKinds.has(entry.kind as string) ||
      !unsigned(entry.amountBaseUnit) ||
      !feeLimit(entry.feeLimit)
    ) {
      invalid(status);
    }
    return structuredClone(entry) as unknown as LocalSwapExecutePreview["steps"][number];
  });
  const expectedKinds =
    steps.length === 4
      ? (["allowance-reset", "approve", "swap", "cleanup"] as const)
      : (["approve", "swap", "cleanup"] as const);
  const approvedAmount = steps.find(({ kind }) => kind === "approve")?.amountBaseUnit;
  if (
    steps.some(({ kind }, index) => kind !== expectedKinds[index]) ||
    !approvedAmount ||
    steps.find(({ kind }) => kind === "swap")?.amountBaseUnit !== approvedAmount ||
    steps.some(
      ({ amountBaseUnit, kind }) =>
        (kind === "allowance-reset" || kind === "cleanup") && amountBaseUnit !== "0",
    ) ||
    BigInt(value.feeLimitTotalBaseUnit) !==
      steps.reduce((total, step) => total + BigInt(step.feeLimit.feeCapBaseUnit), 0n)
  ) {
    invalid(status);
  }
  return { ...(structuredClone(value) as unknown as LocalSwapExecutePreview), steps };
}

function transaction(value: unknown, status: number): LocalSwapStepTransactionView {
  if (
    !record(value) ||
    !exact(value, [
      "active",
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "state",
      "transactionHash",
    ]) ||
    typeof value.active !== "boolean" ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0 ||
    !unsigned(value.maxFeePerGasBaseUnit, true) ||
    !unsigned(value.maxPriorityFeePerGasBaseUnit) ||
    BigInt(value.maxPriorityFeePerGasBaseUnit) > BigInt(value.maxFeePerGasBaseUnit) ||
    !transactionStates.has(value.state as string) ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" || !hashPattern.test(value.transactionHash)))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalSwapStepTransactionView;
}

function operationStep(value: unknown, status: number, ordinal: number): LocalSwapOperationStep {
  if (
    !record(value) ||
    !exact(value, [
      "failureCode",
      "feeLimit",
      "kind",
      "nonce",
      "ordinal",
      "state",
      "stepId",
      "transactions",
    ]) ||
    value.ordinal !== ordinal ||
    !stepKinds.has(value.kind as string) ||
    !stepStates.has(value.state as string) ||
    typeof value.stepId !== "string" ||
    !uuidPattern.test(value.stepId) ||
    !unsigned(value.nonce) ||
    !feeLimit(value.feeLimit) ||
    !Array.isArray(value.transactions) ||
    (value.failureCode !== null && typeof value.failureCode !== "string")
  ) {
    invalid(status);
  }
  const transactions = value.transactions.map((entry) => transaction(entry, status));
  if (
    new Set(transactions.map(({ generation }) => generation)).size !== transactions.length ||
    transactions.filter(({ active }) => active).length > 1 ||
    transactions.some(({ generation }, index) => generation !== index) ||
    transactions.some(({ active }, index) => active && index !== transactions.length - 1)
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as LocalSwapOperationStep),
    transactions,
  };
}

export function parseLocalSwapExecutionOperation(
  value: unknown,
  status = 0,
): LocalSwapExecutionOperation {
  if (
    !record(value) ||
    !exact(value, [
      "authorizationMode",
      "chainId",
      "createdAt",
      "failureCode",
      "helperAddress",
      "operationId",
      "operationKind",
      "planDigest",
      "quoteDigest",
      "reconciliationReason",
      "registryVersion",
      "state",
      "steps",
      "updatedAt",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.operationKind !== "local-swap" ||
    value.registryVersion !== "p05-local-swap-execution-v2" ||
    !authorizationModes.has(value.authorizationMode as string) ||
    !operationStates.has(value.state as string) ||
    typeof value.operationId !== "string" ||
    !uuidPattern.test(value.operationId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.helperAddress !== "string" ||
    !addressPattern.test(value.helperAddress) ||
    typeof value.planDigest !== "string" ||
    !digestPattern.test(value.planDigest) ||
    typeof value.quoteDigest !== "string" ||
    !digestPattern.test(value.quoteDigest) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    (value.failureCode !== null && typeof value.failureCode !== "string") ||
    (value.reconciliationReason !== null && typeof value.reconciliationReason !== "string") ||
    !Array.isArray(value.steps) ||
    value.steps.length < 3 ||
    value.steps.length > 4
  ) {
    invalid(status);
  }
  const steps = value.steps.map((entry, ordinal) => operationStep(entry, status, ordinal));
  const expectedKinds =
    steps.length === 4
      ? (["allowance-reset", "approve", "swap", "cleanup"] as const)
      : (["approve", "swap", "cleanup"] as const);
  if (
    new Set(steps.map(({ stepId }) => stepId)).size !== steps.length ||
    new Set(steps.map(({ nonce }) => nonce)).size !== steps.length ||
    steps.some(({ kind }, index) => kind !== expectedKinds[index]) ||
    steps.some(({ nonce }, index) => index > 0 && BigInt(nonce) !== BigInt(steps[index - 1]!.nonce) + 1n)
  ) {
    invalid(status);
  }
  return { ...(structuredClone(value) as unknown as LocalSwapExecutionOperation), steps };
}

export class LocalSwapExecutionClient {
  readonly #fetcher: typeof fetch;
  readonly #reauthenticationProof: () => string | null;

  constructor(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    reauthenticationProof: () => string | null = () => null,
  ) {
    this.#fetcher = fetcher;
    this.#reauthenticationProof = reauthenticationProof;
  }

  async quote(request: LocalSwapQuoteRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/swap/quote", {
      body: JSON.stringify({
        amountInBaseUnit: request.amountInBaseUnit,
        chainId: 31_337,
        slippageBps: request.slippageBps,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        walletId: request.walletId,
      } satisfies LocalSwapQuoteRequest),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseLocalSwapQuoteView(response.data, response.status);
  }

  async preview(request: LocalSwapExecutePreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/swap/execute/preview", {
      body: JSON.stringify({
        authorizationMode: request.authorizationMode,
        quoteDigest: request.quoteDigest,
        walletId: request.walletId,
      } satisfies LocalSwapExecutePreviewRequest),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseLocalSwapExecutePreview(response.data, response.status);
  }

  async execute(request: LocalSwapExecuteRequest, idempotencyKey: string) {
    if (!/^[!-~]{16,128}$/u.test(idempotencyKey)) {
      throw new LocalSwapExecutionRequestError("IDEMPOTENCY_KEY_REQUIRED", false, 0);
    }
    const proof = this.#reauthenticationProof();
    const response = await this.#request("/api/swap/execute", {
      body: JSON.stringify({
        authorizationMode: request.authorizationMode,
        previewDigest: request.previewDigest,
        previewToken: request.previewToken,
        quoteDigest: request.quoteDigest,
        walletId: request.walletId,
      } satisfies LocalSwapExecuteRequest),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(proof ? { "X-LPBOT-Reauthentication": proof } : {}),
      },
      method: "POST",
    });
    return parseLocalSwapExecutionOperation(response.data, response.status);
  }

  async operation(operationId: string, signal?: AbortSignal) {
    if (!uuidPattern.test(operationId)) {
      throw new LocalSwapExecutionRequestError("LOCAL_SWAP_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/chain-operations/${operationId.toLowerCase()}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseLocalSwapExecutionOperation(response.data, response.status);
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
      throw new LocalSwapExecutionRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new LocalSwapExecutionRequestError(
        typeof error?.code === "string" ? error.code : "LOCAL_SWAP_REQUEST_FAILED",
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
