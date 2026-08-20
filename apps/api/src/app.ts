import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  addressBookSecretMediaType,
  createErrorEnvelope,
  createSuccessEnvelope,
  marketCandleBars,
  type ChainAccessMode,
  type EvmAddress,
  type LiquidityFlowFilter,
  type LocalPositionCurrentPage,
  type ManagedChainView,
  marketStreamKey,
  marketWindowMinutes,
  okxKeySecretBodyLimit,
  okxKeySecretMediaType,
  parseLiquidityProtocolFilter,
  type MarketPoolByTokenSort,
  type MarketCandleBar,
  type MarketProtocol,
  type MarketWindowMinutes,
  type SessionView,
  type ShellStatsSnapshot,
  walletTransferSecretMediaType,
} from "@lpbot/api-contract";
import { findRegisteredChain } from "@lpbot/chain-registry";
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
import { LocalSwapQuoteError, SwapQuoteAdapterError } from "@lpbot/chain-adapters";

import { sessionCookieName, setBrowserSessionCookie } from "./browser-session-cookie.js";
import {
  AddressBookError,
  classifyAddress,
  parseAddressBookCreateIngress,
  parseAddressBookEntryId,
  parseAddressBookPatch,
  type AddressBookAllowedAudit,
  type AddressBookAuditAction,
  type AddressBookStore,
} from "./address-book.js";
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
  NotificationHistoryQueryError,
  parseNotificationHistoryQuery,
  type NotificationHistoryStore,
} from "./notification-history.js";
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
  MonitorValidationError,
  parseIdempotencyKey,
  parseMonitorCreate,
  parseMonitorLifecycle,
  parseMonitorListQuery,
  parseMonitorPatch,
  type MonitorMutationResult,
  type MonitorStore,
} from "./monitors.js";
import {
  NotificationValidationError,
  parseDestinationDraft,
  parseNotificationDestinationPatch,
  parseNotificationExpectedRevision,
  parseNotificationIdempotencyKey,
  parseNotificationPreferencesPatch,
  renderLocalSinkTest,
  type NotificationConfigurationStore,
  type NotificationDestinationMutationResult,
} from "./notifications.js";
import { OkxKeyError, publicOkxKeyStatus, type OkxKeyApplication } from "./okx-key.js";
import {
  parsePoolBlocklistPatch,
  PoolBlocklistValidationError,
  type PoolBlocklistStore,
} from "./pool-blocklist.js";
import {
  parsePoolCreationHistoryQuery,
  parsePoolCreatorBatchRequest,
  parsePoolCreatorQuery,
  poolCreationIdentityDigest,
  PoolCreationProvenanceValidationError,
  publicPoolCreationAttribution,
  type PoolCreationAdminAuditAction,
  type PoolCreationProvenanceReadStore,
} from "./pool-creation-provenance.js";
import {
  createRecommendedPoolsEventStream,
  parseRecommendedPoolsCursor,
  type RecommendedPoolsScheduler,
  type RecommendedPoolsStreamEvent,
} from "./recommended-pools.js";
import { PositionCursorError, type PositionReadApplication } from "./position-read-model.js";
import {
  parseSwapQuoteRequest,
  SwapQuoteValidationError,
  type SwapQuoteApplication,
} from "./swap-quotes.js";
import {
  parseImportPricingPositionRequest,
  parseMarkPricingPositionWithdrawnRequest,
  parsePricingPositionId,
  PricingPositionCursorError,
  PricingPositionError,
  type PricingPositionApplication,
  type PricingPositionStreamProvider,
} from "./pricing-positions.js";
import type { WalletHelperReadApplication } from "./helper-read-model.js";
import {
  HelperDeploymentError,
  helperDeploymentBodyLimit,
  parseChainOperationId,
  parseHelperDeploymentIdempotencyKey,
  parseHelperDeploymentPreviewRequest,
  parseHelperDeploymentSubmit,
  type HelperDeploymentApplication,
} from "./helper-deployments.js";
import {
  LocalSwapExecutionError,
  LocalSwapQuoteValidationError,
  localSwapExecutionBodyLimit,
  parseLocalSwapExecute,
  parseLocalSwapExecutePreview,
  parseLocalSwapIdempotencyKey,
  parseLocalSwapQuoteRequest,
  type LocalSwapExecutionApplication,
  type LocalSwapQuoteApplication,
} from "./local-swap-executions.js";
import {
  LocalPositionExecutionError,
  localPositionExecutionBodyLimit,
  parseLocalPositionCollectFees,
  parseLocalPositionCollectFeesPreview,
  parseLocalPositionIdempotencyKey,
  parseLocalPositionOperationId,
  parseLocalPositionRemoveLiquidity,
  parseLocalPositionRemoveLiquidityPreview,
  parseLocalPositionWalletId,
  type LocalPositionExecutionApplication,
} from "./local-position-executions.js";
import {
  LocalHelperSweepError,
  localHelperSweepBodyLimit,
  parseLocalHelperSweepId,
  parseLocalHelperSweepIdempotencyKey,
  parseLocalHelperSweepPreview,
  parseLocalHelperSweepSubmit,
  type LocalHelperSweepApplication,
} from "./local-helper-sweeps.js";
import {
  LocalHelperUpgradeError,
  localHelperUpgradeBodyLimit,
  parseLocalHelperUpgradeId,
  parseLocalHelperUpgradeIdempotencyKey,
  parseLocalHelperUpgradePreview,
  parseLocalHelperUpgradeSubmit,
  type LocalHelperUpgradeApplication,
} from "./local-helper-upgrades.js";
import {
  HelperResidualCursorError,
  HelperResidualReadError,
  type WalletHelperResidualApplication,
} from "./helper-residual-model.js";
import type { ShellStatsProvider, ShellStatsScope } from "./shell-stats.js";
import {
  defaultVersionedUserPreferences,
  parseUserPreferencesPatch,
  UserPreferencesValidationError,
  type UserPreferencesStore,
} from "./user-preferences.js";
import {
  canonicalWalletAddress,
  WalletAssetError,
  type WalletAssetApplication,
} from "./wallet-assets.js";
import {
  parseWalletTransferIdempotencyKey,
  parseWalletTransferOperationId,
  parseWalletTransferPreviewRequest,
  parseWalletTransferSubmit,
  WalletTransferError,
  walletTransferBodyLimit,
  type WalletTransferApplication,
} from "./wallet-transfers.js";
import {
  keystoreSecretBodyLimit,
  keystoreSecretMediaType,
  parseDeleteCustodyWalletRequest,
  parseGenerateCustodyWalletRequest,
  parseRenameCustodyWalletRequest,
  parseWalletId,
  publicKeystoreResetPreview,
  publicKeystoreStatus,
  publicSecurityPasswordStatus,
  publicWalletDeletePreview,
  publicWalletDeletionReceipt,
  publicWalletDto,
  WalletApiError,
  securityPasswordSecretMediaType,
  walletSecretBodyLimit,
  walletSecretMediaType,
  type FreshReauthenticationVerifier,
  type KeystoreApplication,
  type SecurityPasswordApplication,
  type WalletDirectory,
  type WalletSignerClient,
} from "./wallets.js";

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
  addressBookStore?: AddressBookStore;
  addressRemarkRateLimit?: ChainManagementRateLimit;
  addressRemarkStore?: AddressRemarkStore;
  authRateLimits?: AuthRateLimits;
  chainActivityProvider?: ChainActivityProvider;
  chainManagementRateLimit?: ChainManagementRateLimit;
  chainPolicyStore?: ChainAccessPolicyStore;
  freshReauthentication?: FreshReauthenticationVerifier;
  logger?: { write(line: string): void };
  liquidityFlowProvider?: LiquidityFlowProvider;
  liquidityFlowRateLimit?: PublicReadRateLimit;
  maintenance: MaintenanceConfig;
  marketChartsProvider?: MarketChartsProvider;
  marketChartsRateLimit?: PublicReadRateLimit;
  marketPoolsProvider?: MarketPoolsProvider;
  marketPoolsRateLimit?: PublicReadRateLimit;
  monitorStore?: MonitorStore;
  notificationStore?: NotificationConfigurationStore;
  notificationHistoryStore?: NotificationHistoryStore;
  okxKey?: OkxKeyApplication;
  managementOrigin?: string;
  now?: () => Date;
  poolBlocklistRateLimit?: ChainManagementRateLimit;
  poolBlocklistStore?: PoolBlocklistStore;
  poolCreationProvenanceRateLimit?: PublicReadRateLimit;
  poolCreationProvenanceStore?: PoolCreationProvenanceReadStore;
  pricingPositions?: PricingPositionApplication;
  pricingPositionStream?: PricingPositionStreamProvider;
  positionReads?: PositionReadApplication;
  helperReads?: WalletHelperReadApplication;
  helperResiduals?: WalletHelperResidualApplication;
  localHelperSweepChainIds?: readonly number[];
  localHelperSweeps?: LocalHelperSweepApplication;
  localHelperUpgradeChainIds?: readonly number[];
  localHelperUpgrades?: LocalHelperUpgradeApplication;
  helperDeploymentLocalChainIds?: readonly number[];
  helperDeployments?: HelperDeploymentApplication;
  localSwapExecutionChainIds?: readonly number[];
  localSwapExecutions?: LocalSwapExecutionApplication;
  localSwapQuotes?: LocalSwapQuoteApplication;
  localPositionExecutionChainIds?: readonly number[];
  localPositionExecutions?: LocalPositionExecutionApplication;
  preferencesStore?: UserPreferencesStore;
  recommendedPoolsPollMilliseconds?: number;
  regionPolicy(request: FastifyRequest): RegionPolicyResult;
  sessionStore: SessionStore;
  statsHeartbeatMilliseconds?: number;
  statsProvider?: ShellStatsProvider;
  statsRateLimit?: PublicReadRateLimit;
  statsStreamScheduler?: RecommendedPoolsScheduler;
  swapQuoteRateLimit?: PublicReadRateLimit;
  swapQuotes?: SwapQuoteApplication;
  telegramBot?: TelegramBotLoginApplication;
  telegramBotUsername?: string;
  telegramMiniApp?: TelegramMiniAppAuthenticator;
  tenantId?: string;
  testRoutes?: boolean;
  walletAuth?: LoginWalletAuthenticationApplication;
  walletAssets?: WalletAssetApplication;
  walletDirectory?: WalletDirectory;
  walletSigner?: WalletSignerClient;
  walletTransferLocalChainIds?: readonly number[];
  walletTransfers?: WalletTransferApplication;
  keystore?: KeystoreApplication;
  securityPassword?: SecurityPasswordApplication;
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
  telegramUserId: string | null;
}

interface StatsSnapshotQuery {
  telegramUserId: string | null;
}

function parseStatsTelegramUserId(value: unknown): string | null {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) return null;
  return parsed.toString();
}

function parseStatsSnapshotQuery(request: FastifyRequest): StatsSnapshotQuery | null {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== "user_id")) return null;
  if (query.user_id === undefined) return { telegramUserId: null };
  const telegramUserId = parseStatsTelegramUserId(query.user_id);
  return telegramUserId === null ? null : { telegramUserId };
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
  const telegramUserId =
    query.user_id === undefined ? null : parseStatsTelegramUserId(query.user_id);
  if (query.user_id !== undefined && telegramUserId === null) return null;
  return { chain, limit: Number(rawLimit), telegramUserId };
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

function parsePositiveChainId(value: unknown, defaultValue = 56): number | null {
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/u.test(value)) return null;
  const chainId = Number(value);
  return Number.isSafeInteger(chainId) ? chainId : null;
}

function parseWalletReadQuery(
  value: unknown,
  allowedKeys: readonly string[],
): { amountDecimal?: string; chainId: number; tokenAddress?: string } | null {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    return null;
  }
  const chainId = parsePositiveChainId(value.chainId);
  if (!chainId) return null;
  if (
    value.tokenAddress !== undefined &&
    (typeof value.tokenAddress !== "string" || value.tokenAddress.length > 42)
  ) {
    return null;
  }
  if (
    value.amountDecimal !== undefined &&
    (typeof value.amountDecimal !== "string" || value.amountDecimal.length > 160)
  ) {
    return null;
  }
  return {
    chainId,
    ...(value.tokenAddress === undefined ? {} : { tokenAddress: value.tokenAddress }),
    ...(value.amountDecimal === undefined ? {} : { amountDecimal: value.amountDecimal }),
  };
}

interface ParsedPositionReadQuery {
  chainId: number;
  cursor: string | null;
  limit: number;
  platformId: 1 | 2 | 4 | 5 | null;
}

function parsePositionReadQuery(
  value: unknown,
  platformFilterAllowed: boolean,
): ParsedPositionReadQuery | null {
  if (!isPlainRecord(value)) return null;
  const allowed = new Set(["chainId", "cursor", "limit"]);
  if (platformFilterAllowed) allowed.add("platformId");
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const chainId = parsePositiveChainId(value.chainId);
  if (!chainId) return null;
  const limitValue = value.limit ?? "50";
  if (typeof limitValue !== "string" || !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    return null;
  }
  const cursor = value.cursor ?? null;
  if (
    cursor !== null &&
    (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 2_048)
  ) {
    return null;
  }
  let platformId: 1 | 2 | 4 | 5 | null = null;
  if (value.platformId !== undefined) {
    if (
      typeof value.platformId !== "string" ||
      !(["1", "2", "4", "5"] as const).includes(value.platformId as "1" | "2" | "4" | "5")
    ) {
      return null;
    }
    platformId = Number(value.platformId) as 1 | 2 | 4 | 5;
  }
  return { chainId, cursor, limit: Number(limitValue), platformId };
}

interface ParsedHelperResidualListQuery {
  chainId: number;
  cursor: string | null;
  limit: number;
  walletId: string;
}

function parseHelperStatusQuery(value: unknown): { chainId: number } | null {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => key !== "chainId")) return null;
  const chainId = parsePositiveChainId(value.chainId);
  return chainId ? { chainId } : null;
}

function parseHelperResidualListQuery(value: unknown): ParsedHelperResidualListQuery | null {
  if (!isPlainRecord(value)) return null;
  const allowed = new Set(["chainId", "cursor", "limit", "walletId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const chainId = parsePositiveChainId(value.chainId);
  const cursor = value.cursor ?? null;
  const limitValue = value.limit ?? "50";
  if (
    !chainId ||
    typeof value.walletId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.walletId,
    ) ||
    typeof limitValue !== "string" ||
    !/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue) ||
    (cursor !== null && (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 2_048))
  ) {
    return null;
  }
  return {
    chainId,
    cursor,
    limit: Number(limitValue),
    walletId: value.walletId.toLowerCase(),
  };
}

function parseHelperResidualScanBody(value: unknown): {
  chainId: number;
  idempotencyKey: string;
  walletId: string;
} | null {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).sort().join(",") !== "chainId,idempotencyKey,walletId" ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1 ||
    typeof value.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u.test(value.idempotencyKey) ||
    typeof value.walletId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value.walletId,
    )
  ) {
    return null;
  }
  return {
    chainId: Number(value.chainId),
    idempotencyKey: value.idempotencyKey,
    walletId: value.walletId.toLowerCase(),
  };
}

function parseWalletTokenImport(value: unknown): { chainId: number; tokenAddress: unknown } | null {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).sort().join(",") !== "chainId,tokenAddress" ||
    !Number.isSafeInteger(value.chainId) ||
    Number(value.chainId) < 1
  ) {
    return null;
  }
  return { chainId: Number(value.chainId), tokenAddress: value.tokenAddress };
}

function parseAddressBookQuery(value: unknown): { address?: string; chainId: number } | null {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some((key) => key !== "address" && key !== "chainId")
  ) {
    return null;
  }
  const chainId = parsePositiveChainId(value.chainId);
  if (
    !chainId ||
    (value.address !== undefined &&
      (typeof value.address !== "string" || value.address.length > 42))
  ) {
    return null;
  }
  return { chainId, ...(value.address === undefined ? {} : { address: value.address }) };
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
  const helperDeploymentLocalChainIds = new Set(options.helperDeploymentLocalChainIds ?? []);
  if (
    helperDeploymentLocalChainIds.size !== (options.helperDeploymentLocalChainIds?.length ?? 0) ||
    [...helperDeploymentLocalChainIds].some((chainId) => chainId !== 31_337)
  ) {
    throw new RangeError("Helper deployment local chain IDs must contain only 31337");
  }
  const localSwapExecutionChainIds = new Set(options.localSwapExecutionChainIds ?? []);
  if (
    localSwapExecutionChainIds.size !== (options.localSwapExecutionChainIds?.length ?? 0) ||
    [...localSwapExecutionChainIds].some((chainId) => chainId !== 31_337)
  ) {
    throw new RangeError("Local Swap execution chain IDs must contain only 31337");
  }
  const localPositionExecutionChainIds = new Set(options.localPositionExecutionChainIds ?? []);
  if (
    localPositionExecutionChainIds.size !== (options.localPositionExecutionChainIds?.length ?? 0) ||
    [...localPositionExecutionChainIds].some((chainId) => chainId !== 31_337)
  ) {
    throw new RangeError("Local position execution chain IDs must contain only 31337");
  }
  const localHelperSweepChainIds = new Set(options.localHelperSweepChainIds ?? []);
  if (
    localHelperSweepChainIds.size !== (options.localHelperSweepChainIds?.length ?? 0) ||
    [...localHelperSweepChainIds].some((chainId) => chainId !== 31_337)
  ) {
    throw new RangeError("Local Helper sweep chain IDs must contain only 31337");
  }
  const localHelperUpgradeChainIds = new Set(options.localHelperUpgradeChainIds ?? []);
  if (
    localHelperUpgradeChainIds.size !== (options.localHelperUpgradeChainIds?.length ?? 0) ||
    [...localHelperUpgradeChainIds].some((chainId) => chainId !== 31_337)
  ) {
    throw new RangeError("Local Helper upgrade chain IDs must contain only 31337");
  }
  const walletTransferLocalChainIds = new Set(options.walletTransferLocalChainIds ?? []);
  if (
    walletTransferLocalChainIds.size !== (options.walletTransferLocalChainIds?.length ?? 0) ||
    [...walletTransferLocalChainIds].some(
      (chainId) => !Number.isSafeInteger(chainId) || chainId < 1,
    )
  ) {
    throw new RangeError("Wallet transfer local chain IDs must be unique positive integers");
  }
  const now = options.now ?? (() => new Date());
  const swapQuoteRateLimit: PublicReadRateLimit = {
    max: 20,
    timeWindowMs: 60_000,
    ...options.swapQuoteRateLimit,
  };
  if (
    !Number.isSafeInteger(swapQuoteRateLimit.max) ||
    swapQuoteRateLimit.max <= 0 ||
    !Number.isSafeInteger(swapQuoteRateLimit.timeWindowMs) ||
    swapQuoteRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Swap quote rate limits must be positive integers");
  }
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
  const poolCreationProvenanceRateLimit: PublicReadRateLimit = {
    max: 60,
    timeWindowMs: 60_000,
    ...options.poolCreationProvenanceRateLimit,
  };
  if (
    !Number.isSafeInteger(poolCreationProvenanceRateLimit.max) ||
    poolCreationProvenanceRateLimit.max <= 0 ||
    !Number.isSafeInteger(poolCreationProvenanceRateLimit.timeWindowMs) ||
    poolCreationProvenanceRateLimit.timeWindowMs <= 0
  ) {
    throw new RangeError("Pool creation provenance rate limits must be positive integers");
  }
  const poolCreationProvenanceLimiter = new FixedWindowRateLimiter();
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

  const isKeystoreSecretRequest = (method: string, path: string): boolean =>
    (method === "POST" &&
      (path === "/api/keystore/password" ||
        path === "/api/keystore/unlock" ||
        path === "/api/keystore/reset")) ||
    (method === "PUT" && path === "/api/keystore/password") ||
    (method === "POST" && /^\/api\/wallets\/[^/]+\/encryption-mode$/u.test(path));

  const isSecurityPasswordSecretRequest = (method: string, path: string): boolean =>
    method === "PUT" && path === "/api/security-password";

  const isAddressBookSecretRequest = (method: string, path: string): boolean =>
    method === "POST" && path === "/api/address-book";

  const isWalletTransferSecretRequest = (method: string, path: string): boolean =>
    method === "POST" && path === "/api/wallets/transfers";

  const isOkxKeySecretRequest = (method: string, path: string): boolean =>
    (path === "/api/settings/okx-key" &&
      (method === "POST" || method === "PUT" || method === "DELETE")) ||
    (path === "/api/settings/okx-key/test" && method === "POST");

  app.addHook("onRequest", (request, reply, done) => {
    const path = request.url.split("?", 1)[0]!;
    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    const requiredMediaType =
      request.method === "POST" && path === "/api/wallets/import"
        ? walletSecretMediaType
        : isKeystoreSecretRequest(request.method, path)
          ? keystoreSecretMediaType
          : isSecurityPasswordSecretRequest(request.method, path)
            ? securityPasswordSecretMediaType
            : isAddressBookSecretRequest(request.method, path)
              ? addressBookSecretMediaType
              : isWalletTransferSecretRequest(request.method, path)
                ? walletTransferSecretMediaType
                : isOkxKeySecretRequest(request.method, path)
                  ? okxKeySecretMediaType
                  : null;
    if (
      requiredMediaType &&
      mediaType !== requiredMediaType &&
      !(isWalletTransferSecretRequest(request.method, path) && mediaType === "application/json")
    ) {
      reply.header("Cache-Control", "no-store");
      void reply.code(415).send(
        createErrorEnvelope({
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "This operation requires the dedicated secret ingress",
          requestId: request.id,
          retryable: false,
        }),
      );
      return;
    }
    done();
  });

  app.addContentTypeParser(walletSecretMediaType, { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );
  app.addContentTypeParser(keystoreSecretMediaType, { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );
  app.addContentTypeParser(
    securityPasswordSecretMediaType,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    addressBookSecretMediaType,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    walletTransferSecretMediaType,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(okxKeySecretMediaType, { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );

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
    const requestPath = request.url.split("?", 1)[0]!;
    if (
      errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" &&
      ((request.method === "POST" &&
        (requestPath === "/api/wallets/import" || requestPath === "/api/wallets/generate")) ||
        isKeystoreSecretRequest(request.method, requestPath) ||
        isSecurityPasswordSecretRequest(request.method, requestPath) ||
        isAddressBookSecretRequest(request.method, requestPath) ||
        isWalletTransferSecretRequest(request.method, requestPath) ||
        isOkxKeySecretRequest(request.method, requestPath) ||
        (request.method === "POST" && requestPath === "/api/swap/quote") ||
        (request.method === "POST" &&
          (requestPath === "/api/swap/execute" || requestPath === "/api/swap/execute/preview")) ||
        (request.method === "POST" &&
          (requestPath === "/api/positions/collect-fees" ||
            requestPath === "/api/positions/collect-fees/preview" ||
            requestPath === "/api/positions/remove-liquidity" ||
            requestPath === "/api/positions/remove-liquidity/preview")) ||
        (request.method === "POST" &&
          (requestPath === "/api/pricing-positions/import" ||
            /^\/api\/pricing-positions\/[^/]+\/withdrawn$/u.test(requestPath))) ||
        (request.method === "POST" && requestPath === "/api/wallets/transfers/preview") ||
        (request.method === "POST" &&
          (requestPath === "/api/wallets/helper/deploy" ||
            requestPath === "/api/wallets/helper/deploy/preview")))
    ) {
      reply.header("Cache-Control", "no-store");
      return reply.code(413).send(
        createErrorEnvelope({
          code: "REQUEST_TOO_LARGE",
          message: "The secret or transfer request is too large",
          requestId: request.id,
          retryable: false,
        }),
      );
    }
    if (
      errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" &&
      (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") &&
      (/^\/api\/monitors(?:\/[^/]+(?:\/(?:enable|disable))?)?$/u.test(requestPath) ||
        /^\/api\/notification-(?:preferences|destinations)(?:\/[^/]+)?$/u.test(requestPath))
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
      request.method === "POST" &&
      requestPath === "/api/admin/pool-creators"
    ) {
      reply.header("Cache-Control", "no-store");
      const token = sessionToken(request);
      const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
      if (resolved) {
        await options.poolCreationProvenanceStore?.recordAdminQueryAudit({
          action: "pool-creator.batch",
          actorUserId: resolved.session.userId,
          createdAt: now(),
          identityCount: 0,
          identityDigest: poolCreationIdentityDigest([]),
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
      request.method === "PATCH" &&
      requestPath === "/api/user/pool-blocklist"
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
      requestPath === "/api/address-remarks"
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
    if (errorCode === "FST_ERR_CTP_BODY_TOO_LARGE" && requestPath === "/api/system-config/chains") {
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

  const sendStatsUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send(
      createErrorEnvelope({
        code: "STATS_UNAVAILABLE",
        message: "Shell statistics are temporarily unavailable",
        requestId: request.id,
        retryable: true,
      }),
    );

  const resolveStatsScope = async (
    request: FastifyRequest,
    reply: FastifyReply,
    session: StoredSession,
    telegramUserId: string | null,
    transport: "http" | "sse",
  ): Promise<ShellStatsScope | null> => {
    if (telegramUserId === null) {
      return session.account.role === "admin"
        ? { type: "global" }
        : { type: "user", userId: session.userId };
    }
    if (session.account.role !== "admin") {
      reply.code(403).send(
        createErrorEnvelope({
          code: "FORBIDDEN",
          message: "Filtering stats by user is restricted to administrators",
          requestId: request.id,
          retryable: false,
        }),
      );
      return null;
    }
    if (!options.statsProvider) {
      sendStatsUnavailable(request, reply);
      return null;
    }
    try {
      const targetUserId = await options.statsProvider.resolveTelegramUserId(telegramUserId);
      const outcome = targetUserId === null ? "not_found" : "allowed";
      await options.statsProvider.recordAdminQueryAudit({
        actorUserId: session.userId,
        createdAt: now().toISOString(),
        outcome,
        requestId: request.id,
        targetTelegramUserId: telegramUserId,
        targetUserId,
        transport,
      });
      options.logger?.write(
        JSON.stringify({
          actorUserId: session.userId,
          event: "stats.admin_user_filter",
          outcome,
          requestId: request.id,
          targetTelegramUserId: telegramUserId,
          targetUserId,
          transport,
        }),
      );
      if (targetUserId === null) {
        reply.code(404).send(
          createErrorEnvelope({
            code: "STATS_USER_NOT_FOUND",
            message: "The Telegram user is not linked to an account",
            requestId: request.id,
            retryable: false,
          }),
        );
        return null;
      }
      return { type: "user", userId: targetUserId };
    } catch {
      sendStatsUnavailable(request, reply);
      return null;
    }
  };

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

  const addressBookAudit = (
    action: AddressBookAuditAction,
    request: FastifyRequest,
    session: StoredSession,
    input: { address?: EvmAddress | null; chainId?: number | null; entryId?: string | null } = {},
  ): AddressBookAllowedAudit => ({
    action,
    actorUserId: session.userId,
    address: input.address ?? null,
    chainId: input.chainId ?? null,
    createdAt: now(),
    entryId: input.entryId ?? null,
    requestId: request.id,
    sessionId: session.id,
  });

  const recordDeniedAddressBook = async (
    audit: AddressBookAllowedAudit,
    resultCode: string,
  ): Promise<void> => {
    await options.addressBookStore?.recordDenied({
      ...audit,
      outcome: "denied",
      resultCode,
    });
  };

  const requireAllowedWalletChain = async (
    chainId: number,
    request: FastifyRequest,
    reply: FastifyReply,
    session: StoredSession,
    localChainIds: ReadonlySet<number> | null = null,
  ): Promise<boolean> => {
    const registered = findRegisteredChain(chainId);
    if (
      (!registered?.configurationComplete && !(localChainIds?.has(chainId) ?? false)) ||
      !options.chainPolicyStore
    ) {
      reply.code(403).send(
        createErrorEnvelope({
          code: "CHAIN_NOT_ALLOWED",
          message: "The chain is not available for this account",
          requestId: request.id,
          retryable: false,
        }),
      );
      return false;
    }
    let policies: ChainAccessPolicyView[];
    try {
      policies = await options.chainPolicyStore.list();
    } catch {
      reply.code(503).send(
        createErrorEnvelope({
          code: "CHAIN_CONFIG_UNAVAILABLE",
          message: "Chain configuration is not available",
          requestId: request.id,
          retryable: true,
        }),
      );
      return false;
    }
    const allowed = effectiveAllowedChainIds(
      policies,
      session.account.role,
      session.account.tier,
    ).includes(chainId);
    if (!allowed) {
      reply.code(403).send(
        createErrorEnvelope({
          code: "CHAIN_NOT_ALLOWED",
          message: "The chain is not available for this account",
          requestId: request.id,
          retryable: false,
        }),
      );
    }
    return allowed;
  };

  const poolProvenanceRateAllowed = (session: StoredSession): boolean =>
    poolCreationProvenanceLimiter.consume(
      session.id,
      poolCreationProvenanceRateLimit.max,
      poolCreationProvenanceRateLimit.timeWindowMs,
      now().getTime(),
    );

  const recordPoolCreatorAudit = async (
    action: PoolCreationAdminAuditAction,
    request: FastifyRequest,
    session: StoredSession,
    poolKeys: readonly string[],
    outcome: "allowed" | "denied",
    resultCode: string,
  ): Promise<void> => {
    await options.poolCreationProvenanceStore?.recordAdminQueryAudit({
      action,
      actorUserId: session.userId,
      createdAt: now(),
      identityCount: poolKeys.length,
      identityDigest: poolCreationIdentityDigest(poolKeys),
      outcome,
      requestId: request.id,
      resultCode,
      sessionId: session.id,
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
    app.get("/api/pools/create-history", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.poolCreationProvenanceStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_UNAVAILABLE",
            message: "Pool creation provenance is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      let query;
      try {
        query = parsePoolCreationHistoryQuery(request.query);
      } catch (error) {
        if (!(error instanceof PoolCreationProvenanceValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_INVALID",
            message: "Pool creation history query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!poolProvenanceRateAllowed(session)) {
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many pool provenance requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const page = await options.poolCreationProvenanceStore.listByUser({
        ...query,
        userId: session.userId,
      });
      return createSuccessEnvelope(
        {
          items: page.items.map(publicPoolCreationAttribution),
          nextCursor: page.nextCursor,
        },
        request.id,
      );
    });

    app.get("/api/admin/pool-creators", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.poolCreationProvenanceStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_UNAVAILABLE",
            message: "Pool creation provenance is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      let query;
      try {
        query = parsePoolCreatorQuery(request.query);
      } catch (error) {
        if (!(error instanceof PoolCreationProvenanceValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_INVALID",
            message: "Pool creator identity is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        trustedRoleForTier(session.account.role, session.account.tier) !== "admin" ||
        !roleCanAccess(session.account.role, "admin")
      ) {
        await recordPoolCreatorAudit(
          "pool-creator.single",
          request,
          session,
          [query.poolKey],
          "denied",
          "ADMIN_REQUIRED",
        );
        return reply.code(403).send(
          createErrorEnvelope({
            code: "ADMIN_REQUIRED",
            message: "Administrator access is required",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!poolProvenanceRateAllowed(session)) {
        await recordPoolCreatorAudit(
          "pool-creator.single",
          request,
          session,
          [query.poolKey],
          "denied",
          "RATE_LIMITED",
        );
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many pool provenance requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const creator = await options.poolCreationProvenanceStore.findAttribution(query.poolKey);
        await recordPoolCreatorAudit(
          "pool-creator.single",
          request,
          session,
          [query.poolKey],
          "allowed",
          "OK",
        );
        return createSuccessEnvelope(
          {
            creator: creator ? publicPoolCreationAttribution(creator) : null,
            identity: query.identity,
          },
          request.id,
        );
      } catch (error) {
        await recordPoolCreatorAudit(
          "pool-creator.single",
          request,
          session,
          [query.poolKey],
          "denied",
          "STORE_ERROR",
        );
        throw error;
      }
    });

    app.post("/api/admin/pool-creators", { bodyLimit: 32_768 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.poolCreationProvenanceStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_UNAVAILABLE",
            message: "Pool creation provenance is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      let batch;
      try {
        batch = parsePoolCreatorBatchRequest(request.body);
      } catch (error) {
        if (!(error instanceof PoolCreationProvenanceValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "POOL_PROVENANCE_INVALID",
            message: "Pool creator batch is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        trustedRoleForTier(session.account.role, session.account.tier) !== "admin" ||
        !roleCanAccess(session.account.role, "admin")
      ) {
        await recordPoolCreatorAudit(
          "pool-creator.batch",
          request,
          session,
          batch.poolKeys,
          "denied",
          "ADMIN_REQUIRED",
        );
        return reply.code(403).send(
          createErrorEnvelope({
            code: "ADMIN_REQUIRED",
            message: "Administrator access is required",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!poolProvenanceRateAllowed(session)) {
        await recordPoolCreatorAudit(
          "pool-creator.batch",
          request,
          session,
          batch.poolKeys,
          "denied",
          "RATE_LIMITED",
        );
        return reply.code(429).send(
          createErrorEnvelope({
            code: "RATE_LIMITED",
            message: "Too many pool provenance requests",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const creators = await options.poolCreationProvenanceStore.findAttributions(batch.poolKeys);
        const results = batch.identities.map((identity, index) => {
          const creator = creators.get(batch.poolKeys[index]!) ?? null;
          return {
            creator: creator ? publicPoolCreationAttribution(creator) : null,
            identity,
          };
        });
        await recordPoolCreatorAudit(
          "pool-creator.batch",
          request,
          session,
          batch.poolKeys,
          "allowed",
          "OK",
        );
        return createSuccessEnvelope({ results }, request.id);
      } catch (error) {
        await recordPoolCreatorAudit(
          "pool-creator.batch",
          request,
          session,
          batch.poolKeys,
          "denied",
          "STORE_ERROR",
        );
        throw error;
      }
    });

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
      const query = parseStatsSnapshotQuery(request);
      if (!query) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "STATS_QUERY_INVALID",
            message: "Stats user_id or query keys are invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.statsProvider) {
        return sendStatsUnavailable(request, reply);
      }
      const scope = await resolveStatsScope(request, reply, session, query.telegramUserId, "http");
      if (!scope) return reply;
      try {
        const snapshot = await options.statsProvider.getSnapshot({ scope });
        return createSuccessEnvelope(snapshot, request.id);
      } catch {
        return sendStatsUnavailable(request, reply);
      }
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
        if (query.telegramUserId !== null && session.account.role !== "admin") {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "Filtering stats by user is restricted to administrators",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if ((query.chain === null || query.telegramUserId !== null) && !options.statsProvider) {
          return sendStatsUnavailable(request, reply);
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
        const statsScope = options.statsProvider
          ? await resolveStatsScope(request, reply, session, query.telegramUserId, "sse")
          : null;
        if (options.statsProvider && !statsScope) return reply;
        const recommendationEligibility =
          query.chain === "bsc" ? await poolEligibility(session.userId) : undefined;
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

        let initialStatsSnapshot: ShellStatsSnapshot | null = null;
        if (options.statsProvider && statsScope) {
          try {
            initialStatsSnapshot = await options.statsProvider.getSnapshot({ scope: statsScope });
          } catch {
            return sendStatsUnavailable(request, reply);
          }
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
          if (!options.statsProvider || !statsScope || !initialStatsSnapshot) return;
          let sequence = initialStatsSnapshot.sequence;
          for await (const event of options.statsProvider.subscribe({
            afterSequence: sequence,
            scope: statsScope,
            signal: controller.signal,
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
          if (
            initialStatsSnapshot &&
            !(await writeEvent({ ...initialStatsSnapshot, type: "snapshot" }))
          ) {
            controller.abort();
          }
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

    const sendMonitorUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
      reply.code(503).send(
        createErrorEnvelope({
          code: "SERVICE_UNAVAILABLE",
          message: "Monitor storage or eligibility authority is unavailable",
          requestId: request.id,
          retryable: true,
        }),
      );

    const sendMonitorMutation = (
      request: FastifyRequest,
      reply: FastifyReply,
      result: MonitorMutationResult,
    ) => {
      if (result.status === "not-found") {
        return reply.code(404).send(
          createErrorEnvelope({
            code: "MONITOR_NOT_FOUND",
            message: "The monitor was not found",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "conflict") {
        return reply.code(409).send({
          current: result.current,
          error: {
            code: "REVISION_CONFLICT",
            message: "The monitor changed in another session",
            requestId: request.id,
            retryable: true,
          },
          success: false,
        });
      }
      if (result.status === "destination-not-found") {
        return reply.code(404).send(
          createErrorEnvelope({
            code: "DESTINATION_NOT_FOUND",
            message: "A bound notification destination was not found",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "invalid") {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_MONITOR",
            message: "The monitor mutation is invalid in its current state",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "not-ready") {
        return reply.code(422).send(
          createErrorEnvelope({
            code: "MONITOR_NOT_READY",
            message: "The monitor has no enabled supported condition",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if ("value" in result) {
        return reply.send(createSuccessEnvelope(result.value, request.id));
      }
      throw new Error("Unknown monitor mutation result");
    };

    const monitorPoolEligibility = async (userId: string, poolKey: string) => {
      if (!options.poolBlocklistStore) return null;
      try {
        const snapshot = await options.poolBlocklistStore.get(userId);
        return !snapshot.entries.some(
          (entry) => entry.scope === "pool" && entry.identity === poolKey,
        );
      } catch {
        return null;
      }
    };

    app.get("/api/monitors", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
      let query;
      try {
        query = parseMonitorListQuery(request.query);
      } catch (error) {
        if (!(error instanceof MonitorValidationError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_QUERY",
            message: "The monitor list query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      return createSuccessEnvelope(
        await options.monitorStore.list(session.userId, query),
        request.id,
      );
    });

    app.post("/api/monitors", { bodyLimit: 65_536 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
      let parsed;
      let idempotencyKey;
      try {
        parsed = parseMonitorCreate(request.body);
        idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      } catch (error) {
        if (!(error instanceof MonitorValidationError)) throw error;
        return reply.code(error.code === "UNSUPPORTED_METRIC" ? 422 : 400).send(
          createErrorEnvelope({
            code: error.code,
            message:
              error.code === "UNSUPPORTED_METRIC"
                ? "The requested monitor metric is not available"
                : "The monitor request is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      const eligible = await monitorPoolEligibility(session.userId, parsed.poolKey);
      const result = await options.monitorStore.create({
        createdAt: now(),
        idempotencyKey,
        poolEligible: eligible,
        request: parsed,
        userId: session.userId,
      });
      if (result.status === "idempotency-conflict") {
        return reply.code(409).send(
          createErrorEnvelope({
            code: "IDEMPOTENCY_CONFLICT",
            message: "The idempotency key was already used with another payload",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "capacity") {
        return reply.code(422).send(
          createErrorEnvelope({
            code: "LIMIT_EXCEEDED",
            message: "The monitor limit was reached",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "destination-not-found") {
        return reply.code(404).send(
          createErrorEnvelope({
            code: "DESTINATION_NOT_FOUND",
            message: "A bound notification destination was not found",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "pool-ineligible") {
        return reply.code(422).send(
          createErrorEnvelope({
            code: "POOL_NOT_ELIGIBLE",
            message: "The pool is not eligible for monitoring",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "service-unavailable") {
        return sendMonitorUnavailable(request, reply);
      }
      if ("value" in result) {
        return reply.code(201).send(createSuccessEnvelope(result.value, request.id));
      }
      throw new Error("Unknown monitor create result");
    });

    app.get<{ Params: { monitorId: string } }>(
      "/api/monitors/:monitorId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
        const monitor = await options.monitorStore.get(session.userId, request.params.monitorId);
        if (!monitor) {
          return reply.code(404).send(
            createErrorEnvelope({
              code: "MONITOR_NOT_FOUND",
              message: "The monitor was not found",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        return createSuccessEnvelope(monitor, request.id);
      },
    );

    app.patch<{ Params: { monitorId: string } }>(
      "/api/monitors/:monitorId",
      { bodyLimit: 65_536 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
        let parsed;
        try {
          parsed = parseMonitorPatch(request.body);
        } catch (error) {
          if (!(error instanceof MonitorValidationError)) throw error;
          return reply.code(error.code === "UNSUPPORTED_METRIC" ? 422 : 400).send(
            createErrorEnvelope({
              code: error.code,
              message: "The monitor patch is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        const result = await options.monitorStore.patch({
          ...parsed,
          monitorId: request.params.monitorId,
          updatedAt: now(),
          userId: session.userId,
        });
        return sendMonitorMutation(request, reply, result);
      },
    );

    for (const enabled of [true, false]) {
      app.post<{ Params: { monitorId: string } }>(
        `/api/monitors/:monitorId/${enabled ? "enable" : "disable"}`,
        { bodyLimit: 1_024 },
        async (request, reply) => {
          reply.header("Cache-Control", "no-store");
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
          let parsed;
          try {
            parsed = parseMonitorLifecycle(request.body);
          } catch (error) {
            if (!(error instanceof MonitorValidationError)) throw error;
            return reply.code(400).send(
              createErrorEnvelope({
                code: "INVALID_MONITOR",
                message: "The monitor lifecycle request is invalid",
                requestId: request.id,
                retryable: false,
              }),
            );
          }
          if (enabled) {
            const current = await options.monitorStore.get(
              session.userId,
              request.params.monitorId,
            );
            if (!current) {
              return reply.code(404).send(
                createErrorEnvelope({
                  code: "MONITOR_NOT_FOUND",
                  message: "The monitor was not found",
                  requestId: request.id,
                  retryable: false,
                }),
              );
            }
            const eligible = await monitorPoolEligibility(session.userId, current.poolKey);
            if (eligible === null) return sendMonitorUnavailable(request, reply);
            if (!eligible) {
              return reply.code(422).send(
                createErrorEnvelope({
                  code: "POOL_NOT_ELIGIBLE",
                  message: "The pool is not eligible for monitoring",
                  requestId: request.id,
                  retryable: false,
                }),
              );
            }
          }
          const result = await options.monitorStore.setEnabled({
            enabled,
            expectedRevision: parsed.expectedRevision,
            monitorId: request.params.monitorId,
            updatedAt: now(),
            userId: session.userId,
          });
          return sendMonitorMutation(request, reply, result);
        },
      );
    }

    app.delete<{ Params: { monitorId: string } }>(
      "/api/monitors/:monitorId",
      { bodyLimit: 1_024 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.monitorStore) return sendMonitorUnavailable(request, reply);
        let parsed;
        try {
          parsed = parseMonitorLifecycle(request.body);
        } catch (error) {
          if (!(error instanceof MonitorValidationError)) throw error;
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_MONITOR",
              message: "The monitor delete request is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        const result = await options.monitorStore.delete({
          expectedRevision: parsed.expectedRevision,
          monitorId: request.params.monitorId,
          userId: session.userId,
        });
        if (result.status === "not-found") {
          return reply.code(404).send(
            createErrorEnvelope({
              code: "MONITOR_NOT_FOUND",
              message: "The monitor was not found",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (result.status === "conflict") {
          return reply.code(409).send({
            current: result.current,
            error: {
              code: "REVISION_CONFLICT",
              message: "The monitor changed in another session",
              requestId: request.id,
              retryable: true,
            },
            success: false,
          });
        }
        return reply.code(204).send();
      },
    );

    const sendNotificationUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
      reply.code(503).send(
        createErrorEnvelope({
          code: "SERVICE_UNAVAILABLE",
          message: "Notification configuration or secret storage is unavailable",
          requestId: request.id,
          retryable: true,
        }),
      );

    const sendNotificationValidation = (
      error: NotificationValidationError,
      request: FastifyRequest,
      reply: FastifyReply,
    ) =>
      reply.code(error.code === "UNSAFE_WEBHOOK_TARGET" ? 400 : 400).send(
        createErrorEnvelope({
          code: error.code,
          message: "The notification configuration is invalid",
          requestId: request.id,
          retryable: false,
        }),
      );

    const sendDestinationMutation = (
      request: FastifyRequest,
      reply: FastifyReply,
      result: NotificationDestinationMutationResult,
    ) => {
      if (result.status === "not-found") {
        return reply.code(404).send(
          createErrorEnvelope({
            code: "DESTINATION_NOT_FOUND",
            message: "The notification destination was not found",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "conflict") {
        return reply.code(409).send({
          current: result.current,
          error: {
            code: "REVISION_CONFLICT",
            message: "The notification destination changed in another session",
            requestId: request.id,
            retryable: true,
          },
          success: false,
        });
      }
      if (result.status === "invalid") {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_DESTINATION",
            message: "The notification destination is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "service-unavailable") {
        return sendNotificationUnavailable(request, reply);
      }
      if ("value" in result) {
        return reply.send(createSuccessEnvelope(result.value, request.id));
      }
      throw new Error("Unknown notification destination mutation result");
    };

    app.get("/api/notification-preferences", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
      return createSuccessEnvelope(
        await options.notificationStore.getPreferences(session.userId),
        request.id,
      );
    });

    app.patch("/api/notification-preferences", { bodyLimit: 65_536 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
      let patch;
      try {
        patch = parseNotificationPreferencesPatch(request.body);
      } catch (error) {
        if (!(error instanceof NotificationValidationError)) throw error;
        return sendNotificationValidation(error, request, reply);
      }
      const result = await options.notificationStore.updatePreferences({
        patch,
        updatedAt: now(),
        userId: session.userId,
      });
      if (result.status === "conflict") {
        return reply.code(409).send({
          current: result.current,
          error: {
            code: "REVISION_CONFLICT",
            message: "Notification preferences changed in another session",
            requestId: request.id,
            retryable: true,
          },
          success: false,
        });
      }
      return createSuccessEnvelope(result.value, request.id);
    });

    app.get("/api/notification-destinations", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
      return createSuccessEnvelope(
        await options.notificationStore.listDestinations(session.userId),
        request.id,
      );
    });

    app.get("/api/notifications/history", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationHistoryStore) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "NOTIFICATION_HISTORY_UNAVAILABLE",
            message: "Notification history is not configured",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      let query;
      try {
        query = parseNotificationHistoryQuery(request.query);
      } catch (error) {
        if (!(error instanceof NotificationHistoryQueryError)) throw error;
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_NOTIFICATION_HISTORY_QUERY",
            message: "Notification history query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      return createSuccessEnvelope(
        await options.notificationHistoryStore.list(session.userId, query),
        request.id,
      );
    });

    app.get("/api/notification-destinations/options", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
      return createSuccessEnvelope(
        { telegramIdentityId: await options.notificationStore.getTelegramIdentity(session.userId) },
        request.id,
      );
    });

    app.post("/api/notification-destinations", { bodyLimit: 65_536 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
      let draft;
      let idempotencyKey;
      try {
        draft = parseDestinationDraft(request.body);
        idempotencyKey = parseNotificationIdempotencyKey(request.headers["idempotency-key"]);
      } catch (error) {
        if (!(error instanceof NotificationValidationError)) throw error;
        return sendNotificationValidation(error, request, reply);
      }
      const result = await options.notificationStore.createDestination({
        createdAt: now(),
        draft,
        idempotencyKey,
        userId: session.userId,
      });
      if (result.status === "idempotency-conflict") {
        return reply.code(409).send(
          createErrorEnvelope({
            code: "IDEMPOTENCY_CONFLICT",
            message: "The idempotency key was already used with another destination",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "capacity") {
        return reply.code(422).send(
          createErrorEnvelope({
            code: "LIMIT_EXCEEDED",
            message: "The notification destination limit was reached",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "invalid") {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_DESTINATION",
            message: "The notification destination is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (result.status === "service-unavailable") {
        return sendNotificationUnavailable(request, reply);
      }
      if ("value" in result) {
        return reply.code(201).send(createSuccessEnvelope(result.value, request.id));
      }
      throw new Error("Unknown notification destination create result");
    });

    app.post(
      "/api/notification-destinations/test",
      { bodyLimit: 65_536 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
        try {
          const draft = parseDestinationDraft(request.body);
          if (
            draft.type === "telegram" &&
            !(await options.notificationStore.ownsTelegramIdentity(
              session.userId,
              draft.config.telegramIdentityId,
            ))
          ) {
            throw new NotificationValidationError("INVALID_DESTINATION");
          }
          return createSuccessEnvelope(renderLocalSinkTest(draft), request.id);
        } catch (error) {
          if (!(error instanceof NotificationValidationError)) throw error;
          return sendNotificationValidation(error, request, reply);
        }
      },
    );

    app.patch<{ Params: { destinationId: string } }>(
      "/api/notification-destinations/:destinationId",
      { bodyLimit: 65_536 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
        let patch;
        try {
          patch = parseNotificationDestinationPatch(request.body);
        } catch (error) {
          if (!(error instanceof NotificationValidationError)) throw error;
          return sendNotificationValidation(error, request, reply);
        }
        return sendDestinationMutation(
          request,
          reply,
          await options.notificationStore.patchDestination({
            destinationId: request.params.destinationId,
            patch,
            updatedAt: now(),
            userId: session.userId,
          }),
        );
      },
    );

    app.delete<{ Params: { destinationId: string } }>(
      "/api/notification-destinations/:destinationId",
      { bodyLimit: 1_024 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.notificationStore) return sendNotificationUnavailable(request, reply);
        let expectedRevision;
        try {
          expectedRevision = parseNotificationExpectedRevision(request.body);
        } catch (error) {
          if (!(error instanceof NotificationValidationError)) throw error;
          return sendNotificationValidation(error, request, reply);
        }
        const result = await options.notificationStore.deleteDestination({
          destinationId: request.params.destinationId,
          expectedRevision,
          updatedAt: now(),
          userId: session.userId,
        });
        if (result.status === "not-found") {
          return reply.code(404).send(
            createErrorEnvelope({
              code: "DESTINATION_NOT_FOUND",
              message: "The notification destination was not found",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (result.status === "conflict") {
          return reply.code(409).send({
            current: result.current,
            error: {
              code: "REVISION_CONFLICT",
              message: "The notification destination changed in another session",
              requestId: request.id,
              retryable: true,
            },
            success: false,
          });
        }
        return reply.code(204).send();
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

    const walletFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : null;
      const mapped =
        code === "INVALID_MODE"
          ? {
              code,
              message: "The wallet encryption mode is invalid",
              retryable: false,
              status: 400,
            }
          : code === "INVALID_PRIVATE_KEY"
            ? { code, message: "The private key is invalid", retryable: false, status: 400 }
            : code === "INVALID_WALLET"
              ? { code, message: "The wallet request is invalid", retryable: false, status: 400 }
              : code === "INVALID_CREDENTIALS" || code === "KEYSTORE_CORRUPTED"
                ? {
                    code: "INVALID_CREDENTIALS",
                    message: "The credentials are invalid",
                    retryable: false,
                    status: 401,
                  }
                : code === "LOCKED_OUT"
                  ? {
                      code,
                      message: "The Keystore is temporarily locked",
                      retryable: false,
                      status: 429,
                    }
                  : code === "INVALID_AUTO_LOCK" ||
                      code === "PASSWORD_POLICY_FAILED" ||
                      code === "CONFIRMATION_MISMATCH"
                    ? {
                        code,
                        message: "The Keystore request is invalid",
                        retryable: false,
                        status: 400,
                      }
                    : code === "SECRET_VERSION_CONFLICT" ||
                        code === "SECURITY_PASSWORD_VERSION_CONFLICT" ||
                        code === "REVISION_CONFLICT" ||
                        code === "PASSWORD_ALREADY_CONFIGURED" ||
                        code === "PREVIEW_EXPIRED" ||
                        code === "PREVIEW_CHANGED"
                      ? {
                          code,
                          message: "The Keystore state changed",
                          retryable: false,
                          status: 409,
                        }
                      : code === "DELETE_BLOCKED"
                        ? {
                            code,
                            message: "Wallet deletion is blocked by current dependencies",
                            retryable: false,
                            status: 409,
                          }
                        : code === "WALLET_ADDRESS_EXISTS"
                          ? {
                              code,
                              message: "This address is already managed",
                              retryable: false,
                              status: 409,
                            }
                          : code === "WALLET_NOT_FOUND"
                            ? {
                                code,
                                message: "The wallet was not found",
                                retryable: false,
                                status: 404,
                              }
                            : code === "SIGNER_UNAVAILABLE" ||
                                code === "CUSTODY_STORE_UNAVAILABLE" ||
                                code === "KEK_VERSION_UNAVAILABLE"
                              ? {
                                  code: "SIGNER_UNAVAILABLE",
                                  message: "The wallet signer is unavailable",
                                  retryable: true,
                                  status: 503,
                                }
                              : null;
      if (!mapped) return null;
      return reply.code(mapped.status).send(
        createErrorEnvelope({
          code: mapped.code,
          message: mapped.message,
          requestId: request.id,
          retryable: mapped.retryable,
        }),
      );
    };

    const walletAssetFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof WalletAssetError)) return null;
      const conflict =
        error.code === "DEFAULT_TOKEN_IMMUTABLE" ||
        error.code === "TOKEN_ALREADY_EXISTS" ||
        error.code === "TOKEN_METADATA_CONFLICT";
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "CHAIN_READ_UNAVAILABLE"
            ? 503
            : error.code === "TOKEN_NOT_FOUND"
              ? 404
              : conflict
                ? 409
                : 400;
      const messages: Record<WalletAssetError["code"], string> = {
        CHAIN_NOT_ALLOWED: "The chain is not available for this account",
        CHAIN_READ_UNAVAILABLE: "The controlled chain reader is unavailable",
        DEFAULT_TOKEN_IMMUTABLE: "Default tokens cannot be removed or replaced",
        INVALID_AMOUNT: "The receive amount is invalid",
        INVALID_TOKEN: "The token address is invalid",
        TOKEN_ALREADY_EXISTS: "The custom token already exists",
        TOKEN_METADATA_CONFLICT: "Stored token metadata conflicts with the chain response",
        TOKEN_METADATA_INVALID: "The ERC-20 metadata response is invalid",
        TOKEN_NOT_CONTRACT: "The token address has no contract code",
        TOKEN_NOT_FOUND: "The token is not configured for this wallet",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.code === "CHAIN_READ_UNAVAILABLE",
        }),
      );
    };

    const positionReadFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      const code =
        error instanceof PositionCursorError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "POSITION_CURSOR_INVALID")
          ? "POSITION_CURSOR_INVALID"
          : "CHAIN_READ_UNAVAILABLE";
      return reply.code(code === "POSITION_CURSOR_INVALID" ? 400 : 503).send(
        createErrorEnvelope({
          code,
          message:
            code === "POSITION_CURSOR_INVALID"
              ? "The position cursor is invalid or no longer belongs to this snapshot"
              : "The controlled position reader is unavailable",
          requestId: request.id,
          retryable: code === "CHAIN_READ_UNAVAILABLE",
        }),
      );
    };

    const swapQuoteFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      const stale =
        error instanceof SwapQuoteAdapterError &&
        ["provider-snapshot-expired", "registry-code-hash-mismatch", "registry-mismatch"].includes(
          error.reason,
        );
      return reply.code(stale ? 409 : 503).send(
        createErrorEnvelope({
          code: stale ? "SWAP_QUOTE_STALE" : "SWAP_QUOTE_UNAVAILABLE",
          message: stale
            ? "The controlled quote snapshot is stale"
            : "The controlled quote provider is unavailable",
          requestId: request.id,
          retryable: !stale,
        }),
      );
    };

    const localSwapQuoteFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      const invalid =
        error instanceof LocalSwapQuoteValidationError ||
        (error instanceof LocalSwapQuoteError && error.code === "INVALID_INPUT");
      const helperConflict =
        error instanceof LocalSwapQuoteValidationError &&
        (error.code === "HELPER_NOT_ACTIVE" || error.code === "HELPER_BINDING_MISMATCH");
      const stale =
        error instanceof LocalSwapQuoteError &&
        (error.code === "REGISTRY_MISMATCH" || error.code === "SNAPSHOT_EXPIRED");
      const code = invalid
        ? error instanceof LocalSwapQuoteValidationError
          ? error.code
          : "LOCAL_SWAP_QUOTE_INVALID"
        : stale
          ? "LOCAL_SWAP_QUOTE_STALE"
          : "LOCAL_SWAP_QUOTE_UNAVAILABLE";
      return reply
        .code(
          invalid
            ? code === "WALLET_NOT_FOUND"
              ? 404
              : helperConflict
                ? 409
                : 400
            : stale
              ? 409
              : 503,
        )
        .send(
          createErrorEnvelope({
            code,
            message: invalid
              ? code === "WALLET_NOT_FOUND"
                ? "The custody wallet was not found"
                : helperConflict
                  ? "An active verified WalletHelperV1 binding is required"
                  : "The local Swap quote request is invalid"
              : stale
                ? "The local Swap quote snapshot is stale"
                : "The local Swap quote provider is unavailable",
            requestId: request.id,
            retryable: !invalid && !stale,
          }),
        );
    };

    const pricingPositionFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      if (!(error instanceof PricingPositionError)) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "PRICING_POSITIONS_UNAVAILABLE",
            message: "The pricing position ledger is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const status =
        error.code === "PRICING_POSITION_INVALID"
          ? 400
          : error.code === "PRICING_POSITION_NOT_FOUND" ||
              error.code === "PRICING_SNAPSHOT_NOT_FOUND"
            ? 404
            : 409;
      const messages: Record<typeof error.code, string> = {
        PRICING_POSITION_INVALID: "The pricing position request is invalid",
        PRICING_POSITION_NOT_FOUND: "The pricing position was not found",
        PRICING_POSITION_REVISION_CONFLICT: "The pricing position revision has changed",
        PRICING_SNAPSHOT_NOT_FOUND: "The verified position snapshot was not found",
        PRICING_SNAPSHOT_QUARANTINED: "The position snapshot is quarantined",
        PRICING_SNAPSHOT_STALE: "The position snapshot is stale",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: false,
        }),
      );
    };

    const helperReadFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      const code =
        error instanceof HelperResidualCursorError
          ? "HELPER_RESIDUAL_CURSOR_INVALID"
          : error instanceof HelperResidualReadError
            ? error.code
            : "CHAIN_READ_UNAVAILABLE";
      const status =
        code === "HELPER_RESIDUAL_CURSOR_INVALID" || code === "HELPER_RESIDUAL_INPUT_INVALID"
          ? 400
          : code === "HELPER_UNDEPLOYED"
            ? 409
            : 503;
      const message =
        code === "HELPER_RESIDUAL_CURSOR_INVALID"
          ? "The Helper residual cursor is invalid or no longer belongs to this snapshot"
          : code === "HELPER_RESIDUAL_INPUT_INVALID"
            ? "The Helper residual request is invalid"
            : code === "HELPER_UNDEPLOYED"
              ? "The custody wallet has no trusted Helper binding"
              : "The controlled Helper reader is unavailable";
      return reply.code(status).send(
        createErrorEnvelope({
          code,
          message,
          requestId: request.id,
          retryable: status === 503,
        }),
      );
    };

    const walletTransferFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof WalletTransferError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "TRANSFER_NOT_FOUND" ||
              error.code === "WALLET_NOT_FOUND" ||
              error.code === "TOKEN_NOT_FOUND"
            ? 404
            : error.code === "TRANSFER_UNAVAILABLE"
              ? 503
              : error.code === "TOKEN_FEE_ON_TRANSFER_UNSUPPORTED"
                ? 422
                : error.code === "IDEMPOTENCY_CONFLICT" ||
                    error.code === "PREVIEW_CHANGED" ||
                    error.code === "PREVIEW_EXPIRED" ||
                    error.code === "TRANSFER_BALANCE_INSUFFICIENT" ||
                    error.code === "TRANSFER_GAS_INSUFFICIENT" ||
                    error.code === "WALLET_LOCKED"
                  ? 409
                  : 400;
      const messages: Record<WalletTransferError["code"], string> = {
        CHAIN_NOT_ALLOWED: "The chain is not available for wallet transfers",
        IDEMPOTENCY_CONFLICT: "The idempotency key is already bound to another request",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        NONCE_RECONCILIATION_REQUIRED: "The wallet nonce requires reconciliation",
        PREVIEW_CHANGED: "The transfer preview no longer matches current state",
        PREVIEW_EXPIRED: "The transfer preview has expired",
        PREVIEW_INVALID: "The transfer preview is invalid",
        SECURITY_PASSWORD_REQUIRED: "A security password is required for this recipient",
        TOKEN_FEE_ON_TRANSFER_UNSUPPORTED: "Fee-on-transfer tokens are not supported",
        TOKEN_NOT_FOUND: "The token is not configured for this wallet",
        TRANSFER_ADDRESS_INVALID: "The transfer recipient is invalid",
        TRANSFER_AMOUNT_INVALID: "The transfer amount is invalid",
        TRANSFER_BALANCE_INSUFFICIENT: "The asset balance is insufficient",
        TRANSFER_GAS_INSUFFICIENT: "The native balance cannot cover the gas cap",
        TRANSFER_NOT_FOUND: "The transfer operation was not found",
        TRANSFER_SELF_FORBIDDEN: "Self-transfers are not supported",
        TRANSFER_UNAVAILABLE: "The wallet transfer service is unavailable",
        WALLET_LOCKED: "The wallet must be unlocked before transfer",
        WALLET_NOT_FOUND: "The wallet was not found",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const helperDeploymentFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof HelperDeploymentError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "HELPER_DEPLOYMENT_NOT_FOUND" || error.code === "WALLET_NOT_FOUND"
            ? 404
            : error.code === "HELPER_DEPLOYMENT_UNAVAILABLE"
              ? 503
              : error.code === "HELPER_ADDRESS_OCCUPIED" ||
                  error.code === "HELPER_ALREADY_ACTIVE" ||
                  error.code === "HELPER_CODE_IDENTITY_MISMATCH" ||
                  error.code === "HELPER_DEPLOYMENT_IN_PROGRESS" ||
                  error.code === "IDEMPOTENCY_CONFLICT" ||
                  error.code === "NONCE_DRIFT" ||
                  error.code === "NONCE_RECONCILIATION_REQUIRED" ||
                  error.code === "PREVIEW_CHANGED" ||
                  error.code === "PREVIEW_EXPIRED" ||
                  error.code === "REGISTRY_MISMATCH" ||
                  error.code === "WALLET_LOCKED"
                ? 409
                : 400;
      const messages: Record<HelperDeploymentError["code"], string> = {
        CHAIN_NOT_ALLOWED: "The chain is not available for Helper deployment",
        HELPER_ADDRESS_OCCUPIED: "The predicted Helper address is already occupied",
        HELPER_ALREADY_ACTIVE: "This wallet already has an active Helper",
        HELPER_CODE_IDENTITY_MISMATCH: "The local Helper deployment code identity changed",
        HELPER_DEPLOYMENT_IN_PROGRESS: "A Helper deployment is already in progress",
        HELPER_DEPLOYMENT_NOT_FOUND: "The chain operation was not found",
        HELPER_DEPLOYMENT_UNAVAILABLE: "The Helper deployment service is unavailable",
        IDEMPOTENCY_CONFLICT: "The idempotency key is already bound to another request",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        NONCE_DRIFT: "The wallet nonce changed after preview",
        NONCE_RECONCILIATION_REQUIRED: "The wallet nonce requires reconciliation",
        PREVIEW_CHANGED: "The Helper deployment preview no longer matches current state",
        PREVIEW_EXPIRED: "The Helper deployment preview has expired",
        PREVIEW_INVALID: "The Helper deployment preview is invalid",
        REGISTRY_MISMATCH: "The Helper deployment Registry does not match the chain snapshot",
        WALLET_LOCKED: "The wallet must be unlocked before Helper deployment",
        WALLET_NOT_FOUND: "The wallet was not found",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const localSwapFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof LocalSwapExecutionError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "LOCAL_SWAP_NOT_FOUND" ||
              error.code === "QUOTE_NOT_FOUND" ||
              error.code === "WALLET_NOT_FOUND"
            ? 404
            : error.code === "LOCAL_SWAP_UNAVAILABLE"
              ? 503
              : error.code === "INSUFFICIENT_BALANCE"
                ? 422
                : error.code === "HELPER_BINDING_MISMATCH" ||
                    error.code === "HELPER_NOT_ACTIVE" ||
                    error.code === "IDEMPOTENCY_CONFLICT" ||
                    error.code === "NONCE_DRIFT" ||
                    error.code === "NONCE_RECONCILIATION_REQUIRED" ||
                    error.code === "PERMIT2_AUTHORIZATION_INVALID" ||
                    error.code === "PREVIEW_CHANGED" ||
                    error.code === "PREVIEW_EXPIRED" ||
                    error.code === "QUOTE_CHANGED" ||
                    error.code === "QUOTE_EXPIRED" ||
                    error.code === "QUOTE_STALE" ||
                    error.code === "REGISTRY_MISMATCH" ||
                    error.code === "WALLET_LOCKED"
                  ? 409
                  : 400;
      const messages: Record<LocalSwapExecutionError["code"], string> = {
        CHAIN_NOT_ALLOWED: "The chain is not available for local Swap execution",
        HELPER_BINDING_MISMATCH: "The active Helper binding no longer matches chain state",
        HELPER_NOT_ACTIVE: "An active per-wallet Helper is required",
        IDEMPOTENCY_CONFLICT: "The idempotency key is already bound to another request",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        INSUFFICIENT_BALANCE: "The wallet token balance is insufficient",
        LOCAL_SWAP_NOT_FOUND: "The chain operation was not found",
        LOCAL_SWAP_UNAVAILABLE: "The local Swap execution service is unavailable",
        NONCE_DRIFT: "The wallet nonce changed after preview",
        NONCE_RECONCILIATION_REQUIRED: "The wallet nonce requires reconciliation",
        PERMIT2_AUTHORIZATION_INVALID: "The Permit2 authorization is invalid",
        PREVIEW_CHANGED: "The local Swap preview no longer matches current state",
        PREVIEW_EXPIRED: "The local Swap preview has expired",
        PREVIEW_INVALID: "The local Swap preview is invalid",
        QUOTE_CHANGED: "The local Swap quote no longer matches its stored snapshot",
        QUOTE_EXPIRED: "The local Swap quote has expired",
        QUOTE_NOT_FOUND: "The local Swap quote was not found",
        QUOTE_STALE: "The local Swap quote is stale at the current block",
        REGISTRY_MISMATCH: "The local Swap Registry does not match chain state",
        WALLET_LOCKED: "The wallet must be unlocked before Swap execution",
        WALLET_NOT_FOUND: "The wallet was not found",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const localPositionFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof LocalPositionExecutionError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "LOCAL_POSITION_NOT_FOUND" ||
              error.code === "SNAPSHOT_NOT_FOUND" ||
              error.code === "WALLET_NOT_FOUND"
            ? 404
            : error.code === "LOCAL_POSITION_UNAVAILABLE"
              ? 503
              : error.code === "ZERO_LIQUIDITY_DELTA"
                ? 422
                : error.code === "BURN_NOT_ALLOWED" ||
                    error.code === "IDEMPOTENCY_CONFLICT" ||
                    error.code === "MANAGER_IDENTITY_MISMATCH" ||
                    error.code === "NONCE_DRIFT" ||
                    error.code === "NONCE_RECONCILIATION_REQUIRED" ||
                    error.code === "OWNER_APPROVAL_MISMATCH" ||
                    error.code === "PREVIEW_CHANGED" ||
                    error.code === "PREVIEW_EXPIRED" ||
                    error.code === "REGISTRY_MISMATCH" ||
                    error.code === "SNAPSHOT_CHANGED" ||
                    error.code === "SNAPSHOT_EXPIRED" ||
                    error.code === "SNAPSHOT_REORGED" ||
                    error.code === "SNAPSHOT_STALE" ||
                    error.code === "TOKEN_IDENTITY_MISMATCH" ||
                    error.code === "WALLET_LOCKED"
                  ? 409
                  : 400;
      const messages: Record<LocalPositionExecutionError["code"], string> = {
        BURN_NOT_ALLOWED: "Burn is available only for an exact 100% exit",
        CHAIN_NOT_ALLOWED: "The chain is not available for local position execution",
        IDEMPOTENCY_CONFLICT: "The idempotency key is already bound to another request",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        LOCAL_POSITION_NOT_FOUND: "The chain operation was not found",
        LOCAL_POSITION_UNAVAILABLE: "The local position execution service is unavailable",
        MANAGER_IDENTITY_MISMATCH: "The position manager identity changed",
        NONCE_DRIFT: "The wallet nonce changed after preview",
        NONCE_RECONCILIATION_REQUIRED: "The wallet nonce requires reconciliation",
        OWNER_APPROVAL_MISMATCH: "The position owner or approval changed",
        PREVIEW_CHANGED: "The local position preview no longer matches current state",
        PREVIEW_EXPIRED: "The local position preview has expired",
        PREVIEW_INVALID: "The local position preview is invalid",
        REGISTRY_MISMATCH: "The local position Registry does not match the snapshot",
        SNAPSHOT_CHANGED: "The local position snapshot changed",
        SNAPSHOT_EXPIRED: "The local position snapshot has expired",
        SNAPSHOT_NOT_FOUND: "The local position snapshot was not found",
        SNAPSHOT_REORGED: "The local position snapshot block was reorganized",
        SNAPSHOT_STALE: "The local position snapshot is stale",
        TOKEN_IDENTITY_MISMATCH: "A position token identity changed",
        WALLET_LOCKED: "The wallet must be unlocked before position execution",
        WALLET_NOT_FOUND: "The wallet was not found",
        ZERO_LIQUIDITY_DELTA: "The selected percentage rounds to zero liquidity",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const localHelperSweepFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof LocalHelperSweepError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "HELPER_NOT_FOUND" ||
              error.code === "LOCAL_HELPER_SWEEP_NOT_FOUND" ||
              error.code === "SNAPSHOT_NOT_FOUND" ||
              error.code === "WALLET_NOT_FOUND"
            ? 404
            : error.code === "LOCAL_HELPER_SWEEP_UNAVAILABLE"
              ? 503
              : error.code === "ZERO_BALANCE"
                ? 422
                : error.code === "PREVIEW_INVALID" ||
                    error.code === "IDEMPOTENCY_KEY_REQUIRED" ||
                    error.code === "DUPLICATE_ASSET_ID" ||
                    error.code === "UNKNOWN_ASSET"
                  ? 400
                  : 409;
      const messages: Record<LocalHelperSweepError["code"], string> = {
        ASSET_ALREADY_CONFIRMED: "The selected residual asset was already confirmed",
        BATCH_IN_PROGRESS: "Another Helper sweep batch is still active for this wallet",
        CHAIN_NOT_ALLOWED: "Helper sweep execution is available only on local Anvil",
        DUPLICATE_ASSET_ID: "Each residual asset may appear only once",
        HELPER_BINDING_MISMATCH: "The Helper binding or immutable identity does not match",
        HELPER_NOT_FOUND: "A deployed per-wallet Helper is required",
        IDEMPOTENCY_CONFLICT: "The idempotency key is already bound to another batch",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        LOCAL_HELPER_SWEEP_NOT_FOUND: "The Helper sweep operation or batch was not found",
        LOCAL_HELPER_SWEEP_UNAVAILABLE: "The local Helper sweep service is unavailable",
        MANUAL_RECOVERY_REQUIRED: "This residual requires manual recovery",
        NONCE_DRIFT: "The wallet nonce changed after preview",
        NONCE_RECONCILIATION_REQUIRED: "The wallet nonce requires reconciliation",
        PREVIEW_CHANGED: "The Helper sweep preview no longer matches current state",
        PREVIEW_EXPIRED: "The Helper sweep preview has expired",
        PREVIEW_INVALID: "The Helper sweep preview is invalid",
        REGISTRY_MISMATCH: "The local Helper sweep Registry does not match",
        SNAPSHOT_CHANGED: "The local Helper residual snapshot changed",
        SNAPSHOT_EXPIRED: "The local Helper residual snapshot has expired",
        SNAPSHOT_NOT_FOUND: "The local Helper residual snapshot was not found",
        SNAPSHOT_REORGED: "The local Helper residual snapshot block was reorganized",
        SNAPSHOT_STALE: "The local Helper residual snapshot is stale",
        UNKNOWN_ASSET: "The selected residual asset is not allowlisted",
        WALLET_LOCKED: "The wallet must be unlocked before Helper sweep execution",
        WALLET_NOT_FOUND: "The wallet was not found",
        ZERO_BALANCE: "The selected residual is zero or within dust",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const localHelperUpgradeFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof LocalHelperUpgradeError)) return null;
      const status =
        error.code === "CHAIN_NOT_ALLOWED"
          ? 403
          : error.code === "BINDING_NOT_FOUND" ||
              error.code === "HELPER_UPGRADE_NOT_FOUND" ||
              error.code === "WALLET_NOT_FOUND"
            ? 404
            : error.code === "HELPER_UPGRADE_UNAVAILABLE"
              ? 503
              : error.code === "IDEMPOTENCY_KEY_REQUIRED" || error.code === "PREVIEW_INVALID"
                ? 400
                : 409;
      const messages: Record<LocalHelperUpgradeError["code"], string> = {
        BINDING_NOT_FOUND: "An active WalletHelperV1 binding is required",
        CHAIN_NOT_ALLOWED: "Helper upgrade execution is available only on local Anvil",
        HELPER_UPGRADE_IN_PROGRESS: "Another Helper upgrade is active for this wallet",
        HELPER_UPGRADE_NOT_FOUND: "The Helper upgrade operation was not found",
        HELPER_UPGRADE_UNAVAILABLE: "The local Helper upgrade service is unavailable",
        IDEMPOTENCY_CONFLICT: "The idempotency key is bound to another Helper upgrade",
        IDEMPOTENCY_KEY_REQUIRED: "A valid Idempotency-Key header is required",
        MANUAL_RECOVERY_REQUIRED: "WalletHelperV1 requires manual recovery before upgrade",
        NONCE_CONFLICT: "The wallet nonce is reserved by another operation",
        PREFLIGHT_FAILED: "The Helper upgrade preflight no longer passes",
        PREVIEW_CHANGED: "The Helper upgrade preview no longer matches current state",
        PREVIEW_EXPIRED: "The Helper upgrade preview has expired",
        PREVIEW_INVALID: "The Helper upgrade preview is invalid",
        PROVIDER_DIVERGENCE: "The local providers disagree on chain or nonce state",
        TARGET_ADDRESS_OCCUPIED: "The expected WalletHelperV2 address is already occupied",
        WALLET_LOCKED: "The wallet must be unlocked before Helper upgrade",
        WALLET_NOT_FOUND: "The wallet was not found",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    const addressBookFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply | null => {
      if (!(error instanceof AddressBookError)) return null;
      const status =
        error.code === "ADDRESS_BOOK_ENTRY_NOT_FOUND"
          ? 404
          : error.code === "ADDRESS_BOOK_INVALID"
            ? 400
            : 409;
      const messages: Record<AddressBookError["code"], string> = {
        ADDRESS_BOOK_DUPLICATE: "The external address already exists in the address book",
        ADDRESS_BOOK_ENTRY_NOT_FOUND: "The address-book entry was not found",
        ADDRESS_BOOK_INVALID: "The address-book request is invalid",
        ADDRESS_BOOK_REVISION_CONFLICT: "The address-book entry changed in another session",
        ADDRESS_IS_OWN_WALLET: "Owned wallets are already available in the wallet directory",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.code === "ADDRESS_BOOK_REVISION_CONFLICT",
        }),
      );
    };

    const requireFreshReauthentication = async (
      request: FastifyRequest,
      reply: FastifyReply,
      session: StoredSession,
    ): Promise<boolean> => {
      const header = request.headers["x-lpbot-reauthentication"];
      const proof = typeof header === "string" && header.length <= 512 ? header : null;
      let verified: boolean;
      try {
        verified =
          (await options.freshReauthentication?.verify({
            proof,
            requestId: request.id,
            session,
          })) ?? false;
      } catch {
        verified = false;
      }
      if (verified) return true;
      reply.code(403).send(
        createErrorEnvelope({
          code: "REAUTH_REQUIRED",
          message: "Fresh reauthentication is required",
          requestId: request.id,
          retryable: false,
        }),
      );
      return false;
    };

    const keystoreUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
      reply.code(503).send(
        createErrorEnvelope({
          code: "SIGNER_UNAVAILABLE",
          message: "The Keystore signer is unavailable",
          requestId: request.id,
          retryable: true,
        }),
      );

    const securityPasswordUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
      reply.code(503).send(
        createErrorEnvelope({
          code: "SIGNER_UNAVAILABLE",
          message: "The security password service is unavailable",
          requestId: request.id,
          retryable: true,
        }),
      );

    const okxKeyFailure = (
      error: unknown,
      request: FastifyRequest,
      reply: FastifyReply,
    ): FastifyReply => {
      if (!(error instanceof OkxKeyError)) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CONNECTOR_UNAVAILABLE",
            message: "The OKX credential connector is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const status =
        error.code === "INVALID_CREDENTIAL_INGRESS"
          ? 400
          : error.code === "CREDENTIAL_NOT_CONFIGURED"
            ? 404
            : error.code === "VERSION_CONFLICT" ||
                error.code === "CREDENTIAL_ALREADY_CONFIGURED" ||
                error.code === "CAPABILITY_EXPIRED" ||
                error.code === "CREDENTIAL_REVOKED"
              ? 409
              : error.code === "CREDENTIAL_INVALID" || error.code === "INSUFFICIENT_PERMISSION"
                ? 422
                : 503;
      const messages: Record<OkxKeyError["code"], string> = {
        CAPABILITY_EXPIRED: "The OKX credential changed while the request was running",
        CONNECTOR_UNAVAILABLE: "The OKX credential connector is unavailable",
        CREDENTIAL_ALREADY_CONFIGURED: "An OKX credential is already configured",
        CREDENTIAL_INTEGRITY_FAILED: "The OKX credential integrity check failed",
        CREDENTIAL_INVALID: "OKX rejected the credential",
        CREDENTIAL_NOT_CONFIGURED: "No OKX credential is configured",
        CREDENTIAL_REVOKED: "The OKX credential must be replaced",
        EGRESS_DENIED: "The OKX validation egress policy denied the request",
        INSUFFICIENT_PERMISSION: "The OKX credential must be read-only and IP restricted",
        INVALID_CREDENTIAL_INGRESS: "The OKX credential request is invalid",
        KMS_UNAVAILABLE: "The OKX credential key service is unavailable",
        PROVIDER_UNKNOWN: "The OKX credential could not be verified",
        VERSION_CONFLICT: "The OKX credential version changed in another session",
      };
      return reply.code(status).send(
        createErrorEnvelope({
          code: error.code,
          message: messages[error.code],
          requestId: request.id,
          retryable: error.retryable,
        }),
      );
    };

    app.get("/api/settings/okx-key", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.okxKey) return okxKeyFailure(null, request, reply);
      try {
        return createSuccessEnvelope(
          publicOkxKeyStatus(
            await options.okxKey.status({
              actor: `session:${session.id}`,
              requestId: request.id,
              userId: session.userId,
            }),
          ),
          request.id,
        );
      } catch (error) {
        return okxKeyFailure(error, request, reply);
      }
    });

    const mutateOkxKey = async (
      operation: "delete" | "replace" | "save" | "test",
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<unknown> => {
      reply.header("Cache-Control", "no-store");
      const ingress = Buffer.isBuffer(request.body) ? request.body : null;
      try {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!ingress) {
          return reply.code(415).send(
            createErrorEnvelope({
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "OKX credential mutations require the dedicated secret ingress",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.okxKey) return okxKeyFailure(null, request, reply);
        const context = {
          actor: `session:${session.id}`,
          ingress,
          requestId: request.id,
          userId: session.userId,
        };
        const status = await options.okxKey[operation](context);
        return reply
          .code(operation === "save" ? 201 : 200)
          .send(createSuccessEnvelope(publicOkxKeyStatus(status), request.id));
      } catch (error) {
        return okxKeyFailure(error, request, reply);
      } finally {
        ingress?.fill(0);
      }
    };

    app.post("/api/settings/okx-key", { bodyLimit: okxKeySecretBodyLimit }, (request, reply) =>
      mutateOkxKey("save", request, reply),
    );
    app.put("/api/settings/okx-key", { bodyLimit: okxKeySecretBodyLimit }, (request, reply) =>
      mutateOkxKey("replace", request, reply),
    );
    app.delete("/api/settings/okx-key", { bodyLimit: okxKeySecretBodyLimit }, (request, reply) =>
      mutateOkxKey("delete", request, reply),
    );
    app.post("/api/settings/okx-key/test", { bodyLimit: okxKeySecretBodyLimit }, (request, reply) =>
      mutateOkxKey("test", request, reply),
    );

    app.get("/api/security-password/status", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.securityPassword) return securityPasswordUnavailable(request, reply);
      try {
        return createSuccessEnvelope(
          publicSecurityPasswordStatus(
            await options.securityPassword.securityPasswordStatus(session.userId),
          ),
          request.id,
        );
      } catch (error) {
        return walletFailure(error, request, reply) ?? securityPasswordUnavailable(request, reply);
      }
    });

    app.put("/api/security-password", { bodyLimit: 16_384 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const ingress = Buffer.isBuffer(request.body) ? request.body : null;
      try {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!ingress) {
          return reply.code(415).send(
            createErrorEnvelope({
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Security password mutation requires the dedicated secret ingress",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.securityPassword) return securityPasswordUnavailable(request, reply);
        return createSuccessEnvelope(
          publicSecurityPasswordStatus(
            await options.securityPassword.putSecurityPassword({
              ingress,
              userId: session.userId,
            }),
          ),
          request.id,
        );
      } catch (error) {
        return walletFailure(error, request, reply) ?? securityPasswordUnavailable(request, reply);
      } finally {
        ingress?.fill(0);
      }
    });

    app.get("/api/address-book", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.addressBookStore || !options.walletDirectory) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "ADDRESS_BOOK_UNAVAILABLE",
            message: "The address book is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const query = parseAddressBookQuery(request.query);
      if (!query) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "ADDRESS_BOOK_INVALID",
            message: "The address-book query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!(await requireAllowedWalletChain(query.chainId, request, reply, session))) return reply;
      try {
        const [entries, walletPage] = await Promise.all([
          options.addressBookStore.list({ chainId: query.chainId, userId: session.userId }),
          options.walletDirectory.listWallets(session.userId),
        ]);
        const wallets = walletPage.items.map(publicWalletDto);
        let classification = null;
        if (query.address !== undefined) {
          try {
            classification = classifyAddress({
              address: canonicalWalletAddress(query.address),
              entries,
              wallets,
            });
          } catch {
            throw new AddressBookError("ADDRESS_BOOK_INVALID");
          }
        }
        return createSuccessEnvelope(
          {
            chainId: query.chainId,
            classification,
            entries,
            ownWallets: wallets.map(({ address, name, walletId }) => ({ address, name, walletId })),
          },
          request.id,
        );
      } catch (error) {
        return (
          addressBookFailure(error, request, reply) ??
          walletFailure(error, request, reply) ??
          reply.code(503).send(
            createErrorEnvelope({
              code: "ADDRESS_BOOK_UNAVAILABLE",
              message: "The address book is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          )
        );
      }
    });

    app.post("/api/address-book", { bodyLimit: 4_096 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const ingress = Buffer.isBuffer(request.body) ? request.body : null;
      let passwordIngress: Buffer | null = null;
      let audit: AddressBookAllowedAudit | null = null;
      try {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!ingress) {
          return reply.code(415).send(
            createErrorEnvelope({
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Address-book creation requires the dedicated secret ingress",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.addressBookStore || !options.walletDirectory) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "ADDRESS_BOOK_UNAVAILABLE",
              message: "The address book is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        if (!options.securityPassword) return securityPasswordUnavailable(request, reply);
        let parsed;
        try {
          parsed = parseAddressBookCreateIngress(ingress);
        } catch (error) {
          if (error instanceof WalletAssetError) {
            throw new AddressBookError("ADDRESS_BOOK_INVALID", { cause: error });
          }
          throw error;
        }
        audit = addressBookAudit("address-book.create", request, session, {
          address: parsed.address,
          chainId: parsed.chainId,
        });
        if (!(await requireAllowedWalletChain(parsed.chainId, request, reply, session))) {
          await recordDeniedAddressBook(audit, "CHAIN_NOT_ALLOWED");
          return reply;
        }
        const [entries, walletPage] = await Promise.all([
          options.addressBookStore.list({ chainId: parsed.chainId, userId: session.userId }),
          options.walletDirectory.listWallets(session.userId),
        ]);
        const classification = classifyAddress({
          address: parsed.address,
          entries,
          wallets: walletPage.items.map(publicWalletDto),
        });
        if (classification.kind === "own-wallet") {
          throw new AddressBookError("ADDRESS_IS_OWN_WALLET");
        }
        if (classification.kind === "known-external") {
          throw new AddressBookError("ADDRESS_BOOK_DUPLICATE");
        }
        passwordIngress = Buffer.from(JSON.stringify({ password: parsed.password }), "utf8");
        parsed.password = "";
        const verified = await options.securityPassword.verifySecurityPassword({
          ingress: passwordIngress,
          userId: session.userId,
        });
        if (
          verified.verified !== true ||
          !Number.isSafeInteger(verified.version) ||
          verified.version < 1
        ) {
          throw new WalletApiError("SIGNER_UNAVAILABLE");
        }
        const value = await options.addressBookStore.create({
          address: parsed.address,
          audit,
          category: parsed.category,
          chainId: parsed.chainId,
          createdAt: now(),
          label: parsed.label,
          note: parsed.note,
          userId: session.userId,
        });
        audit = null;
        return reply.code(201).send(createSuccessEnvelope(value, request.id));
      } catch (error) {
        if (audit) {
          const resultCode =
            typeof error === "object" && error !== null && "code" in error
              ? String((error as { code: unknown }).code)
              : "INTERNAL_ERROR";
          await recordDeniedAddressBook(audit, resultCode);
        }
        const response =
          addressBookFailure(error, request, reply) ?? walletFailure(error, request, reply);
        if (response) return response;
        throw error;
      } finally {
        passwordIngress?.fill(0);
        ingress?.fill(0);
      }
    });

    app.patch<{ Params: { entryId: string } }>(
      "/api/address-book/:entryId",
      { bodyLimit: 2_048 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.addressBookStore) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "ADDRESS_BOOK_UNAVAILABLE",
              message: "The address book is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        let audit: AddressBookAllowedAudit | null = null;
        try {
          const entryId = parseAddressBookEntryId(request.params.entryId);
          const current = await options.addressBookStore.get({ entryId, userId: session.userId });
          if (!current) throw new AddressBookError("ADDRESS_BOOK_ENTRY_NOT_FOUND");
          audit = addressBookAudit("address-book.patch", request, session, {
            address: current.address,
            chainId: current.chainId,
            entryId,
          });
          if (!(await requireAllowedWalletChain(current.chainId, request, reply, session))) {
            await recordDeniedAddressBook(audit, "CHAIN_NOT_ALLOWED");
            audit = null;
            return reply;
          }
          const patch = parseAddressBookPatch(request.body);
          const value = await options.addressBookStore.patch({
            ...patch,
            audit,
            entryId,
            updatedAt: now(),
            userId: session.userId,
          });
          audit = null;
          return createSuccessEnvelope(value, request.id);
        } catch (error) {
          if (audit) {
            await recordDeniedAddressBook(
              audit,
              error instanceof AddressBookError ? error.code : "INTERNAL_ERROR",
            );
          }
          return addressBookFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.delete<{ Params: { entryId: string } }>(
      "/api/address-book/:entryId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.addressBookStore) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "ADDRESS_BOOK_UNAVAILABLE",
              message: "The address book is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        let audit: AddressBookAllowedAudit | null = null;
        try {
          const entryId = parseAddressBookEntryId(request.params.entryId);
          const current = await options.addressBookStore.get({ entryId, userId: session.userId });
          if (!current) throw new AddressBookError("ADDRESS_BOOK_ENTRY_NOT_FOUND");
          audit = addressBookAudit("address-book.delete", request, session, {
            address: current.address,
            chainId: current.chainId,
            entryId,
          });
          if (!(await requireAllowedWalletChain(current.chainId, request, reply, session))) {
            await recordDeniedAddressBook(audit, "CHAIN_NOT_ALLOWED");
            audit = null;
            return reply;
          }
          const deleted = await options.addressBookStore.delete({
            audit,
            deletedAt: now(),
            entryId,
            userId: session.userId,
          });
          audit = null;
          return createSuccessEnvelope({ deleted }, request.id);
        } catch (error) {
          if (audit) {
            await recordDeniedAddressBook(
              audit,
              error instanceof AddressBookError ? error.code : "INTERNAL_ERROR",
            );
          }
          return addressBookFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get("/api/keystore/status", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.keystore) return keystoreUnavailable(request, reply);
      try {
        const status = await options.keystore.keystoreStatus(session.userId, session.id);
        return createSuccessEnvelope(publicKeystoreStatus(status), request.id);
      } catch (error) {
        return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
      }
    });

    app.post(
      "/api/keystore/unlock",
      { bodyLimit: keystoreSecretBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const ingress = Buffer.isBuffer(request.body) ? request.body : null;
        try {
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!(await requireFreshReauthentication(request, reply, session))) return reply;
          if (!ingress)
            return reply.code(415).send(
              createErrorEnvelope({
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "Keystore unlock requires the dedicated secret ingress",
                requestId: request.id,
                retryable: false,
              }),
            );
          if (!options.keystore) return keystoreUnavailable(request, reply);
          const status = await options.keystore.unlockKeystore({
            ingress,
            reauthenticatedSessionId: session.id,
            userId: session.userId,
          });
          return createSuccessEnvelope(publicKeystoreStatus(status), request.id);
        } catch (error) {
          return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
        } finally {
          ingress?.fill(0);
        }
      },
    );

    app.post("/api/keystore/lock", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.keystore) return keystoreUnavailable(request, reply);
      try {
        return createSuccessEnvelope(
          publicKeystoreStatus(await options.keystore.lockKeystore(session.userId)),
          request.id,
        );
      } catch (error) {
        return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
      }
    });

    app.patch("/api/keystore/auto-lock", { bodyLimit: 16_384 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.keystore) return keystoreUnavailable(request, reply);
      const body = request.body;
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(",") !== "expectedVersion,minutes"
      ) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_AUTO_LOCK",
            message: "The auto-lock request is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      try {
        const value = body as Record<string, unknown>;
        const status = await options.keystore.updateKeystoreAutoLock({
          expectedVersion: Number(value.expectedVersion),
          minutes: Number(value.minutes),
          reauthenticatedSessionId: session.id,
          userId: session.userId,
        });
        return createSuccessEnvelope(publicKeystoreStatus(status), request.id);
      } catch (error) {
        return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
      }
    });

    const mutateKeystorePassword = async (
      mode: "create" | "change",
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      reply.header("Cache-Control", "no-store");
      const ingress = Buffer.isBuffer(request.body) ? request.body : null;
      try {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!ingress)
          return reply.code(415).send(
            createErrorEnvelope({
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Password mutation requires the dedicated secret ingress",
              requestId: request.id,
              retryable: false,
            }),
          );
        if (!options.keystore) return keystoreUnavailable(request, reply);
        const status =
          mode === "create"
            ? await options.keystore.createKeystorePassword({ ingress, userId: session.userId })
            : await options.keystore.changeKeystorePassword({ ingress, userId: session.userId });
        return createSuccessEnvelope(publicKeystoreStatus(status), request.id);
      } catch (error) {
        return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
      } finally {
        ingress?.fill(0);
      }
    };

    app.post("/api/keystore/password", { bodyLimit: keystoreSecretBodyLimit }, (request, reply) =>
      mutateKeystorePassword("create", request, reply),
    );
    app.put("/api/keystore/password", { bodyLimit: keystoreSecretBodyLimit }, (request, reply) =>
      mutateKeystorePassword("change", request, reply),
    );

    app.get("/api/keystore/reset-preview", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.keystore) return keystoreUnavailable(request, reply);
      try {
        const preview = await options.keystore.createKeystoreResetPreview(session.userId);
        return createSuccessEnvelope(publicKeystoreResetPreview(preview), request.id);
      } catch (error) {
        return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
      }
    });

    app.post(
      "/api/keystore/reset",
      { bodyLimit: keystoreSecretBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const ingress = Buffer.isBuffer(request.body) ? request.body : null;
        try {
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!(await requireFreshReauthentication(request, reply, session))) return reply;
          if (!ingress)
            return reply.code(415).send(
              createErrorEnvelope({
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "Keystore reset requires the dedicated secret ingress",
                requestId: request.id,
                retryable: false,
              }),
            );
          if (!options.keystore) return keystoreUnavailable(request, reply);
          const status = await options.keystore.resetKeystore({ ingress, userId: session.userId });
          return reply
            .code(202)
            .send(createSuccessEnvelope(publicKeystoreStatus(status), request.id));
        } catch (error) {
          return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
        } finally {
          ingress?.fill(0);
        }
      },
    );

    app.post<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/encryption-mode",
      { bodyLimit: keystoreSecretBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const ingress = Buffer.isBuffer(request.body) ? request.body : null;
        try {
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!(await requireFreshReauthentication(request, reply, session))) return reply;
          if (!ingress)
            return reply.code(415).send(
              createErrorEnvelope({
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "Mode switching requires the dedicated secret ingress",
                requestId: request.id,
                retryable: false,
              }),
            );
          if (!options.keystore || !options.tenantId) return keystoreUnavailable(request, reply);
          const wallet = await options.keystore.changeWalletEncryptionMode({
            ingress,
            tenantId: options.tenantId,
            userId: session.userId,
            walletId: parseWalletId(request.params.walletId),
          });
          return reply.code(202).send(createSuccessEnvelope(publicWalletDto(wallet), request.id));
        } catch (error) {
          return walletFailure(error, request, reply) ?? keystoreUnavailable(request, reply);
        } finally {
          ingress?.fill(0);
        }
      },
    );

    app.post(
      "/api/wallets/helper/deploy/preview",
      { bodyLimit: helperDeploymentBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.helperDeployments || !options.tenantId) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "HELPER_DEPLOYMENT_UNAVAILABLE",
              message: "The Helper deployment service is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const deployment = parseHelperDeploymentPreviewRequest(request.body);
          if (
            !(await requireAllowedWalletChain(
              deployment.chainId,
              request,
              reply,
              session,
              helperDeploymentLocalChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(
            session.userId,
            deployment.walletId,
          );
          if (!wallet) throw new HelperDeploymentError("WALLET_NOT_FOUND");
          const preview = await options.helperDeployments.preview({
            request: deployment,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return createSuccessEnvelope(preview, request.id);
        } catch (error) {
          return helperDeploymentFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/helper/deploy",
      { bodyLimit: helperDeploymentBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.helperDeployments || !options.tenantId) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "HELPER_DEPLOYMENT_UNAVAILABLE",
              message: "The Helper deployment service is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const idempotencyKey = parseHelperDeploymentIdempotencyKey(
            request.headers["idempotency-key"],
          );
          const deployment = parseHelperDeploymentSubmit(request.body);
          if (
            !(await requireAllowedWalletChain(
              deployment.chainId,
              request,
              reply,
              session,
              helperDeploymentLocalChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(
            session.userId,
            deployment.walletId,
          );
          if (!wallet) throw new HelperDeploymentError("WALLET_NOT_FOUND");
          const result = await options.helperDeployments.submit({
            idempotencyKey,
            request: deployment,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return helperDeploymentFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/swap/execute/preview",
      { bodyLimit: localSwapExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localSwapExecutions || !options.tenantId) {
          return localSwapFailure(
            new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const input = parseLocalSwapExecutePreview(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localSwapExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalSwapExecutionError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.localSwapExecutions.preview({
              request: input,
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            request.id,
          );
        } catch (error) {
          return localSwapFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/swap/execute",
      { bodyLimit: localSwapExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory || !options.localSwapExecutions || !options.tenantId) {
          return localSwapFailure(
            new LocalSwapExecutionError("LOCAL_SWAP_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const idempotencyKey = parseLocalSwapIdempotencyKey(request.headers["idempotency-key"]);
          const input = parseLocalSwapExecute(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localSwapExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalSwapExecutionError("WALLET_NOT_FOUND");
          const result = await options.localSwapExecutions.submit({
            idempotencyKey,
            request: input,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return localSwapFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get<{ Querystring: { walletId?: unknown } }>(
      "/api/positions/local-current",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localPositionExecutions || !options.tenantId) {
          return localPositionFailure(
            new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          if (
            Object.keys(request.query as Record<string, unknown>).length !== 1 ||
            !("walletId" in request.query)
          ) {
            throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          }
          const walletId = parseLocalPositionWalletId(request.query.walletId);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localPositionExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          const page = {
            chainId: 31_337,
            executionEnabled: true,
            items: await options.localPositionExecutions.current({
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            registryVersion: "p05-local-position-execution-v2",
            serviceFeeBps: 0,
            walletId,
          } satisfies LocalPositionCurrentPage;
          return createSuccessEnvelope(page, request.id);
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/positions/collect-fees/preview",
      { bodyLimit: localPositionExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localPositionExecutions || !options.tenantId) {
          return localPositionFailure(
            new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const input = parseLocalPositionCollectFeesPreview(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localPositionExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.localPositionExecutions.previewCollectFees({
              request: input,
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            request.id,
          );
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/positions/collect-fees",
      { bodyLimit: localPositionExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory || !options.localPositionExecutions || !options.tenantId) {
          return localPositionFailure(
            new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const idempotencyKey = parseLocalPositionIdempotencyKey(
            request.headers["idempotency-key"],
          );
          const input = parseLocalPositionCollectFees(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localPositionExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          const result = await options.localPositionExecutions.collectFees({
            idempotencyKey,
            request: input,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/positions/remove-liquidity/preview",
      { bodyLimit: localPositionExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localPositionExecutions || !options.tenantId) {
          return localPositionFailure(
            new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const input = parseLocalPositionRemoveLiquidityPreview(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localPositionExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.localPositionExecutions.previewRemoveLiquidity({
              request: input,
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            request.id,
          );
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/positions/remove-liquidity",
      { bodyLimit: localPositionExecutionBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory || !options.localPositionExecutions || !options.tenantId) {
          return localPositionFailure(
            new LocalPositionExecutionError("LOCAL_POSITION_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const idempotencyKey = parseLocalPositionIdempotencyKey(
            request.headers["idempotency-key"],
          );
          const input = parseLocalPositionRemoveLiquidity(request.body);
          if (
            !(await requireAllowedWalletChain(
              31_337,
              request,
              reply,
              session,
              localPositionExecutionChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalPositionExecutionError("WALLET_NOT_FOUND");
          const result = await options.localPositionExecutions.removeLiquidity({
            idempotencyKey,
            request: input,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/helper/upgrade/preview",
      { bodyLimit: localHelperUpgradeBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localHelperUpgrades || !options.tenantId) {
          return localHelperUpgradeFailure(
            new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const input = parseLocalHelperUpgradePreview(request.body);
          if (
            !(await requireAllowedWalletChain(
              input.chainId,
              request,
              reply,
              session,
              localHelperUpgradeChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalHelperUpgradeError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.localHelperUpgrades.preview({
              request: input,
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            request.id,
          );
        } catch (error) {
          return localHelperUpgradeFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/helper/upgrade",
      { bodyLimit: localHelperUpgradeBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory || !options.localHelperUpgrades || !options.tenantId) {
          return localHelperUpgradeFailure(
            new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const idempotencyKey = parseLocalHelperUpgradeIdempotencyKey(
            request.headers["idempotency-key"],
          );
          const input = parseLocalHelperUpgradeSubmit(request.body);
          if (
            !(await requireAllowedWalletChain(
              input.chainId,
              request,
              reply,
              session,
              localHelperUpgradeChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalHelperUpgradeError("WALLET_NOT_FOUND");
          const result = await options.localHelperUpgrades.submit({
            idempotencyKey,
            request: input,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return localHelperUpgradeFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get<{ Params: { operationId: string } }>(
      "/api/helper-upgrades/:operationId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The Helper upgrade query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.localHelperUpgrades || !options.tenantId) {
          return localHelperUpgradeFailure(
            new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          return createSuccessEnvelope(
            await options.localHelperUpgrades.get({
              operationId: parseLocalHelperUpgradeId(request.params.operationId),
              tenantId: options.tenantId,
              userId: session.userId,
            }),
            request.id,
          );
        } catch (error) {
          return localHelperUpgradeFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/helper-upgrade",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The wallet Helper upgrade query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.localHelperUpgrades || !options.tenantId) {
          return localHelperUpgradeFailure(
            new LocalHelperUpgradeError("HELPER_UPGRADE_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          return createSuccessEnvelope(
            await options.localHelperUpgrades.latest({
              tenantId: options.tenantId,
              userId: session.userId,
              walletId: parseLocalHelperUpgradeId(request.params.walletId),
            }),
            request.id,
          );
        } catch (error) {
          return localHelperUpgradeFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/helper-residuals/sweep/preview",
      { bodyLimit: localHelperSweepBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.localHelperSweeps || !options.tenantId) {
          return localHelperSweepFailure(
            new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const input = parseLocalHelperSweepPreview(request.body);
          if (
            !(await requireAllowedWalletChain(
              input.chainId,
              request,
              reply,
              session,
              localHelperSweepChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalHelperSweepError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.localHelperSweeps.preview({
              request: input,
              tenantId: options.tenantId,
              userId: session.userId,
              wallet,
            }),
            request.id,
          );
        } catch (error) {
          return localHelperSweepFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/helper-residuals/sweep",
      { bodyLimit: localHelperSweepBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory || !options.localHelperSweeps || !options.tenantId) {
          return localHelperSweepFailure(
            new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          const idempotencyKey = parseLocalHelperSweepIdempotencyKey(
            request.headers["idempotency-key"],
          );
          const input = parseLocalHelperSweepSubmit(request.body);
          if (
            !(await requireAllowedWalletChain(
              input.chainId,
              request,
              reply,
              session,
              localHelperSweepChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
          if (!wallet) throw new LocalHelperSweepError("WALLET_NOT_FOUND");
          const result = await options.localHelperSweeps.sweep({
            idempotencyKey,
            request: input,
            requestId: request.id,
            sessionId: session.id,
            tenantId: options.tenantId,
            userId: session.userId,
            wallet,
          });
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.batch, request.id));
        } catch (error) {
          return localHelperSweepFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get<{ Params: { batchId: string } }>(
      "/api/chain-operation-batches/:batchId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The chain operation batch query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.localHelperSweeps || !options.tenantId) {
          return localHelperSweepFailure(
            new LocalHelperSweepError("LOCAL_HELPER_SWEEP_UNAVAILABLE", true),
            request,
            reply,
          );
        }
        try {
          return createSuccessEnvelope(
            await options.localHelperSweeps.getBatch({
              batchId: parseLocalHelperSweepId(request.params.batchId),
              tenantId: options.tenantId,
              userId: session.userId,
            }),
            request.id,
          );
        } catch (error) {
          return localHelperSweepFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.get<{ Params: { operationId: string } }>(
      "/api/chain-operations/:operationId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The chain operation query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (
          (!options.helperDeployments &&
            !options.localHelperSweeps &&
            !options.localPositionExecutions &&
            !options.localSwapExecutions) ||
          !options.tenantId
        ) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_OPERATION_UNAVAILABLE",
              message: "The chain operation service is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        let operationId: string;
        try {
          operationId = parseLocalPositionOperationId(request.params.operationId);
        } catch (error) {
          return localPositionFailure(error, request, reply) ?? reply;
        }
        if (options.localHelperSweeps) {
          try {
            const operation = await options.localHelperSweeps.getOperation({
              operationId,
              tenantId: options.tenantId,
              userId: session.userId,
            });
            return createSuccessEnvelope(operation, request.id);
          } catch (error) {
            if (
              !(error instanceof LocalHelperSweepError) ||
              error.code !== "LOCAL_HELPER_SWEEP_NOT_FOUND"
            ) {
              return localHelperSweepFailure(error, request, reply) ?? reply;
            }
          }
        }
        if (options.localPositionExecutions) {
          try {
            const operation = await options.localPositionExecutions.get({
              operationId,
              tenantId: options.tenantId,
              userId: session.userId,
            });
            return createSuccessEnvelope(operation, request.id);
          } catch (error) {
            if (
              !(error instanceof LocalPositionExecutionError) ||
              error.code !== "LOCAL_POSITION_NOT_FOUND"
            ) {
              return localPositionFailure(error, request, reply) ?? reply;
            }
          }
        }
        if (options.localSwapExecutions) {
          try {
            const operation = await options.localSwapExecutions.get({
              operationId,
              tenantId: options.tenantId,
              userId: session.userId,
            });
            return createSuccessEnvelope(operation, request.id);
          } catch (error) {
            if (
              !(error instanceof LocalSwapExecutionError) ||
              error.code !== "LOCAL_SWAP_NOT_FOUND"
            ) {
              return localSwapFailure(error, request, reply) ?? reply;
            }
          }
        }
        if (options.helperDeployments) {
          try {
            const operation = await options.helperDeployments.get({
              operationId: parseChainOperationId(operationId),
              tenantId: options.tenantId,
              userId: session.userId,
            });
            return createSuccessEnvelope(operation, request.id);
          } catch (error) {
            return helperDeploymentFailure(error, request, reply) ?? reply;
          }
        }
        return localPositionFailure(
          new LocalPositionExecutionError("LOCAL_POSITION_NOT_FOUND"),
          request,
          reply,
        );
      },
    );

    app.post(
      "/api/wallets/transfers/preview",
      { bodyLimit: walletTransferBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory || !options.walletTransfers) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "TRANSFER_UNAVAILABLE",
              message: "The wallet transfer service is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const transfer = parseWalletTransferPreviewRequest(request.body);
          if (
            !(await requireAllowedWalletChain(
              transfer.chainId,
              request,
              reply,
              session,
              walletTransferLocalChainIds,
            ))
          ) {
            return reply;
          }
          const wallet = await options.walletDirectory.getWallet(session.userId, transfer.walletId);
          if (!wallet) throw new WalletTransferError("WALLET_NOT_FOUND");
          const preview = await options.walletTransfers.preview({
            request: transfer,
            userId: session.userId,
            wallet: publicWalletDto(wallet),
          });
          return createSuccessEnvelope(preview, request.id);
        } catch (error) {
          return (
            walletTransferFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.post(
      "/api/wallets/transfers",
      { bodyLimit: walletTransferBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const ingress = Buffer.isBuffer(request.body) ? request.body : null;
        let parsed: ReturnType<typeof parseWalletTransferSubmit> | null = null;
        try {
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!options.walletDirectory || !options.walletTransfers) {
            return reply.code(503).send(
              createErrorEnvelope({
                code: "TRANSFER_UNAVAILABLE",
                message: "The wallet transfer service is unavailable",
                requestId: request.id,
                retryable: true,
              }),
            );
          }
          const idempotencyKey = parseWalletTransferIdempotencyKey(
            request.headers["idempotency-key"],
          );
          parsed = parseWalletTransferSubmit(request.body);
          const wallet = await options.walletDirectory.getWallet(
            session.userId,
            parsed.request.walletId,
          );
          if (!wallet) throw new WalletTransferError("WALLET_NOT_FOUND");
          const result = await options.walletTransfers.submit({
            idempotencyKey,
            password: parsed.password,
            request: parsed.request,
            requestId: request.id,
            secretIngress: ingress !== null,
            sessionId: session.id,
            userId: session.userId,
            wallet: publicWalletDto(wallet),
          });
          parsed.password = null;
          return reply
            .code(result.created ? 202 : 200)
            .send(createSuccessEnvelope(result.operation, request.id));
        } catch (error) {
          return (
            walletTransferFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        } finally {
          if (parsed) parsed.password = null;
          ingress?.fill(0);
        }
      },
    );

    app.get<{ Params: { operationId: string } }>(
      "/api/wallets/transfers/:operationId",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The transfer query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.walletTransfers) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "TRANSFER_UNAVAILABLE",
              message: "The wallet transfer service is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const operation = await options.walletTransfers.get({
            operationId: parseWalletTransferOperationId(request.params.operationId),
            userId: session.userId,
          });
          return createSuccessEnvelope(operation, request.id);
        } catch (error) {
          return walletTransferFailure(error, request, reply) ?? reply;
        }
      },
    );

    const readPositions = async (
      request: FastifyRequest,
      reply: FastifyReply,
      platformFilterAllowed: boolean,
    ): Promise<unknown> => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      const query = parsePositionReadQuery(request.query, platformFilterAllowed);
      if (!query) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "POSITION_QUERY_INVALID",
            message: "The position read query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!(await requireAllowedWalletChain(query.chainId, request, reply, session))) return reply;
      if (query.chainId !== 56) {
        return reply.code(403).send(
          createErrorEnvelope({
            code: "CHAIN_NOT_ALLOWED",
            message: "Position reads are enabled only for BNB Smart Chain",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.walletDirectory || !options.positionReads) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CHAIN_READ_UNAVAILABLE",
            message: "The controlled position reader is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      const parameters = request.params as { address?: unknown };
      const requestedAddress =
        typeof parameters.address === "string" && /^0x[0-9a-fA-F]{40}$/u.test(parameters.address)
          ? parameters.address.toLowerCase()
          : null;
      try {
        const wallets = await options.walletDirectory.listWallets(session.userId);
        if (!Array.isArray(wallets.items)) throw new WalletApiError("SIGNER_UNAVAILABLE");
        const wallet = requestedAddress
          ? wallets.items.find(({ address }) => address.toLowerCase() === requestedAddress)
          : null;
        if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
        const helperAddress = options.helperReads
          ? await options.helperReads.resolveTrustedAddress({
              chainId: 56,
              userId: session.userId,
              walletId: wallet.walletId,
            })
          : null;
        const page = await options.positionReads.scan({
          address: requestedAddress as `0x${string}`,
          chainId: 56,
          cursor: query.cursor,
          helperAddress,
          limit: query.limit,
          platformId: query.platformId,
          userId: session.userId,
          walletId: wallet.walletId,
        });
        return createSuccessEnvelope(page, request.id);
      } catch (error) {
        return walletFailure(error, request, reply) ?? positionReadFailure(error, request, reply);
      }
    };

    app.get<{ Params: { address: string } }>("/api/wallets/:address/positions", (request, reply) =>
      readPositions(request, reply, true),
    );

    app.get<{ Params: { address: string } }>("/api/positions/scan/:address", (request, reply) =>
      readPositions(request, reply, false),
    );

    app.post(
      "/api/swap/quote",
      {
        bodyLimit: 8_192,
        config: {
          rateLimit: {
            max: swapQuoteRateLimit.max,
            timeWindow: swapQuoteRateLimit.timeWindowMs,
          },
        },
      },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (isPlainRecord(request.body) && request.body.chainId === 31_337) {
          try {
            const parsed = parseLocalSwapQuoteRequest(request.body);
            if (
              !(await requireAllowedWalletChain(
                31_337,
                request,
                reply,
                session,
                localSwapExecutionChainIds,
              ))
            ) {
              return reply;
            }
            if (!options.walletDirectory || !options.localSwapQuotes || !options.tenantId) {
              return localSwapQuoteFailure(new Error("unconfigured"), request, reply);
            }
            const wallet = await options.walletDirectory.getWallet(session.userId, parsed.walletId);
            if (!wallet || wallet.lockStatus === "quarantined") {
              throw new LocalSwapQuoteValidationError("WALLET_NOT_FOUND");
            }
            const quote = await options.localSwapQuotes.quote({
              ...parsed,
              tenantId: options.tenantId,
              userId: session.userId,
              walletAddress: wallet.address,
            });
            return createSuccessEnvelope(quote, request.id);
          } catch (error) {
            return localSwapQuoteFailure(error, request, reply);
          }
        }
        let parsed;
        try {
          parsed = parseSwapQuoteRequest(request.body);
        } catch (error) {
          if (error instanceof SwapQuoteValidationError) {
            const walletMissing = error.code === "WALLET_NOT_FOUND";
            return reply.code(walletMissing ? 404 : 400).send(
              createErrorEnvelope({
                code: error.code,
                message: walletMissing
                  ? "The custody wallet was not found"
                  : "The swap quote request is invalid",
                requestId: request.id,
                retryable: false,
              }),
            );
          }
          throw error;
        }
        if (!(await requireAllowedWalletChain(parsed.chainId, request, reply, session)))
          return reply;
        if (parsed.chainId !== 56) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "CHAIN_NOT_ALLOWED",
              message: "Swap quotes are enabled only for BNB Smart Chain",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.walletDirectory || !options.swapQuotes || !options.tenantId) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "SWAP_QUOTE_UNAVAILABLE",
              message: "The controlled quote provider is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const wallet = await options.walletDirectory.getWallet(session.userId, parsed.walletId);
          if (!wallet || wallet.lockStatus === "quarantined") {
            return reply.code(404).send(
              createErrorEnvelope({
                code: "WALLET_NOT_FOUND",
                message: "The custody wallet was not found",
                requestId: request.id,
                retryable: false,
              }),
            );
          }
          const quote = await options.swapQuotes.quote({
            ...parsed,
            chainId: 56,
            userId: session.userId,
            walletAddress: wallet.address,
          });
          return createSuccessEnvelope(quote, request.id);
        } catch (error) {
          return swapQuoteFailure(error, request, reply);
        }
      },
    );

    app.get("/api/pricing-positions", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (Object.keys(request.query as Record<string, unknown>).length !== 0) {
        return pricingPositionFailure(
          new PricingPositionError("PRICING_POSITION_INVALID"),
          request,
          reply,
        );
      }
      if (!options.pricingPositions || !options.tenantId) {
        return pricingPositionFailure(new Error("unconfigured"), request, reply);
      }
      try {
        return createSuccessEnvelope(
          await options.pricingPositions.list({ userId: session.userId }),
          request.id,
        );
      } catch (error) {
        return pricingPositionFailure(error, request, reply);
      }
    });

    app.get("/api/pricing-positions/stream", async (request, reply) => {
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (Object.keys(request.query as Record<string, unknown>).length !== 0) {
        return pricingPositionFailure(
          new PricingPositionError("PRICING_POSITION_INVALID"),
          request,
          reply,
        );
      }
      if (!options.pricingPositionStream || !options.tenantId) {
        return pricingPositionFailure(new Error("unconfigured"), request, reply);
      }
      const lastEventHeader = request.headers["last-event-id"];
      if (lastEventHeader !== undefined && typeof lastEventHeader !== "string") {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "PRICING_CURSOR_INVALID",
            message: "The pricing position cursor is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      let opened;
      try {
        opened = await options.pricingPositionStream.open({
          lastEventId: lastEventHeader ?? null,
          tenantId: options.tenantId,
          userId: session.userId,
        });
      } catch (error) {
        if (error instanceof PricingPositionCursorError) {
          return reply.code(error.code === "PRICING_CURSOR_EXPIRED" ? 409 : 400).send(
            createErrorEnvelope({
              code: error.code,
              message:
                error.code === "PRICING_CURSOR_EXPIRED"
                  ? "The pricing position cursor is outside the retained epoch"
                  : "The pricing position cursor is invalid",
              requestId: request.id,
              retryable: error.code === "PRICING_CURSOR_EXPIRED",
            }),
          );
        }
        return pricingPositionFailure(error, request, reply);
      }

      const controller = new AbortController();
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
      const writeEvent = (event: { cursor: string; type: string }) =>
        writeSseChunk(
          reply,
          controller,
          `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      try {
        if (opened.initialEvent && !(await writeEvent(opened.initialEvent))) {
          controller.abort();
        }
        if (!controller.signal.aborted) {
          for await (const event of options.pricingPositionStream.subscribe({
            afterSequence: opened.afterSequence,
            epoch: opened.epoch,
            signal: controller.signal,
            tenantId: options.tenantId,
            userId: session.userId,
          })) {
            if (controller.signal.aborted || event.epoch !== opened.epoch) break;
            if (!(await writeEvent(event))) break;
          }
        }
      } catch {
        controller.abort();
      } finally {
        reply.raw.off("close", close);
        controller.abort();
        if (!reply.raw.destroyed) reply.raw.end();
      }
      return reply;
    });

    app.post("/api/pricing-positions/import", { bodyLimit: 16_384 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.pricingPositions || !options.tenantId) {
        return pricingPositionFailure(new Error("unconfigured"), request, reply);
      }
      try {
        const parsed = parseImportPricingPositionRequest(request.body);
        return createSuccessEnvelope(
          await options.pricingPositions.importPosition({
            request: parsed,
            userId: session.userId,
          }),
          request.id,
        );
      } catch (error) {
        return pricingPositionFailure(error, request, reply);
      }
    });

    app.post<{ Params: { pricingId: string } }>(
      "/api/pricing-positions/:pricingId/withdrawn",
      { bodyLimit: 2_048 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.pricingPositions || !options.tenantId) {
          return pricingPositionFailure(new Error("unconfigured"), request, reply);
        }
        try {
          const pricingId = parsePricingPositionId(request.params.pricingId);
          const input = parseMarkPricingPositionWithdrawnRequest(request.body);
          return createSuccessEnvelope(
            await options.pricingPositions.markWithdrawn({
              expectedRevision: input.expectedRevision,
              pricingId,
              userId: session.userId,
            }),
            request.id,
          );
        } catch (error) {
          return pricingPositionFailure(error, request, reply);
        }
      },
    );

    app.get<{ Params: { address: string } }>(
      "/api/wallets/:address/helper",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseHelperStatusQuery(request.query);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "HELPER_QUERY_INVALID",
              message: "The Helper read query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(query.chainId, request, reply, session)))
          return reply;
        if (query.chainId !== 56) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "CHAIN_NOT_ALLOWED",
              message: "Helper reads are enabled only for BNB Smart Chain",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.walletDirectory || !options.helperReads) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "The controlled Helper reader is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        const requestedAddress = /^0x[0-9a-fA-F]{40}$/u.test(request.params.address)
          ? request.params.address.toLowerCase()
          : null;
        try {
          const wallets = await options.walletDirectory.listWallets(session.userId);
          if (!Array.isArray(wallets.items)) throw new WalletApiError("SIGNER_UNAVAILABLE");
          const wallet = requestedAddress
            ? wallets.items.find(({ address }) => address.toLowerCase() === requestedAddress)
            : null;
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          const status = await options.helperReads.status({
            chainId: 56,
            userId: session.userId,
            walletAddress: requestedAddress as EvmAddress,
            walletId: wallet.walletId,
          });
          return createSuccessEnvelope(status, request.id);
        } catch (error) {
          return walletFailure(error, request, reply) ?? helperReadFailure(error, request, reply);
        }
      },
    );

    app.get("/api/wallets/helper-residuals", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      const query = parseHelperResidualListQuery(request.query);
      if (!query) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "HELPER_RESIDUAL_INPUT_INVALID",
            message: "The Helper residual request is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        !(await requireAllowedWalletChain(
          query.chainId,
          request,
          reply,
          session,
          query.chainId === 31_337 ? localHelperSweepChainIds : null,
        ))
      ) {
        return reply;
      }
      if (query.chainId !== 56 && query.chainId !== 31_337) {
        return reply.code(403).send(
          createErrorEnvelope({
            code: "CHAIN_NOT_ALLOWED",
            message: "Helper residual reads are unavailable for this chain",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        !options.walletDirectory ||
        (query.chainId === 56 ? !options.helperResiduals : !options.localHelperSweeps) ||
        (query.chainId === 31_337 && !options.tenantId)
      ) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CHAIN_READ_UNAVAILABLE",
            message: "The controlled Helper residual reader is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const wallet = await options.walletDirectory.getWallet(session.userId, query.walletId);
        if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
        const page =
          query.chainId === 56
            ? await options.helperResiduals!.latest({
                chainId: 56,
                cursor: query.cursor,
                limit: query.limit,
                userId: session.userId,
                walletId: wallet.walletId,
              })
            : query.cursor === null
              ? await options.localHelperSweeps!.latest({
                  tenantId: options.tenantId!,
                  userId: session.userId,
                  wallet,
                })
              : (() => {
                  throw new LocalHelperSweepError("PREVIEW_INVALID");
                })();
        return createSuccessEnvelope(page, request.id);
      } catch (error) {
        return (
          walletFailure(error, request, reply) ??
          localHelperSweepFailure(error, request, reply) ??
          helperReadFailure(error, request, reply)
        );
      }
    });

    app.post("/api/wallets/helper-residuals/scan", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      const input = parseHelperResidualScanBody(request.body);
      if (!input) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "HELPER_RESIDUAL_INPUT_INVALID",
            message: "The Helper residual request is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        !(await requireAllowedWalletChain(
          input.chainId,
          request,
          reply,
          session,
          input.chainId === 31_337 ? localHelperSweepChainIds : null,
        ))
      ) {
        return reply;
      }
      if (input.chainId !== 56 && input.chainId !== 31_337) {
        return reply.code(403).send(
          createErrorEnvelope({
            code: "CHAIN_NOT_ALLOWED",
            message: "Helper residual reads are unavailable for this chain",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (
        !options.walletDirectory ||
        (input.chainId === 56 ? !options.helperResiduals : !options.localHelperSweeps) ||
        (input.chainId === 31_337 && !options.tenantId)
      ) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "CHAIN_READ_UNAVAILABLE",
            message: "The controlled Helper residual reader is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const wallet = await options.walletDirectory.getWallet(session.userId, input.walletId);
        if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
        const page =
          input.chainId === 56
            ? await options.helperResiduals!.scan({
                chainId: 56,
                idempotencyKey: input.idempotencyKey,
                userId: session.userId,
                walletId: wallet.walletId,
              })
            : await options.localHelperSweeps!.scan({
                idempotencyKey: input.idempotencyKey,
                tenantId: options.tenantId!,
                userId: session.userId,
                wallet,
              });
        return createSuccessEnvelope(page, request.id);
      } catch (error) {
        return (
          walletFailure(error, request, reply) ??
          localHelperSweepFailure(error, request, reply) ??
          helperReadFailure(error, request, reply)
        );
      }
    });

    app.get("/api/wallets", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (Object.keys(request.query as Record<string, unknown>).length > 0) {
        return reply.code(400).send(
          createErrorEnvelope({
            code: "INVALID_QUERY",
            message: "The wallet query is invalid",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (!options.walletDirectory) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "SIGNER_UNAVAILABLE",
            message: "Wallet metadata is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const page = await options.walletDirectory.listWallets(session.userId);
        if (!Array.isArray(page.items)) throw new WalletApiError("SIGNER_UNAVAILABLE");
        return createSuccessEnvelope({ items: page.items.map(publicWalletDto) }, request.id);
      } catch (error) {
        return (
          walletFailure(error, request, reply) ??
          reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "Wallet metadata is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          )
        );
      }
    });

    app.get<{ Params: { walletId: string } }>("/api/wallets/:walletId", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionRequest(request, reply);
      if (!session) return reply;
      if (!options.walletDirectory) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "SIGNER_UNAVAILABLE",
            message: "Wallet metadata is unavailable",
            requestId: request.id,
            retryable: true,
          }),
        );
      }
      try {
        const walletId = parseWalletId(request.params.walletId);
        const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
        if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
        return createSuccessEnvelope(publicWalletDto(wallet), request.id);
      } catch (error) {
        return (
          walletFailure(error, request, reply) ??
          reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "Wallet metadata is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          )
        );
      }
    });

    app.get<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/balances",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseWalletReadQuery(request.query, ["chainId"]);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The wallet balance query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(query.chainId, request, reply, session)))
          return reply;
        if (!options.walletDirectory || !options.walletAssets) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "The controlled chain reader is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const walletId = parseWalletId(request.params.walletId);
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          const snapshot = await options.walletAssets.balances({
            chainId: query.chainId,
            userId: session.userId,
            wallet: publicWalletDto(wallet),
          });
          return createSuccessEnvelope(snapshot, request.id);
        } catch (error) {
          return (
            walletAssetFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.get<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/tokens",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseWalletReadQuery(request.query, ["chainId"]);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The wallet token query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(query.chainId, request, reply, session)))
          return reply;
        if (!options.walletDirectory || !options.walletAssets) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "Wallet tokens are unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const walletId = parseWalletId(request.params.walletId);
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.walletAssets.listTokens({
              chainId: query.chainId,
              userId: session.userId,
              walletId,
            }),
            request.id,
          );
        } catch (error) {
          return (
            walletAssetFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.post<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/tokens",
      { bodyLimit: 2_048 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const input = parseWalletTokenImport(request.body);
        if (!input) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_TOKEN",
              message: "The custom token request is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(input.chainId, request, reply, session)))
          return reply;
        if (!options.walletDirectory || !options.walletAssets) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "Wallet tokens are unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const walletId = parseWalletId(request.params.walletId);
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          const token = await options.walletAssets.importToken({
            chainId: input.chainId,
            tokenAddress: input.tokenAddress,
            userId: session.userId,
            walletId,
          });
          return reply.code(201).send(createSuccessEnvelope(token, request.id));
        } catch (error) {
          return (
            walletAssetFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.delete<{ Params: { tokenAddress: string; walletId: string } }>(
      "/api/wallets/:walletId/tokens/:tokenAddress",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseWalletReadQuery(request.query, ["chainId"]);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The wallet token query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(query.chainId, request, reply, session)))
          return reply;
        if (!options.walletDirectory || !options.walletAssets) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "Wallet tokens are unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const walletId = parseWalletId(request.params.walletId);
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          const deleted = await options.walletAssets.deleteToken({
            chainId: query.chainId,
            tokenAddress: request.params.tokenAddress,
            userId: session.userId,
            walletId,
          });
          return createSuccessEnvelope({ deleted }, request.id);
        } catch (error) {
          return (
            walletAssetFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.get<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/receive",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        const query = parseWalletReadQuery(request.query, [
          "amountDecimal",
          "chainId",
          "tokenAddress",
        ]);
        if (!query) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_QUERY",
              message: "The receive-content query is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!(await requireAllowedWalletChain(query.chainId, request, reply, session)))
          return reply;
        if (!options.walletDirectory || !options.walletAssets) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "CHAIN_READ_UNAVAILABLE",
              message: "Receive content is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const walletId = parseWalletId(request.params.walletId);
          const wallet = await options.walletDirectory.getWallet(session.userId, walletId);
          if (!wallet) throw new WalletApiError("WALLET_NOT_FOUND");
          return createSuccessEnvelope(
            await options.walletAssets.receive({
              amountDecimal: query.amountDecimal,
              chainId: query.chainId,
              tokenAddress: query.tokenAddress,
              userId: session.userId,
              wallet: publicWalletDto(wallet),
            }),
            request.id,
          );
        } catch (error) {
          return (
            walletAssetFailure(error, request, reply) ??
            walletFailure(error, request, reply) ??
            reply
          );
        }
      },
    );

    app.patch<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId",
      { bodyLimit: 16_384 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!options.walletDirectory?.renameWallet) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "Wallet metadata is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const input = parseRenameCustodyWalletRequest(request.body);
          const wallet = await options.walletDirectory.renameWallet({
            ...input,
            updatedAt: now(),
            userId: session.userId,
            walletId: parseWalletId(request.params.walletId),
          });
          return createSuccessEnvelope(publicWalletDto(wallet), request.id);
        } catch (error) {
          return walletFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId/delete-preview",
      { bodyLimit: 16_384 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (
          request.body !== undefined &&
          (typeof request.body !== "object" ||
            request.body === null ||
            Array.isArray(request.body) ||
            Object.keys(request.body).length > 0)
        ) {
          return reply.code(400).send(
            createErrorEnvelope({
              code: "INVALID_WALLET",
              message: "The wallet request is invalid",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (!options.walletDirectory?.createWalletDeletePreview) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "Wallet deletion inventory is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const preview = await options.walletDirectory.createWalletDeletePreview(
            session.userId,
            parseWalletId(request.params.walletId),
          );
          return reply
            .code(201)
            .send(createSuccessEnvelope(publicWalletDeletePreview(preview), request.id));
        } catch (error) {
          return walletFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.delete<{ Params: { walletId: string } }>(
      "/api/wallets/:walletId",
      { bodyLimit: 16_384 },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletDirectory?.deleteWallet) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "Wallet deletion is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        try {
          const input = parseDeleteCustodyWalletRequest(request.body);
          const receipt = await options.walletDirectory.deleteWallet({
            ...input,
            userId: session.userId,
            walletId: parseWalletId(request.params.walletId),
          });
          return createSuccessEnvelope(publicWalletDeletionReceipt(receipt), request.id);
        } catch (error) {
          return walletFailure(error, request, reply) ?? reply;
        }
      },
    );

    app.post(
      "/api/wallets/import",
      { bodyLimit: walletSecretBodyLimit },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const ingress = Buffer.isBuffer(request.body) ? request.body : null;
        try {
          const session = await authenticateSessionRequest(request, reply);
          if (!session) return reply;
          if (!(await requireFreshReauthentication(request, reply, session))) return reply;
          if (!ingress) {
            return reply.code(415).send(
              createErrorEnvelope({
                code: "UNSUPPORTED_MEDIA_TYPE",
                message: "Wallet import requires the dedicated secret ingress",
                requestId: request.id,
                retryable: false,
              }),
            );
          }
          if (!options.walletSigner || !options.tenantId) {
            return reply.code(503).send(
              createErrorEnvelope({
                code: "SIGNER_UNAVAILABLE",
                message: "The wallet signer is unavailable",
                requestId: request.id,
                retryable: true,
              }),
            );
          }
          const wallet = await options.walletSigner.importWallet({
            ingress,
            tenantId: options.tenantId,
            userId: session.userId,
          });
          return reply.code(201).send(createSuccessEnvelope(publicWalletDto(wallet), request.id));
        } catch (error) {
          const response = walletFailure(error, request, reply);
          if (response) return response;
          throw error;
        } finally {
          ingress?.fill(0);
        }
      },
    );

    app.post("/api/wallets/generate", { bodyLimit: 16_384 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const ingress = Buffer.isBuffer(request.body) ? request.body : null;
      try {
        const session = await authenticateSessionRequest(request, reply);
        if (!session) return reply;
        if (!(await requireFreshReauthentication(request, reply, session))) return reply;
        if (!options.walletSigner || !options.tenantId) {
          return reply.code(503).send(
            createErrorEnvelope({
              code: "SIGNER_UNAVAILABLE",
              message: "The wallet signer is unavailable",
              requestId: request.id,
              retryable: true,
            }),
          );
        }
        const input = ingress
          ? { ingress, mode: "user-password" as const, name: "secret-ingress" }
          : parseGenerateCustodyWalletRequest(request.body);
        const wallet = await options.walletSigner.generateWallet({
          ...input,
          tenantId: options.tenantId,
          userId: session.userId,
        });
        return reply.code(201).send(createSuccessEnvelope(publicWalletDto(wallet), request.id));
      } catch (error) {
        const response = walletFailure(error, request, reply);
        if (response) return response;
        throw error;
      } finally {
        ingress?.fill(0);
      }
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
