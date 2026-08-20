import type {
  LocalHelperResidualBalance,
  LocalHelperResidualScanRequest,
  LocalHelperResidualSnapshot,
  LocalHelperSweepBatch,
  LocalHelperSweepOperation,
  LocalHelperSweepPreview,
  LocalHelperSweepPreviewRequest,
  LocalHelperSweepSubmitRequest,
  LocalHelperSweepTransactionView,
  LocalSwapFeeLimit,
} from "@lpbot/api-contract";

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const unsignedPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const previewTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const scanKeyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const operationStates = new Set([
  "queued",
  "signing",
  "broadcast",
  "pending",
  "confirmed",
  "succeeded",
  "failed",
  "dropped",
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
const batchStates = new Set([
  "queued",
  "running",
  "partial",
  "reconciling",
  "succeeded",
  "failed",
  "manual-recovery-required",
]);

export class LocalHelperSweepRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(code);
    this.name = "LocalHelperSweepRequestError";
  }
}

function invalid(status = 0): never {
  throw new LocalHelperSweepRequestError("LOCAL_HELPER_SWEEP_RESPONSE_INVALID", true, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function address(value: unknown): value is `0x${string}` {
  return typeof value === "string" && addressPattern.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && digestPattern.test(value);
}

function hash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && hashPattern.test(value);
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function unsigned(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= 78 &&
    unsignedPattern.test(value) &&
    (!positive || BigInt(value) > 0n)
  );
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
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

function balance(value: unknown, status: number): LocalHelperResidualBalance {
  if (
    !record(value) ||
    !exact(value, [
      "amountBaseUnit",
      "assetId",
      "dustBaseUnit",
      "fixture",
      "kind",
      "runtimeCodeHash",
      "tokenAddress",
    ]) ||
    !unsigned(value.amountBaseUnit) ||
    !unsigned(value.dustBaseUnit) ||
    typeof value.assetId !== "string" ||
    !["native", "token"].includes(String(value.kind))
  ) {
    invalid(status);
  }
  if (
    (value.kind === "native" &&
      (value.assetId !== "native:31337" ||
        value.fixture !== null ||
        value.runtimeCodeHash !== null ||
        value.tokenAddress !== null)) ||
    (value.kind === "token" &&
      (!address(value.tokenAddress) ||
        value.assetId !== `token:${value.tokenAddress}` ||
        !["TestOnlyERC20", "TestOnlyWBNB"].includes(String(value.fixture)) ||
        !hash(value.runtimeCodeHash)))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperResidualBalance;
}

export function parseLocalHelperResidualSnapshot(
  value: unknown,
  status = 0,
): LocalHelperResidualSnapshot {
  if (
    !record(value) ||
    !exact(value, [
      "allowances",
      "balances",
      "binding",
      "block",
      "chainId",
      "coverage",
      "degradationReasons",
      "expiresAt",
      "identity",
      "manualRecoveryRequired",
      "nftCustody",
      "observedAt",
      "registry",
      "schemaVersion",
      "snapshotDigest",
      "snapshotVersion",
      "unknownTokens",
      "wallet",
    ]) ||
    value.chainId !== 31_337 ||
    value.schemaVersion !== 2 ||
    value.snapshotVersion !== "p05-local-helper-residual-snapshot-v2" ||
    !digest(value.snapshotDigest) ||
    !timestamp(value.observedAt) ||
    !timestamp(value.expiresAt) ||
    Date.parse(value.observedAt) >= Date.parse(value.expiresAt) ||
    !Array.isArray(value.allowances) ||
    !Array.isArray(value.balances) ||
    value.balances.length !== 3 ||
    !Array.isArray(value.nftCustody) ||
    !Array.isArray(value.unknownTokens) ||
    !Array.isArray(value.degradationReasons) ||
    !value.degradationReasons.every(
      (reason) => typeof reason === "string" && reason.length > 0 && reason.length <= 120,
    ) ||
    new Set(value.degradationReasons).size !== value.degradationReasons.length ||
    typeof value.manualRecoveryRequired !== "boolean"
  ) {
    invalid(status);
  }
  if (
    !record(value.wallet) ||
    !exact(value.wallet, ["address", "walletId"]) ||
    !address(value.wallet.address) ||
    !uuid(value.wallet.walletId) ||
    !record(value.block) ||
    !exact(value.block, ["hash", "number", "timestamp"]) ||
    !hash(value.block.hash) ||
    !unsigned(value.block.number) ||
    !timestamp(value.block.timestamp) ||
    Date.parse(value.block.timestamp) > Date.parse(value.observedAt) ||
    !record(value.registry) ||
    !exact(value.registry, ["digest", "version"]) ||
    value.registry.version !== "p05-local-helper-sweep-v2" ||
    !digest(value.registry.digest)
  ) {
    invalid(status);
  }
  if (
    !record(value.binding) ||
    !exact(value.binding, [
      "adapterAddress",
      "bindingId",
      "deploymentRegistryVersion",
      "helperAddress",
      "helperVersion",
      "ownerAddress",
      "permit2Address",
      "runtimeCodeHash",
      "state",
      "verifiedBlockNumber",
      "walletId",
    ]) ||
    !uuid(value.binding.bindingId) ||
    !uuid(value.binding.walletId) ||
    value.binding.walletId !== value.wallet.walletId ||
    value.binding.helperVersion !== "WalletHelperV1" ||
    value.binding.deploymentRegistryVersion !== "p05-local-helper-deployment-v2" ||
    !["active", "degraded"].includes(String(value.binding.state)) ||
    !address(value.binding.adapterAddress) ||
    !address(value.binding.helperAddress) ||
    !address(value.binding.ownerAddress) ||
    !address(value.binding.permit2Address) ||
    !hash(value.binding.runtimeCodeHash) ||
    !unsigned(value.binding.verifiedBlockNumber) ||
    value.binding.ownerAddress !== value.wallet.address ||
    (value.binding.state === "active") !== (value.degradationReasons.length === 0)
  ) {
    invalid(status);
  }
  const identity = value.identity;
  const identityKeys = [
    "bindingMatches",
    "componentsMatch",
    "observedOwner",
    "observedRuntimeCodeHash",
    "ownerMatches",
    "registryMatches",
    "runtimeMatches",
    "tokensMatch",
  ];
  if (
    !record(identity) ||
    !exact(identity, identityKeys) ||
    identityKeys
      .filter((key) => key.endsWith("Matches"))
      .some((key) => typeof identity[key] !== "boolean") ||
    (identity.observedOwner !== null && !address(identity.observedOwner)) ||
    (identity.observedRuntimeCodeHash !== null && !hash(identity.observedRuntimeCodeHash))
  ) {
    invalid(status);
  }
  const coverage = value.coverage;
  const coverageKeys = [
    "allowancesComplete",
    "complete",
    "helperIdentityComplete",
    "nftCustodyComplete",
    "tokenInventoryComplete",
  ];
  if (
    !record(coverage) ||
    !exact(coverage, coverageKeys) ||
    coverageKeys.some((key) => typeof coverage[key] !== "boolean") ||
    coverage.complete !==
      coverageKeys.filter((key) => key !== "complete").every((key) => coverage[key] === true)
  ) {
    invalid(status);
  }
  const balances = value.balances.map((item) => balance(item, status));
  if (
    new Set(balances.map(({ assetId }) => assetId)).size !== balances.length ||
    balances.filter(({ kind }) => kind === "native").length !== 1 ||
    new Set(balances.filter(({ kind }) => kind === "token").map(({ fixture }) => fixture)).size !==
      2
  ) {
    invalid(status);
  }
  const allowances = value.allowances.map((item) => {
    if (
      !record(item) ||
      !exact(item, [
        "amountBaseUnit",
        "assetId",
        "spenderAddress",
        "spenderRole",
        "tokenAddress",
      ]) ||
      !unsigned(item.amountBaseUnit) ||
      !address(item.spenderAddress) ||
      !address(item.tokenAddress) ||
      !["adapter", "manager", "permit2", "router"].includes(String(item.spenderRole)) ||
      item.assetId !== `allowance:${item.tokenAddress}:${item.spenderAddress}`
    ) {
      invalid(status);
    }
    return structuredClone(item) as unknown as LocalHelperResidualSnapshot["allowances"][number];
  });
  const nftCustody = value.nftCustody.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["assetId", "managerAddress", "tokenId"]) ||
      !address(item.managerAddress) ||
      !unsigned(item.tokenId) ||
      item.assetId !== `nft:${item.managerAddress}:${item.tokenId}`
    ) {
      invalid(status);
    }
    return structuredClone(item) as unknown as LocalHelperResidualSnapshot["nftCustody"][number];
  });
  const unknownTokens = value.unknownTokens.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["amountBaseUnit", "assetId", "runtimeCodeHash", "tokenAddress"]) ||
      !unsigned(item.amountBaseUnit, true) ||
      !address(item.tokenAddress) ||
      !hash(item.runtimeCodeHash) ||
      item.assetId !== `unknown-token:${item.tokenAddress}`
    ) {
      invalid(status);
    }
    return structuredClone(item) as unknown as LocalHelperResidualSnapshot["unknownTokens"][number];
  });
  if (
    new Set(allowances.map((item) => item.assetId)).size !== allowances.length ||
    new Set(nftCustody.map((item) => item.assetId)).size !== nftCustody.length ||
    new Set(unknownTokens.map((item) => item.assetId)).size !== unknownTokens.length ||
    value.manualRecoveryRequired !==
      (allowances.some((item) => BigInt(item.amountBaseUnit as string) > 0n) ||
        nftCustody.length > 0 ||
        unknownTokens.length > 0)
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperResidualSnapshot;
}

export function parseLocalHelperSweepPreview(value: unknown, status = 0): LocalHelperSweepPreview {
  if (
    !record(value) ||
    !exact(value, [
      "assets",
      "chainId",
      "deadline",
      "expiresAt",
      "feeLimitTotalBaseUnit",
      "helperAddress",
      "manualRecoveryRequired",
      "previewDigest",
      "previewToken",
      "recipient",
      "registryVersion",
      "snapshotDigest",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.registryVersion !== "p05-local-helper-sweep-v2" ||
    value.manualRecoveryRequired !== false ||
    !uuid(value.walletId) ||
    !address(value.helperAddress) ||
    !address(value.recipient) ||
    value.helperAddress === value.recipient ||
    !digest(value.snapshotDigest) ||
    !digest(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !previewTokenPattern.test(value.previewToken) ||
    !timestamp(value.deadline) ||
    !timestamp(value.expiresAt) ||
    !unsigned(value.feeLimitTotalBaseUnit, true) ||
    !Array.isArray(value.assets) ||
    value.assets.length < 1 ||
    value.assets.length > 3
  ) {
    invalid(status);
  }
  const assets = value.assets.map((item) => {
    if (
      !record(item) ||
      !exact(item, [
        "amountBaseUnit",
        "assetId",
        "dustBaseUnit",
        "feeLimit",
        "kind",
        "recipient",
        "tokenAddress",
      ]) ||
      !unsigned(item.amountBaseUnit, true) ||
      !unsigned(item.dustBaseUnit) ||
      BigInt(item.amountBaseUnit) <= BigInt(item.dustBaseUnit) ||
      !feeLimit(item.feeLimit) ||
      item.recipient !== value.recipient ||
      ((item.kind === "native" &&
        (item.assetId !== "native:31337" || item.tokenAddress !== null)) as boolean) ||
      (item.kind === "token" &&
        (!address(item.tokenAddress) || item.assetId !== `token:${item.tokenAddress}`)) ||
      !["native", "token"].includes(String(item.kind))
    ) {
      invalid(status);
    }
    return structuredClone(item) as unknown as LocalHelperSweepPreview["assets"][number];
  });
  if (
    new Set(assets.map((item) => item.assetId)).size !== assets.length ||
    assets.reduce((sum, item) => sum + BigInt(item.feeLimit.feeCapBaseUnit), 0n).toString() !==
      value.feeLimitTotalBaseUnit
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperSweepPreview;
}

function transaction(value: unknown, status: number): LocalHelperSweepTransactionView {
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
    !transactionStates.has(String(value.state)) ||
    (value.transactionHash !== null && !hash(value.transactionHash))
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperSweepTransactionView;
}

export function parseLocalHelperSweepOperation(
  value: unknown,
  status = 0,
): LocalHelperSweepOperation {
  if (
    !record(value) ||
    !exact(value, [
      "amountBaseUnit",
      "assetId",
      "assetKind",
      "batchId",
      "chainId",
      "createdAt",
      "failureCode",
      "feeLimit",
      "helperAddress",
      "nonce",
      "operationId",
      "operationKind",
      "planDigest",
      "recipient",
      "reconciliationReason",
      "registryVersion",
      "snapshotDigest",
      "state",
      "tokenAddress",
      "transactions",
      "updatedAt",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.operationKind !== "helper-residual-sweep" ||
    value.registryVersion !== "p05-local-helper-sweep-v2" ||
    !uuid(value.batchId) ||
    !uuid(value.operationId) ||
    !uuid(value.walletId) ||
    !unsigned(value.amountBaseUnit, true) ||
    !unsigned(value.nonce) ||
    !feeLimit(value.feeLimit) ||
    !address(value.helperAddress) ||
    !address(value.recipient) ||
    value.helperAddress === value.recipient ||
    !digest(value.planDigest) ||
    !digest(value.snapshotDigest) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !operationStates.has(String(value.state)) ||
    (value.failureCode !== null && typeof value.failureCode !== "string") ||
    (value.reconciliationReason !== null && typeof value.reconciliationReason !== "string") ||
    !Array.isArray(value.transactions) ||
    ((value.assetKind === "native" &&
      (value.assetId !== "native:31337" || value.tokenAddress !== null)) as boolean) ||
    (value.assetKind === "token" &&
      (!address(value.tokenAddress) || value.assetId !== `token:${value.tokenAddress}`)) ||
    !["native", "token"].includes(String(value.assetKind))
  ) {
    invalid(status);
  }
  const transactions = value.transactions.map((item) => transaction(item, status));
  if (
    new Set(transactions.map(({ generation }) => generation)).size !== transactions.length ||
    transactions.filter(({ active }) => active).length > 1
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperSweepOperation;
}

export function parseLocalHelperSweepBatch(value: unknown, status = 0): LocalHelperSweepBatch {
  if (
    !record(value) ||
    !exact(value, [
      "batchId",
      "chainId",
      "createdAt",
      "helperAddress",
      "operations",
      "registryVersion",
      "snapshotDigest",
      "state",
      "updatedAt",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.registryVersion !== "p05-local-helper-sweep-v2" ||
    !uuid(value.batchId) ||
    !uuid(value.walletId) ||
    !address(value.helperAddress) ||
    !digest(value.snapshotDigest) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !batchStates.has(String(value.state)) ||
    !Array.isArray(value.operations) ||
    value.operations.length < 1 ||
    value.operations.length > 3
  ) {
    invalid(status);
  }
  const operations = value.operations.map((item) => parseLocalHelperSweepOperation(item, status));
  if (
    new Set(operations.map(({ operationId }) => operationId)).size !== operations.length ||
    new Set(operations.map(({ assetId }) => assetId)).size !== operations.length ||
    new Set(operations.map(({ nonce }) => nonce)).size !== operations.length ||
    operations.some(
      (operation) =>
        operation.batchId !== value.batchId ||
        operation.walletId !== value.walletId ||
        operation.helperAddress !== value.helperAddress ||
        operation.snapshotDigest !== value.snapshotDigest,
    )
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalHelperSweepBatch;
}

export class LocalHelperSweepClient {
  constructor(
    readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    readonly reauthentication: () => string | null = () => null,
  ) {}

  async latest(
    walletId: string,
    signal?: AbortSignal,
  ): Promise<LocalHelperResidualSnapshot | null> {
    if (!uuid(walletId)) {
      throw new LocalHelperSweepRequestError("WALLET_NOT_FOUND", false, 0);
    }
    const response = await this.#request(
      `/api/wallets/helper-residuals?chainId=31337&walletId=${encodeURIComponent(walletId)}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return response.data === null
      ? null
      : parseLocalHelperResidualSnapshot(response.data, response.status);
  }

  async scan(
    request: LocalHelperResidualScanRequest,
    signal?: AbortSignal,
  ): Promise<LocalHelperResidualSnapshot> {
    if (!uuid(request.walletId) || !scanKeyPattern.test(request.idempotencyKey)) {
      throw new LocalHelperSweepRequestError("PREVIEW_INVALID", false, 0);
    }
    const response = await this.#request("/api/wallets/helper-residuals/scan", {
      body: JSON.stringify({
        chainId: 31_337,
        idempotencyKey: request.idempotencyKey,
        walletId: request.walletId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseLocalHelperResidualSnapshot(response.data, response.status);
  }

  async preview(
    request: LocalHelperSweepPreviewRequest,
    signal?: AbortSignal,
  ): Promise<LocalHelperSweepPreview> {
    const response = await this.#request("/api/wallets/helper-residuals/sweep/preview", {
      body: JSON.stringify({
        assetIds: [...request.assetIds],
        chainId: 31_337,
        snapshotDigest: request.snapshotDigest,
        walletId: request.walletId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseLocalHelperSweepPreview(response.data, response.status);
  }

  async sweep(
    request: LocalHelperSweepSubmitRequest,
    idempotencyKey: string,
  ): Promise<LocalHelperSweepBatch> {
    if (
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 128 ||
      !/^[!-~]+$/u.test(idempotencyKey)
    ) {
      throw new LocalHelperSweepRequestError("IDEMPOTENCY_KEY_REQUIRED", false, 0);
    }
    const proof = this.reauthentication();
    const response = await this.#request("/api/wallets/helper-residuals/sweep", {
      body: JSON.stringify({
        assetIds: [...request.assetIds],
        chainId: 31_337,
        previewDigest: request.previewDigest,
        previewToken: request.previewToken,
        snapshotDigest: request.snapshotDigest,
        walletId: request.walletId,
      }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(proof ? { "X-LPBOT-Reauthentication": proof } : {}),
      },
      method: "POST",
    });
    return parseLocalHelperSweepBatch(response.data, response.status);
  }

  async batch(batchId: string, signal?: AbortSignal): Promise<LocalHelperSweepBatch> {
    if (!uuid(batchId)) {
      throw new LocalHelperSweepRequestError("LOCAL_HELPER_SWEEP_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/chain-operation-batches/${batchId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseLocalHelperSweepBatch(response.data, response.status);
  }

  async operation(operationId: string, signal?: AbortSignal): Promise<LocalHelperSweepOperation> {
    if (!uuid(operationId)) {
      throw new LocalHelperSweepRequestError("LOCAL_HELPER_SWEEP_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/chain-operations/${operationId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseLocalHelperSweepOperation(response.data, response.status);
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
      throw new LocalHelperSweepRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new LocalHelperSweepRequestError(
        typeof error?.code === "string" ? error.code : "LOCAL_HELPER_SWEEP_REQUEST_FAILED",
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
