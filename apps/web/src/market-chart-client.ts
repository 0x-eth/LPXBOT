import {
  marketCandleBars,
  type ErrorEnvelope,
  type MarketCandleBar,
  type MarketCandlesResponse,
  type MarketProtocol,
  type MarketTickLiquidityResponse,
  type SuccessEnvelope,
} from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

export interface MarketCandlesRequest {
  bar: MarketCandleBar;
  limit: number;
  poolKey: string;
  token: string;
}

export interface MarketTickLiquidityRequest {
  decimals0: number | null;
  decimals1: number | null;
  identity: string;
  protocol: MarketProtocol;
  range: number;
  tickSpacing: number;
}

export interface MarketChartRequest {
  requestId: number;
  selectionKey: string;
  signal: AbortSignal;
}

interface AbortControllerLike {
  abort(): void;
  signal: AbortSignal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/u.test(value);
}

function isPoolKey(value: unknown): value is string {
  return typeof value === "string" && /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function isIntegerString(value: unknown, allowZero = true): value is string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(value)) return false;
  return allowZero || value !== "0";
}

function decimalValue(value: unknown, positive: boolean): Decimal | null {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
    return null;
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || (positive ? !parsed.isPositive() : parsed.isNegative())) return null;
  return parsed;
}

function validMetadata(value: Record<string, unknown>): boolean {
  return (
    value.chainId === 56 &&
    isTimestamp(value.asOf) &&
    typeof value.canonicalRevision === "string" &&
    /^canonical:v1:[0-9a-f]{64}$/u.test(value.canonicalRevision) &&
    value.source === "canonical-events" &&
    typeof value.version === "string" &&
    /^(?:0|[1-9][0-9]*)$/u.test(value.version) &&
    isPoolKey(value.poolKey)
  );
}

export function buildMarketCandlesUrl(request: MarketCandlesRequest): string {
  if (
    !isAddress(request.token.toLowerCase()) ||
    !isPoolKey(request.poolKey.toLowerCase()) ||
    !marketCandleBars.includes(request.bar) ||
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 1_000
  ) {
    throw new RangeError("MARKET_CANDLE_REQUEST_INVALID");
  }
  const parameters = new URLSearchParams({
    token: request.token.toLowerCase(),
    poolKey: request.poolKey.toLowerCase(),
    bar: request.bar,
    limit: String(request.limit),
    chainId: "56",
  });
  return `/api/market/candles?${parameters.toString()}`;
}

export function buildMarketTickLiquidityUrl(request: MarketTickLiquidityRequest): string {
  const identity = request.identity.toLowerCase();
  const decimalsKnown = request.decimals0 !== null || request.decimals1 !== null;
  if (
    !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity) ||
    !(["pcsv3", "univ3", "pcsv4", "univ4"] as const).includes(request.protocol) ||
    !Number.isSafeInteger(request.range) ||
    request.range < 5 ||
    request.range > 50 ||
    !Number.isSafeInteger(request.tickSpacing) ||
    request.tickSpacing < 1 ||
    (decimalsKnown &&
      (request.decimals0 === null ||
        request.decimals1 === null ||
        !Number.isSafeInteger(request.decimals0) ||
        !Number.isSafeInteger(request.decimals1) ||
        request.decimals0 < 0 ||
        request.decimals0 > 255 ||
        request.decimals1 < 0 ||
        request.decimals1 > 255))
  ) {
    throw new RangeError("MARKET_TICK_REQUEST_INVALID");
  }
  const parameters = new URLSearchParams({
    range: String(request.range),
    chain: "bsc",
    dex: request.protocol,
    tickSpacing: String(request.tickSpacing),
  });
  if (request.decimals0 !== null && request.decimals1 !== null) {
    parameters.set("decimals0", String(request.decimals0));
    parameters.set("decimals1", String(request.decimals1));
  }
  return `/api/pools/liquidity/${identity}?${parameters.toString()}`;
}

export function parseMarketCandlesResponse(value: unknown): MarketCandlesResponse {
  if (
    !isRecord(value) ||
    !validMetadata(value) ||
    typeof value.bar !== "string" ||
    !marketCandleBars.includes(value.bar as MarketCandleBar) ||
    !isAddress(value.token) ||
    (value.direction !== "token0" && value.direction !== "token1") ||
    value.priceUnit !==
      (value.direction === "token0" ? "token1-raw/token0-raw" : "token0-raw/token1-raw") ||
    !isRecord(value.volumeUnit) ||
    value.volumeUnit.kind !== "raw-integer" ||
    value.volumeUnit.token !== value.token ||
    !Array.isArray(value.candles)
  ) {
    throw new Error("MARKET_CANDLE_RESPONSE_INVALID");
  }
  let previousTs = -1;
  for (const candle of value.candles) {
    if (
      !isRecord(candle) ||
      !Number.isSafeInteger(candle.ts) ||
      (candle.ts as number) <= previousTs ||
      !decimalValue(candle.open, true) ||
      !decimalValue(candle.high, true) ||
      !decimalValue(candle.low, true) ||
      !decimalValue(candle.close, true) ||
      !decimalValue(candle.volume, false)
    ) {
      throw new Error("MARKET_CANDLE_RESPONSE_INVALID");
    }
    const open = new Decimal(candle.open as string);
    const high = new Decimal(candle.high as string);
    const low = new Decimal(candle.low as string);
    const close = new Decimal(candle.close as string);
    if (low.greaterThan(open) || low.greaterThan(close) || high.lessThan(open) || high.lessThan(close)) {
      throw new Error("MARKET_CANDLE_RESPONSE_INVALID");
    }
    previousTs = candle.ts as number;
  }
  return value as unknown as MarketCandlesResponse;
}

export function parseMarketTickLiquidityResponse(value: unknown): MarketTickLiquidityResponse {
  if (
    !isRecord(value) ||
    !validMetadata(value) ||
    !(value.currentTick === null || Number.isSafeInteger(value.currentTick)) ||
    !Number.isSafeInteger(value.range) ||
    (value.range as number) < 5 ||
    (value.range as number) > 50 ||
    !Number.isSafeInteger(value.tickSpacing) ||
    (value.tickSpacing as number) < 1 ||
    !Array.isArray(value.ticks)
  ) {
    throw new Error("MARKET_TICK_RESPONSE_INVALID");
  }
  const decimalsUnknown = value.decimals0 === null && value.decimals1 === null;
  const decimalsKnown =
    Number.isSafeInteger(value.decimals0) &&
    Number.isSafeInteger(value.decimals1) &&
    (value.decimals0 as number) >= 0 &&
    (value.decimals0 as number) <= 255 &&
    (value.decimals1 as number) >= 0 &&
    (value.decimals1 as number) <= 255;
  if (!decimalsUnknown && !decimalsKnown) throw new Error("MARKET_TICK_RESPONSE_INVALID");
  if (value.currentTick === null && value.ticks.length > 0) {
    throw new Error("MARKET_TICK_RESPONSE_INVALID");
  }
  let previousTick: number | null = null;
  for (const tick of value.ticks) {
    if (
      !isRecord(tick) ||
      !Number.isSafeInteger(tick.tickIdx) ||
      (previousTick !== null && (tick.tickIdx as number) <= previousTick) ||
      !isIntegerString(tick.liquidityNet, false)
    ) {
      throw new Error("MARKET_TICK_RESPONSE_INVALID");
    }
    if (decimalsUnknown) {
      if (tick.price0 !== null || tick.price1 !== null) {
        throw new Error("MARKET_TICK_RESPONSE_INVALID");
      }
    } else if (!decimalValue(tick.price0, true) || !decimalValue(tick.price1, true)) {
      throw new Error("MARKET_TICK_RESPONSE_INVALID");
    }
    previousTick = tick.tickIdx as number;
  }
  return value as unknown as MarketTickLiquidityResponse;
}

export class MarketChartRequestManager {
  #active: { controller: AbortControllerLike; requestId: number; selectionKey: string } | null = null;
  #nextRequestId = 0;

  start(selectionKey: string, controller: AbortControllerLike = new AbortController()): MarketChartRequest {
    this.#active?.controller.abort();
    const requestId = ++this.#nextRequestId;
    this.#active = { controller, requestId, selectionKey };
    return { requestId, selectionKey, signal: controller.signal };
  }

  isCurrent(requestId: number, selectionKey: string): boolean {
    return (
      this.#active?.requestId === requestId &&
      this.#active.selectionKey === selectionKey &&
      !this.#active.controller.signal.aborted
    );
  }

  clear(): void {
    this.#active?.controller.abort();
    this.#active = null;
  }
}

export class MarketChartRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.name = "MarketChartRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function responseData(response: Response): Promise<unknown> {
  const envelope = (await response.json()) as SuccessEnvelope<unknown> | ErrorEnvelope;
  if (!response.ok || !envelope.success) {
    const error = envelope.success ? null : envelope.error;
    throw new MarketChartRequestError(
      error?.code ?? `MARKET_CHART_HTTP_${response.status}`,
      error?.retryable ?? response.status >= 500,
    );
  }
  return envelope.data;
}

export class MarketChartClient {
  async getCandles(
    request: MarketCandlesRequest,
    signal: AbortSignal,
  ): Promise<MarketCandlesResponse> {
    const response = await fetch(buildMarketCandlesUrl(request), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    return parseMarketCandlesResponse(await responseData(response));
  }

  async getTickLiquidity(
    request: MarketTickLiquidityRequest,
    signal: AbortSignal,
  ): Promise<MarketTickLiquidityResponse> {
    const response = await fetch(buildMarketTickLiquidityUrl(request), {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
    return parseMarketTickLiquidityResponse(await responseData(response));
  }
}
