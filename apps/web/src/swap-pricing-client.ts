import type {
  EvmAddress,
  ImportPricingPositionRequest,
  PricingPosition,
  PricingPositionCostBasis,
  PricingPositionObservation,
  PricingPositionPage,
  PricingPositionStreamEvent,
  SwapQuoteRequest,
  SwapQuoteView,
} from "@lpbot/api-contract";

type SwapPricingFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const selectorPattern = /^0x[0-9a-f]{8}$/u;
const unsignedPattern = /^(?:0|[1-9][0-9]*)$/u;
const decimalValuePattern = /^(?:0|[1-9][0-9]{0,37})(?:\.[0-9]{1,18})?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const platformIds = new Set([1, 2, 4, 5]);
const pricingStatuses = new Set(["active", "hidden", "withdrawn"]);

export class SwapPricingRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "SwapPricingRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function invalid(status = 0): never {
  throw new SwapPricingRequestError("SWAP_PRICING_RESPONSE_INVALID", true, status);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function address(value: unknown): value is EvmAddress {
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

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function parseSwapQuoteView(value: unknown, status = 0): SwapQuoteView {
  if (
    !record(value) ||
    !exact(value, [
      "amountInBaseUnit",
      "amountOutBaseUnit",
      "blockNumber",
      "calldataDigest",
      "chainId",
      "deadline",
      "digest",
      "digestDomain",
      "digestVersion",
      "executionEnabled",
      "expiresAt",
      "gas",
      "maxBlockNumber",
      "minOutBaseUnit",
      "platformId",
      "priceImpactBps",
      "providerSnapshotId",
      "quotedAt",
      "registryVersion",
      "route",
      "router",
      "selector",
      "slippageBps",
      "spender",
      "tokenIn",
      "tokenOut",
      "walletAddress",
      "walletId",
    ]) ||
    value.chainId !== 56 ||
    !platformIds.has(Number(value.platformId)) ||
    !positive(value.amountInBaseUnit) ||
    !positive(value.amountOutBaseUnit) ||
    !unsigned(value.minOutBaseUnit) ||
    !positive(value.blockNumber) ||
    !positive(value.maxBlockNumber) ||
    !Number.isSafeInteger(value.slippageBps) ||
    Number(value.slippageBps) < 0 ||
    Number(value.slippageBps) > 500 ||
    !Number.isSafeInteger(value.priceImpactBps) ||
    Number(value.priceImpactBps) < 0 ||
    Number(value.priceImpactBps) > 10_000 ||
    !address(value.tokenIn) ||
    !address(value.tokenOut) ||
    value.tokenIn === value.tokenOut ||
    !address(value.walletAddress) ||
    !address(value.router) ||
    !address(value.spender) ||
    typeof value.selector !== "string" ||
    !selectorPattern.test(value.selector) ||
    !hash(value.calldataDigest) ||
    !hash(value.digest) ||
    value.digestDomain !== "LPXBOT_SWAP_QUOTE" ||
    value.digestVersion !== 1 ||
    value.executionEnabled !== false ||
    value.registryVersion !== "p05-bsc-execution-v1" ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    typeof value.providerSnapshotId !== "string" ||
    !uuidPattern.test(value.providerSnapshotId) ||
    !timestamp(value.quotedAt) ||
    !timestamp(value.expiresAt) ||
    !timestamp(value.deadline)
  ) {
    invalid(status);
  }
  const gas = value.gas;
  if (
    !record(gas) ||
    !exact(gas, ["estimatedFeeWei", "gasLimit", "gasPriceWei"]) ||
    !positive(gas.gasLimit) ||
    !positive(gas.gasPriceWei) ||
    !positive(gas.estimatedFeeWei) ||
    BigInt(gas.estimatedFeeWei) !== BigInt(gas.gasLimit) * BigInt(gas.gasPriceWei)
  ) {
    invalid(status);
  }
  const route = value.route;
  if (
    !record(route) ||
    !exact(route, ["poolPath", "tokens"]) ||
    !Array.isArray(route.tokens) ||
    route.tokens.length < 2 ||
    !route.tokens.every(address) ||
    route.tokens[0] !== value.tokenIn ||
    route.tokens.at(-1) !== value.tokenOut ||
    !Array.isArray(route.poolPath) ||
    route.poolPath.length < 1 ||
    !route.poolPath.every(hash)
  ) {
    invalid(status);
  }
  if (
    BigInt(value.minOutBaseUnit) !==
      (BigInt(value.amountOutBaseUnit) * BigInt(10_000 - Number(value.slippageBps))) / 10_000n ||
    BigInt(value.maxBlockNumber) < BigInt(value.blockNumber) ||
    Date.parse(value.quotedAt) >= Date.parse(value.expiresAt) ||
    Date.parse(value.expiresAt) > Date.parse(value.deadline)
  ) {
    invalid(status);
  }
  return structuredClone(value) as unknown as SwapQuoteView;
}

export function quoteTimeState(
  quote: Pick<SwapQuoteView, "deadline" | "expiresAt">,
  now = new Date(),
): "expired" | "quoted" {
  const current = now.getTime();
  return current < Date.parse(quote.expiresAt) && current < Date.parse(quote.deadline)
    ? "quoted"
    : "expired";
}

function parseCostBasis(value: unknown, status: number): PricingPositionCostBasis {
  if (
    !record(value) ||
    !exact(value, [
      "amount0BaseUnit",
      "amount1BaseUnit",
      "priceObservedAt",
      "priceSource",
      "priceStatus",
      "usdValueDecimal",
    ]) ||
    !unsigned(value.amount0BaseUnit) ||
    !unsigned(value.amount1BaseUnit) ||
    !["current", "missing", "stale"].includes(String(value.priceStatus))
  ) {
    invalid(status);
  }
  const missing = value.priceStatus === "missing";
  const current = value.priceStatus === "current";
  const stale = value.priceStatus === "stale";
  if (
    (missing &&
      (value.usdValueDecimal !== null ||
        value.priceObservedAt !== null ||
        value.priceSource !== null)) ||
    (current &&
      (typeof value.usdValueDecimal !== "string" ||
        !decimalValuePattern.test(value.usdValueDecimal) ||
        !timestamp(value.priceObservedAt) ||
        typeof value.priceSource !== "string" ||
        value.priceSource.length < 1)) ||
    (stale &&
      (value.usdValueDecimal !== null ||
        !timestamp(value.priceObservedAt) ||
        typeof value.priceSource !== "string" ||
        value.priceSource.length < 1))
  ) {
    invalid(status);
  }
  return { ...value } as unknown as PricingPositionCostBasis;
}

function parseObservation(value: unknown, status: number): PricingPositionObservation {
  if (
    !record(value) ||
    !exact(value, [
      "blockHash",
      "blockNumber",
      "liquidityAmount0BaseUnit",
      "liquidityAmount1BaseUnit",
      "liquidityRaw",
      "observationId",
      "observedAt",
      "observedFee0BaseUnit",
      "observedFee1BaseUnit",
      "pageSnapshotDigest",
      "recordedAt",
      "snapshotDigest",
    ]) ||
    !hash(value.blockHash) ||
    !unsigned(value.blockNumber) ||
    !unsigned(value.liquidityAmount0BaseUnit) ||
    !unsigned(value.liquidityAmount1BaseUnit) ||
    !unsigned(value.liquidityRaw) ||
    typeof value.observationId !== "string" ||
    !uuidPattern.test(value.observationId) ||
    !timestamp(value.observedAt) ||
    !timestamp(value.recordedAt) ||
    !unsigned(value.observedFee0BaseUnit) ||
    !unsigned(value.observedFee1BaseUnit) ||
    !hash(value.pageSnapshotDigest) ||
    !hash(value.snapshotDigest)
  ) {
    invalid(status);
  }
  return { ...value } as unknown as PricingPositionObservation;
}

function parsePricingPosition(value: unknown, status: number): PricingPosition {
  if (
    !record(value) ||
    !exact(value, [
      "chainId",
      "costBasis",
      "importedAt",
      "observations",
      "platformId",
      "pool",
      "positionManager",
      "pricingId",
      "revision",
      "status",
      "tokenId",
      "updatedAt",
      "walletAddress",
      "walletId",
    ]) ||
    value.chainId !== 56 ||
    !platformIds.has(Number(value.platformId)) ||
    typeof value.pricingId !== "string" ||
    !uuidPattern.test(value.pricingId) ||
    typeof value.walletId !== "string" ||
    !uuidPattern.test(value.walletId) ||
    !address(value.walletAddress) ||
    !address(value.positionManager) ||
    !unsigned(value.tokenId) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !pricingStatuses.has(String(value.status)) ||
    !timestamp(value.importedAt) ||
    !timestamp(value.updatedAt) ||
    !Array.isArray(value.observations)
  ) {
    invalid(status);
  }
  const pool = value.pool;
  if (
    !record(pool) ||
    !exact(pool, ["poolAddress", "poolId", "token0", "token1"]) ||
    (pool.poolAddress !== null && !address(pool.poolAddress)) ||
    (pool.poolId !== null && !hash(pool.poolId)) ||
    (pool.poolAddress === null) === (pool.poolId === null) ||
    !address(pool.token0) ||
    !address(pool.token1) ||
    pool.token0 === pool.token1
  ) {
    invalid(status);
  }
  const platformId = Number(value.platformId);
  if (
    ((platformId === 1 || platformId === 2) && pool.poolAddress === null) ||
    ((platformId === 4 || platformId === 5) && pool.poolId === null)
  ) {
    invalid(status);
  }
  const observations = value.observations.map((item) => parseObservation(item, status));
  if (new Set(observations.map(({ snapshotDigest }) => snapshotDigest)).size !== observations.length) {
    invalid(status);
  }
  return {
    ...value,
    costBasis: parseCostBasis(value.costBasis, status),
    observations,
    pool: { ...pool },
  } as unknown as PricingPosition;
}

export function parsePricingPositionPage(value: unknown, status = 0): PricingPositionPage {
  if (!record(value) || !exact(value, ["items"]) || !Array.isArray(value.items)) invalid(status);
  return { items: value.items.map((item) => parsePricingPosition(item, status)) };
}

export function parsePricingPositionStreamEvent(
  value: unknown,
  status = 0,
): PricingPositionStreamEvent {
  if (
    !record(value) ||
    typeof value.type !== "string" ||
    typeof value.cursor !== "string" ||
    value.cursor.length < 1 ||
    value.cursor.length > 1_024 ||
    typeof value.epoch !== "string" ||
    !uuidPattern.test(value.epoch) ||
    !unsigned(value.sequence)
  ) {
    invalid(status);
  }
  if (value.type === "snapshot") {
    if (!exact(value, ["cursor", "epoch", "items", "sequence", "type"]) || !Array.isArray(value.items)) {
      invalid(status);
    }
    return {
      cursor: value.cursor,
      epoch: value.epoch,
      items: value.items.map((item) => parsePricingPosition(item, status)),
      sequence: value.sequence,
      type: "snapshot",
    };
  }
  if (value.type === "diff") {
    if (!exact(value, ["cursor", "epoch", "position", "sequence", "type"])) invalid(status);
    return {
      cursor: value.cursor,
      epoch: value.epoch,
      position: parsePricingPosition(value.position, status),
      sequence: value.sequence,
      type: "diff",
    };
  }
  if (value.type === "tombstone") {
    if (
      !exact(value, ["cursor", "epoch", "pricingId", "revision", "sequence", "status", "type"]) ||
      typeof value.pricingId !== "string" ||
      !uuidPattern.test(value.pricingId) ||
      !Number.isSafeInteger(value.revision) ||
      Number(value.revision) < 1 ||
      value.status !== "withdrawn"
    ) {
      invalid(status);
    }
    return { ...value } as unknown as PricingPositionStreamEvent;
  }
  if (value.type === "heartbeat") {
    if (
      !exact(value, ["cursor", "epoch", "observedAt", "sequence", "type"]) ||
      !timestamp(value.observedAt)
    ) {
      invalid(status);
    }
    return { ...value } as unknown as PricingPositionStreamEvent;
  }
  invalid(status);
}

export interface PricingPositionStreamState {
  connection: "connecting" | "live" | "stale";
  cursor: string | null;
  epoch: string | null;
  items: PricingPosition[];
  sequence: string;
}

export function initialPricingPositionStreamState(): PricingPositionStreamState {
  return { connection: "connecting", cursor: null, epoch: null, items: [], sequence: "0" };
}

export function reducePricingPositionStream(
  state: PricingPositionStreamState,
  event: PricingPositionStreamEvent,
): PricingPositionStreamState {
  if (event.type === "snapshot") {
    return {
      connection: "live",
      cursor: event.cursor,
      epoch: event.epoch,
      items: [...event.items],
      sequence: event.sequence,
    };
  }
  if (state.epoch === null || state.epoch !== event.epoch) {
    return { ...state, connection: "stale" };
  }
  const next = BigInt(event.sequence);
  const current = BigInt(state.sequence);
  if (event.type === "heartbeat") {
    if (next < current) return state;
    return { ...state, connection: "live", cursor: event.cursor };
  }
  if (next <= current) return state;
  if (event.type === "diff") {
    const exists = state.items.some(({ pricingId }) => pricingId === event.position.pricingId);
    return {
      connection: "live",
      cursor: event.cursor,
      epoch: state.epoch,
      items: exists
        ? state.items.map((item) =>
            item.pricingId === event.position.pricingId ? event.position : item,
          )
        : [...state.items, event.position],
      sequence: event.sequence,
    };
  }
  return {
    connection: "live",
    cursor: event.cursor,
    epoch: state.epoch,
    items: state.items.map((item) =>
      item.pricingId === event.pricingId
        ? { ...item, revision: event.revision, status: "withdrawn" }
        : item,
    ),
    sequence: event.sequence,
  };
}

async function responseData(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    invalid(response.status);
  }
  if (!response.ok) {
    const envelope = body as ErrorEnvelope;
    throw new SwapPricingRequestError(
      typeof envelope.error?.code === "string" ? envelope.error.code : "REQUEST_FAILED",
      envelope.error?.retryable === true,
      response.status,
    );
  }
  if (!record(body) || !exact(body, ["data", "requestId", "success"]) || body.success !== true) {
    invalid(response.status);
  }
  return body.data;
}

export class SwapPricingClient {
  readonly #fetch: SwapPricingFetch;

  constructor(fetcher: SwapPricingFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetch = fetcher;
  }

  async quote(input: SwapQuoteRequest, signal?: AbortSignal): Promise<SwapQuoteView> {
    const response = await this.#fetch("/api/swap/quote", {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parseSwapQuoteView(await responseData(response), response.status);
  }

  async pricingPositions(signal?: AbortSignal): Promise<PricingPositionPage> {
    const response = await this.#fetch("/api/pricing-positions", {
      cache: "no-store",
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
    return parsePricingPositionPage(await responseData(response), response.status);
  }

  async importPricingPosition(
    input: ImportPricingPositionRequest,
    signal?: AbortSignal,
  ): Promise<PricingPosition> {
    const response = await this.#fetch("/api/pricing-positions/import", {
      body: JSON.stringify(input),
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parsePricingPosition(await responseData(response), response.status);
  }

  async markWithdrawn(
    pricingId: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<PricingPosition> {
    const response = await this.#fetch(`/api/pricing-positions/${pricingId}/withdrawn`, {
      body: JSON.stringify({ expectedRevision }),
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    return parsePricingPosition(await responseData(response), response.status);
  }
}
