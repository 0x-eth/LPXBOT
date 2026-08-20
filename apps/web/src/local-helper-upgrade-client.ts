import type {
  LocalHelperUpgradeCursor,
  LocalHelperUpgradeOperation,
  LocalHelperUpgradePreview,
  LocalHelperUpgradePreviewRequest,
  LocalHelperUpgradeState,
  LocalHelperUpgradeStepState,
  LocalHelperUpgradeSubmitRequest,
  LocalHelperUpgradeTransactionView,
  LocalHelperUpgradeVersionView,
  LocalSwapFeeLimit,
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
const cursors = [
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
] as const satisfies readonly LocalHelperUpgradeCursor[];
const operationStates = new Set<LocalHelperUpgradeState>([
  "queued",
  "running",
  "manual-recovery-required",
  "failed",
  "completed",
]);
const stepStates = new Set<LocalHelperUpgradeStepState>([
  "pending",
  "running",
  "succeeded",
  "failed",
  "manual-recovery-required",
]);
const transactionStates = new Set<LocalHelperUpgradeTransactionView["state"]>([
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "failed",
  "dropped",
  "replaced",
]);

export class LocalHelperUpgradeRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(code);
    this.name = "LocalHelperUpgradeRequestError";
  }
}

function invalid(status = 0): never {
  throw new LocalHelperUpgradeRequestError("HELPER_UPGRADE_RESPONSE_INVALID", true, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function address(value: unknown): value is `0x${string}` {
  return typeof value === "string" && addressPattern.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && digestPattern.test(value);
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

function stringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every((entry) => typeof entry === "string" && entry.length >= 1 && entry.length <= 120)
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

function versions(value: unknown): value is LocalHelperUpgradeVersionView {
  return (
    record(value) &&
    exact(value, ["comparison", "source", "target"]) &&
    value.comparison === "upgrade-available" &&
    value.source === "WalletHelperV1" &&
    value.target === "WalletHelperV2"
  );
}

export function parseLocalHelperUpgradePreview(
  value: unknown,
  status = 0,
): LocalHelperUpgradePreview {
  if (
    !record(value) ||
    !exact(value, [
      "blockers",
      "chainId",
      "expectedTargetAddress",
      "expectedTargetRuntimeCodeHash",
      "expiresAt",
      "feeLimit",
      "nonce",
      "previewDigest",
      "previewToken",
      "registryVersion",
      "residual",
      "sourceHelperAddress",
      "steps",
      "upgradeable",
      "versions",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.registryVersion !== "p05-local-helper-upgrade-v3" ||
    !uuid(value.walletId) ||
    !address(value.sourceHelperAddress) ||
    !address(value.expectedTargetAddress) ||
    typeof value.expectedTargetRuntimeCodeHash !== "string" ||
    !hashPattern.test(value.expectedTargetRuntimeCodeHash) ||
    !timestamp(value.expiresAt) ||
    !feeLimit(value.feeLimit) ||
    !unsigned(value.nonce) ||
    !digest(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !previewTokenPattern.test(value.previewToken) ||
    typeof value.upgradeable !== "boolean" ||
    !stringList(value.blockers) ||
    !versions(value.versions) ||
    !Array.isArray(value.steps) ||
    value.steps.length !== cursors.length ||
    value.steps.some((cursor, index) => cursor !== cursors[index]) ||
    !record(value.residual) ||
    !exact(value.residual, [
      "allowanceCount",
      "balancesAboveDust",
      "nftCustodyCount",
      "unknownTokenCount",
    ])
  ) {
    invalid(status);
  }
  for (const count of Object.values(value.residual)) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) invalid(status);
  }
  if (value.upgradeable && value.blockers.length > 0) invalid(status);
  return structuredClone(value) as unknown as LocalHelperUpgradePreview;
}

function parseStep(value: unknown, ordinal: number, status: number) {
  if (
    !record(value) ||
    !exact(value, ["cursor", "failureCode", "state", "updatedAt"]) ||
    value.cursor !== cursors[ordinal] ||
    !stepStates.has(value.state as LocalHelperUpgradeStepState) ||
    (value.failureCode !== null &&
      (typeof value.failureCode !== "string" || value.failureCode.length < 1)) ||
    (value.updatedAt !== null && !timestamp(value.updatedAt))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperUpgradeOperation["steps"][number];
}

function parseTransaction(value: unknown, status: number): LocalHelperUpgradeTransactionView {
  if (
    !record(value) ||
    !exact(value, [
      "active",
      "generation",
      "maxFeePerGasBaseUnit",
      "maxPriorityFeePerGasBaseUnit",
      "state",
      "transactionHash",
      "transactionId",
    ]) ||
    typeof value.active !== "boolean" ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0 ||
    !unsigned(value.maxFeePerGasBaseUnit, true) ||
    !unsigned(value.maxPriorityFeePerGasBaseUnit) ||
    BigInt(value.maxPriorityFeePerGasBaseUnit) > BigInt(value.maxFeePerGasBaseUnit) ||
    !transactionStates.has(value.state as LocalHelperUpgradeTransactionView["state"]) ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" || !hashPattern.test(value.transactionHash))) ||
    !uuid(value.transactionId)
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperUpgradeTransactionView;
}

export function parseLocalHelperUpgradeOperation(
  value: unknown,
  status = 0,
): LocalHelperUpgradeOperation {
  if (
    !record(value) ||
    !exact(value, [
      "chainId",
      "createdAt",
      "cursor",
      "expectedTargetAddress",
      "failureCode",
      "manualRecovery",
      "nonce",
      "operationId",
      "planDigest",
      "registryVersion",
      "sourceBindingId",
      "sourceHelperAddress",
      "state",
      "steps",
      "sweepBatchId",
      "transactions",
      "updatedAt",
      "versions",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.registryVersion !== "p05-local-helper-upgrade-v3" ||
    !uuid(value.operationId) ||
    !uuid(value.walletId) ||
    !uuid(value.sourceBindingId) ||
    !address(value.sourceHelperAddress) ||
    !address(value.expectedTargetAddress) ||
    !unsigned(value.nonce) ||
    !digest(value.planDigest) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !operationStates.has(value.state as LocalHelperUpgradeState) ||
    !cursors.includes(value.cursor as LocalHelperUpgradeCursor) ||
    (value.failureCode !== null &&
      (typeof value.failureCode !== "string" || value.failureCode.length < 1)) ||
    (value.sweepBatchId !== null && !uuid(value.sweepBatchId)) ||
    !versions(value.versions) ||
    !record(value.manualRecovery) ||
    !exact(value.manualRecovery, ["blockers", "required"]) ||
    typeof value.manualRecovery.required !== "boolean" ||
    !stringList(value.manualRecovery.blockers) ||
    !Array.isArray(value.steps) ||
    value.steps.length !== cursors.length ||
    !Array.isArray(value.transactions)
  ) {
    invalid(status);
  }
  const steps = value.steps.map((entry, ordinal) => parseStep(entry, ordinal, status));
  const transactions = value.transactions.map((entry) => parseTransaction(entry, status));
  if (
    (value.state === "completed") !== (value.cursor === "completed") ||
    value.manualRecovery.required !== (value.state === "manual-recovery-required") ||
    value.manualRecovery.required !== value.manualRecovery.blockers.length > 0 ||
    new Set(transactions.map(({ generation }) => generation)).size !== transactions.length ||
    transactions.some(({ generation }, index) => generation !== index) ||
    transactions.filter(({ active }) => active).length > 1
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as LocalHelperUpgradeOperation),
    steps,
    transactions,
  };
}

export class LocalHelperUpgradeClient {
  constructor(
    readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    readonly reauthentication: () => string | null = () => null,
  ) {}

  async preview(request: LocalHelperUpgradePreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/wallets/helper/upgrade/preview", {
      body: JSON.stringify({ chainId: 31_337, walletId: request.walletId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseLocalHelperUpgradePreview(response.data, response.status);
  }

  async submit(request: LocalHelperUpgradeSubmitRequest, idempotencyKey: string) {
    if (!/^[!-~]{16,128}$/u.test(idempotencyKey)) {
      throw new LocalHelperUpgradeRequestError("IDEMPOTENCY_KEY_REQUIRED", false, 0);
    }
    const proof = this.reauthentication();
    const response = await this.#request("/api/wallets/helper/upgrade", {
      body: JSON.stringify({
        chainId: 31_337,
        previewDigest: request.previewDigest,
        previewToken: request.previewToken,
        walletId: request.walletId,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(proof ? { "X-LPBOT-Reauthentication": proof } : {}),
      },
      method: "POST",
    });
    return parseLocalHelperUpgradeOperation(response.data, response.status);
  }

  async latest(walletId: string, signal?: AbortSignal) {
    if (!uuid(walletId)) {
      throw new LocalHelperUpgradeRequestError("WALLET_NOT_FOUND", false, 0);
    }
    const response = await this.#request(
      `/api/wallets/${encodeURIComponent(walletId.toLowerCase())}/helper-upgrade`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseLocalHelperUpgradeOperation(response.data, response.status);
  }

  async operation(operationId: string, signal?: AbortSignal) {
    if (!uuid(operationId)) {
      throw new LocalHelperUpgradeRequestError("HELPER_UPGRADE_NOT_FOUND", false, 0);
    }
    const response = await this.#request(
      `/api/helper-upgrades/${encodeURIComponent(operationId.toLowerCase())}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseLocalHelperUpgradeOperation(response.data, response.status);
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", "Cache-Control": "no-store", ...init.headers },
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new LocalHelperUpgradeRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new LocalHelperUpgradeRequestError(
        typeof error?.code === "string" ? error.code : "HELPER_UPGRADE_REQUEST_FAILED",
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
