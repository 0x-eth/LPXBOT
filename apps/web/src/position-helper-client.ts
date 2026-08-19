import type {
  HelperResidualAsset,
  HelperResidualPage,
  HelperVerificationFailure,
  PositionPageSnapshot,
  PositionPlatformId,
  PositionQuarantineReason,
  PositionSnapshot,
  QuarantinedPositionRead,
  WalletHelperStatus,
  WalletPosition,
  WalletPositionPage,
} from "@lpbot/api-contract";

type PositionHelperFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const selectorPattern = /^0x[0-9a-f]{8}$/u;
const unsignedPattern = /^(?:0|[1-9][0-9]*)$/u;
const signedPattern = /^-?(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const versionPattern = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const idempotencyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const platformIds = new Set<PositionPlatformId>([1, 2, 4, 5]);
const positionStates = new Set(["empty", "ready", "partial", "stale", "quarantined"]);
const helperStates = new Set(["undeployed", "active", "degraded", "superseded", "residual"]);
const quarantineReasons = new Set<PositionQuarantineReason>([
  "abi-decode-failed",
  "invalid-transfer-log",
  "owner-mismatch",
  "position-manager-code-hash-mismatch",
  "provider-read-failed",
  "unknown-position-manager",
]);
const helperFailures = new Set<HelperVerificationFailure>([
  "address-mismatch",
  "owner-mismatch",
  "provider-read-failed",
  "runtime-code-hash-mismatch",
  "selector-set-mismatch",
  "version-unregistered",
]);

export class PositionHelperRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "PositionHelperRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function invalid(status = 0): never {
  throw new PositionHelperRequestError("POSITION_HELPER_RESPONSE_INVALID", true, status);
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
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function address(value: unknown): value is `0x${string}` {
  return typeof value === "string" && addressPattern.test(value);
}

function hash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && hashPattern.test(value);
}

function unsigned(value: unknown): value is string {
  return typeof value === "string" && value.length <= 78 && unsignedPattern.test(value);
}

function positive(value: unknown): value is string {
  return unsigned(value) && BigInt(value) > 0n;
}

function signed(value: unknown): value is string {
  return typeof value === "string" && value.length <= 79 && signedPattern.test(value);
}

function snapshot(value: unknown, status: number): PositionPageSnapshot {
  if (
    !record(value) ||
    !exact(value, ["blockHash", "blockNumber", "blockTimestamp", "digest"]) ||
    !hash(value.blockHash) ||
    !unsigned(value.blockNumber) ||
    !timestamp(value.blockTimestamp) ||
    !hash(value.digest)
  ) {
    invalid(status);
  }
  return {
    blockHash: value.blockHash,
    blockNumber: value.blockNumber,
    blockTimestamp: value.blockTimestamp,
    digest: value.digest,
  };
}

function positionSnapshot(value: unknown, status: number): PositionSnapshot {
  if (
    !record(value) ||
    !exact(value, [
      "blockHash",
      "blockNumber",
      "blockTimestamp",
      "digest",
      "positionManager",
      "positionManagerCodeHash",
      "registryVersion",
    ]) ||
    !hash(value.blockHash) ||
    !unsigned(value.blockNumber) ||
    !timestamp(value.blockTimestamp) ||
    !hash(value.digest) ||
    !address(value.positionManager) ||
    !hash(value.positionManagerCodeHash) ||
    value.registryVersion !== "p05-bsc-execution-v1"
  ) {
    invalid(status);
  }
  return { ...value } as unknown as PositionSnapshot;
}

function position(value: unknown, page: PositionPageSnapshot, owner: string, status: number) {
  if (
    !record(value) ||
    !exact(value, [
      "approval",
      "chainId",
      "fees",
      "liquidity",
      "owner",
      "platformId",
      "pool",
      "snapshot",
      "ticks",
      "tokenId",
    ]) ||
    value.chainId !== 56 ||
    !platformIds.has(value.platformId as PositionPlatformId) ||
    !address(value.owner) ||
    value.owner !== owner ||
    !unsigned(value.tokenId)
  ) {
    invalid(status);
  }
  const platformId = value.platformId as PositionPlatformId;
  const approval = value.approval;
  if (
    !record(approval) ||
    !exact(approval, [
      "approvedAddress",
      "approvedForAll",
      "helperAuthorized",
      "nftOwner",
      "observedAtBlock",
    ]) ||
    (approval.approvedAddress !== null && !address(approval.approvedAddress)) ||
    typeof approval.approvedForAll !== "boolean" ||
    typeof approval.helperAuthorized !== "boolean" ||
    !address(approval.nftOwner) ||
    approval.nftOwner !== owner ||
    !unsigned(approval.observedAtBlock) ||
    approval.observedAtBlock !== page.blockNumber
  ) {
    invalid(status);
  }
  const fees = value.fees;
  if (
    !record(fees) ||
    !exact(fees, ["estimated0BaseUnit", "estimated1BaseUnit", "owed0BaseUnit", "owed1BaseUnit"]) ||
    (fees.estimated0BaseUnit !== null && !unsigned(fees.estimated0BaseUnit)) ||
    (fees.estimated1BaseUnit !== null && !unsigned(fees.estimated1BaseUnit)) ||
    !unsigned(fees.owed0BaseUnit) ||
    !unsigned(fees.owed1BaseUnit)
  ) {
    invalid(status);
  }
  const liquidity = value.liquidity;
  if (
    !record(liquidity) ||
    !exact(liquidity, ["amount0BaseUnit", "amount1BaseUnit", "raw"]) ||
    !unsigned(liquidity.amount0BaseUnit) ||
    !unsigned(liquidity.amount1BaseUnit) ||
    !unsigned(liquidity.raw)
  ) {
    invalid(status);
  }
  const pool = value.pool;
  if (
    !record(pool) ||
    !exact(pool, [
      "feePips",
      "hooks",
      "poolAddress",
      "poolId",
      "tickSpacing",
      "token0",
      "token1",
    ]) ||
    !unsigned(pool.feePips) ||
    (pool.hooks !== null && !address(pool.hooks)) ||
    (pool.poolAddress !== null && !address(pool.poolAddress)) ||
    (pool.poolId !== null && !hash(pool.poolId)) ||
    !positive(pool.tickSpacing) ||
    !address(pool.token0) ||
    !address(pool.token1) ||
    pool.token0 === pool.token1 ||
    ((platformId === 1 || platformId === 2) &&
      (pool.poolAddress === null || pool.poolId !== null)) ||
    ((platformId === 4 || platformId === 5) &&
      (pool.poolAddress !== null || pool.poolId === null))
  ) {
    invalid(status);
  }
  const ticks = value.ticks;
  if (
    !record(ticks) ||
    !exact(ticks, ["current", "inRange", "lower", "upper"]) ||
    !signed(ticks.current) ||
    typeof ticks.inRange !== "boolean" ||
    !signed(ticks.lower) ||
    !signed(ticks.upper)
  ) {
    invalid(status);
  }
  const spacing = BigInt(pool.tickSpacing);
  const current = BigInt(ticks.current);
  const lower = BigInt(ticks.lower);
  const upper = BigInt(ticks.upper);
  if (
    lower >= upper ||
    lower % spacing !== 0n ||
    upper % spacing !== 0n ||
    ticks.inRange !== (current >= lower && current < upper)
  ) {
    invalid(status);
  }
  const observed = positionSnapshot(value.snapshot, status);
  if (
    observed.blockHash !== page.blockHash ||
    observed.blockNumber !== page.blockNumber ||
    observed.blockTimestamp !== page.blockTimestamp
  ) {
    invalid(status);
  }
  return {
    approval: { ...approval },
    chainId: 56,
    fees: { ...fees },
    liquidity: { ...liquidity },
    owner: value.owner,
    platformId,
    pool: { ...pool },
    snapshot: observed,
    ticks: { ...ticks },
    tokenId: value.tokenId,
  } as unknown as WalletPosition;
}

function quarantine(value: unknown, status: number): QuarantinedPositionRead {
  if (
    !record(value) ||
    !exact(value, ["managerAddress", "platformId", "reason", "tokenId"]) ||
    !address(value.managerAddress) ||
    (value.platformId !== null && !platformIds.has(value.platformId as PositionPlatformId)) ||
    !quarantineReasons.has(value.reason as PositionQuarantineReason) ||
    (value.tokenId !== null && !unsigned(value.tokenId))
  ) {
    invalid(status);
  }
  return { ...value } as unknown as QuarantinedPositionRead;
}

export function parseWalletPositionPage(value: unknown, status = 0): WalletPositionPage {
  if (
    !record(value) ||
    !exact(value, [
      "address",
      "chainId",
      "coverage",
      "cursor",
      "items",
      "quarantined",
      "registryVersion",
      "snapshot",
      "status",
      "walletId",
    ]) ||
    !address(value.address) ||
    value.chainId !== 56 ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length < 1 || value.cursor.length > 2_048)) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.quarantined) ||
    value.registryVersion !== "p05-bsc-execution-v1" ||
    !positionStates.has(String(value.status)) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    invalid(status);
  }
  const pageSnapshot = snapshot(value.snapshot, status);
  const coverage = value.coverage;
  if (
    !record(coverage) ||
    !exact(coverage, ["complete", "failedPlatformIds", "scannedPlatformIds"]) ||
    typeof coverage.complete !== "boolean" ||
    !Array.isArray(coverage.failedPlatformIds) ||
    !Array.isArray(coverage.scannedPlatformIds) ||
    !coverage.failedPlatformIds.every((id) => platformIds.has(id as PositionPlatformId)) ||
    !coverage.scannedPlatformIds.every((id) => platformIds.has(id as PositionPlatformId)) ||
    new Set(coverage.failedPlatformIds).size !== coverage.failedPlatformIds.length ||
    new Set(coverage.scannedPlatformIds).size !== coverage.scannedPlatformIds.length ||
    (value.status !== "stale" &&
      coverage.complete !== (coverage.failedPlatformIds.length === 0))
  ) {
    invalid(status);
  }
  const failedPlatformIds = [...coverage.failedPlatformIds] as PositionPlatformId[];
  const scannedPlatformIds = [...coverage.scannedPlatformIds] as PositionPlatformId[];
  const items = value.items.map((item) => position(item, pageSnapshot, value.address as string, status));
  const quarantined = value.quarantined.map((item) => quarantine(item, status));
  if (
    new Set(items.map((item) => `${item.platformId}:${item.tokenId}`)).size !== items.length ||
    items.some((item) => !scannedPlatformIds.includes(item.platformId))
  ) {
    invalid(status);
  }
  const state = String(value.status);
  const validState =
    (state === "stale" && !coverage.complete && items.length === 0 && quarantined.length === 0) ||
    (state === "empty" && coverage.complete && items.length === 0 && quarantined.length === 0) ||
    (state === "quarantined" && items.length === 0 && quarantined.length > 0) ||
    (state === "ready" && coverage.complete && items.length > 0 && quarantined.length === 0) ||
    (state === "partial" &&
      items.length > 0 &&
      (!coverage.complete || quarantined.length > 0));
  if (!validState) invalid(status);
  return {
    address: value.address,
    chainId: 56,
    coverage: {
      complete: coverage.complete,
      failedPlatformIds,
      scannedPlatformIds,
    },
    cursor: value.cursor as string | null,
    items,
    quarantined,
    registryVersion: value.registryVersion,
    snapshot: pageSnapshot,
    status: state as WalletPositionPage["status"],
    walletId: value.walletId,
  };
}

function helperVerification(value: unknown, status: number): NonNullable<WalletHelperStatus["verification"]> {
  if (
    !record(value) ||
    !exact(value, [
      "blockHash",
      "blockNumber",
      "blockTimestamp",
      "checks",
      "digest",
      "observedOwner",
      "observedRuntimeCodeHash",
      "observedSelectors",
      "verifiedAt",
    ]) ||
    !hash(value.blockHash) ||
    !unsigned(value.blockNumber) ||
    !timestamp(value.blockTimestamp) ||
    !hash(value.digest) ||
    (value.observedOwner !== null && !address(value.observedOwner)) ||
    (value.observedRuntimeCodeHash !== null && !hash(value.observedRuntimeCodeHash)) ||
    !Array.isArray(value.observedSelectors) ||
    value.observedSelectors.length > 256 ||
    !value.observedSelectors.every(
      (selector) => typeof selector === "string" && selectorPattern.test(selector),
    ) ||
    new Set(value.observedSelectors).size !== value.observedSelectors.length ||
    !timestamp(value.verifiedAt)
  ) {
    invalid(status);
  }
  const checks = value.checks;
  if (
    !record(checks) ||
    !exact(checks, ["address", "owner", "runtimeCodeHash", "selectorSet", "version"]) ||
    Object.values(checks).some((check) => typeof check !== "boolean")
  ) {
    invalid(status);
  }
  return {
    blockHash: value.blockHash,
    blockNumber: value.blockNumber,
    blockTimestamp: value.blockTimestamp,
    checks: { ...checks } as NonNullable<WalletHelperStatus["verification"]>["checks"],
    digest: value.digest,
    observedOwner: value.observedOwner as `0x${string}` | null,
    observedRuntimeCodeHash: value.observedRuntimeCodeHash as `0x${string}` | null,
    observedSelectors: [...value.observedSelectors] as `0x${string}`[],
    verifiedAt: value.verifiedAt,
  };
}

export function parseWalletHelperStatus(value: unknown, status = 0): WalletHelperStatus {
  if (
    !record(value) ||
    !exact(value, [
      "address",
      "chainId",
      "failures",
      "helperVersion",
      "owner",
      "registryVersion",
      "state",
      "verification",
      "walletId",
    ]) ||
    (value.address !== null && !address(value.address)) ||
    value.chainId !== 56 ||
    !Array.isArray(value.failures) ||
    !value.failures.every((failure) => helperFailures.has(failure as HelperVerificationFailure)) ||
    new Set(value.failures).size !== value.failures.length ||
    (value.helperVersion !== null &&
      (typeof value.helperVersion !== "string" || !versionPattern.test(value.helperVersion))) ||
    (value.owner !== null && !address(value.owner)) ||
    value.registryVersion !== "p05-bsc-execution-v1" ||
    !helperStates.has(String(value.state)) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    invalid(status);
  }
  const state = String(value.state) as WalletHelperStatus["state"];
  if (state === "undeployed") {
    if (
      value.address !== null ||
      value.helperVersion !== null ||
      value.verification !== null ||
      value.owner === null ||
      value.failures.length !== 0
    ) {
      invalid(status);
    }
    return { ...value, failures: [] } as unknown as WalletHelperStatus;
  }
  if (
    value.address === null ||
    value.helperVersion === null ||
    value.owner === null ||
    value.verification === null
  ) {
    invalid(status);
  }
  const verification = helperVerification(value.verification, status);
  const failures = value.failures as HelperVerificationFailure[];
  if (
    (state === "degraded") !== (failures.length > 0) ||
    (failures.includes("address-mismatch") && verification.checks.address) ||
    (failures.includes("owner-mismatch") && verification.checks.owner) ||
    (failures.includes("runtime-code-hash-mismatch") && verification.checks.runtimeCodeHash) ||
    (failures.includes("selector-set-mismatch") && verification.checks.selectorSet) ||
    (failures.includes("version-unregistered") && verification.checks.version)
  ) {
    invalid(status);
  }
  return {
    address: value.address as `0x${string}`,
    chainId: 56,
    failures: [...failures],
    helperVersion: value.helperVersion,
    owner: value.owner as `0x${string}`,
    registryVersion: value.registryVersion,
    state,
    verification,
    walletId: value.walletId,
  };
}

function residualCoverage(value: unknown, status: number): HelperResidualPage["coverage"] {
  if (
    !record(value) ||
    !exact(value, [
      "allowlistComplete",
      "complete",
      "missingSources",
      "positionTokensComplete",
      "walletTokenRegistryComplete",
    ]) ||
    typeof value.allowlistComplete !== "boolean" ||
    typeof value.complete !== "boolean" ||
    typeof value.positionTokensComplete !== "boolean" ||
    typeof value.walletTokenRegistryComplete !== "boolean" ||
    !Array.isArray(value.missingSources) ||
    !value.missingSources.every(
      (source) =>
        typeof source === "string" && source.length >= 1 && source.length <= 256 && !/\p{Cc}/u.test(source),
    ) ||
    new Set(value.missingSources).size !== value.missingSources.length ||
    value.complete !== (value.missingSources.length === 0) ||
    (value.complete &&
      (!value.allowlistComplete ||
        !value.positionTokensComplete ||
        !value.walletTokenRegistryComplete))
  ) {
    invalid(status);
  }
  return {
    allowlistComplete: value.allowlistComplete,
    complete: value.complete,
    missingSources: [...value.missingSources] as string[],
    positionTokensComplete: value.positionTokensComplete,
    walletTokenRegistryComplete: value.walletTokenRegistryComplete,
  };
}

function residualAsset(value: unknown, status: number): HelperResidualAsset {
  if (!record(value) || !positive(value.amountBaseUnit) || value.chainId !== 56) invalid(status);
  if (
    value.kind === "native" &&
    exact(value, ["amountBaseUnit", "assetId", "chainId", "kind", "tokenAddress"]) &&
    value.assetId === "native:56" &&
    value.tokenAddress === null
  ) {
    return { ...value } as unknown as HelperResidualAsset;
  }
  if (
    value.kind === "token" &&
    exact(value, ["amountBaseUnit", "assetId", "chainId", "kind", "tokenAddress"]) &&
    address(value.tokenAddress) &&
    value.assetId === `token:${value.tokenAddress}`
  ) {
    return { ...value } as unknown as HelperResidualAsset;
  }
  if (
    value.kind === "allowance" &&
    exact(value, [
      "amountBaseUnit",
      "assetId",
      "chainId",
      "kind",
      "spenderAddress",
      "tokenAddress",
    ]) &&
    address(value.tokenAddress) &&
    address(value.spenderAddress) &&
    value.assetId === `allowance:${value.tokenAddress}:${value.spenderAddress}`
  ) {
    return { ...value } as unknown as HelperResidualAsset;
  }
  if (
    value.kind === "nft" &&
    exact(value, [
      "amountBaseUnit",
      "assetId",
      "chainId",
      "kind",
      "managerAddress",
      "tokenAddress",
      "tokenId",
    ]) &&
    value.amountBaseUnit === "1" &&
    address(value.managerAddress) &&
    value.tokenAddress === null &&
    unsigned(value.tokenId) &&
    value.assetId === `nft:${value.managerAddress}:${value.tokenId}`
  ) {
    return { ...value } as unknown as HelperResidualAsset;
  }
  invalid(status);
}

export function parseHelperResidualPage(
  value: unknown,
  status = 0,
): HelperResidualPage | null {
  if (value === null) return null;
  if (
    !record(value) ||
    !exact(value, [
      "allowlistVersion",
      "chainId",
      "coverage",
      "cursor",
      "helperAddress",
      "items",
      "registryVersion",
      "scanId",
      "scannedAt",
      "snapshot",
      "state",
      "walletId",
    ]) ||
    typeof value.allowlistVersion !== "string" ||
    !versionPattern.test(value.allowlistVersion) ||
    value.chainId !== 56 ||
    (value.cursor !== null &&
      (typeof value.cursor !== "string" || value.cursor.length < 1 || value.cursor.length > 2_048)) ||
    !address(value.helperAddress) ||
    !Array.isArray(value.items) ||
    value.registryVersion !== "p05-bsc-execution-v1" ||
    typeof value.scanId !== "string" ||
    !uuidPattern.test(value.scanId) ||
    !timestamp(value.scannedAt) ||
    (value.state !== "empty" && value.state !== "ready" && value.state !== "partial") ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId)
  ) {
    invalid(status);
  }
  const coverage = residualCoverage(value.coverage, status);
  const items = value.items.map((item) => residualAsset(item, status));
  const pageSnapshot = snapshot(value.snapshot, status);
  if (
    new Set(items.map(({ assetId }) => assetId)).size !== items.length ||
    (coverage.complete && value.state === "partial") ||
    (!coverage.complete && value.state !== "partial") ||
    (coverage.complete && items.length === 0 && value.state !== "empty") ||
    (coverage.complete && items.length > 0 && value.state !== "ready")
  ) {
    invalid(status);
  }
  return {
    allowlistVersion: value.allowlistVersion,
    chainId: 56,
    coverage,
    cursor: value.cursor as string | null,
    helperAddress: value.helperAddress,
    items,
    registryVersion: value.registryVersion,
    scanId: value.scanId,
    scannedAt: value.scannedAt,
    snapshot: pageSnapshot,
    state: value.state,
    walletId: value.walletId,
  };
}

export class PositionHelperClient {
  readonly #fetcher: PositionHelperFetch;

  constructor(fetcher: PositionHelperFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async positions(walletAddress: string, signal?: AbortSignal): Promise<WalletPositionPage> {
    const normalized = this.#address(walletAddress);
    const response = await this.#request(
      `/api/wallets/${normalized}/positions?chainId=56&limit=100`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseWalletPositionPage(response.data, response.status);
  }

  async helper(walletAddress: string, signal?: AbortSignal): Promise<WalletHelperStatus> {
    const normalized = this.#address(walletAddress);
    const response = await this.#request(`/api/wallets/${normalized}/helper?chainId=56`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseWalletHelperStatus(response.data, response.status);
  }

  async residuals(walletId: string, signal?: AbortSignal): Promise<HelperResidualPage | null> {
    const normalized = this.#uuid(walletId);
    const response = await this.#request(
      `/api/wallets/helper-residuals?chainId=56&walletId=${normalized}&limit=100`,
      { method: "GET", ...(signal ? { signal } : {}) },
    );
    return parseHelperResidualPage(response.data, response.status);
  }

  async scanResiduals(
    walletId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<HelperResidualPage> {
    const normalized = this.#uuid(walletId);
    if (!idempotencyPattern.test(idempotencyKey)) {
      throw new PositionHelperRequestError("HELPER_RESIDUAL_INPUT_INVALID", false, 0);
    }
    const response = await this.#request("/api/wallets/helper-residuals/scan", {
      body: JSON.stringify({ chainId: 56, idempotencyKey, walletId: normalized }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    const parsed = parseHelperResidualPage(response.data, response.status);
    if (!parsed) invalid(response.status);
    return parsed;
  }

  #address(value: string): string {
    const normalized = value.toLowerCase();
    if (!addressPattern.test(normalized)) {
      throw new PositionHelperRequestError("WALLET_NOT_FOUND", false, 0);
    }
    return normalized;
  }

  #uuid(value: string): string {
    if (!uuidPattern.test(value)) {
      throw new PositionHelperRequestError("WALLET_NOT_FOUND", false, 0);
    }
    return value.toLowerCase();
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
      throw new PositionHelperRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      invalid(response.status);
    }
    if (!response.ok) {
      const envelope = record(body) ? (body as ErrorEnvelope) : null;
      const code =
        typeof envelope?.error?.code === "string"
          ? envelope.error.code
          : "POSITION_HELPER_REQUEST_FAILED";
      throw new PositionHelperRequestError(
        code,
        envelope?.error?.retryable === true,
        response.status,
      );
    }
    if (!record(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      invalid(response.status);
    }
    return { data: body.data, status: response.status };
  }
}
