import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  marketCandleBars,
  type ChainAccessMode,
  type EvmAddress,
  type LiquidityFlowFilter,
  type ManagedChainView,
  marketStreamKey,
  marketWindowMinutes,
  parseLiquidityProtocolFilter,
  type MarketPoolByTokenSort,
  type MarketCandleBar,
  type MarketProtocol,
  type MarketWindowMinutes,
  type SessionView,
} from "@lpbot/api-contract";
import {
  authorizeAccount,
  authorizeChainOperation,
  canAccessOwnedResource,
  chainOperationCategory,
  effectiveAllowedChainIds,
  roleCanAccess,
  trustedRoleForTier,
  type AccessLevel,
  type AccountAccessContext,
} from "@lpbot/domain";
import {
  hashSessionToken,
  TelegramAuthenticationError,
  WalletAuthenticationError,
  type LoginWalletAuthenticationApplication,
  type SessionStore,
  type StoredAccount,
  type StoredSession,
  type TelegramBotLoginApplication,
  type TelegramMiniAppAuthenticator,
} from "@lpbot/security";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { sessionCookieName, setBrowserSessionCookie } from "./browser-session-cookie.js";
import {
  addressRemarkChainId,
  AddressRemarkValidationError,
  canonicalAddressRemarkAddress,
  parseAddressRemarkPutRequest,
  type AddressRemarkAllowedAudit,
  type AddressRemarkAuditAction,
  type AddressRemarkStore,
} from "./address-remarks.js";
import {
  ChainPolicyStoreError,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyView,
} from "./chain-access-policies.js";
import type { LiquidityFlowProvider } from "./liquidity-flow.js";
import {
  MarketChartProviderError,
  type MarketCandleQuery,
  type MarketChartsProvider,
  type MarketTickLiquidityQuery,
} from "./market-charts.js";
import {
  createMarketPoolEligibility,
  filterEligibleMarketPoolRows,
  filterMarketPoolSnapshot,
  filterMarketStreamEnvelope,
  type MarketPoolsByTokenContext,
  type MarketPoolsProvider,
} from "./market-pools.js";
import {
  parsePoolBlocklistPatch,
  PoolBlocklistValidationError,
  type PoolBlocklistStore,
} from "./pool-blocklist.js";
import {
  createRecommendedPoolsEventStream,
  parseRecommendedPoolsCursor,
  type RecommendedPoolsScheduler,
  type RecommendedPoolsStreamEvent,
} from "./recommended-pools.js";
import type { ShellStatsProvider } from "./shell-stats.js";
import {
  defaultVersionedUserPreferences,
  parseUserPreferencesPatch,
  UserPreferencesValidationError,
  type UserPreferencesStore,
} from "./user-preferences.js";

export interface MaintenanceConfig {
  enabled: boolean;
  message: string | null;
  until: string | null;
}

export interface RegionPolicyResult {
  blocked: boolean;
  code: string | null;
  message: string | null;
}

export interface ApiAppOptions {
  addressRemarkRateLimit?: ChainManagementRateLimit;
  addressRemarkStore?: AddressRemarkStore;
  authRateLimits?: AuthRateLimits;
  chainActivityProvider?: ChainActivityProvider;
  chainManagementRateLimit?: ChainManagementRateLimit;
  chainPolicyStore?: ChainAccessPolicyStore;
  logger?: { write(line: string): void };
  liquidityFlowProvider?: LiquidityFlowProvider;
  liquidityFlowRateLimit?: PublicReadRateLimit;
  maintenance: MaintenanceConfig;
  marketChartsProvider?: MarketChartsProvider;
  marketChartsRateLimit?: PublicReadRateLimit;
  marketPoolsProvider?: MarketPoolsProvider;
  marketPoolsRateLimit?: PublicReadRateLimit;
  managementOrigin?: string;
  now?: () => Date;
  poolBlocklistRateLimit?: ChainManagementRateLimit;
  poolBlocklistStore?: PoolBlocklistStore;
  preferencesStore?: UserPreferencesStore;
  recommendedPoolsPollMilliseconds?: number;
  regionPolicy(request: FastifyRequest): RegionPolicyResult;
  sessionStore: SessionStore;
  statsHeartbeatMilliseconds?: number;
  statsProvider?: ShellStatsProvider;
  statsRateLimit?: PublicReadRateLimit;
  statsStreamScheduler?: RecommendedPoolsScheduler;
  telegramBot?: TelegramBotLoginApplication;
  telegramBotUsername?: string;
  telegramMiniApp?: TelegramMiniAppAuthenticator;
  testRoutes?: boolean;
  walletAuth?: LoginWalletAuthenticationApplication;
}

export interface ChainActivityProvider {
  getActivePositionCounts(chainIds: readonly number[]): Promise<ReadonlyMap<number, number>>;
}

export interface ChainManagementRateLimit {
  max: number;
  timeWindowMs: number;
}

export interface PublicReadRateLimit {
  max: number;
  timeWindowMs: number;
}

export interface AuthRateLimits {
  cancel: number;
  loginToken: number;
  miniApp: number;
  status: number;
  timeWindowMs: number;
  walletLogin?: number;
  walletLinks?: number;
  walletNonce?: number;
}

interface StatsStreamQuery {
  chain: "bsc" | null;
  limit: number;
  userId: string | null;
}

function parseStatsStreamQuery(request: FastifyRequest): StatsStreamQuery | null {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== "chain" && key !== "limit" && key !== "user_id")) {
    return null;
  }
  const chain = query.chain === undefined ? null : query.chain;
  if (chain !== null && chain !== "bsc") return null;
  const rawLimit = query.limit === undefined ? "3" : query.limit;
  if (typeof rawLimit !== "string" || !/^(?:[1-9]|1[0-9]|20)$/u.test(rawLimit)) return null;
  const userId = query.user_id === undefined ? null : query.user_id;
  if (userId !== null && (typeof userId !== "string" || userId.length < 1 || userId.length > 128)) {
    return null;
  }
  return { chain, limit: Number(rawLimit), userId };
}

function parseMarketPoolsContext(request: FastifyRequest): {
  chainId: 56;
  minutes: MarketWindowMinutes;
  protocols: ReturnType<typeof parseLiquidityProtocolFilter>;
} | null {
  const parameters = request.params as { minutes?: unknown };
  const query = request.query as { chainId?: unknown; dex?: unknown };
  if (Object.keys(query).some((key) => key !== "chainId" && key !== "dex")) return null;
  if (typeof parameters.minutes !== "string" || typeof query.chainId !== "string") return null;
  if (!/^(?:1|5|15|30|60)$/u.test(parameters.minutes) || query.chainId !== "56") return null;
  const minutes = Number(parameters.minutes) as MarketWindowMinutes;
  if (!marketWindowMinutes.includes(minutes)) return null;
  try {
    return { chainId: 56, minutes, protocols: parseLiquidityProtocolFilter(query.dex) };
  } catch {
    return null;
  }
}

function parseMarketPoolsByTokenContext(request: FastifyRequest): MarketPoolsByTokenContext | null {
  const parameters = request.params as { address?: unknown };
  const query = request.query as Record<string, unknown>;
  const allowed = new Set(["chain", "dex", "limit", "sort"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (
    typeof parameters.address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/u.test(parameters.address) ||
    query.chain !== "bsc" ||
    typeof query.dex !== "string"
  ) {
    return null;
  }
  const limitValue = query.limit ?? "100";
  if (typeof limitValue !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    return null;
  }
  const sort = query.sort ?? "fees";
  if (sort !== "fees" && sort !== "volume") return null;
  try {
    return {
      address: parameters.address.toLowerCase() as `0x${string}`,
      chainId: 56,
      limit: Number(limitValue),
      protocols: parseLiquidityProtocolFilter(query.dex),
      sort: sort as MarketPoolByTokenSort,
    };
  } catch {
    return null;
  }
}

function parseMarketCandleQuery(request: FastifyRequest): MarketCandleQuery | null {
  const query = request.query as Record<string, unknown>;
  const allowed = new Set(["bar", "chainId", "limit", "poolKey", "token"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (
    typeof query.token !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/u.test(query.token) ||
    typeof query.bar !== "string" ||
    !marketCandleBars.includes(query.bar as MarketCandleBar) ||
    query.chainId !== "56"
  ) {
    return null;
  }
  const limitValue = query.limit ?? "200";
  if (typeof limitValue !== "string" || !/^(?:[1-9]|[1-9][0-9]{1,2}|1000)$/u.test(limitValue)) {
    return null;
  }
  const rawPoolKey = query.poolKey ?? null;
  if (
    rawPoolKey !== null &&
    (typeof rawPoolKey !== "string" ||
      !/^56:0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u.test(rawPoolKey))
  ) {
    return null;
  }
  return {
    bar: query.bar as MarketCandleBar,
    chainId: 56,
    limit: Number(limitValue),
    poolKey: rawPoolKey?.toLowerCase() ?? null,
    token: query.token.toLowerCase() as EvmAddress,
  };
}

function parseMarketTickLiquidityQuery(request: FastifyRequest): MarketTickLiquidityQuery | null {
  const parameters = request.params as { poolAddressOrPoolId?: unknown };
  const query = request.query as Record<string, unknown>;
  const allowed = new Set(["chain", "decimals0", "decimals1", "dex", "range", "tickSpacing"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (
    typeof parameters.poolAddressOrPoolId !== "string" ||
    !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u.test(parameters.poolAddressOrPoolId) ||
    query.chain !== "bsc" ||
    typeof query.dex !== "string" ||
    !(["pcsv3", "univ3", "pcsv4", "univ4"] as const).includes(query.dex as MarketProtocol) ||
    typeof query.range !== "string" ||
    !/^(?:[5-9]|[1-4][0-9]|50)$/u.test(query.range) ||
    typeof query.tickSpacing !== "string" ||
    !/^[1-9][0-9]*$/u.test(query.tickSpacing)
  ) {
    return null;
  }
  const tickSpacing = Number(query.tickSpacing);
  if (!Number.isSafeInteger(tickSpacing)) return null;
  const hasDecimals0 = query.decimals0 !== undefined;
  const hasDecimals1 = query.decimals1 !== undefined;
  if (hasDecimals0 !== hasDecimals1) return null;
  let decimals0: number | null = null;
  let decimals1: number | null = null;
  if (hasDecimals0 && hasDecimals1) {
    if (
      typeof query.decimals0 !== "string" ||
      typeof query.decimals1 !== "string" ||
      !/^(?:0|[1-9][0-9]{0,2})$/u.test(query.decimals0) ||
      !/^(?:0|[1-9][0-9]{0,2})$/u.test(query.decimals1)
    ) {
      return null;
    }
    decimals0 = Number(query.decimals0);
    decimals1 = Number(query.decimals1);
    if (decimals0 > 255 || decimals1 > 255) return null;
  }
  return {
    chainId: 56,
    decimals0,
    decimals1,
    identity: parameters.poolAddressOrPoolId.toLowerCase() as `0x${string}`,
    protocol: query.dex as MarketProtocol,
    range: Number(query.range),
    tickSpacing,
  };
}

function parseLiquidityFlowFilter(request: FastifyRequest): LiquidityFlowFilter | null {
  const query = request.query as Record<string, unknown>;
  const allowed = new Set(["since", "pool", "token", "user", "nft_id"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (typeof query.since !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(query.since)) {
    return null;
  }
  const since = Number(query.since);
  if (!Number.isSafeInteger(since)) return null;
  const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
  const poolPattern = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u;
  const optional = (value: unknown, pattern: RegExp): string | null | undefined => {
    if (value === undefined) return null;
    if (typeof value !== "string" || !pattern.test(value)) return undefined;
    return value.toLowerCase();
  };
  const pool = optional(query.pool, poolPattern);
  const token = optional(query.token, addressPattern);
  const user = optional(query.user, addressPattern);
  const nftId = optional(query.nft_id, /^(?:0|[1-9][0-9]*)$/u);
  if (pool === undefined || token === undefined || user === undefined || nftId === undefined) {
    return null;
  }
  return {
    nftId,
    pool: pool as EvmAddress | `0x${string}` | null,
    since,
    token: token as EvmAddress | null,
    user: user as EvmAddress | null,
  };
}

async function writeSseChunk(
  reply: FastifyReply,
  controller: AbortController,
  chunk: string,
): Promise<boolean> {
  if (controller.signal.aborted || reply.raw.destroyed) return false;
  if (reply.raw.writableLength > 1_048_576) {
    controller.abort(new Error("LIQUIDITY_FLOW_CLIENT_TOO_SLOW"));
    return false;
  }
  if (reply.raw.write(chunk)) return true;
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      reply.raw.off("close", onClose);
      reply.raw.off("drain", onDrain);
    };
    const onClose = () => {
      cleanup();
      controller.abort();
      resolve(false);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    reply.raw.once("close", onClose);
    reply.raw.once("drain", onDrain);
  });
}

class AuthenticationRateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly statusCode: number;

  constructor(statusCode: number) {
    super("Too many authentication requests");
    this.name = "AuthenticationRateLimitError";
    this.statusCode = statusCode;
  }
}

interface RateLimitCounter {
  current: number;
  resetAt: number;
}

const rateLimitCacheCapacity = 5_000;

class AtomicMemoryRateLimitStore {
  readonly #counters = new Map<string, RateLimitCounter>();

  child(): AtomicMemoryRateLimitStore {
    return new AtomicMemoryRateLimitStore();
  }

  incr(
    key: string,
    callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
    timeWindow: number,
  ): void {
    const currentTime = Date.now();
    const existing = this.#counters.get(key);
    if (!existing && this.#counters.size >= rateLimitCacheCapacity) {
      for (const [storedKey, storedCounter] of this.#counters) {
        if (storedCounter.resetAt <= currentTime) this.#counters.delete(storedKey);
      }
      if (this.#counters.size >= rateLimitCacheCapacity) {
        const oldestKey = this.#counters.keys().next().value;
        if (oldestKey !== undefined) this.#counters.delete(oldestKey);
      }
    }
    const counter =
      !existing || existing.resetAt <= currentTime
        ? { current: 1, resetAt: currentTime + timeWindow }
        : { current: existing.current + 1, resetAt: existing.resetAt };

    this.#counters.set(key, counter);
    callback(null, {
      current: counter.current,
      ttl: Math.max(0, counter.resetAt - currentTime),
    });
  }
}

class FixedWindowRateLimiter {
  readonly #counters = new Map<string, RateLimitCounter>();

  consume(key: string, max: number, timeWindowMs: number, currentTime: number): boolean {
    const existing = this.#counters.get(key);
    if (!existing && this.#counters.size >= rateLimitCacheCapacity) {
      for (const [storedKey, counter] of this.#counters) {
        if (counter.resetAt <= currentTime) this.#counters.delete(storedKey);
      }
      if (this.#counters.size >= rateLimitCacheCapacity) {
        const oldestKey = this.#counters.keys().next().value;
        if (oldestKey !== undefined) this.#counters.delete(oldestKey);
      }
    }
    const counter =
      !existing || existing.resetAt <= currentTime
        ? { current: 1, resetAt: currentTime + timeWindowMs }
        : { current: existing.current + 1, resetAt: existing.resetAt };
    this.#counters.set(key, counter);
    return counter.current <= max;
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  return match?.[1] ?? null;
}

function sessionToken(request: FastifyRequest): string | null {
  return request.cookies[sessionCookieName] ?? bearerToken(request.headers.authorization);
}

async function findValidSession(
  token: string,
  store: SessionStore,
  now: Date,
): Promise<{ session: StoredSession; tokenHash: string } | null> {
  const tokenHash = hashSessionToken(token);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
  return { session, tokenHash };
}

async function accountToSessionView(
  account: StoredAccount,
  maintenanceBypass: boolean,
  chainPolicyStore: ChainAccessPolicyStore | undefined,
): Promise<SessionView> {
  let policies: ChainAccessPolicyView[];
  try {
    policies = (await chainPolicyStore?.list()) ?? [];
  } catch {
    policies = [];
  }
  return {
    allowedChainIds: effectiveAllowedChainIds(policies, account.role, account.tier),
    avatarUrl: account.avatarUrl,
    displayName: account.displayName,
    maintenanceBypass,
    role: account.role,
    tier: account.tier,
    userId: account.id,
  };
}

function toSessionView(
  session: StoredSession,
  maintenanceBypass: boolean,
  chainPolicyStore: ChainAccessPolicyStore | undefined,
): Promise<SessionView> {
  return accountToSessionView(session.account, maintenanceBypass, chainPolicyStore);
}

const telegramAuthenticationMessages: Readonly<
  Record<TelegramAuthenticationError["code"], string>
> = {
  AUTH_DUPLICATE_FIELD: "Telegram authentication data contains a repeated field",
  AUTH_EXPIRED: "Telegram authentication data has expired",
  AUTH_FUTURE: "Telegram authentication data has an invalid timestamp",
  AUTH_INVALID: "Telegram authentication data is invalid",
  AUTH_REPLAYED: "Telegram authentication data was already used",
};

function isTelegramAuthenticationError(error: unknown): error is TelegramAuthenticationError {
  if (!(error instanceof Error) || error.name !== "TelegramAuthenticationError") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && Object.hasOwn(telegramAuthenticationMessages, code);
}

function isWalletAuthenticationError(error: unknown): error is WalletAuthenticationError {
  return error instanceof Error && error.name === "WalletAuthenticationError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function parseChainAccessUpdateBody(value: unknown) {
  if (!isPlainRecord(value)) throw new ChainPolicyStoreError("CONFIG_INVALID");
  const topLevelKeys = Object.keys(value).sort();
  if (
    topLevelKeys.length !== 3 ||
    topLevelKeys[0] !== "access" ||
    topLevelKeys[1] !== "expectedRevision" ||
    topLevelKeys[2] !== "reason" ||
    !isPlainRecord(value.access) ||
    !isPlainRecord(value.expectedRevision) ||
    typeof value.reason !== "string" ||
    value.reason.trim() === "" ||
    value.reason.length > 500
  ) {
    throw new ChainPolicyStoreError("CONFIG_INVALID");
  }

  const accessValues = value.access as Record<string, unknown>;
  const revisionValues = value.expectedRevision as Record<string, unknown>;
  const accessKeys = Object.keys(accessValues).sort();
  const revisionKeys = Object.keys(revisionValues).sort();
  if (
    accessKeys.length === 0 ||
    accessKeys.length !== revisionKeys.length ||
    accessKeys.some((key, index) => key !== revisionKeys[index])
  ) {
    throw new ChainPolicyStoreError("CONFIG_INVALID");
  }

  const changes = accessKeys.map((key) => {
    if (!/^[1-9][0-9]*$/u.test(key)) throw new ChainPolicyStoreError("CONFIG_INVALID");
    const chainId = Number(key);
    const access = accessValues[key];
    const expectedRevision = revisionValues[key];
    if (
      !Number.isSafeInteger(chainId) ||
      (access !== "off" && access !== "pro" && access !== "all") ||
      !Number.isSafeInteger(expectedRevision) ||
      (expectedRevision as number) < 0
    ) {
      throw new ChainPolicyStoreError("CONFIG_INVALID");
    }
    return {
      access: access as ChainAccessMode,
      chainId,
      expectedRevision: expectedRevision as number,
    };
  });

  return { changes, reason: value.reason.trim() };
}

function chainPolicyErrorStatus(code: ChainPolicyStoreError["code"]): 400 | 404 | 409 {
  if (code === "CHAIN_UNKNOWN") return 404;
  if (code === "CONFIG_INVALID") return 400;
  return 409;
}

function chainPolicyErrorMessage(code: ChainPolicyStoreError["code"]): string {
  const messages: Record<ChainPolicyStoreError["code"], string> = {
    CHAIN_NOT_READY: "The chain configuration is incomplete",
    CHAIN_UNKNOWN: "The chain is not registered",
    CONFIG_CONFLICT: "Chain configuration changed in another session",
    CONFIG_INVALID: "Chain configuration request is invalid",
    DEFAULT_CHAIN_REQUIRED: "The default chain must remain available",
  };
  return messages[code];
}

function walletErrorStatus(code: WalletAuthenticationError["code"]): 400 | 401 | 404 | 409 | 410 {
  if (code === "NONCE_REPLAYED") return 409;
  if (code === "ADDRESS_ALREADY_LINKED" || code === "LAST_LOGIN_METHOD") return 409;
  if (code === "NONCE_EXPIRED") return 410;
  if (code === "SIGNATURE_INVALID") return 401;
  if (code === "LINK_NOT_FOUND") return 404;
  return 400;
}

function walletErrorMessage(code: WalletAuthenticationError["code"]): string {
  const messages: Record<WalletAuthenticationError["code"], string> = {
    ADDRESS_ALREADY_LINKED: "Wallet address is already linked",
    ADDRESS_INVALID: "Wallet address is invalid",
    CHAIN_INVALID: "Wallet chain ID is invalid",
    LABEL_INVALID: "Login wallet label is invalid",
    LAST_LOGIN_METHOD: "At least one login method must remain linked",
    LINK_NOT_FOUND: "Login wallet link was not found",
    NONCE_EXPIRED: "Wallet challenge has expired",
    NONCE_INVALID: "Wallet challenge is invalid",
    NONCE_MISMATCH: "Wallet challenge does not match the request",
    NONCE_REPLAYED: "Wallet challenge was already used",
    SIGNATURE_INVALID: "Wallet signature is invalid",
  };
  return messages[code];
}

function marketChartErrorStatus(code: MarketChartProviderError["code"]): number {
  if (code === "MARKET_POOL_NOT_FOUND") return 404;
  if (code === "AMBIGUOUS_POOL" || code === "TICK_SPACING_MISMATCH") return 409;
  return 400;
}

function marketChartErrorMessage(code: MarketChartProviderError["code"]): string {
  const messages: Record<MarketChartProviderError["code"], string> = {
    AMBIGUOUS_POOL: "Token resolves to multiple pools; poolKey is required",
    MARKET_POOL_NOT_FOUND: "The requested canonical pool is unknown",
    TICK_SPACING_MISMATCH: "tickSpacing does not match the canonical pool catalog",
    TOKEN_NOT_IN_POOL: "Token does not belong to the requested pool",
  };
  return messages[code];
}

const telegramBotUsernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;

function telegramBotConfigured(options: ApiAppOptions): options is ApiAppOptions & {
  telegramBot: TelegramBotLoginApplication;
  telegramBotUsername: string;
} {
  return (
    options.telegramBot !== undefined &&
    typeof options.telegramBotUsername === "string" &&
    telegramBotUsernamePattern.test(options.telegramBotUsername)
  );
}

export function buildApiApp(options: ApiAppOptions): FastifyInstance {
  const now = options.now ?? (() => new Date());
  const addressRemarkRateLimit: ChainManagementRateLimit = {
    max: 30,
    timeWindowMs: 60_000,
    ...options.addressRemarkRateLimit,
  };
  if (
    !Number.isSafeInteger(addressRemarkRateLimit.max) ||
    addressRemarkRateLimit.max <= 0 ||
    !Number.isSafeInteger(addressRemarkRateLimit.timeWindowMs) ||
    addressRemarkRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Address remark rate limits must be positive integers");
  }
  const addressRemarkLimiter = new FixedWindowRateLimiter();
  const poolBlocklistRateLimit: ChainManagementRateLimit = {
    max: 30,
    timeWindowMs: 60_000,
    ...options.poolBlocklistRateLimit,
  };
  if (
    !Number.isSafeInteger(poolBlocklistRateLimit.max) ||
    poolBlocklistRateLimit.max <= 0 ||
    !Number.isSafeInteger(poolBlocklistRateLimit.timeWindowMs) ||
    poolBlocklistRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Pool blocklist rate limits must be positive integers");
  }
  const poolBlocklistLimiter = new FixedWindowRateLimiter();
  const chainManagementRateLimit: ChainManagementRateLimit = {
    max: 10,
    timeWindowMs: 60_000,
    ...options.chainManagementRateLimit,
  };
  if (
    !Number.isSafeInteger(chainManagementRateLimit.max) ||
    chainManagementRateLimit.max <= 0 ||
    !Number.isSafeInteger(chainManagementRateLimit.timeWindowMs) ||
    chainManagementRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Chain management rate limits must be positive integers");
  }
  const chainManagementLimiter = new FixedWindowRateLimiter();
  const liquidityFlowRateLimit: PublicReadRateLimit = {
    max: 60,
    timeWindowMs: 60_000,
    ...options.liquidityFlowRateLimit,
  };
  if (
    !Number.isSafeInteger(liquidityFlowRateLimit.max) ||
    liquidityFlowRateLimit.max <= 0 ||
    !Number.isSafeInteger(liquidityFlowRateLimit.timeWindowMs) ||
    liquidityFlowRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Liquidity flow rate limits must be positive integers");
  }
  const marketChartsRateLimit: PublicReadRateLimit = {
    max: 60,
    timeWindowMs: 60_000,
    ...options.marketChartsRateLimit,
  };
  if (
    !Number.isSafeInteger(marketChartsRateLimit.max) ||
    marketChartsRateLimit.max <= 0 ||
    !Number.isSafeInteger(marketChartsRateLimit.timeWindowMs) ||
    marketChartsRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Market chart rate limits must be positive integers");
  }
  const marketPoolsRateLimit: PublicReadRateLimit = {
    max: 60,
    timeWindowMs: 60_000,
    ...options.marketPoolsRateLimit,
  };
  if (
    !Number.isSafeInteger(marketPoolsRateLimit.max) ||
    marketPoolsRateLimit.max <= 0 ||
    !Number.isSafeInteger(marketPoolsRateLimit.timeWindowMs) ||
    marketPoolsRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Market pool rate limits must be positive integers");
  }
  const statsRateLimit: PublicReadRateLimit = {
    max: 60,
    timeWindowMs: 60_000,
    ...options.statsRateLimit,
  };
  if (
    !Number.isSafeInteger(statsRateLimit.max) ||
    statsRateLimit.max <= 0 ||
    !Number.isSafeInteger(statsRateLimit.timeWindowMs) ||
    statsRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Stats rate limits must be positive integers");
  }
  const authRateLimits: Required<AuthRateLimits> = {
    cancel: 20,
    loginToken: 5,
    miniApp: 120,
    status: 120,
    timeWindowMs: 60_000,
    walletLogin: 10,
    walletLinks: 30,
    walletNonce: 10,
    ...options.authRateLimits,
  };
  for (const value of Object.values(authRateLimits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError("Authentication rate limits must be positive integers");
    }
  }
  const app = Fastify({
    logger: false,
  });

  void app.register(cookie);
  void app.register(rateLimit, {
    errorResponseBuilder(_request, context) {
      return new AuthenticationRateLimitError(context.statusCode);
    },
    global: false,
    store: AtomicMemoryRateLimitStore,
  });

  app.addHook("onResponse", (request, reply, done) => {
    options.logger?.write(
      JSON.stringify({
        event: "http.response",
        method: request.method,
        requestId: request.id,
        statusCode: reply.statusCode,
      }),
    );
    done();
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(
      createErrorEnvelope({
        code: "NOT_FOUND",
        message: "The requested endpoint does not exist",
        requestId: request.id,
        retryable: false,
      }),
    ),
  );

  app.setErrorHandler(async (error, request, reply) => {
    const errorCode = (error as { code?: unknown }).code;
    if (
      errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" &&
      request.method === "PATCH" &&
      request.url.split("?", 1)[0] === "/api/user/pool-blocklist"
    ) {
      reply.header("Cache-Control", "no-store");
      return reply.code(413).send(
        createErrorEnvelope({
          code: "REQUEST_TOO_LARGE",
          message: "The request body is too large",
          requestId: request.id,
          retryable: false,
        }),
      );
    }
    if (
      errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" &&
      request.method === "PUT" &&
      request.url.split("?", 1)[0] === "/api/address-remarks"
    ) {
      reply.header("Cache-Control", "no-store");
      const token = sessionToken(request);
      const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
      if (resolved) {
        await options.addressRemarkStore?.recordDenied({
          action: "address-remark.put",
          actorUserId: resolved.session.userId,
          address: null,
          chainId: addressRemarkChainId,
          createdAt: now(),
          outcome: "denied",
          requestId: request.id,
          resultCode: "REQUEST_TOO_LARGE",
          sessionId: resolved.session.id,
        });
      }
      return reply.code(413).send(
        createErrorEnvelope({
          code: "REQUEST_TOO_LARGE",
          message: "The request body is too large",
          requestId: request.id,
          retryable: false,
        }),
      );
    }
    if (
      errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" &&
      request.url.split("?", 1)[0] === "/api/system-config/chains"
    ) {
      reply.header("Cache-Control", "no-store");
      const token = sessionToken(request);
      const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
      await options.chainPolicyStore?.recordManagementAudit({
        actorUserId: resolved?.session.userId ?? null,
        createdAt: now(),
        outcome: "denied",
        reason: null,
        requestId: request.id,
        resultCode: "REQUEST_TOO_LARGE",
        sessionId: resolved?.session.id ?? null,
      });
      return reply.code(413).send(
        createErrorEnvelope({
          code: "REQUEST_TOO_LARGE",
          message: "The request body is too large",
          requestId: request.id,
          retryable: false,
        }),
      );
    }

    if (error instanceof AuthenticationRateLimitError) {
      return reply.code(error.statusCode).send(
        createErrorEnvelope({
          code: error.code,
          message: error.message,
          requestId: request.id,
          retryable: true,
        }),
      );
    }

    return reply.code(500).send(
      createErrorEnvelope({
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
        requestId: request.id,
        retryable: true,
      }),
    );
  });

  const authenticateSessionRequest = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<StoredSession | null> => {
    const token = sessionToken(request);
    const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
    if (!resolved) {
      await options.sessionStore.recordAccessAudit({
        action: "session.access",
        createdAt: now(),
        outcome: "denied",
        requestId: request.id,
        sessionId: null,
        userId: null,
      });
      reply.code(401).send(
        createErrorEnvelope({
          code: token ? "AUTH_EXPIRED" : "UNAUTHENTICATED",
          message: token ? "Session is invalid or expired" : "Authentication is required",
          requestId: request.id,
          retryable: false,
        }),
      );
      return null;
    }

    const decision = authorizeAccount({
      accountStatus: resolved.session.account.status,
      maintenance: options.maintenance,
      region: options.regionPolicy(request),
      role: resolved.session.account.role,
    });
    if (!decision.allowed) {
      await options.sessionStore.recordAccessAudit({
        action: "session.access",
        createdAt: now(),
        outcome: "denied",
        requestId: request.id,
        sessionId: resolved.session.id,
        userId: resolved.session.userId,
      });
      reply.code(decision.statusCode).send(
        createErrorEnvelope({
          code: decision.code,
          message: decision.message,
          requestId: request.id,
          retryable: decision.retryable,
        }),
      );
      return null;
    }

    const accessedAt = now();
    await options.sessionStore.touchSession(resolved.tokenHash, accessedAt);
    await options.sessionStore.recordAccessAudit({
      action: "session.access",
      createdAt: accessedAt,
      outcome: "allowed",
      requestId: request.id,
      sessionId: resolved.session.id,
      userId: resolved.session.userId,
    });
    return resolved.session;
  };

  const poolEligibility = async (userId: string) =>
    options.poolBlocklistStore
      ? createMarketPoolEligibility(await options.poolBlocklistStore.get(userId))
      : undefined;

  const recordDeniedChainManagement = async (
    request: FastifyRequest,
    session: StoredSession | null,
    resultCode: string,
    reason: string | null = null,
  ) => {
    await options.chainPolicyStore?.recordManagementAudit({
      actorUserId: session?.userId ?? null,
      createdAt: now(),
      outcome: "denied",
      reason,
      requestId: request.id,
      resultCode,
      sessionId: session?.id ?? null,
    });
  };

  const addressRemarkAudit = (
    action: AddressRemarkAuditAction,
    address: ReturnType<typeof canonicalAddressRemarkAddress> | null,
    request: FastifyRequest,
    session: StoredSession,
  ): AddressRemarkAllowedAudit => ({
    action,
    actorUserId: session.userId,
    address,
    chainId: addressRemarkChainId,
    createdAt: now(),
    requestId: request.id,
    sessionId: session.id,
  });

  const recordDeniedAddressRemark = async (
    audit: AddressRemarkAllowedAudit,
    resultCode: string,
  ) => {
    await options.addressRemarkStore?.recordDenied({
      ...audit,
      outcome: "denied",
      resultCode,
    });
  };

  const managedChainViews = async (
    policies: readonly ChainAccessPolicyView[],
  ): Promise<ManagedChainView[]> => {
    let counts: ReadonlyMap<number, number> = new Map();
    if (options.chainActivityProvider) {
      try {
        counts = await options.chainActivityProvider.getActivePositionCounts(
          policies.map(({ chainId }) => chainId),
        );
      } catch {
        counts = new Map();
      }
    }
    return policies.map((policy) => ({
      ...policy,
      activePositionCount: counts.get(policy.chainId) ?? null,
      missingConfiguration: [...policy.missingConfiguration],
    }));
  };

  app.after(() => {
    app.get("/api/system-config/chains", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.chainPolicyStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CHAIN_CONFIG_UNAVAILABLE",
            message: "Chain configuration is not available",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      const policies = await options.chainPolicyStore.list();
      const trustedRole = trustedRoleForTier(session.account.role, session.account.tier);
      if (trustedRole === "admin") {
        return createSuccessEnvelope({ chains: await managedChainViews(policies) }, request.id);
      }
      const allowedChainIds = new Set(
        effectiveAllowedChainIds(policies, session.account.role, session.account.tier),
      );
      return createSuccessEnvelope(
        {
          chains: policies
            .filter(({ chainId }) => allowedChainIds.has(chainId))
            .map(({ chainId, displayName }) => ({ chainId, displayName })),
        },
        request.id,
      );
    });

    app.post("/api/system-config/chains", { bodyLimit: 4_096 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const presentedToken = sessionToken(request);
      const session = await authenticateSessionRequest(request, reply);
      if (!session) {
        await recordDeniedChainManagement(
          request,
          null,
          presentedToken ? "AUTH_EXPIRED" : "UNAUTHENTICATED",
        );
        return reply;
      }
      if (
        trustedRoleForTier(session.account.role, session.account.tier) !== "admin" ||
        !roleCanAccess(session.account.role, "admin")
      ) {
        await recordDeniedChainManagement(request, session, "FORBIDDEN");
        return reply.code(403).send(
          createErrorEnvelope({
            code: "FORBIDDEN",
            message: "Administrator access is required",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const expectedOrigin =
        options.managementOrigin ?? `http://${request.headers.host ?? "localhost"}`;
      if (request.headers.origin !== expectedOrigin) {
        await recordDeniedChainManagement(request, session, "CSRF_INVALID");
        return reply.code(403).send(
          createErrorEnvelope({
            code: "CSRF_INVALID",
            message: "The management request origin is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.chainPolicyStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CHAIN_CONFIG_UNAVAILABLE",
            message: "Chain configuration is not available",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      let parsed: ReturnType<typeof parseChainAccessUpdateBody>;
      try {
        parsed = parseChainAccessUpdateBody(request.body);
      } catch (error) {
        if (!(error instanceof ChainPolicyStoreError)) throw error;
        await recordDeniedChainManagement(request, session, error.code);
        return reply.code(chainPolicyErrorStatus(error.code)).send(
          createErrorEnvelope({
            code: error.code,
            message: chainPolicyErrorMessage(error.code),
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      if (
        !chainManagementLimiter.consume(
          session.id,
          chainManagementRateLimit.max,
          chainManagementRateLimit.timeWindowMs,
          now().getTime(),
        )
      ) {
        await recordDeniedChainManagement(request, session, "RATE_LIMITED", parsed.reason);
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many chain configuration requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      try {
        const result = await options.chainPolicyStore.update({
          actorUserId: session.userId,
          changes: parsed.changes,
          reason: parsed.reason,
          requestId: request.id,
          sessionId: session.id,
          updatedAt: now(),
        });
        return createSuccessEnvelope(
          { chains: await managedChainViews(result.policies), status: result.status },
          request.id,
        );
      } catch (error) {
        if (!(error instanceof ChainPolicyStoreError)) {
          await recordDeniedChainManagement(request, session, "INTERNAL_ERROR", parsed.reason);
          throw error;
        }
        await recordDeniedChainManagement(request, session, error.code, parsed.reason);
        return reply.code(chainPolicyErrorStatus(error.code)).send(
          createErrorEnvelope({
            code: error.code,
            message: chainPolicyErrorMessage(error.code),
            requestId: request.id,
            retryable: error.code === "CONFIG_CONFLICT",
          }),
        );
      }
    });

    if (options.testRoutes) {
      app.post("/api/test/chain-access", async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.chainPolicyStore) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_CONFIG_UNAVAILABLE",
              message: "Chain configuration is not available",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        if (
          !isPlainRecord(request.body) ||
          Object.keys(request.body).sort().join(",") !== "action,chainId,ownerUserId" ||
          typeof request.body.action !== "string" ||
          !Number.isSafeInteger(request.body.chainId) ||
          typeof request.body.ownerUserId !== "string"
        ) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "The chain operation is not authorized",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const action = request.body.action as string;
        const chainId = request.body.chainId as number;
        const ownerUserId = request.body.ownerUserId as string;
        const policies = await options.chainPolicyStore.list();
        const policy = policies.find((candidate) => candidate.chainId === chainId);
        if (!policy) {
          return reply.code(404).send(
            createErrorEnvelope({
              code: "CHAIN_UNKNOWN",
              message: "The chain is not registered",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        const operation = chainOperationCategory(action);
        if (
          !operation ||
          !canAccessOwnedResource(session.userId, ownerUserId, session.account.role, false)
        ) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "The chain operation is not authorized",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const decision = authorizeChainOperation({
          access: policy.access,
          operation,
          role: session.account.role,
          tier: session.account.tier,
        });
        if (!decision.allowed) {
          const code = decision.code === "CHAIN_ACCESS_DENIED" ? "FORBIDDEN" : decision.code;
          return reply.code(403).send(
            createErrorEnvelope({
              code,
              message:
                code === "CHAIN_PRO_REQUIRED"
                  ? "Pro access is required for new exposure on this chain"
                  : code === "CHAIN_CREATION_DISABLED"
                    ? "New exposure is disabled for this chain"
                    : "The chain operation is not authorized",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        return createSuccessEnvelope({ authorized: true, operation }, request.id);
      });
    }

    app.get(
      "/api/liquidity-adds/stream",
      {
        config: {
          rateLimit: {
            max: liquidityFlowRateLimit.max,
            timeWindow: liquidityFlowRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const filter = parseLiquidityFlowFilter(request);
        if (!filter) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "LIQUIDITY_FLOW_QUERY_INVALID",
              message: "Liquidity flow filters are invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.liquidityFlowProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "LIQUIDITY_FLOW_UNAVAILABLE",
              message: "Liquidity flow data is not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }

        const controller = new AbortController();
        reply.hijack();
        reply.raw.writeHead(200, {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        });
        reply.raw.flushHeaders?.();
        reply.raw.once("close", () => controller.abort());
        reply.raw.once("error", () => controller.abort());
        await writeSseChunk(reply, controller, "retry: 3000\n\n");

        const lastEventHeader = request.headers["last-event-id"];
        const lastEventId =
          typeof lastEventHeader === "string" && lastEventHeader.length <= 256
            ? lastEventHeader
            : null;
        try {
          for await (const envelope of options.liquidityFlowProvider.subscribe({
            ...filter,
            lastEventId,
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) break;
            if (envelope.eventType === "heartbeat") {
              if (
                !(await writeSseChunk(reply, controller, `: heartbeat ${envelope.emittedAt}\n\n`))
              ) {
                break;
              }
              continue;
            }
            const wireEvent =
              envelope.eventType === "liquidity.backfill" ? "backfill" : "liquidity-add";
            const chunk =
              `id: ${envelope.cursor}\n` +
              `event: ${wireEvent}\n` +
              `data: ${JSON.stringify(envelope.data)}\n\n`;
            if (!(await writeSseChunk(reply, controller, chunk))) break;
          }
        } finally {
          controller.abort();
          if (!reply.raw.destroyed) reply.raw.end();
        }
        return reply;
      },
    );

    app.get(
      "/api/market/candles",
      {
        config: {
          rateLimit: {
            keyGenerator: (request: FastifyRequest) => sessionToken(request) ?? request.ip,
            max: marketChartsRateLimit.max,
            timeWindow: marketChartsRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseMarketCandleQuery(request);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "MARKET_CANDLE_QUERY_INVALID",
              message: "Candle token, poolKey, bar, limit, or BSC chain is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.marketChartsProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "MARKET_CHARTS_UNAVAILABLE",
              message: "Canonical chart data is not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const result = await options.marketChartsProvider.getCandles(query);
          return createSuccessEnvelope(result, request.id);
        } catch (error) {
          if (!(error instanceof MarketChartProviderError)) throw error;
          return reply.code(marketChartErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: marketChartErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.get(
      "/api/pools/liquidity/:poolAddressOrPoolId",
      {
        config: {
          rateLimit: {
            keyGenerator: (request: FastifyRequest) => sessionToken(request) ?? request.ip,
            max: marketChartsRateLimit.max,
            timeWindow: marketChartsRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseMarketTickLiquidityQuery(request);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "MARKET_LIQUIDITY_QUERY_INVALID",
              message: "Liquidity pool, range, BSC chain, DEX, spacing, or decimals are invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.marketChartsProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "MARKET_CHARTS_UNAVAILABLE",
              message: "Canonical chart data is not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const result = await options.marketChartsProvider.getTickLiquidity(query);
          return createSuccessEnvelope(result, request.id);
        } catch (error) {
          if (!(error instanceof MarketChartProviderError)) throw error;
          return reply.code(marketChartErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: marketChartErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.get(
      "/api/pools/by-token/:address",
      {
        config: {
          rateLimit: {
            keyGenerator: (request: FastifyRequest) => sessionToken(request) ?? request.ip,
            max: marketPoolsRateLimit.max,
            timeWindow: marketPoolsRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!roleCanAccess(session.account.role, "authenticated")) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "Pool search is not authorized",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        const context = parseMarketPoolsByTokenContext(request);
        if (!context) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "MARKET_TOKEN_QUERY_INVALID",
              message: "Token, BSC chain, DEX, limit, or sort is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.marketPoolsProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "MARKET_DATA_UNAVAILABLE",
              message: "Market data is not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        const eligibility = await poolEligibility(session.userId);
        const rows = await options.marketPoolsProvider.getByToken({
          ...context,
          ...(eligibility ? { eligibility } : {}),
        });
        return createSuccessEnvelope(
          filterEligibleMarketPoolRows(rows, eligibility).slice(0, context.limit),
          request.id,
        );
      },
    );

    app.get("/api/pools/top-fees/:minutes", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      const context = parseMarketPoolsContext(request);
      if (!context) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "MARKET_QUERY_INVALID",
            message: "Window must be 1, 5, 15, 30, or 60 minutes and chainId must be 56",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.marketPoolsProvider) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "MARKET_DATA_UNAVAILABLE",
            message: "Market data is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const eligibility = await poolEligibility(session.userId);
      const snapshot = await options.marketPoolsProvider.getTopFees({
        ...context,
        ...(eligibility ? { eligibility } : {}),
      });
      return createSuccessEnvelope(filterMarketPoolSnapshot(snapshot, eligibility), request.id);
    });

    app.get("/api/pools/top-fees/:minutes/stream", async (request, reply) => {
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      const context = parseMarketPoolsContext(request);
      if (!context) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "MARKET_QUERY_INVALID",
            message: "Window must be 1, 5, 15, 30, or 60 minutes and chainId must be 56",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.marketPoolsProvider) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "MARKET_DATA_UNAVAILABLE",
            message: "Market data is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      const controller = new AbortController();
      const eligibility = await poolEligibility(session.userId);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders?.();
      reply.raw.on("close", () => controller.abort());
      reply.raw.write("retry: 3000\n\n");

      let epoch: string | null = null;
      let sequence = 0n;
      const lastEventHeader = request.headers["last-event-id"];
      try {
        for await (const event of options.marketPoolsProvider.subscribe({
          ...context,
          ...(eligibility ? { eligibility } : {}),
          lastEventId: typeof lastEventHeader === "string" ? lastEventHeader : null,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break;
          const filteredEvent = filterMarketStreamEnvelope(event, eligibility);
          if (filteredEvent.streamKey !== marketStreamKey(context)) continue;
          const nextSequence = BigInt(filteredEvent.sequence);
          if (epoch === filteredEvent.epoch && nextSequence <= sequence) continue;
          if (
            epoch !== null &&
            epoch !== filteredEvent.epoch &&
            filteredEvent.eventType !== "pools.snapshot"
          )
            break;
          reply.raw.write(`id: ${filteredEvent.cursor}\n`);
          reply.raw.write(`event: ${filteredEvent.eventType}\n`);
          reply.raw.write(`data: ${JSON.stringify(filteredEvent)}\n\n`);
          epoch = filteredEvent.epoch;
          sequence = nextSequence;
        }
      } finally {
        if (!reply.raw.destroyed) reply.raw.end();
      }
      return reply;
    });

    app.get("/api/stats", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.statsProvider) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "STATS_UNAVAILABLE",
            message: "Shell statistics are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const snapshot = await options.statsProvider.getSnapshot({ userId: session.userId });
      return createSuccessEnvelope(snapshot, request.id);
    });

    app.get(
      "/api/stats/stream",
      {
        config: {
          rateLimit: {
            keyGenerator: (request: FastifyRequest) => sessionToken(request) ?? request.ip,
            max: statsRateLimit.max,
            timeWindow: statsRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseStatsStreamQuery(request);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "STATS_STREAM_QUERY_INVALID",
              message: "Stats stream chain, limit, user_id, or query keys are invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (query.userId !== null && session.account.role !== "admin") {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "Filtering stats by user is restricted to administrators",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (query.chain === null && !options.statsProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "STATS_UNAVAILABLE",
              message: "Shell statistics are not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        if (query.chain === "bsc" && !options.marketPoolsProvider) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "RECOMMENDATIONS_UNAVAILABLE",
              message: "Recommended pool data is not configured",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        const statsUserId = query.userId ?? session.userId;
        const recommendationEligibility =
          query.chain === "bsc" ? await poolEligibility(statsUserId) : undefined;
        const lastEventHeader = request.headers["last-event-id"];
        if (
          query.chain === "bsc" &&
          lastEventHeader !== undefined &&
          (typeof lastEventHeader !== "string" ||
            parseRecommendedPoolsCursor(lastEventHeader, {
              ...(recommendationEligibility
                ? { blocklistHash: recommendationEligibility.blocklistHash }
                : {}),
              chain: query.chain,
              limit: query.limit,
            }) === null)
        ) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "STATS_STREAM_CURSOR_INVALID",
              message: "The recommendation cursor does not match this stream filter",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const controller = new AbortController();
        const recommendationStream =
          query.chain === "bsc" && options.marketPoolsProvider
            ? createRecommendedPoolsEventStream({
                chain: query.chain,
                ...(recommendationEligibility ? { eligibility: recommendationEligibility } : {}),
                limit: query.limit,
                provider: options.marketPoolsProvider,
                signal: controller.signal,
                ...(options.statsHeartbeatMilliseconds === undefined
                  ? {}
                  : { heartbeatMilliseconds: options.statsHeartbeatMilliseconds }),
                ...(options.recommendedPoolsPollMilliseconds === undefined
                  ? {}
                  : { pollMilliseconds: options.recommendedPoolsPollMilliseconds }),
                ...(options.statsStreamScheduler === undefined
                  ? {}
                  : { scheduler: options.statsStreamScheduler }),
              })
            : null;
        let initialRecommendation: IteratorResult<RecommendedPoolsStreamEvent> | null = null;
        if (recommendationStream) {
          try {
            const first = await recommendationStream.next();
            if (first.done) throw new Error("Recommendation stream ended early");
            initialRecommendation = first;
          } catch {
            controller.abort();
            return reply.code(503).send(
              createErrorEnvelope({
                code: "RECOMMENDATIONS_UNAVAILABLE",
                message: "Recommended pool data is temporarily unavailable",
                requestId: request.id,
                retryable: true,
              }),
            );
          }
        }

        const close = () => controller.abort();
        reply.hijack();
        reply.raw.writeHead(200, {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        });
        reply.raw.flushHeaders?.();
        reply.raw.once("close", close);
        await writeSseChunk(reply, controller, "retry: 1000\n\n");

        const writeEvent = async (event: {
          cursor?: string;
          sequence?: number | null;
          type: string;
        }) => {
          const identifier =
            event.type === "rec_pools_snapshot"
              ? event.cursor
              : query.chain === null
                ? event.sequence
                : undefined;
          const chunk =
            (identifier === undefined || identifier === null ? "" : `id: ${identifier}\n`) +
            `event: ${event.type}\n` +
            `data: ${JSON.stringify(event)}\n\n`;
          return writeSseChunk(reply, controller, chunk);
        };

        const streamStats = async () => {
          if (!options.statsProvider) return;
          const snapshot = await options.statsProvider.getSnapshot({ userId: statsUserId });
          if (!(await writeEvent({ ...snapshot, type: "snapshot" }))) return;
          let sequence = snapshot.sequence;
          for await (const event of options.statsProvider.subscribe({
            afterSequence: sequence,
            signal: controller.signal,
            userId: statsUserId,
          })) {
            if (controller.signal.aborted) break;
            if (event.type === "rec_pools_snapshot") continue;
            if (event.sequence === null) {
              if (query.chain === null && !(await writeEvent(event))) break;
              continue;
            }
            if (event.sequence <= sequence) continue;
            if (query.chain === "bsc" && event.type === "heartbeat") continue;
            if (!(await writeEvent(event))) break;
            sequence = event.sequence;
          }
        };

        const streamRecommendations = async () => {
          if (!recommendationStream || !initialRecommendation || initialRecommendation.done) return;
          if (!(await writeEvent(initialRecommendation.value))) {
            await recommendationStream.return(undefined);
            return;
          }
          for await (const event of recommendationStream) {
            if (!(await writeEvent(event))) break;
          }
        };

        try {
          await Promise.all([streamRecommendations(), streamStats()]);
        } catch {
          controller.abort();
        } finally {
          reply.raw.off("close", close);
          controller.abort();
          if (!reply.raw.destroyed) reply.raw.end();
        }
        return reply;
      },
    );

    app.get("/api/user/pool-blocklist", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.poolBlocklistStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "POOL_BLOCKLIST_UNAVAILABLE",
            message: "Pool blocklist storage is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      return createSuccessEnvelope(
        await options.poolBlocklistStore.get(session.userId),
        request.id,
      );
    });

    app.patch("/api/user/pool-blocklist", { bodyLimit: 2_048 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.poolBlocklistStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "POOL_BLOCKLIST_UNAVAILABLE",
            message: "Pool blocklist storage is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      let parsed;
      try {
        parsed = parsePoolBlocklistPatch(request.body);
      } catch (error) {
        if (!(error instanceof PoolBlocklistValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "POOL_BLOCKLIST_INVALID",
            message: "Pool blocklist mutation is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        !poolBlocklistLimiter.consume(
          session.id,
          poolBlocklistRateLimit.max,
          poolBlocklistRateLimit.timeWindowMs,
          now().getTime(),
        )
      ) {
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many pool blocklist mutations",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const result = await options.poolBlocklistStore.mutate({
        ...parsed,
        updatedAt: now(),
        userId: session.userId,
      });
      if (result.status === "conflict") {
        return reply.code(409).send({
          current: result.current,
          error: {
            code: "REVISION_CONFLICT",
            message: "Pool blocklist changed in another session",
            requestId: request.id,
            retryable: true,
          },
          success: false,
        });
      }
      if (result.status === "capacity") {
        return reply.code(422).send({
          current: result.current,
          error: {
            code: "BLOCKLIST_CAPACITY_EXCEEDED",
            message: "Pool blocklist entry capacity has been reached",
            requestId: request.id,
            retryable: false,
          },
          success: false,
        });
      }
      if (!("value" in result)) throw new Error("Pool blocklist mutation result is invalid");
      return createSuccessEnvelope(result.value, request.id);
    });

    app.get("/api/user/preferences", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.preferencesStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "PREFERENCES_UNAVAILABLE",
            message: "User preferences are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const value =
        (await options.preferencesStore.get(session.userId)) ?? defaultVersionedUserPreferences();
      return createSuccessEnvelope(value, request.id);
    });

    app.get("/api/address-remarks", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.addressRemarkStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "ADDRESS_REMARKS_UNAVAILABLE",
            message: "Address remarks are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const response = await options.addressRemarkStore.list({
        chainId: addressRemarkChainId,
        userId: session.userId,
      });
      return createSuccessEnvelope(response, request.id);
    });

    app.put("/api/address-remarks", { bodyLimit: 2_048 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.addressRemarkStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "ADDRESS_REMARKS_UNAVAILABLE",
            message: "Address remarks are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      let parsed;
      try {
        parsed = parseAddressRemarkPutRequest(request.body);
      } catch (error) {
        if (!(error instanceof AddressRemarkValidationError)) throw error;
        const address = (() => {
          try {
            return canonicalAddressRemarkAddress(
              typeof request.body === "object" && request.body !== null
                ? (request.body as { address?: unknown }).address
                : null,
            );
          } catch {
            return null;
          }
        })();
        await recordDeniedAddressRemark(
          addressRemarkAudit("address-remark.put", address, request, session),
          "ADDRESS_REMARK_INVALID",
        );
        return reply.code(400).send(
          createErrorEnvelope({
            code: "ADDRESS_REMARK_INVALID",
            message: "Address remark request is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const audit = addressRemarkAudit("address-remark.put", parsed.address, request, session);
      if (
        !addressRemarkLimiter.consume(
          session.id,
          addressRemarkRateLimit.max,
          addressRemarkRateLimit.timeWindowMs,
          now().getTime(),
        )
      ) {
        await recordDeniedAddressRemark(audit, "RATE_LIMITED");
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many address remark requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      const remark = await options.addressRemarkStore.put({
        ...parsed,
        audit,
        chainId: addressRemarkChainId,
        updatedAt: now(),
        userId: session.userId,
      });
      return createSuccessEnvelope({ remark }, request.id);
    });

    app.delete("/api/address-remarks/:address", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.addressRemarkStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "ADDRESS_REMARKS_UNAVAILABLE",
            message: "Address remarks are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      let address;
      try {
        address = canonicalAddressRemarkAddress((request.params as { address?: unknown }).address);
      } catch (error) {
        if (!(error instanceof AddressRemarkValidationError)) throw error;
        await recordDeniedAddressRemark(
          addressRemarkAudit("address-remark.delete", null, request, session),
          "ADDRESS_REMARK_INVALID",
        );
        return reply.code(400).send(
          createErrorEnvelope({
            code: "ADDRESS_REMARK_INVALID",
            message: "Address remark address is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const audit = addressRemarkAudit("address-remark.delete", address, request, session);
      if (
        !addressRemarkLimiter.consume(
          session.id,
          addressRemarkRateLimit.max,
          addressRemarkRateLimit.timeWindowMs,
          now().getTime(),
        )
      ) {
        await recordDeniedAddressRemark(audit, "RATE_LIMITED");
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many address remark requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const deleted = await options.addressRemarkStore.delete({
        address,
        audit,
        chainId: addressRemarkChainId,
        deletedAt: now(),
        userId: session.userId,
      });
      return createSuccessEnvelope({ deleted }, request.id);
    });

    app.patch("/api/user/preferences", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.preferencesStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "PREFERENCES_UNAVAILABLE",
            message: "User preferences are not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }

      const current =
        (await options.preferencesStore.get(session.userId)) ?? defaultVersionedUserPreferences();
      let patch;
      try {
        patch = parseUserPreferencesPatch(request.body, current.preferences);
      } catch (error) {
        if (!(error instanceof UserPreferencesValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "PREFERENCES_INVALID",
            message: "User preferences are invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const result = await options.preferencesStore.update({
        expectedRevision: patch.expectedRevision,
        preferences: patch.preferences,
        updatedAt: now(),
        userId: session.userId,
      });
      if (result.status === "conflict") {
        return reply.code(409).send(
          createErrorEnvelope({
            code: "PREFERENCES_CONFLICT",
            message: "User preferences changed in another session",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      return createSuccessEnvelope(result.value, request.id);
    });

    app.post(
      "/api/auth/wallet/nonce",
      {
        config: {
          rateLimit: {
            max: authRateLimits.walletNonce,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!isRecord(request.body)) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "ADDRESS_INVALID",
              message: "Wallet address is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        try {
          const challenge = await options.walletAuth.createLoginChallenge({
            address: typeof request.body.address === "string" ? request.body.address : "",
            chainId: typeof request.body.chainId === "number" ? request.body.chainId : 0,
            requestId: request.id,
          });
          return createSuccessEnvelope(
            {
              expiresAt: challenge.expiresAt.toISOString(),
              message: challenge.message,
              nonceId: challenge.nonceId,
            },
            request.id,
          );
        } catch (error) {
          if (!isWalletAuthenticationError(error)) throw error;
          return reply.code(walletErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: walletErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.post(
      "/api/auth/wallet/login",
      {
        config: {
          rateLimit: {
            max: authRateLimits.walletLogin,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!isRecord(request.body)) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "NONCE_INVALID",
              message: "Wallet challenge is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        try {
          const login = await options.walletAuth.login({
            address: typeof request.body.address === "string" ? request.body.address : "",
            chainId: typeof request.body.chainId === "number" ? request.body.chainId : 0,
            nonceId: typeof request.body.nonceId === "string" ? request.body.nonceId : "",
            requestId: request.id,
            signature: typeof request.body.signature === "string" ? request.body.signature : "",
          });
          setBrowserSessionCookie(reply, login.session);
          const decision = authorizeAccount({
            accountStatus: login.account.status,
            maintenance: options.maintenance,
            region: options.regionPolicy(request),
            role: login.account.role,
          });
          if (!decision.allowed) {
            return reply.code(decision.statusCode).send(
              createErrorEnvelope({
                code: decision.code,
                message: decision.message,
                requestId: request.id,
                retryable: decision.retryable,
              }),
            );
          }

          return createSuccessEnvelope(
            {
              session: await accountToSessionView(
                login.account,
                decision.maintenanceBypass,
                options.chainPolicyStore,
              ),
            },
            request.id,
          );
        } catch (error) {
          if (!isWalletAuthenticationError(error)) throw error;
          return reply.code(walletErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: walletErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.get(
      "/api/auth/wallet/links",
      {
        config: {
          rateLimit: {
            max: authRateLimits.walletLinks,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        const links = (await options.walletAuth.listLinks(session.userId)).map((link) => ({
          ...link,
          createdAt: link.createdAt.toISOString(),
          updatedAt: link.updatedAt.toISOString(),
        }));
        return createSuccessEnvelope({ links }, request.id);
      },
    );

    app.post(
      "/api/auth/wallet/link-nonce",
      {
        config: {
          rateLimit: {
            max: authRateLimits.walletNonce,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!isRecord(request.body)) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "ADDRESS_INVALID",
              message: "Wallet address is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        try {
          const challenge = await options.walletAuth.createLinkChallenge({
            address: typeof request.body.address === "string" ? request.body.address : "",
            chainId: typeof request.body.chainId === "number" ? request.body.chainId : 0,
            requestId: request.id,
            userId: session.userId,
          });
          return createSuccessEnvelope(
            {
              expiresAt: challenge.expiresAt.toISOString(),
              message: challenge.message,
              nonceId: challenge.nonceId,
            },
            request.id,
          );
        } catch (error) {
          if (!isWalletAuthenticationError(error)) throw error;
          return reply.code(walletErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: walletErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.post(
      "/api/auth/wallet/link",
      {
        config: {
          rateLimit: {
            max: authRateLimits.walletLogin,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!isRecord(request.body)) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "NONCE_INVALID",
              message: "Wallet challenge is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        try {
          const link = await options.walletAuth.link({
            address: typeof request.body.address === "string" ? request.body.address : "",
            chainId: typeof request.body.chainId === "number" ? request.body.chainId : 0,
            label:
              typeof request.body.label === "string" || request.body.label === null
                ? request.body.label
                : "\u0000",
            nonceId: typeof request.body.nonceId === "string" ? request.body.nonceId : "",
            requestId: request.id,
            signature: typeof request.body.signature === "string" ? request.body.signature : "",
            userId: session.userId,
          });
          return createSuccessEnvelope(
            {
              link: {
                ...link,
                createdAt: link.createdAt.toISOString(),
                updatedAt: link.updatedAt.toISOString(),
              },
            },
            request.id,
          );
        } catch (error) {
          if (!isWalletAuthenticationError(error)) throw error;
          return reply
            .code(error.code === "SIGNATURE_INVALID" ? 400 : walletErrorStatus(error.code))
            .send(
              createErrorEnvelope({
                code: error.code,
                message: walletErrorMessage(error.code),
                requestId: request.id,
                retryable: false,
              }),
            );
        }
      },
    );

    app.delete<{ Params: { linkId: string } }>(
      "/api/auth/wallet/link/:linkId",
      async (request, reply) => {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletAuth) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "WALLET_AUTH_UNAVAILABLE",
              message: "Wallet authentication is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        try {
          const result = await options.walletAuth.unlink({
            linkId: request.params.linkId,
            requestId: request.id,
            userId: session.userId,
          });
          return createSuccessEnvelope(result, request.id);
        } catch (error) {
          if (!isWalletAuthenticationError(error)) throw error;
          return reply.code(walletErrorStatus(error.code)).send(
            createErrorEnvelope({
              code: error.code,
              message: walletErrorMessage(error.code),
              requestId: request.id,
              retryable: false,
            }),
          );
        }
      },
    );

    app.post(
      "/api/auth/me",
      {
        config: {
          rateLimit: { max: authRateLimits.miniApp, timeWindow: authRateLimits.timeWindowMs },
        },
      },
      async (request, reply) => {
        if (request.body !== undefined) {
          if (!options.telegramMiniApp) {
            return reply.code(503).send(
              createErrorEnvelope({
                code: "TELEGRAM_AUTH_UNAVAILABLE",
                message: "Telegram authentication is not configured",
                requestId: request.id,
                retryable: false,
              }),
            );
          }

          let login;
          try {
            login = await options.telegramMiniApp.authenticate(request.body, request.id);
          } catch (error) {
            if (!isTelegramAuthenticationError(error)) throw error;
            return reply.code(error.code === "AUTH_REPLAYED" ? 409 : 401).send(
              createErrorEnvelope({
                code: error.code,
                message: telegramAuthenticationMessages[error.code],
                requestId: request.id,
                retryable: false,
              }),
            );
          }

          setBrowserSessionCookie(reply, login.session);
          const decision = authorizeAccount({
            accountStatus: login.account.status,
            maintenance: options.maintenance,
            region: options.regionPolicy(request),
            role: login.account.role,
          });
          if (!decision.allowed) {
            return reply.code(decision.statusCode).send(
              createErrorEnvelope({
                code: decision.code,
                message: decision.message,
                requestId: request.id,
                retryable: decision.retryable,
              }),
            );
          }

          const user = await accountToSessionView(
            login.account,
            decision.maintenanceBypass,
            options.chainPolicyStore,
          );
          return createSuccessEnvelope(
            {
              isAdmin: user.role === "admin",
              maintenance: options.maintenance.enabled ? options.maintenance : null,
              user,
            },
            request.id,
          );
        }

        const token = sessionToken(request);
        const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
        if (!resolved) {
          await options.sessionStore.recordAccessAudit({
            action: "session.access",
            createdAt: now(),
            outcome: "denied",
            requestId: request.id,
            sessionId: null,
            userId: null,
          });
          return reply.code(401).send(
            createErrorEnvelope({
              code: token ? "AUTH_EXPIRED" : "UNAUTHENTICATED",
              message: token ? "Session is invalid or expired" : "Authentication is required",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const { session, tokenHash } = resolved;
        const context: AccountAccessContext = {
          accountStatus: session.account.status,
          maintenance: options.maintenance,
          region: options.regionPolicy(request),
          role: session.account.role,
        };
        const decision = authorizeAccount(context);
        if (!decision.allowed) {
          await options.sessionStore.recordAccessAudit({
            action: "session.access",
            createdAt: now(),
            outcome: "denied",
            requestId: request.id,
            sessionId: session.id,
            userId: session.userId,
          });
          return reply.code(decision.statusCode).send(
            createErrorEnvelope({
              code: decision.code,
              message: decision.message,
              requestId: request.id,
              retryable: decision.retryable,
            }),
          );
        }

        const accessedAt = now();
        await options.sessionStore.touchSession(tokenHash, accessedAt);
        await options.sessionStore.recordAccessAudit({
          action: "session.access",
          createdAt: accessedAt,
          outcome: "allowed",
          requestId: request.id,
          sessionId: session.id,
          userId: session.userId,
        });
        const user = await toSessionView(
          session,
          decision.maintenanceBypass,
          options.chainPolicyStore,
        );
        return createSuccessEnvelope(
          {
            isAdmin: user.role === "admin",
            maintenance: options.maintenance.enabled ? options.maintenance : null,
            user,
          },
          request.id,
        );
      },
    );

    app.post("/api/auth/logout", async (request, reply) => {
      const token = sessionToken(request);
      const revokedAt = now();
      let session: StoredSession | null = null;
      let revoked = false;

      if (token) {
        const tokenHash = hashSessionToken(token);
        session = await options.sessionStore.findSessionByTokenHash(tokenHash);
        revoked = await options.sessionStore.revokeSession(tokenHash, revokedAt);
      }

      await options.sessionStore.recordAccessAudit({
        action: "session.logout",
        createdAt: revokedAt,
        outcome: "allowed",
        requestId: request.id,
        sessionId: session?.id ?? null,
        userId: session?.userId ?? null,
      });
      reply.clearCookie(sessionCookieName, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
      });
      return createSuccessEnvelope({ loggedOut: true, revoked }, request.id);
    });

    app.post(
      "/api/auth/login-token",
      {
        config: {
          rateLimit: {
            max: authRateLimits.loginToken,
            timeWindow: authRateLimits.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        if (!telegramBotConfigured(options)) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "TELEGRAM_BOT_UNAVAILABLE",
              message: "Telegram Bot login is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const created = await options.telegramBot.create(request.id);
        return createSuccessEnvelope(
          {
            expiresAt: created.expiresAt.toISOString(),
            loginUrl: `https://t.me/${options.telegramBotUsername}?start=${created.token}`,
            token: created.token,
          },
          request.id,
        );
      },
    );

    app.get<{ Params: { token: string } }>(
      "/api/auth/login-status/:token",
      {
        config: {
          rateLimit: { max: authRateLimits.status, timeWindow: authRateLimits.timeWindowMs },
        },
      },
      async (request, reply) => {
        if (!telegramBotConfigured(options)) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "TELEGRAM_BOT_UNAVAILABLE",
              message: "Telegram Bot login is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const result = await options.telegramBot.poll(request.params.token, request.id);
        if (result.status === "pending") {
          return createSuccessEnvelope(
            { confirmed: false, session: null, status: "pending" as const },
            request.id,
          );
        }
        if (!result.login) {
          const error =
            result.status === "expired"
              ? {
                  code: "LOGIN_TOKEN_EXPIRED",
                  message: "The Telegram login link has expired",
                  statusCode: 410,
                }
              : result.status === "cancelled"
                ? {
                    code: "LOGIN_TOKEN_CANCELLED",
                    message: "The Telegram login was cancelled",
                    statusCode: 409,
                  }
                : result.status === "consumed"
                  ? {
                      code: "LOGIN_TOKEN_CONSUMED",
                      message: "The Telegram login link was already used",
                      statusCode: 409,
                    }
                  : {
                      code: "LOGIN_TOKEN_INVALID",
                      message: "The Telegram login link is invalid",
                      statusCode: 404,
                    };
          return reply.code(error.statusCode).send(
            createErrorEnvelope({
              code: error.code,
              message: error.message,
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        setBrowserSessionCookie(reply, result.login.session);
        const decision = authorizeAccount({
          accountStatus: result.login.account.status,
          maintenance: options.maintenance,
          region: options.regionPolicy(request),
          role: result.login.account.role,
        });
        if (!decision.allowed) {
          return reply.code(decision.statusCode).send(
            createErrorEnvelope({
              code: decision.code,
              message: decision.message,
              requestId: request.id,
              retryable: decision.retryable,
            }),
          );
        }

        const user = await accountToSessionView(
          result.login.account,
          decision.maintenanceBypass,
          options.chainPolicyStore,
        );
        return createSuccessEnvelope(
          { confirmed: true, session: user, status: "consumed" as const },
          request.id,
        );
      },
    );

    app.post<{ Params: { token: string } }>(
      "/api/auth/login-token/:token/cancel",
      {
        config: {
          rateLimit: { max: authRateLimits.cancel, timeWindow: authRateLimits.timeWindowMs },
        },
      },
      async (request, reply) => {
        if (!telegramBotConfigured(options)) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "TELEGRAM_BOT_UNAVAILABLE",
              message: "Telegram Bot login is not configured",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        const result = await options.telegramBot.cancel(request.params.token, request.id);
        if (result.status === "cancelled") {
          return createSuccessEnvelope({ status: "cancelled" as const }, request.id);
        }
        const error =
          result.status === "expired"
            ? {
                code: "LOGIN_TOKEN_EXPIRED",
                message: "The Telegram login link has expired",
                statusCode: 410,
              }
            : result.status === "consumed"
              ? {
                  code: "LOGIN_TOKEN_CONSUMED",
                  message: "The Telegram login link was already used",
                  statusCode: 409,
                }
              : {
                  code: "LOGIN_TOKEN_INVALID",
                  message: "The Telegram login link is invalid",
                  statusCode: 404,
                };
        return reply.code(error.statusCode).send(
          createErrorEnvelope({
            code: error.code,
            message: error.message,
            requestId: request.id,
            retryable: false,
          }),
        );
      },
    );

    if (options.testRoutes) {
      const authenticateTestRequest = async (request: FastifyRequest) => {
        const token = sessionToken(request);
        if (!token) return { kind: "unauthenticated" as const, code: "UNAUTHENTICATED" };
        const resolved = await findValidSession(token, options.sessionStore, now());
        if (!resolved) return { kind: "unauthenticated" as const, code: "AUTH_EXPIRED" };

        const decision = authorizeAccount({
          accountStatus: resolved.session.account.status,
          maintenance: options.maintenance,
          region: options.regionPolicy(request),
          role: resolved.session.account.role,
        });
        if (!decision.allowed) return { kind: "denied" as const, decision };
        return { kind: "allowed" as const, session: resolved.session };
      };

      app.get<{ Params: { level: string } }>("/__test/guard/:level", async (request, reply) => {
        const authentication = await authenticateTestRequest(request);
        if (authentication.kind === "unauthenticated") {
          return reply.code(401).send(
            createErrorEnvelope({
              code: authentication.code,
              message:
                authentication.code === "AUTH_EXPIRED"
                  ? "Session is invalid or expired"
                  : "Authentication is required",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (authentication.kind === "denied") {
          return reply.code(authentication.decision.statusCode).send(
            createErrorEnvelope({
              code: authentication.decision.code,
              message: authentication.decision.message,
              requestId: request.id,
              retryable: authentication.decision.retryable,
            }),
          );
        }
        const { session } = authentication;

        const level = request.params.level;
        const validLevel =
          level === "authenticated" || level === "pro" || level === "admin"
            ? (level satisfies AccessLevel)
            : null;
        if (!roleCanAccess(session.account.role, validLevel)) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "This role cannot access the requested resource",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        return createSuccessEnvelope({ level }, request.id);
      });

      app.get<{ Params: { ownerUserId: string } }>(
        "/__test/owned/:ownerUserId",
        async (request, reply) => {
          const authentication = await authenticateTestRequest(request);
          if (authentication.kind === "unauthenticated") {
            return reply.code(401).send(
              createErrorEnvelope({
                code: authentication.code,
                message:
                  authentication.code === "AUTH_EXPIRED"
                    ? "Session is invalid or expired"
                    : "Authentication is required",
                requestId: request.id,
                retryable: false,
              }),
            );
          }
          if (authentication.kind === "denied") {
            return reply.code(authentication.decision.statusCode).send(
              createErrorEnvelope({
                code: authentication.decision.code,
                message: authentication.decision.message,
                requestId: request.id,
                retryable: authentication.decision.retryable,
              }),
            );
          }
          const { session } = authentication;

          if (
            !canAccessOwnedResource(
              session.userId,
              request.params.ownerUserId,
              session.account.role,
              false,
            )
          ) {
            return reply.code(403).send(
              createErrorEnvelope({
                code: "FORBIDDEN",
                message: "The requested resource is outside the authorized scope",
                requestId: request.id,
                retryable: false,
              }),
            );
          }

          return createSuccessEnvelope({ value: "fixture-resource" }, request.id);
        },
      );
    }
  });

  return app;
}
