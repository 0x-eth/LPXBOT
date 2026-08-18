import { apiContractPackage } from "@lpbot/api-contract";
import { domainPackage } from "@lpbot/domain";
import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export { buildApiApp } from "./app.js";
export type {
  ApiAppOptions,
  AuthRateLimits,
  ChainActivityProvider,
  ChainManagementRateLimit,
  MaintenanceConfig,
  PublicReadRateLimit,
  RegionPolicyResult,
} from "./app.js";
export { sessionCookieName, setBrowserSessionCookie } from "./browser-session-cookie.js";
export { createLoginWalletAuthenticationFromEnvironment } from "./login-wallet-auth-config.js";
export type { LoginWalletAuthEnvironment } from "./login-wallet-auth-config.js";
export { PostgresSessionStore } from "./postgres-session-store.js";
export { PostgresWalletDirectory } from "./postgres-wallet-directory.js";
export { RemoteWalletSignerClient } from "./remote-wallet-signer-client.js";
export {
  keystoreSecretBodyLimit,
  keystoreSecretMediaType,
  parseGenerateCustodyWalletRequest,
  parseWalletId,
  publicKeystoreResetPreview,
  publicKeystoreStatus,
  publicWalletDto,
  WalletApiError,
  walletSecretBodyLimit,
  walletSecretMediaType,
} from "./wallets.js";
export type {
  FreshReauthenticationVerifier,
  KeystoreApplication,
  KeystoreResetPreviewDto,
  KeystoreStatusDto,
  WalletDirectory,
  WalletSignerClient,
} from "./wallets.js";
export { PostgresChainAccessPolicyStore } from "./postgres-chain-access-policy-store.js";
export { PostgresUserPreferencesStore } from "./postgres-user-preferences-store.js";
export { PostgresAddressRemarkStore } from "./postgres-address-remark-store.js";
export { PostgresPoolBlocklistStore } from "./postgres-pool-blocklist-store.js";
export type { PostgresPoolBlocklistStoreOptions } from "./postgres-pool-blocklist-store.js";
export { PostgresMonitorStore } from "./postgres-monitor-store.js";
export type { PostgresMonitorStoreOptions } from "./postgres-monitor-store.js";
export { PostgresNotificationConfigurationStore } from "./postgres-notification-store.js";
export type { PostgresNotificationConfigurationStoreOptions } from "./postgres-notification-store.js";
export {
  decodeNotificationHistoryCursor,
  encodeNotificationHistoryCursor,
  MemoryNotificationHistoryStore,
  NotificationHistoryQueryError,
  parseNotificationHistoryQuery,
} from "./notification-history.js";
export { PostgresNotificationHistoryStore } from "./postgres-notification-history-store.js";
export type {
  NotificationHistoryQuery,
  NotificationHistoryStore,
  StoredNotificationHistoryItem,
} from "./notification-history.js";
export {
  MemoryMonitorStore,
  MonitorValidationError,
  parseIdempotencyKey,
  parseMonitorCreate,
  parseMonitorLifecycle,
  parseMonitorListQuery,
  parseMonitorPatch,
} from "./monitors.js";
export {
  defaultNotificationPreferences,
  MemoryNotificationConfigurationStore,
  MemoryNotificationSecretStore,
  notificationDestinationPayloadHash,
  NotificationValidationError,
  parseDestinationDraft,
  parseNotificationDestinationPatch,
  parseNotificationExpectedRevision,
  parseNotificationIdempotencyKey,
  parseNotificationPreferencesPatch,
  renderLocalSinkTest,
} from "./notifications.js";
export type {
  NotificationConfigurationStore,
  NotificationDestinationCreateResult,
  NotificationDestinationDeleteResult,
  NotificationDestinationMutationResult,
  NotificationPreferenceMutationResult,
  NotificationSecretStore,
  NotificationValidationCode,
} from "./notifications.js";
export type {
  MonitorCreateInput,
  MonitorCreateResult,
  MonitorDeleteInput,
  MonitorDeleteResult,
  MonitorLifecycleInput,
  MonitorListQuery,
  MonitorMutationResult,
  MonitorPatchInput,
  MonitorStore,
  MonitorValidationCode,
} from "./monitors.js";
export { PostgresPoolCreationProvenanceStore } from "./postgres-pool-creation-provenance-store.js";
export {
  canonicalPoolCreationAddress,
  canonicalPoolCreationPoolKey,
  canonicalPoolCreationRecord,
  parsePoolCreationHistoryQuery,
  parsePoolCreatorBatchRequest,
  parsePoolCreatorQuery,
  poolCreationIdentityDigest,
  poolCreationProvenanceBatchLimit,
  poolCreationProvenanceHistoryLimit,
  PoolCreationProvenanceConflictError,
  PoolCreationProvenanceValidationError,
  publicPoolCreationAttribution,
} from "./pool-creation-provenance.js";
export type {
  ParsedPoolCreatorBatch,
  PoolCreationAdminAuditAction,
  PoolCreationAdminAuditInput,
  PoolCreationAdminAuditOutcome,
  PoolCreationAttribution,
  PoolCreationCreatorProfile,
  PoolCreationHistoryPage,
  PoolCreationProvenanceReadStore,
  PoolCreationProvenanceRecord,
  PoolCreationProvenanceRecorder,
  PoolCreationProvenanceRecordResult,
  PoolCreationProvenanceStore,
} from "./pool-creation-provenance.js";
export {
  canonicalPoolBlocklistEntry,
  createPoolBlocklistSnapshot,
  defaultPoolBlocklistSnapshot,
  parsePoolBlocklistPatch,
  poolBlocklistHash,
  PoolBlocklistValidationError,
  sortPoolBlocklistEntries,
} from "./pool-blocklist.js";
export type {
  PoolBlocklistMutationInput,
  PoolBlocklistMutationResult,
  PoolBlocklistStore,
} from "./pool-blocklist.js";
export {
  addressRemarkChainId,
  AddressRemarkValidationError,
  canonicalAddressRemarkAddress,
  parseAddressRemarkPutRequest,
} from "./address-remarks.js";
export type {
  AddressRemarkAllowedAudit,
  AddressRemarkAuditAction,
  AddressRemarkAuditInput,
  AddressRemarkAuditOutcome,
  AddressRemarkDeleteInput,
  AddressRemarkPutInput,
  AddressRemarkStore,
} from "./address-remarks.js";
export {
  createMarketPoolEligibility,
  filterEligibleMarketPoolRows,
  filterMarketPoolSnapshot,
  filterMarketStreamEnvelope,
  parseMarketEligibilityCursor,
  PostgresMarketPoolsProvider,
  wrapMarketEligibilityCursor,
} from "./market-pools.js";
export type {
  MarketEligibilityCursorFilter,
  MarketPoolEligibility,
  MarketPoolsByTokenContext,
  MarketPoolsContext,
  MarketPoolsProvider,
  MarketPoolsStreamContext,
  PostgresMarketPoolsProviderOptions,
} from "./market-pools.js";
export { MarketChartProviderError, PostgresMarketChartsProvider } from "./market-charts.js";
export type {
  MarketCandleQuery,
  MarketChartProviderErrorCode,
  MarketChartsProvider,
  MarketTickLiquidityQuery,
} from "./market-charts.js";
export { PostgresLiquidityFlowProvider, liquidityFlowStreamKey } from "./liquidity-flow.js";
export type {
  LiquidityFlowProvider,
  LiquidityFlowStreamContext,
  PostgresLiquidityFlowProviderOptions,
} from "./liquidity-flow.js";
export { ChainPolicyStoreError } from "./chain-access-policies.js";
export type {
  ChainAccessPolicyChange,
  ChainAccessPolicyStore,
  ChainAccessPolicyUpdateInput,
  ChainAccessPolicyUpdateResult,
  ChainAccessPolicyView,
  ChainManagementAuditInput,
  ChainPolicyStoreErrorCode,
} from "./chain-access-policies.js";
export {
  canonicalTaskStatusStatsInput,
  PostgresShellStatsProvider,
  PostgresTaskStatusStatsPublisher,
  shellStatsHeartbeatMilliseconds,
  ShellStatsUnavailableError,
  TaskStatusStatsValidationError,
} from "./shell-stats.js";
export type {
  AuthoritativeTaskStatusStatsInput,
  CanonicalTaskStatusStatsInput,
  PostgresShellStatsProviderOptions,
  ShellStatsAdminQueryAudit,
  ShellStatsContext,
  ShellStatsProvider,
  ShellStatsScope,
  ShellStatsSubscriptionContext,
  TaskStatusStatsPublisher,
  TaskStatusStatsPublishResult,
} from "./shell-stats.js";
export {
  createRecommendedPoolsEventStream,
  parseRecommendedPoolsCursor,
  recommendedPoolsCursor,
  recommendationSelectionHash,
  selectRecommendedPools,
} from "./recommended-pools.js";
export type {
  RecommendedPoolsEventStreamOptions,
  RecommendedPoolsScheduler,
  RecommendedPoolsStreamEvent,
} from "./recommended-pools.js";
export {
  defaultUserPreferences,
  defaultVersionedUserPreferences,
  normalizeStoredUserPreferences,
  parseUserPreferencesPatch,
  UserPreferencesValidationError,
} from "./user-preferences.js";
export type {
  UpdateUserPreferencesInput,
  UserPreferencesStore,
  UserPreferencesUpdateResult,
} from "./user-preferences.js";

export const apiApp = {
  contract: apiContractPackage.name,
  domain: domainPackage.name,
  name: "@lpbot/api",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
