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
export { PostgresWalletTokenStore } from "./postgres-wallet-token-store.js";
export { PostgresWalletTransferOperationStore } from "./postgres-wallet-transfer-store.js";
export { ViemLocalWalletTransferChainReader } from "./viem-local-wallet-transfer-chain-reader.js";
export type { ViemLocalWalletTransferChainReaderOptions } from "./viem-local-wallet-transfer-chain-reader.js";
export { ViemLocalHelperDeploymentChainReader } from "./viem-local-helper-deployment-chain-reader.js";
export type { ViemLocalHelperDeploymentChainReaderOptions } from "./viem-local-helper-deployment-chain-reader.js";
export {
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
} from "./postgres-helper-deployment-store.js";
export {
  buildHelperDeploymentMaterial,
  HelperDeploymentError,
  HelperDeploymentService,
  MemoryHelperDeploymentOperationStore,
  MemoryHelperDeploymentPreviewStore,
  parseChainOperationId,
  parseHelperDeploymentIdempotencyKey,
  parseHelperDeploymentPreviewRequest,
  parseHelperDeploymentSubmit,
  helperDeploymentBodyLimit,
  helperDeploymentIdempotencyRetentionHours,
  helperDeploymentPreviewTtlMilliseconds,
} from "./helper-deployments.js";
export {
  ControlledLocalSwapQuoteService,
  LocalSwapExecutionError,
  LocalSwapExecutionService,
  LocalSwapQuoteValidationError,
  MemoryLocalSwapHelperBindingStore,
  MemoryLocalSwapOperationStore,
  MemoryLocalSwapPreviewStore,
  MemoryLocalSwapQuoteStore,
  localSwapExecutionBodyLimit,
  localSwapIdempotencyRetentionHours,
  localSwapPreviewTtlMilliseconds,
  parseLocalSwapExecute,
  parseLocalSwapExecutePreview,
  parseLocalSwapIdempotencyKey,
  parseLocalSwapOperationId,
  parseLocalSwapQuoteRequest,
} from "./local-swap-executions.js";
export {
  PostgresLocalSwapHelperBindingStore,
  PostgresLocalSwapOperationStore,
  PostgresLocalSwapPreviewStore,
  PostgresLocalSwapQuoteStore,
} from "./postgres-local-swap-execution-store.js";
export { RemoteLocalSwapPermit2Client } from "./remote-local-swap-permit2-client.js";
export { ViemLocalSwapExecutionChainReader } from "./viem-local-swap-execution-chain-reader.js";
export type { ViemLocalSwapExecutionChainReaderOptions } from "./viem-local-swap-execution-chain-reader.js";
export { ViemLocalSwapQuoteProvider } from "./viem-local-swap-quote-provider.js";
export type { ViemLocalSwapQuoteProviderOptions } from "./viem-local-swap-quote-provider.js";
export type {
  LocalSwapChainInspection,
  LocalSwapExecutionApplication,
  LocalSwapExecutionChainReader,
  LocalSwapExecutionErrorCode,
  LocalSwapHelperBinding,
  LocalSwapHelperBindingStore,
  LocalSwapIdempotencyRecord,
  LocalSwapNonceView,
  LocalSwapOperationStore,
  LocalSwapPermit2SignatureProvider,
  LocalSwapPreviewStore,
  LocalSwapQuoteApplication,
  LocalSwapQuoteStore,
  LocalSwapStepReservation,
  StoredLocalSwapOperation,
  StoredLocalSwapPreview,
} from "./local-swap-executions.js";
export {
  buildLocalPositionSnapshot,
  LocalPositionExecutionError,
  LocalPositionExecutionService,
  MemoryLocalPositionOperationStore,
  MemoryLocalPositionPreviewStore,
  MemoryLocalPositionSnapshotStore,
  localPositionExecutionBodyLimit,
  localPositionIdempotencyRetentionHours,
  localPositionPreviewTtlMilliseconds,
  parseLocalPositionCollectFees,
  parseLocalPositionCollectFeesPreview,
  parseLocalPositionIdempotencyKey,
  parseLocalPositionOperationId,
  parseLocalPositionRemoveLiquidity,
  parseLocalPositionRemoveLiquidityPreview,
  parseLocalPositionWalletId,
} from "./local-position-executions.js";
export { ViemLocalPositionExecutionChainReader } from "./viem-local-position-execution-chain-reader.js";
export type { ViemLocalPositionExecutionChainReaderOptions } from "./viem-local-position-execution-chain-reader.js";
export {
  PostgresLocalPositionOperationStore,
  PostgresLocalPositionPreviewStore,
  PostgresLocalPositionSnapshotStore,
} from "./postgres-local-position-execution-store.js";
export type {
  LocalPositionChainInspection,
  LocalPositionExecutionApplication,
  LocalPositionExecutionChainReader,
  LocalPositionExecutionErrorCode,
  LocalPositionIdempotencyRecord,
  LocalPositionNonceView,
  LocalPositionOperationStore,
  LocalPositionPreviewStore,
  LocalPositionSnapshotStore,
  LocalPositionStepReservation,
  StoredLocalPositionOperation,
  StoredLocalPositionPreview,
} from "./local-position-executions.js";
export {
  LocalHelperSweepError,
  LocalHelperSweepService,
  MemoryLocalHelperResidualSnapshotStore,
  MemoryLocalHelperSweepBindingStore,
  MemoryLocalHelperSweepOperationStore,
  MemoryLocalHelperSweepPreviewStore,
  localHelperResidualSnapshotTtlMilliseconds,
  localHelperSweepBodyLimit,
  localHelperSweepIdempotencyRetentionHours,
  localHelperSweepPreviewTtlMilliseconds,
  parseLocalHelperSweepId,
  parseLocalHelperSweepIdempotencyKey,
  parseLocalHelperSweepPreview,
  parseLocalHelperSweepSubmit,
} from "./local-helper-sweeps.js";
export {
  PostgresLocalHelperResidualSnapshotStore,
  PostgresLocalHelperSweepBindingStore,
  PostgresLocalHelperSweepOperationStore,
  PostgresLocalHelperSweepPreviewStore,
} from "./postgres-local-helper-sweep-store.js";
export { ViemLocalHelperResidualChainReader } from "./viem-local-helper-residual-chain-reader.js";
export { LocalHelperSweepApplicationRescanner } from "./local-helper-sweep-rescanner.js";
export type { LocalHelperSweepRescanRequest } from "./local-helper-sweep-rescanner.js";
export type {
  LocalHelperResidualChainInspection,
  LocalHelperResidualChainReader,
  LocalHelperResidualSnapshotStore,
  LocalHelperSweepApplication,
  LocalHelperSweepBindingStore,
  LocalHelperSweepErrorCode,
  LocalHelperSweepNonceView,
  LocalHelperSweepOperationStore,
  LocalHelperSweepPreviewFacts,
  LocalHelperSweepPreviewStore,
  LocalHelperSweepReservation,
  StoredLocalHelperSweepBatch,
  StoredLocalHelperSweepOperation,
  StoredLocalHelperSweepPreview,
} from "./local-helper-sweeps.js";
export type {
  LocalHelperResidualInventory,
  LocalHelperResidualInventorySource,
  ViemLocalHelperResidualChainReaderOptions,
} from "./viem-local-helper-residual-chain-reader.js";
export type {
  HelperDeploymentApplication,
  HelperDeploymentChainReader,
  HelperDeploymentCreateInput,
  HelperDeploymentErrorCode,
  HelperDeploymentIdempotencyRecord,
  HelperDeploymentInspection,
  HelperDeploymentNonceSnapshot,
  HelperDeploymentNonceView,
  HelperDeploymentOperationStore,
  HelperDeploymentPreviewStore,
  StoredHelperDeploymentOperation,
  StoredHelperDeploymentPreview,
} from "./helper-deployments.js";
export { PostgresAddressBookStore } from "./postgres-address-book-store.js";
export { OkxKeyError, publicOkxKeyStatus, RemoteOkxKeyConnectorClient } from "./okx-key.js";
export type { OkxKeyApplication, OkxKeyConnectorContext, OkxKeyErrorCode } from "./okx-key.js";
export { RemoteWalletSignerClient } from "./remote-wallet-signer-client.js";
export {
  AddressBookError,
  classifyAddress,
  MemoryAddressBookStore,
  parseAddressBookCreateIngress,
  parseAddressBookEntryId,
  parseAddressBookPatch,
} from "./address-book.js";
export type {
  AddressBookAllowedAudit,
  AddressBookAuditAction,
  AddressBookAuditInput,
  AddressBookCreateInput,
  AddressBookDeleteInput,
  AddressBookPatchInput,
  AddressBookStore,
  ParsedAddressBookCreate,
} from "./address-book.js";
export {
  canonicalWalletAddress,
  defaultWalletTokens,
  inspectErc20Token,
  MemoryWalletTokenStore,
  WalletAssetError,
  WalletAssetService,
} from "./wallet-assets.js";
export {
  DirectoryWalletTransferAddressClassifier,
  MemoryWalletTransferOperationStore,
  MemoryWalletTransferPreviewStore,
  parseWalletTransferIdempotencyKey,
  parseWalletTransferOperationId,
  parseWalletTransferPreviewRequest,
  parseWalletTransferSubmit,
  WalletTransferError,
  WalletTransferService,
  walletTransferBodyLimit,
  walletTransferIdempotencyRetentionHours,
  walletTransferPreviewTtlMilliseconds,
} from "./wallet-transfers.js";
export type {
  MemoryWalletTransferOutboxEvent,
  ParsedWalletTransferSubmit,
  StoredWalletTransferOperation,
  WalletTransferAddressClassifier,
  WalletTransferApplication,
  WalletTransferAssetDefinition,
  WalletTransferAssetRegistry,
  WalletTransferChainAssetState,
  WalletTransferChainReader,
  WalletTransferCreateInput,
  WalletTransferCreateResult,
  WalletTransferErrorCode,
  WalletTransferIdempotencyRecord,
  WalletTransferNonceView,
  WalletTransferOperationStore,
  WalletTransferPolicySnapshot,
  WalletTransferPolicySource,
  WalletTransferPreviewStore,
} from "./wallet-transfers.js";
export type {
  ControlledWalletReadProvider,
  ControlledWalletReadProviderRegistry,
  StoredWalletToken,
  WalletAssetApplication,
  WalletAssetErrorCode,
  WalletTokenInsertResult,
  WalletTokenStore,
  WalletUsdPrice,
} from "./wallet-assets.js";
export {
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
} from "./wallets.js";
export type {
  FreshReauthenticationVerifier,
  KeystoreApplication,
  KeystoreResetPreviewDto,
  KeystoreStatusDto,
  SecurityPasswordApplication,
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
export {
  BscPositionReadService,
  ERC721_TRANSFER_TOPIC,
  PositionCursorError,
} from "./position-read-model.js";
export {
  ControlledSwapQuoteService,
  parseSwapQuoteRequest,
  SwapQuoteValidationError,
} from "./swap-quotes.js";
export {
  MemoryPricingPositionStore,
  parseImportPricingPositionRequest,
  parseMarkPricingPositionWithdrawnRequest,
  parsePricingPositionId,
  PricingPositionCursorError,
  PricingPositionError,
  PricingPositionService,
  PricingPositionStreamService,
} from "./pricing-positions.js";
export { PostgresPricingPositionStore } from "./postgres-pricing-position-store.js";
export type { PostgresPricingPositionStoreOptions } from "./postgres-pricing-position-store.js";
export { PostgresSwapQuoteSnapshotStore } from "./postgres-swap-quote-snapshot-store.js";
export type {
  PricingPositionApplication,
  PricingPositionErrorCode,
  PricingPositionEventStore,
  PricingPositionOutboxEvent,
  PricingPositionScope,
  PricingPositionSource,
  PricingPositionSourceSnapshot,
  PricingPositionStore,
  PricingPositionStoreImportInput,
  PricingPositionStoreTransitionInput,
  PricingPositionStreamOpen,
  PricingPositionStreamProvider,
  PricingPositionStreamSnapshot,
} from "./pricing-positions.js";
export type {
  ParsedSwapQuoteRequest,
  SwapQuoteApplication,
  SwapQuoteApplicationInput,
  SwapQuoteSnapshotStore,
} from "./swap-quotes.js";
export type {
  BscPositionReadServiceOptions,
  PositionReadApplication,
  PositionReadScanInput,
} from "./position-read-model.js";
export {
  HELPER_OWNER_READ_ABI,
  MemoryWalletHelperReadStore,
  WalletHelperReadService,
} from "./helper-read-model.js";
export { PostgresWalletHelperReadStore } from "./postgres-wallet-helper-read-store.js";
export type {
  StoredHelperVerification,
  WalletHelperBinding,
  WalletHelperBindingSource,
  WalletHelperReadApplication,
  WalletHelperReadServiceOptions,
  WalletHelperReadStore,
  WalletHelperStatusInput,
} from "./helper-read-model.js";
export {
  ERC20_RESIDUAL_READ_ABI,
  ERC721_RESIDUAL_READ_ABI,
  HelperResidualCursorError,
  HelperResidualReadError,
  WalletHelperResidualService,
} from "./helper-residual-model.js";
export type {
  HelperKnownNft,
  HelperPositionInventory,
  HelperPositionInventorySource,
  HelperResidualListInput,
  HelperResidualReadErrorCode,
  HelperResidualScanInput,
  HelperWalletTokenInventory,
  HelperWalletTokenSource,
  WalletHelperResidualApplication,
  WalletHelperResidualServiceOptions,
} from "./helper-residual-model.js";
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
