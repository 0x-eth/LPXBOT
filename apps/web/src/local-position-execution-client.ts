import type {
  LocalPositionCollectFeesPreview,
  LocalPositionCollectFeesPreviewRequest,
  LocalPositionCollectFeesRequest,
  LocalPositionCurrentPage,
  LocalPositionCurrentSnapshot,
  LocalPositionExecutionOperation,
  LocalPositionExecutionPreview,
  LocalPositionOperationStep,
  LocalPositionRemoveLiquidityPreview,
  LocalPositionRemoveLiquidityPreviewRequest,
  LocalPositionRemoveLiquidityRequest,
  LocalPositionStepTransactionView,
  LocalSwapFeeLimit,
  PositionPlatformId,
} from "@lpbot/api-contract";

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const unsignedPattern = /^(?:0|[1-9][0-9]*)$/u;
const signedPattern = /^-?(?:0|[1-9][0-9]*)$/u;
const previewTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const platforms = new Set<PositionPlatformId>([1, 2, 4, 5]);
const operationStates = new Set([
  "queued",
  "signing",
  "broadcast",
  "pending",
  "reconciling",
  "succeeded",
  "failed",
]);
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

export class LocalPositionExecutionRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(code);
    this.name = "LocalPositionExecutionRequestError";
  }
}

function invalid(status = 0): never {
  throw new LocalPositionExecutionRequestError("LOCAL_POSITION_RESPONSE_INVALID", true, status);
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

function signed(value: unknown): value is string {
  return typeof value === "string" && value.length <= 79 && signedPattern.test(value);
}

function address(value: unknown): value is `0x${string}` {
  return typeof value === "string" && addressPattern.test(value);
}

function hash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && hashPattern.test(value);
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && digestPattern.test(value);
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

function parseSnapshot(value: unknown, status: number): LocalPositionCurrentSnapshot {
  if (
    !record(value) ||
    !exact(value, [
      "block",
      "chainId",
      "expiresAt",
      "manager",
      "observedAt",
      "position",
      "registry",
      "schemaVersion",
      "snapshotDigest",
      "snapshotVersion",
      "tokens",
      "wallet",
    ]) ||
    value.chainId !== 31_337 ||
    value.schemaVersion !== 2 ||
    value.snapshotVersion !== "p05-local-position-snapshot-v2" ||
    !digest(value.snapshotDigest) ||
    !timestamp(value.observedAt) ||
    !timestamp(value.expiresAt) ||
    Date.parse(value.observedAt) >= Date.parse(value.expiresAt) ||
    !record(value.block) ||
    !exact(value.block, ["hash", "number", "timestamp"]) ||
    !hash(value.block.hash) ||
    !unsigned(value.block.number) ||
    !timestamp(value.block.timestamp) ||
    Date.parse(value.block.timestamp) > Date.parse(value.observedAt) ||
    !record(value.wallet) ||
    !exact(value.wallet, ["address", "walletId"]) ||
    !address(value.wallet.address) ||
    typeof value.wallet.walletId !== "string" ||
    !uuidPattern.test(value.wallet.walletId) ||
    !record(value.manager) ||
    !exact(value.manager, ["abiHash", "address", "runtimeCodeHash"]) ||
    !digest(value.manager.abiHash) ||
    !address(value.manager.address) ||
    !hash(value.manager.runtimeCodeHash) ||
    !record(value.registry) ||
    !exact(value.registry, ["digest", "version"]) ||
    value.registry.version !== "p05-local-position-execution-v2" ||
    !digest(value.registry.digest) ||
    !Array.isArray(value.tokens) ||
    value.tokens.length !== 2
  ) {
    invalid(status);
  }
  const tokens = value.tokens.map((token) => {
    if (
      !record(token) ||
      !exact(token, ["address", "runtimeCodeHash"]) ||
      !address(token.address) ||
      !hash(token.runtimeCodeHash)
    ) {
      invalid(status);
    }
    return structuredClone(token) as LocalPositionCurrentSnapshot["tokens"][number];
  });
  if (
    !record(value.position) ||
    !exact(value.position, [
      "approval",
      "liquidity",
      "owner",
      "platformId",
      "pool",
      "reserve0BaseUnit",
      "reserve1BaseUnit",
      "ticks",
      "tokenId",
      "tokensOwed0BaseUnit",
      "tokensOwed1BaseUnit",
    ]) ||
    !record(value.position.approval) ||
    !exact(value.position.approval, ["approvedAddress", "approvedForAll", "operator"]) ||
    (value.position.approval.approvedAddress !== null &&
      !address(value.position.approval.approvedAddress)) ||
    typeof value.position.approval.approvedForAll !== "boolean" ||
    (value.position.approval.operator !== null && !address(value.position.approval.operator)) ||
    !address(value.position.owner) ||
    value.position.owner !== value.wallet.address ||
    !platforms.has(value.position.platformId as PositionPlatformId) ||
    !unsigned(value.position.tokenId, true) ||
    !unsigned(value.position.liquidity) ||
    !unsigned(value.position.reserve0BaseUnit) ||
    !unsigned(value.position.reserve1BaseUnit) ||
    !unsigned(value.position.tokensOwed0BaseUnit) ||
    !unsigned(value.position.tokensOwed1BaseUnit) ||
    !record(value.position.pool) ||
    !exact(value.position.pool, [
      "feePips",
      "poolAddress",
      "poolId",
      "tickSpacing",
      "token0",
      "token1",
    ]) ||
    !unsigned(value.position.pool.feePips) ||
    !signed(value.position.pool.tickSpacing) ||
    BigInt(value.position.pool.tickSpacing) === 0n ||
    !address(value.position.pool.token0) ||
    !address(value.position.pool.token1) ||
    value.position.pool.token0 === value.position.pool.token1 ||
    !record(value.position.ticks) ||
    !exact(value.position.ticks, ["lower", "upper"]) ||
    !signed(value.position.ticks.lower) ||
    !signed(value.position.ticks.upper)
  ) {
    invalid(status);
  }
  const platformId = value.position.platformId as PositionPlatformId;
  const v3 = platformId === 1 || platformId === 2;
  if (
    (v3 && (!address(value.position.pool.poolAddress) || value.position.pool.poolId !== null)) ||
    (!v3 && (value.position.pool.poolAddress !== null || !hash(value.position.pool.poolId))) ||
    tokens[0]?.address !== value.position.pool.token0 ||
    tokens[1]?.address !== value.position.pool.token1 ||
    BigInt(value.position.ticks.lower) >= BigInt(value.position.ticks.upper) ||
    BigInt(value.position.ticks.lower) % BigInt(value.position.pool.tickSpacing) !== 0n ||
    BigInt(value.position.ticks.upper) % BigInt(value.position.pool.tickSpacing) !== 0n
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalPositionCurrentSnapshot;
}

export function parseLocalPositionCurrentPage(
  value: unknown,
  status = 0,
): LocalPositionCurrentPage {
  if (
    !record(value) ||
    !exact(value, [
      "chainId",
      "executionEnabled",
      "items",
      "registryVersion",
      "serviceFeeBps",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    typeof value.executionEnabled !== "boolean" ||
    value.registryVersion !== "p05-local-position-execution-v2" ||
    value.serviceFeeBps !== 0 ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !Array.isArray(value.items) ||
    value.items.length > 256
  ) {
    invalid(status);
  }
  const items = value.items.map((item) => parseSnapshot(item, status));
  if (
    items.some(({ wallet }) => wallet.walletId !== value.walletId) ||
    new Set(items.map(({ position }) => `${position.platformId}:${position.tokenId}`)).size !==
      items.length
  ) {
    invalid(status);
  }
  return { ...(structuredClone(value) as unknown as LocalPositionCurrentPage), items };
}

function previewStep(value: unknown, status: number, ordinal: number) {
  if (
    !record(value) ||
    !exact(value, ["feeLimit", "kind", "ordinal"]) ||
    value.ordinal !== ordinal ||
    !["decrease", "collect", "burn"].includes(String(value.kind)) ||
    !feeLimit(value.feeLimit)
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as LocalPositionExecutionPreview["steps"][number];
}

export function parseLocalPositionExecutionPreview(
  value: unknown,
  status = 0,
): LocalPositionExecutionPreview {
  if (
    !record(value) ||
    !exact(value, [
      "burnIfEmpty",
      "chainId",
      "deadline",
      "expectedToken0DeltaBaseUnit",
      "expectedToken1DeltaBaseUnit",
      "expiresAt",
      "feeLimitTotalBaseUnit",
      "feeProceeds0BaseUnit",
      "feeProceeds1BaseUnit",
      "liquidityDelta",
      "managerAddress",
      "minPrincipal0BaseUnit",
      "minPrincipal1BaseUnit",
      "operationKind",
      "percent",
      "platformId",
      "previewDigest",
      "previewToken",
      "principal0BaseUnit",
      "principal1BaseUnit",
      "remainingLiquidity",
      "serviceFeeBps",
      "slippageBps",
      "snapshotDigest",
      "steps",
      "tokenId",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.serviceFeeBps !== 0 ||
    !address(value.managerAddress) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !platforms.has(value.platformId as PositionPlatformId) ||
    !unsigned(value.tokenId, true) ||
    !digest(value.snapshotDigest) ||
    !digest(value.previewDigest) ||
    typeof value.previewToken !== "string" ||
    !previewTokenPattern.test(value.previewToken) ||
    !timestamp(value.expiresAt) ||
    !timestamp(value.deadline) ||
    Date.parse(value.expiresAt) > Date.parse(value.deadline) ||
    !unsigned(value.expectedToken0DeltaBaseUnit) ||
    !unsigned(value.expectedToken1DeltaBaseUnit) ||
    !unsigned(value.feeLimitTotalBaseUnit, true) ||
    !unsigned(value.feeProceeds0BaseUnit) ||
    !unsigned(value.feeProceeds1BaseUnit) ||
    !unsigned(value.liquidityDelta) ||
    !unsigned(value.minPrincipal0BaseUnit) ||
    !unsigned(value.minPrincipal1BaseUnit) ||
    !unsigned(value.principal0BaseUnit) ||
    !unsigned(value.principal1BaseUnit) ||
    !unsigned(value.remainingLiquidity) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > 3
  ) {
    invalid(status);
  }
  const steps = value.steps.map((step, ordinal) => previewStep(step, status, ordinal));
  const collect = value.operationKind === "position-collect-fees";
  const remove = value.operationKind === "position-remove-liquidity";
  const burnIfEmpty = value.burnIfEmpty === true;
  const expectedKinds = collect
    ? ["collect"]
    : burnIfEmpty
      ? ["decrease", "collect", "burn"]
      : ["decrease", "collect"];
  if (
    (!collect && !remove) ||
    typeof value.burnIfEmpty !== "boolean" ||
    (collect &&
      (value.burnIfEmpty !== false ||
        value.percent !== null ||
        value.slippageBps !== null ||
        value.liquidityDelta !== "0" ||
        value.principal0BaseUnit !== "0" ||
        value.principal1BaseUnit !== "0" ||
        value.minPrincipal0BaseUnit !== "0" ||
        value.minPrincipal1BaseUnit !== "0")) ||
    (remove &&
      (!Number.isSafeInteger(value.percent) ||
        Number(value.percent) < 1 ||
        Number(value.percent) > 100 ||
        !Number.isSafeInteger(value.slippageBps) ||
        Number(value.slippageBps) < 1 ||
        Number(value.slippageBps) > 500 ||
        !unsigned(value.liquidityDelta, true))) ||
    (burnIfEmpty && (value.percent !== 100 || value.remainingLiquidity !== "0")) ||
    (value.percent !== 100 && burnIfEmpty) ||
    steps.some(({ kind }, index) => kind !== expectedKinds[index]) ||
    BigInt(value.feeLimitTotalBaseUnit) !==
      steps.reduce((total, step) => total + BigInt(step.feeLimit.feeCapBaseUnit), 0n) ||
    BigInt(value.expectedToken0DeltaBaseUnit) !==
      BigInt(value.feeProceeds0BaseUnit) + BigInt(value.principal0BaseUnit) ||
    BigInt(value.expectedToken1DeltaBaseUnit) !==
      BigInt(value.feeProceeds1BaseUnit) + BigInt(value.principal1BaseUnit) ||
    BigInt(value.minPrincipal0BaseUnit) > BigInt(value.principal0BaseUnit) ||
    BigInt(value.minPrincipal1BaseUnit) > BigInt(value.principal1BaseUnit)
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as LocalPositionExecutionPreview),
    steps,
  };
}

function transaction(value: unknown, status: number): LocalPositionStepTransactionView {
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
  return structuredClone(value) as unknown as LocalPositionStepTransactionView;
}

function operationStep(
  value: unknown,
  status: number,
  ordinal: number,
): LocalPositionOperationStep {
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
    !["decrease", "collect", "burn"].includes(String(value.kind)) ||
    !stepStates.has(String(value.state)) ||
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
    transactions.some(({ generation }, index) => generation !== index) ||
    transactions.filter(({ active }) => active).length > 1 ||
    transactions.some(({ active }, index) => active && index !== transactions.length - 1) ||
    transactions.some(
      (entry, index) =>
        index > 0 &&
        (BigInt(entry.maxFeePerGasBaseUnit) <
          BigInt(transactions[index - 1]!.maxFeePerGasBaseUnit) ||
          BigInt(entry.maxPriorityFeePerGasBaseUnit) <
            BigInt(transactions[index - 1]!.maxPriorityFeePerGasBaseUnit)),
    )
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as LocalPositionOperationStep),
    transactions,
  };
}

export function parseLocalPositionExecutionOperation(
  value: unknown,
  status = 0,
): LocalPositionExecutionOperation {
  if (
    !record(value) ||
    !exact(value, [
      "burnIfEmpty",
      "chainId",
      "createdAt",
      "failureCode",
      "managerAddress",
      "operationId",
      "operationKind",
      "percent",
      "planDigest",
      "platformId",
      "reconciliationReason",
      "registryVersion",
      "slippageBps",
      "snapshotDigest",
      "state",
      "steps",
      "tokenId",
      "updatedAt",
      "walletId",
    ]) ||
    value.chainId !== 31_337 ||
    value.registryVersion !== "p05-local-position-execution-v2" ||
    !operationStates.has(String(value.state)) ||
    typeof value.operationId !== "string" ||
    !uuidPattern.test(value.operationId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !address(value.managerAddress) ||
    !digest(value.planDigest) ||
    !digest(value.snapshotDigest) ||
    !platforms.has(value.platformId as PositionPlatformId) ||
    !unsigned(value.tokenId, true) ||
    !timestamp(value.createdAt) ||
    !timestamp(value.updatedAt) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    typeof value.burnIfEmpty !== "boolean" ||
    (value.failureCode !== null && typeof value.failureCode !== "string") ||
    (value.reconciliationReason !== null && typeof value.reconciliationReason !== "string") ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > 3
  ) {
    invalid(status);
  }
  const collect = value.operationKind === "position-collect-fees";
  const remove = value.operationKind === "position-remove-liquidity";
  const burnIfEmpty = value.burnIfEmpty === true;
  const expectedKinds = collect
    ? ["collect"]
    : burnIfEmpty
      ? ["decrease", "collect", "burn"]
      : ["decrease", "collect"];
  const steps = value.steps.map((entry, ordinal) => operationStep(entry, status, ordinal));
  if (
    (!collect && !remove) ||
    (collect &&
      (value.burnIfEmpty !== false || value.percent !== null || value.slippageBps !== null)) ||
    (remove &&
      (!Number.isSafeInteger(value.percent) ||
        Number(value.percent) < 1 ||
        Number(value.percent) > 100 ||
        !Number.isSafeInteger(value.slippageBps) ||
        Number(value.slippageBps) < 1 ||
        Number(value.slippageBps) > 500)) ||
    (burnIfEmpty && value.percent !== 100) ||
    steps.some(({ kind }, index) => kind !== expectedKinds[index]) ||
    new Set(steps.map(({ stepId }) => stepId)).size !== steps.length ||
    new Set(steps.map(({ nonce }) => nonce)).size !== steps.length ||
    steps.some(
      ({ nonce }, index) => index > 0 && BigInt(nonce) !== BigInt(steps[index - 1]!.nonce) + 1n,
    )
  ) {
    invalid(status);
  }
  return {
    ...(structuredClone(value) as unknown as LocalPositionExecutionOperation),
    steps,
  };
}

export class LocalPositionExecutionClient {
  readonly #fetcher: typeof fetch;
  readonly #reauthenticationProof: () => string | null;

  constructor(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    reauthenticationProof: () => string | null = () => null,
  ) {
    this.#fetcher = fetcher;
    this.#reauthenticationProof = reauthenticationProof;
  }

  async current(walletId: string, signal?: AbortSignal) {
    if (!uuidPattern.test(walletId)) {
      throw new LocalPositionExecutionRequestError("WALLET_NOT_FOUND", false, 0);
    }
    const response = await this.#request(
      `/api/positions/local-current?walletId=${encodeURIComponent(walletId.toLowerCase())}`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseLocalPositionCurrentPage(response.data, response.status);
  }

  async previewCollect(request: LocalPositionCollectFeesPreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/positions/collect-fees/preview", {
      body: JSON.stringify({
        platformId: request.platformId,
        snapshotDigest: request.snapshotDigest,
        tokenId: request.tokenId,
        walletId: request.walletId,
      } satisfies LocalPositionCollectFeesPreviewRequest),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    const preview = parseLocalPositionExecutionPreview(response.data, response.status);
    if (preview.operationKind !== "position-collect-fees") invalid(response.status);
    return preview as LocalPositionCollectFeesPreview;
  }

  async collect(request: LocalPositionCollectFeesRequest, idempotencyKey: string) {
    const response = await this.#submit(
      "/api/positions/collect-fees",
      {
        platformId: request.platformId,
        previewDigest: request.previewDigest,
        previewToken: request.previewToken,
        snapshotDigest: request.snapshotDigest,
        tokenId: request.tokenId,
        walletId: request.walletId,
      } satisfies LocalPositionCollectFeesRequest,
      idempotencyKey,
    );
    const operation = parseLocalPositionExecutionOperation(response.data, response.status);
    if (operation.operationKind !== "position-collect-fees") invalid(response.status);
    return operation;
  }

  async previewRemove(request: LocalPositionRemoveLiquidityPreviewRequest, signal?: AbortSignal) {
    const response = await this.#request("/api/positions/remove-liquidity/preview", {
      body: JSON.stringify({
        burnIfEmpty: request.burnIfEmpty,
        percent: request.percent,
        platformId: request.platformId,
        slippageBps: request.slippageBps,
        snapshotDigest: request.snapshotDigest,
        tokenId: request.tokenId,
        walletId: request.walletId,
      } satisfies LocalPositionRemoveLiquidityPreviewRequest),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    const preview = parseLocalPositionExecutionPreview(response.data, response.status);
    if (preview.operationKind !== "position-remove-liquidity") invalid(response.status);
    return preview as LocalPositionRemoveLiquidityPreview;
  }

  async remove(request: LocalPositionRemoveLiquidityRequest, idempotencyKey: string) {
    const response = await this.#submit(
      "/api/positions/remove-liquidity",
      {
        burnIfEmpty: request.burnIfEmpty,
        percent: request.percent,
        platformId: request.platformId,
        previewDigest: request.previewDigest,
        previewToken: request.previewToken,
        slippageBps: request.slippageBps,
        snapshotDigest: request.snapshotDigest,
        tokenId: request.tokenId,
        walletId: request.walletId,
      } satisfies LocalPositionRemoveLiquidityRequest,
      idempotencyKey,
    );
    const operation = parseLocalPositionExecutionOperation(response.data, response.status);
    if (operation.operationKind !== "position-remove-liquidity") invalid(response.status);
    return operation;
  }

  async operation(operationId: string, signal?: AbortSignal) {
    if (!uuidPattern.test(operationId)) {
      throw new LocalPositionExecutionRequestError("LOCAL_POSITION_NOT_FOUND", false, 0);
    }
    const response = await this.#request(`/api/chain-operations/${operationId.toLowerCase()}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseLocalPositionExecutionOperation(response.data, response.status);
  }

  async #submit(path: string, body: object, idempotencyKey: string) {
    if (!/^[!-~]{16,128}$/u.test(idempotencyKey)) {
      throw new LocalPositionExecutionRequestError("IDEMPOTENCY_KEY_REQUIRED", false, 0);
    }
    const proof = this.#reauthenticationProof();
    return this.#request(path, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        ...(proof ? { "X-LPBOT-Reauthentication": proof } : {}),
      },
      method: "POST",
    });
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
      throw new LocalPositionExecutionRequestError("NETWORK_ERROR", true, 0);
    }
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const error = record(envelope) ? (envelope as ErrorEnvelope).error : null;
      throw new LocalPositionExecutionRequestError(
        typeof error?.code === "string" ? error.code : "LOCAL_POSITION_REQUEST_FAILED",
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
