export const apiContractPackage = {
  name: "@lpbot/api-contract",
} as const;

export const telegramBotCancelContract = {
  method: "POST",
  path: "/api/auth/login-token/{token}/cancel",
  replicaInternal: true,
} as const;

export type TelegramBotLoginConfirmationStatus =
  "pending" | "confirmed" | "consumed" | "cancelled" | "expired" | "invalid";

export interface TelegramBotLoginConfirmationInput {
  requestId: string;
  telegramSubject: string;
  token: string;
}

export interface TelegramBotLoginConfirmationPort {
  confirmLogin(
    input: TelegramBotLoginConfirmationInput,
  ): Promise<{ status: TelegramBotLoginConfirmationStatus }>;
}

export type Role = "user" | "pro" | "admin";
export type Tier = "normal" | "pro";
export type AccountBlockReason = "pending" | "rejected" | "banned";
export type ChainAccessMode = "off" | "pro" | "all";

export interface EffectiveChainView {
  chainId: number;
  displayName: string;
}

export interface ManagedChainView extends EffectiveChainView {
  access: ChainAccessMode;
  activePositionCount: number | null;
  configurationComplete: boolean;
  isDefault: boolean;
  missingConfiguration: string[];
  previousAccess: ChainAccessMode | null;
  reason: string | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ChainConfigView<TChain extends EffectiveChainView = EffectiveChainView> {
  chains: TChain[];
}

export interface UpdateChainAccessRequest {
  access: Record<string, ChainAccessMode>;
  expectedRevision: Record<string, number>;
  reason: string;
}

export const chainSystemConfigContracts = {
  get: { method: "GET", path: "/api/system-config/chains" },
  post: { method: "POST", path: "/api/system-config/chains" },
} as const;

export interface SessionView {
  allowedChainIds: number[];
  avatarUrl: string | null;
  displayName: string | null;
  maintenanceBypass: boolean;
  role: Role;
  tier: Tier;
  userId: string;
}

export type EvmAddress = `0x${string}`;

export const poolBlocklistSchemaVersion = 1 as const;
export const poolBlocklistMaxEntries = 500 as const;
export const poolBlocklistMaxLabelLength = 64 as const;

export type PoolBlocklistScope = "pool" | "token";
export type BscPoolKey = `56:0x${string}`;

export interface PoolBlocklistEntry {
  chainId: 56;
  identity: BscPoolKey | EvmAddress;
  label?: string;
  scope: PoolBlocklistScope;
}

export interface PoolBlocklistSnapshot {
  blocklistHash: `sha256:${string}`;
  entries: PoolBlocklistEntry[];
  revision: number;
  schemaVersion: typeof poolBlocklistSchemaVersion;
  updatedAt: string | null;
}

export type PoolBlocklistOperation =
  | { entry: PoolBlocklistEntry; type: "block" }
  | { entry: Omit<PoolBlocklistEntry, "label">; type: "restore" };

export interface PatchPoolBlocklistRequest {
  expectedRevision: number;
  operation: PoolBlocklistOperation;
}

export interface PoolBlocklistRevisionConflict {
  current: PoolBlocklistSnapshot;
  error: ApiError;
  success: false;
}

export const poolBlocklistContracts = {
  get: { method: "GET", path: "/api/user/pool-blocklist" },
  patch: { method: "PATCH", path: "/api/user/pool-blocklist" },
} as const;

export const poolActionIntentSchemaVersion = 1 as const;
export type PoolActionIntentAction = "create-task" | "create-monitor" | "share-chat";

export interface PoolActionIntent {
  action: PoolActionIntentAction;
  chainId: 56;
  poolAddress: EvmAddress | null;
  poolId: `0x${string}` | null;
  poolKey: BscPoolKey;
  schemaVersion: typeof poolActionIntentSchemaVersion;
  token0Address: EvmAddress | null;
  token1Address: EvmAddress | null;
}

export const monitorSupportedChainIds = [56] as const;
export const monitorSupportedMetrics = [
  "volumeUsd",
  "feesUsd",
  "feeTvlRatio",
  "tvlUsd",
  "transactionCount",
  "metricVersion",
] as const;
export const monitorUnresolvedMetrics = ["activeTvlUsd", "feeAtvlRatio"] as const;
export const monitorWindowMinutes = [1, 5, 15, 30, 60] as const;
export const monitorConditionLimit = 16 as const;
export const monitorInitialEnabled = false as const;

export type MonitorSupportedMetric = (typeof monitorSupportedMetrics)[number];
export type MonitorUnresolvedMetric = (typeof monitorUnresolvedMetrics)[number];
export type MonitorMetric = MonitorSupportedMetric | MonitorUnresolvedMetric;
export type MonitorWindowMinutes = (typeof monitorWindowMinutes)[number];

export type Condition =
  | {
      enabled: boolean;
      id: Exclude<MonitorSupportedMetric, "metricVersion"> | MonitorUnresolvedMetric;
      operator: "gte" | "lte";
      value: string;
    }
  | {
      enabled: boolean;
      id: "metricVersion";
      operator: "eq";
      value: string;
    };

export interface CreateMonitorRequest {
  conditions: Condition[];
  destinationIds?: string[];
  excludeHanToken: boolean;
  excludeHook: boolean;
  name: string;
  poolKey: BscPoolKey;
  windowMinutes: MonitorWindowMinutes;
}

export interface PatchMonitorChanges {
  conditions?: Condition[];
  destinationIds?: string[];
  excludeHanToken?: boolean;
  excludeHook?: boolean;
  name?: string;
  windowMinutes?: MonitorWindowMinutes;
}

export interface PatchMonitorRequest {
  changes: PatchMonitorChanges;
  expectedRevision: number;
}

export interface LifecycleMonitorRequest {
  expectedRevision: number;
}

export interface Monitor extends CreateMonitorRequest {
  createdAt: string;
  destinationIds: string[];
  disabledAt: string | null;
  enabled: boolean;
  enabledAt: string | null;
  monitorId: string;
  revision: number;
  updatedAt: string;
  userId: string;
}

export interface MonitorPage {
  enabledCount: number;
  items: Monitor[];
  nextCursor: string | null;
  totalCount: number;
}

export type MonitorCreate = CreateMonitorRequest;
export type MonitorPatch = PatchMonitorRequest;
export type MonitorLifecycle = LifecycleMonitorRequest;

export const monitorErrorCodes = [
  "INVALID_QUERY",
  "INVALID_MONITOR",
  "UNSUPPORTED_METRIC",
  "POOL_NOT_ELIGIBLE",
  "LIMIT_EXCEEDED",
  "IDEMPOTENCY_CONFLICT",
  "MONITOR_NOT_FOUND",
  "MONITOR_NOT_READY",
  "REVISION_CONFLICT",
  "REQUEST_TOO_LARGE",
  "UNAUTHENTICATED",
  "SERVICE_UNAVAILABLE",
] as const;
export type MonitorErrorCode = (typeof monitorErrorCodes)[number];

export const monitorContracts = {
  create: { method: "POST", path: "/api/monitors" },
  delete: { method: "DELETE", path: "/api/monitors/{monitorId}" },
  disable: { method: "POST", path: "/api/monitors/{monitorId}/disable" },
  enable: { method: "POST", path: "/api/monitors/{monitorId}/enable" },
  get: { method: "GET", path: "/api/monitors/{monitorId}" },
  list: { method: "GET", path: "/api/monitors" },
  patch: { method: "PATCH", path: "/api/monitors/{monitorId}" },
} as const;

export const notificationCategories = [
  "monitor-match",
  "task-created",
  "position-moved",
  "operation-failed",
  "position-closed",
  "feedback-replied",
] as const;

export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationDestinationType = "telegram" | "webhook";

export interface NotificationPreferences {
  categories: Record<NotificationCategory, boolean>;
  revision: number;
  updatedAt: string | null;
}

export interface NotificationPreferencesPatch {
  categories: Partial<Record<NotificationCategory, boolean>>;
  expectedRevision: number;
}

export interface TelegramDestinationDraftConfig {
  botToken?: string;
  telegramIdentityId: string;
  template: string;
}

export interface WebhookDestinationDraftConfig {
  method: "GET" | "POST";
  signingSecret?: string;
  template: unknown;
  url: string;
}

export type DestinationDraft =
  | {
      categories: NotificationCategory[];
      config: TelegramDestinationDraftConfig;
      enabled: boolean;
      name: string;
      type: "telegram";
    }
  | {
      categories: NotificationCategory[];
      config: WebhookDestinationDraftConfig;
      enabled: boolean;
      name: string;
      type: "webhook";
    };

export type NotificationDestinationDraft = DestinationDraft;

export interface DestinationConfigChanges {
  botToken?: string;
  method?: "GET" | "POST";
  signingSecret?: string;
  telegramIdentityId?: string;
  template?: unknown;
  url?: string;
}

export interface NotificationDestinationPatch {
  changes: {
    categories?: NotificationCategory[];
    config?: DestinationConfigChanges;
    enabled?: boolean;
    name?: string;
  };
  expectedRevision: number;
}

export type RedactedConfig =
  | {
      secretConfigured: boolean;
      secretRef: string | null;
      telegramIdentityId: string;
      template: string;
    }
  | {
      method: "GET" | "POST";
      secretConfigured: boolean;
      secretRef: string | null;
      template: unknown;
      url: string;
    };

export interface NotificationDestinationBase {
  categories: NotificationCategory[];
  createdAt: string;
  destinationId: string;
  enabled: boolean;
  name: string;
  revision: number;
  updatedAt: string;
  userId: string;
}

export type NotificationDestination = NotificationDestinationBase &
  (
    | {
        config: Extract<RedactedConfig, { telegramIdentityId: string }>;
        type: "telegram";
      }
    | {
        config: Extract<RedactedConfig, { method: "GET" | "POST" }>;
        type: "webhook";
      }
  );

export interface LocalSinkTestResult {
  destinationType: NotificationDestinationType;
  networkCalls: 0;
  rendered:
    | { body: string; method: "POST" }
    | { body: ""; method: "GET"; query: string }
    | { message: string; parseMode: "HTML" };
  signed: boolean;
  sink: "local-sink://p03-01";
}

export interface NotificationDestinationOptions {
  telegramIdentityId: string | null;
}

export const notificationPreferenceContracts = {
  get: { method: "GET", path: "/api/notification-preferences" },
  patch: { method: "PATCH", path: "/api/notification-preferences" },
} as const;

export const notificationDestinationContracts = {
  create: { method: "POST", path: "/api/notification-destinations" },
  delete: { method: "DELETE", path: "/api/notification-destinations/{destinationId}" },
  list: { method: "GET", path: "/api/notification-destinations" },
  options: { method: "GET", path: "/api/notification-destinations/options" },
  patch: { method: "PATCH", path: "/api/notification-destinations/{destinationId}" },
  test: { method: "POST", path: "/api/notification-destinations/test" },
} as const;

export const notificationDeliveryStatuses = [
  "pending",
  "sending",
  "retrying",
  "delivered",
  "failed",
] as const;

export type NotificationDeliveryStatus = (typeof notificationDeliveryStatuses)[number];

export interface NotificationHistoryDestinationSnapshot {
  destinationId: string;
  name: string;
  type: NotificationDestinationType | "local-sink";
}

export interface NotificationHistoryItem {
  attemptCount: number;
  conditionSummary: string;
  createdAt: string;
  deliveredAt: string | null;
  deliveryId: string;
  destination: NotificationHistoryDestinationSnapshot;
  errorCode: string | null;
  monitorId: string;
  monitorName: string;
  nextRetryAt: string | null;
  poolKey: BscPoolKey;
  status: NotificationDeliveryStatus;
  updatedAt: string;
  windowEnd: string;
  windowMinutes: MonitorWindowMinutes;
}

export interface NotificationHistoryPage {
  items: NotificationHistoryItem[];
  nextCursor: string | null;
}

export const notificationHistoryContract = {
  list: { method: "GET", path: "/api/notifications/history" },
} as const;

export interface AddressRemark {
  address: EvmAddress;
  label: string;
  watched: boolean;
}

export interface SharedRemark {
  address: EvmAddress;
  label: string;
  votes: number;
}

export interface AddressRemarksResponse {
  remarks: AddressRemark[];
  shared: SharedRemark[];
}

export interface PutAddressRemarkRequest {
  address: EvmAddress;
  label: string;
  watched: boolean;
}

export interface PutAddressRemarkResponse {
  remark: AddressRemark | null;
}

export interface DeleteAddressRemarkResponse {
  deleted: boolean;
}

export const addressRemarksContracts = {
  delete: { method: "DELETE", path: "/api/address-remarks/{address}" },
  get: { method: "GET", path: "/api/address-remarks" },
  put: { method: "PUT", path: "/api/address-remarks" },
} as const;

export const userPreferenceSchemaVersion = 5 as const;

export const poolColumnKeys = [
  "pool",
  "protocol",
  "fees",
  "volume",
  "feeTvl",
  "feeActiveTvl",
  "tvl",
  "txs",
  "fdv",
  "actions",
] as const;

export const navigationKeys = [
  "tasks",
  "pools",
  "strategies",
  "activity",
  "wallets",
  "chat",
] as const;

export const colorThemeKeys = [
  "neutral",
  "blue",
  "violet",
  "green",
  "orange",
  "red",
  "cyan",
  "pink",
  "indigo",
  "amber",
  "teal",
  "custom",
] as const;

export type NavigationKey = (typeof navigationKeys)[number];
export type ColorTheme = (typeof colorThemeKeys)[number];
export type ThemePreference = "light" | "dark" | "system";
export type TaskViewMode = "grid" | "list";
export type PoolColumnKey = (typeof poolColumnKeys)[number];

export interface NavigationPreference {
  key: NavigationKey;
  visible: boolean;
}

export interface PoolColumnPreference {
  key: PoolColumnKey;
  visible: boolean;
}

export interface UserPreferences {
  colorTheme: ColorTheme;
  customColor: string | null;
  navConfig: NavigationPreference[];
  poolColumns: PoolColumnPreference[];
  poolsPanelCollapsed: boolean;
  showHotPools: boolean;
  showPoolLabels: boolean;
  showScanTab: boolean;
  taskViewMode: TaskViewMode;
  theme: ThemePreference;
}

export const defaultUserPreferences: Readonly<UserPreferences> = Object.freeze({
  colorTheme: "neutral",
  customColor: null,
  navConfig: navigationKeys.map((key) => ({ key, visible: true })),
  poolColumns: poolColumnKeys.map((key) => ({ key, visible: true })),
  poolsPanelCollapsed: false,
  showHotPools: false,
  showPoolLabels: true,
  showScanTab: true,
  taskViewMode: "grid",
  theme: "system",
});

export interface VersionedUserPreferences {
  preferences: UserPreferences;
  revision: number;
  schemaVersion: typeof userPreferenceSchemaVersion;
  updatedAt: string | null;
}

export interface UpdateUserPreferencesRequest {
  changes: Partial<UserPreferences>;
  expectedRevision: number;
}

export const userPreferencesContracts = {
  get: { method: "GET", path: "/api/user/preferences" },
  patch: { method: "PATCH", path: "/api/user/preferences" },
} as const;

export interface ShellTaskCounts {
  paused: number | null;
  running: number | null;
  stopped: number | null;
}

export interface ShellGasStats {
  baseGwei: number | null;
  ethereumGwei: number | null;
}

export interface RecommendedPoolRow {
  chainId: 56;
  feePips: string | null;
  feesUsd: string;
  poolAddress: EvmAddress | null;
  poolId: `0x${string}` | null;
  poolKey: string;
  protocol: MarketProtocol;
  token0Address: EvmAddress;
  token0Symbol: string | null;
  token1Address: EvmAddress;
  token1Symbol: string | null;
}

export interface RecommendedPoolsSnapshotEvent {
  cursor: string;
  observedAt: string;
  pools: RecommendedPoolRow[];
  selectionHash: string;
  sourceVersion: string;
  sourceWindow: 5;
  sourceWindowEnd: string;
  type: "rec_pools_snapshot";
}

export interface ShellStats {
  fps: number | null;
  gas: ShellGasStats;
  online: boolean | null;
  pingMs: number | null;
  taskCounts: ShellTaskCounts;
}

export interface ShellStatsSnapshot {
  observedAt: string;
  sequence: number;
  stats: ShellStats;
}

export interface ShellStatsPatch {
  fps?: number | null;
  gas?: Partial<ShellGasStats>;
  online?: boolean | null;
  pingMs?: number | null;
  taskCounts?: Partial<ShellTaskCounts>;
}

export type ShellStatsEvent =
  | (ShellStatsSnapshot & { type: "snapshot" })
  | { observedAt: string; sequence: number; stats: ShellStatsPatch; type: "update" }
  | RecommendedPoolsSnapshotEvent
  | { observedAt: string; sequence: number | null; type: "heartbeat" };

export const shellStatsContracts = {
  snapshot: { method: "GET", path: "/api/stats" },
  stream: { method: "GET", path: "/api/stats/stream" },
} as const;

export const marketWindowMinutes = [1, 5, 15, 30, 60] as const;

export type MarketWindowMinutes = (typeof marketWindowMinutes)[number];
export const liquidityFlowSchemaVersion = "1.0.0" as const;
export const liquidityFlowProtocols = ["pcsv3", "univ3", "pcsv4", "univ4"] as const;
export const liquidityFlowEventTypes = ["create", "add", "remove"] as const;

export type MarketProtocol = (typeof liquidityFlowProtocols)[number];
export type LiquidityFlowProtocol = MarketProtocol;
export type LiquidityFlowEventType = (typeof liquidityFlowEventTypes)[number];
export type LiquidityProtocolFilter = readonly LiquidityFlowProtocol[];

export const poolCreationProvenanceSchemaVersion = 1 as const;
export type PoolCreationOutcome = "created" | "already_exists";
export type PoolCreationAttributionWarning = "ALREADY_EXISTS_NOT_PLATFORM_FIRST";

export interface PoolCreationProvenanceRecord {
  chainId: 56;
  completedAt: string;
  creatorAddress: EvmAddress | null;
  feePips: string;
  operationId: string;
  outcome: PoolCreationOutcome;
  poolKey: BscPoolKey;
  protocol: MarketProtocol;
  schemaVersion: typeof poolCreationProvenanceSchemaVersion;
  txHash: `0x${string}` | null;
  userId: string;
}

export interface PoolCreationCreatorProfile {
  avatarUrl: string | null;
  displayName: string | null;
  telegramId: string | null;
}

export interface PoolCreationAttribution {
  creatorProfile: PoolCreationCreatorProfile | null;
  record: PoolCreationProvenanceRecord;
  warning: PoolCreationAttributionWarning | null;
}

export interface PoolCreationHistoryPage {
  items: PoolCreationAttribution[];
  nextCursor: string | null;
}

export interface PoolCreatorResult {
  creator: PoolCreationAttribution | null;
  identity: string;
}

export interface PoolCreatorBatchResponse {
  results: PoolCreatorResult[];
}

export const poolCreationProvenanceContracts = {
  batch: { method: "POST", path: "/api/admin/pool-creators" },
  history: { method: "GET", path: "/api/pools/create-history" },
  single: { method: "GET", path: "/api/admin/pool-creators" },
} as const;

export interface LiquidityFlowFilter {
  nftId: string | null;
  pool: EvmAddress | `0x${string}` | null;
  since: number;
  token: EvmAddress | null;
  user: EvmAddress | null;
}

export interface LiquidityFlowEvent {
  amount0: string | null;
  amount1: string | null;
  block_hash: `0x${string}`;
  block_number: string;
  chain_id: 56;
  cursor: string;
  dex: LiquidityFlowProtocol;
  event_type: LiquidityFlowEventType;
  finality: "observed";
  hooks: EvmAddress | null;
  id: string;
  in_range: boolean | null;
  liquidity_delta: string | null;
  log_index: number;
  nft_id: string | null;
  pool_address: EvmAddress | null;
  pool_id: `0x${string}` | null;
  record_type: "event";
  schema_version: typeof liquidityFlowSchemaVersion;
  tick_lower: string | null;
  tick_upper: string | null;
  token0_address: EvmAddress | null;
  token0_symbol: string | null;
  token1_address: EvmAddress | null;
  token1_symbol: string | null;
  ts: number;
  tx_hash: `0x${string}`;
  tx_index: number;
  user: EvmAddress | null;
  usd_value: string | null;
  version: "v3" | "v4";
}

export interface LiquidityFlowTombstone {
  cursor: string;
  dex: LiquidityFlowProtocol;
  finality: "reverted";
  id: string;
  nft_id: string | null;
  pool_address: EvmAddress | null;
  pool_id: `0x${string}` | null;
  reason: "reorg";
  record_type: "tombstone";
  reverted_id: string;
  schema_version: typeof liquidityFlowSchemaVersion;
  token0_address: EvmAddress | null;
  token1_address: EvmAddress | null;
  ts: number;
  user: EvmAddress | null;
  version: "v3" | "v4";
}

export type LiquidityFlowRecord = LiquidityFlowEvent | LiquidityFlowTombstone;

export interface LiquidityFlowBackfill {
  cursor: string | null;
  event_type: "liquidity.backfill";
  events: LiquidityFlowRecord[];
  has_more: boolean;
  schema_version: typeof liquidityFlowSchemaVersion;
  stream_key: string;
}

export interface LiquidityFlowCanonicalEnvelope {
  cursor: string;
  data: LiquidityFlowBackfill | LiquidityFlowRecord | null;
  emittedAt: string;
  epoch: string;
  eventType: "liquidity.backfill" | "liquidity.event" | "heartbeat";
  mode: "snapshot" | "diff";
  schemaVersion: typeof liquidityFlowSchemaVersion;
  sequence: string;
  streamKey: string;
}

function isLiquidityFlowProtocol(value: string): value is LiquidityFlowProtocol {
  return (liquidityFlowProtocols as readonly string[]).includes(value);
}

export function canonicalizeLiquidityProtocols(values: readonly string[]): LiquidityFlowProtocol[] {
  const selected = new Set<LiquidityFlowProtocol>();
  for (const value of values) {
    if (!isLiquidityFlowProtocol(value)) throw new RangeError("DEX_FILTER_INVALID");
    selected.add(value);
  }
  if (selected.size === 0) throw new RangeError("DEX_FILTER_INVALID");
  return liquidityFlowProtocols.filter((protocol) => selected.has(protocol));
}

export function parseLiquidityProtocolFilter(value: unknown): LiquidityFlowProtocol[] {
  if (value === undefined || value === null) return [...liquidityFlowProtocols];
  const entries = (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    typeof entry === "string" ? entry.split(",") : [],
  );
  if (
    entries.length === 0 ||
    entries.some((entry) => entry.length === 0) ||
    (Array.isArray(value) && value.some((entry) => typeof entry !== "string"))
  ) {
    throw new RangeError("DEX_FILTER_INVALID");
  }
  return canonicalizeLiquidityProtocols(entries);
}

export function marketStreamKey(input: {
  chainId: 56;
  minutes: MarketWindowMinutes;
  protocols: LiquidityProtocolFilter;
}): string {
  const protocols = canonicalizeLiquidityProtocols(input.protocols);
  const base = `top-fees:${input.chainId}:${input.minutes}`;
  return protocols.length === liquidityFlowProtocols.length
    ? base
    : `${base}:dex=${protocols.join(",")}`;
}

export const poolLabelIds = [
  "high-fee-rate",
  "yield-surge",
  "yield-decline",
  "yield-stable",
  "stable-volume-price",
  "crowded",
  "volatile",
  "lp-inflow",
  "lp-outflow",
] as const;

export type PoolLabelId = (typeof poolLabelIds)[number];
export type PoolLabelReasonOperator = ">=" | "<=" | "abs<=";

export interface PoolLabelReason {
  code: string;
  observed: string;
  operator: PoolLabelReasonOperator;
  threshold: string;
  window: string;
}

export interface MarketPoolLabel {
  computedAt: string;
  id: PoolLabelId;
  label: string;
  reasons: PoolLabelReason[];
  ruleVersion: string;
  score: number;
}

export interface MarketPoolRow {
  activeTvlUsd: null;
  chainId: 56;
  fdvUsd: string | null;
  feePips: string | null;
  feeActiveTvl: null;
  feesUsd: string | null;
  feeTvl: string | null;
  hooks: EvmAddress | null;
  labelRuleVersion: string;
  labels: MarketPoolLabel[];
  poolAddress: EvmAddress | null;
  poolId: `0x${string}` | null;
  poolKey: string;
  protocol: MarketProtocol;
  tickSpacing: string | null;
  token0Address: EvmAddress | null;
  token0Symbol: string | null;
  token1Address: EvmAddress | null;
  token1Symbol: string | null;
  transactionCount: string | null;
  tvlUsd: string | null;
  volumeUsd: string | null;
}

export type MarketPoolByTokenSort = "fees" | "volume";

export interface MarketPoolByTokenRow extends MarketPoolRow {
  fees1h: string | null;
  fees5m: string | null;
  transactionCount1h: string | null;
  transactionCount5m: string | null;
  volume1h: string | null;
  volume5m: string | null;
}

export interface MarketPoolSnapshot {
  canonicalRevision: string;
  chainId: 56;
  generatedAt: string;
  metricVersion: string;
  minutes: MarketWindowMinutes;
  rows: MarketPoolRow[];
  version: string;
  windowEnd: string;
  windowStart: string;
}

export interface MarketPoolDiff {
  canonicalRevision: string;
  metricVersion: string;
  tombstones: string[];
  upserts: MarketPoolRow[];
  version: string;
  windowEnd: string;
}

export type MarketStreamEventType = "pools.snapshot" | "pools.diff" | "heartbeat";

export interface MarketStreamEnvelope {
  cursor: string;
  data: MarketPoolSnapshot | MarketPoolDiff | null;
  emittedAt: string;
  epoch: string;
  eventType: MarketStreamEventType;
  mode: "snapshot" | "diff";
  schemaVersion: "1.0.0";
  sequence: string;
  streamKey: string;
}

export const marketPoolsContracts = {
  byToken: { method: "GET", path: "/api/pools/by-token/{address}" },
  snapshot: { method: "GET", path: "/api/pools/top-fees/{minutes}" },
  stream: { method: "GET", path: "/api/pools/top-fees/{minutes}/stream" },
} as const;

export const marketCandleBars = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
export type MarketCandleBar = (typeof marketCandleBars)[number];
export type MarketCandleDirection = "token0" | "token1";
export type MarketReadModelSource = "canonical-events";

export interface MarketCandle {
  close: string;
  high: string;
  low: string;
  open: string;
  ts: number;
  volume: string;
}

export interface MarketCandlesResponse {
  asOf: string;
  bar: MarketCandleBar;
  candles: MarketCandle[];
  canonicalRevision: string;
  chainId: 56;
  direction: MarketCandleDirection;
  poolKey: string;
  priceUnit: "token0-raw/token1-raw" | "token1-raw/token0-raw";
  source: MarketReadModelSource;
  token: EvmAddress;
  version: string;
  volumeUnit: { kind: "raw-integer"; token: EvmAddress };
}

export interface MarketTickLiquidityPoint {
  liquidityNet: string;
  price0: string | null;
  price1: string | null;
  tickIdx: number;
}

export interface MarketTickLiquidityResponse {
  asOf: string;
  canonicalRevision: string;
  chainId: 56;
  currentTick: number | null;
  decimals0: number | null;
  decimals1: number | null;
  poolKey: string;
  range: number;
  source: MarketReadModelSource;
  tickSpacing: number;
  ticks: MarketTickLiquidityPoint[];
  version: string;
}

export const marketChartContracts = {
  candles: { method: "GET", path: "/api/market/candles" },
  liquidity: { method: "GET", path: "/api/pools/liquidity/{poolAddressOrPoolId}" },
} as const;

export interface WalletChallengeRequest {
  address: EvmAddress;
  chainId: number;
}

export interface WalletChallengeView {
  expiresAt: string;
  message: string;
  nonceId: string;
}

export interface WalletLoginRequest extends WalletChallengeRequest {
  nonceId: string;
  signature: `0x${string}`;
}

export interface LoginWalletLinkRequest extends WalletLoginRequest {
  label: string | null;
}

export interface LoginWalletLinkView {
  addressMasked: string;
  createdAt: string;
  label: string | null;
  linkId: string;
  updatedAt: string;
}

export const walletEncryptionModes = ["server-kek", "user-password"] as const;
export type WalletEncryptionMode = (typeof walletEncryptionModes)[number];

export const walletLockStatuses = ["ready", "locked", "quarantined"] as const;
export type WalletLockStatus = (typeof walletLockStatuses)[number];

export interface CustodyWallet {
  address: EvmAddress;
  createdAt: string;
  envelopeVersion: number;
  lockStatus: WalletLockStatus;
  mode: WalletEncryptionMode;
  name: string;
  revision: number;
  updatedAt: string;
  walletId: string;
}

export interface CustodyWalletPage {
  items: CustodyWallet[];
}

export const walletPriceStatuses = ["current", "missing", "stale"] as const;
export type WalletPriceStatus = (typeof walletPriceStatuses)[number];

export interface WalletTokenDefinition {
  chainId: number;
  decimals: number;
  default: boolean;
  name: string;
  symbol: string;
  tokenAddress: EvmAddress;
}

export interface WalletTokenPage {
  chainId: number;
  items: WalletTokenDefinition[];
  walletId: string;
}

export interface ImportWalletTokenRequest {
  chainId: number;
  tokenAddress: EvmAddress;
}

export interface WalletAssetBalance {
  assetType: "native" | "erc20";
  balanceBaseUnit: string;
  balanceDecimal: string;
  decimals: number;
  default: boolean;
  name: string;
  priceStatus: WalletPriceStatus;
  symbol: string;
  tokenAddress: EvmAddress | null;
  usdPriceDecimal: string | null;
  usdValueDecimal: string | null;
}

export interface WalletBalanceSnapshot {
  address: EvmAddress;
  blockNumberDecimal: string;
  chainId: number;
  items: WalletAssetBalance[];
  readAt: string;
  totalUsdValueDecimal: string | null;
  walletId: string;
}

export interface WalletReceiveContent {
  address: EvmAddress;
  amountBaseUnit: string | null;
  amountDecimal: string | null;
  chainId: number;
  eip681: string;
  tokenAddress: EvmAddress | null;
  walletId: string;
}

export type PositionPlatformId = 1 | 2 | 4 | 5;

export const positionReadStates = Object.freeze([
  "empty",
  "ready",
  "partial",
  "stale",
  "quarantined",
] as const);
export type PositionReadState = (typeof positionReadStates)[number];

export const positionReadUiStates = Object.freeze([
  "loading",
  ...positionReadStates,
  "error",
] as const);
export type PositionReadUiState = (typeof positionReadUiStates)[number];

export interface PositionSnapshot {
  blockHash: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  digest: `0x${string}`;
  positionManager: EvmAddress;
  positionManagerCodeHash: `0x${string}`;
  registryVersion: string;
}

export interface WalletPosition {
  approval: {
    approvedAddress: EvmAddress | null;
    approvedForAll: boolean;
    helperAuthorized: boolean;
    nftOwner: EvmAddress;
    observedAtBlock: string;
  };
  chainId: 56;
  fees: {
    estimated0BaseUnit: string | null;
    estimated1BaseUnit: string | null;
    owed0BaseUnit: string;
    owed1BaseUnit: string;
  };
  liquidity: {
    amount0BaseUnit: string;
    amount1BaseUnit: string;
    raw: string;
  };
  owner: EvmAddress;
  platformId: PositionPlatformId;
  pool: {
    feePips: string;
    hooks: EvmAddress | null;
    poolAddress: EvmAddress | null;
    poolId: `0x${string}` | null;
    tickSpacing: string;
    token0: EvmAddress;
    token1: EvmAddress;
  };
  snapshot: PositionSnapshot;
  ticks: {
    current: string;
    inRange: boolean;
    lower: string;
    upper: string;
  };
  tokenId: string;
}

export type PositionQuarantineReason =
  | "abi-decode-failed"
  | "invalid-transfer-log"
  | "owner-mismatch"
  | "position-manager-code-hash-mismatch"
  | "provider-read-failed"
  | "unknown-position-manager";

export interface QuarantinedPositionRead {
  managerAddress: EvmAddress;
  platformId: PositionPlatformId | null;
  reason: PositionQuarantineReason;
  tokenId: string | null;
}

export interface PositionPageSnapshot {
  blockHash: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  digest: `0x${string}`;
}

export interface WalletPositionPage {
  address: EvmAddress;
  chainId: 56;
  coverage: {
    complete: boolean;
    failedPlatformIds: PositionPlatformId[];
    scannedPlatformIds: PositionPlatformId[];
  };
  cursor: string | null;
  items: WalletPosition[];
  quarantined: QuarantinedPositionRead[];
  registryVersion: string;
  snapshot: PositionPageSnapshot;
  status: PositionReadState;
  walletId: string;
}

export const positionReadContracts = Object.freeze({
  list: Object.freeze({ method: "GET", path: "/api/wallets/{address}/positions" }),
  scan: Object.freeze({ method: "GET", path: "/api/positions/scan/{address}" }),
} as const);

export const swapQuoteStates = Object.freeze([
  "idle",
  "quoting",
  "quoted",
  "expired",
  "stale",
  "error",
] as const);
export type SwapQuoteState = (typeof swapQuoteStates)[number];

export interface SwapQuoteRequest {
  amountInBaseUnit: string;
  chainId: 56;
  platformId: PositionPlatformId;
  slippageBps: number;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  walletId: string;
}

export interface SwapQuoteGas {
  estimatedFeeWei: string;
  gasLimit: string;
  gasPriceWei: string;
}

export interface SwapQuoteRoute {
  poolPath: `0x${string}`[];
  tokens: EvmAddress[];
}

export interface SwapQuoteView extends SwapQuoteRequest {
  amountOutBaseUnit: string;
  blockNumber: string;
  calldataDigest: `0x${string}`;
  deadline: string;
  digest: `0x${string}`;
  digestDomain: "LPXBOT_SWAP_QUOTE";
  digestVersion: 1;
  executionEnabled: false;
  expiresAt: string;
  gas: SwapQuoteGas;
  maxBlockNumber: string;
  minOutBaseUnit: string;
  priceImpactBps: number;
  providerSnapshotId: string;
  quotedAt: string;
  registryVersion: string;
  route: SwapQuoteRoute;
  router: EvmAddress;
  selector: `0x${string}`;
  spender: EvmAddress;
  walletAddress: EvmAddress;
}

export const swapQuoteContracts = Object.freeze({
  quote: Object.freeze({ method: "POST", path: "/api/swap/quote" }),
} as const);

export type LocalSwapAuthorizationMode = "direct" | "permit2";
export type LocalSwapExecutionState =
  "queued" | "signing" | "broadcast" | "pending" | "reconciling" | "succeeded" | "failed";
export type LocalSwapStepKind = "allowance-reset" | "approve" | "swap" | "cleanup";
export type LocalSwapStepState =
  | "blocked"
  | "queued"
  | "signed"
  | "broadcast"
  | "pending"
  | "confirmed"
  | "succeeded"
  | "failed"
  | "dropped"
  | "replaced"
  | "skipped"
  | "reconciling";

export interface LocalSwapQuoteRequest {
  amountInBaseUnit: string;
  chainId: 31_337;
  slippageBps: number;
  tokenIn: EvmAddress;
  tokenOut: EvmAddress;
  walletId: string;
}

export interface LocalSwapQuoteView extends LocalSwapQuoteRequest {
  amountOutBaseUnit: string;
  blockNumber: string;
  deadline: string;
  executionEnabled: true;
  expiresAt: string;
  gas: {
    estimatedFeeBaseUnit: string;
    gasLimit: string;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
  };
  helperAddress: EvmAddress;
  maxBlockNumber: string;
  minOutBaseUnit: string;
  quoteDigest: `sha256:${string}`;
  quoteVersion: "p05-local-swap-quote-v2";
  quotedAt: string;
  registryVersion: "p05-local-swap-execution-v2";
  serviceFeeBps: 0;
  walletAddress: EvmAddress;
}

export interface LocalSwapExecutePreviewRequest {
  authorizationMode: LocalSwapAuthorizationMode;
  quoteDigest: `sha256:${string}`;
  walletId: string;
}

export interface LocalSwapFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface LocalSwapExecutePreview extends LocalSwapExecutePreviewRequest {
  chainId: 31_337;
  deadline: string;
  expiresAt: string;
  feeLimitTotalBaseUnit: string;
  helperAddress: EvmAddress;
  minOutBaseUnit: string;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  serviceFeeBps: 0;
  steps: Array<{
    amountBaseUnit: string;
    feeLimit: LocalSwapFeeLimit;
    kind: LocalSwapStepKind;
    ordinal: number;
  }>;
}

export interface LocalSwapExecuteRequest extends LocalSwapExecutePreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface LocalSwapStepTransactionView {
  active: boolean;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: Exclude<LocalSwapStepState, "blocked" | "queued" | "skipped" | "reconciling">;
  transactionHash: `0x${string}` | null;
}

export interface LocalSwapOperationStep {
  failureCode: string | null;
  feeLimit: LocalSwapFeeLimit;
  kind: LocalSwapStepKind;
  nonce: string;
  ordinal: number;
  state: LocalSwapStepState;
  stepId: string;
  transactions: LocalSwapStepTransactionView[];
}

export interface LocalSwapExecutionOperation {
  authorizationMode: LocalSwapAuthorizationMode;
  chainId: 31_337;
  createdAt: string;
  failureCode: string | null;
  helperAddress: EvmAddress;
  operationId: string;
  operationKind: "local-swap";
  planDigest: `sha256:${string}`;
  quoteDigest: `sha256:${string}`;
  reconciliationReason: string | null;
  registryVersion: "p05-local-swap-execution-v2";
  state: LocalSwapExecutionState;
  steps: LocalSwapOperationStep[];
  updatedAt: string;
  walletId: string;
}

export type LocalPositionExecutionState = LocalSwapExecutionState;
export type LocalPositionStepState = LocalSwapStepState;
export type LocalPositionStepKind = "burn" | "collect" | "decrease";

export interface LocalPositionCurrentSnapshot {
  block: {
    hash: `0x${string}`;
    number: string;
    timestamp: string;
  };
  chainId: 31_337;
  expiresAt: string;
  manager: {
    abiHash: `sha256:${string}`;
    address: EvmAddress;
    runtimeCodeHash: `0x${string}`;
  };
  observedAt: string;
  position: {
    approval: {
      approvedAddress: EvmAddress | null;
      approvedForAll: boolean;
      operator: EvmAddress | null;
    };
    liquidity: string;
    owner: EvmAddress;
    platformId: PositionPlatformId;
    pool: {
      feePips: string;
      poolAddress: EvmAddress | null;
      poolId: `0x${string}` | null;
      tickSpacing: string;
      token0: EvmAddress;
      token1: EvmAddress;
    };
    reserve0BaseUnit: string;
    reserve1BaseUnit: string;
    ticks: { lower: string; upper: string };
    tokenId: string;
    tokensOwed0BaseUnit: string;
    tokensOwed1BaseUnit: string;
  };
  registry: {
    digest: `sha256:${string}`;
    version: "p05-local-position-execution-v2";
  };
  schemaVersion: 2;
  snapshotDigest: `sha256:${string}`;
  snapshotVersion: "p05-local-position-snapshot-v2";
  tokens: readonly [
    { address: EvmAddress; runtimeCodeHash: `0x${string}` },
    { address: EvmAddress; runtimeCodeHash: `0x${string}` },
  ];
  wallet: { address: EvmAddress; walletId: string };
}

export interface LocalPositionCurrentPage {
  chainId: 31_337;
  executionEnabled: boolean;
  items: LocalPositionCurrentSnapshot[];
  registryVersion: "p05-local-position-execution-v2";
  serviceFeeBps: 0;
  walletId: string;
}

export interface LocalPositionCollectFeesPreviewRequest {
  platformId: PositionPlatformId;
  snapshotDigest: `sha256:${string}`;
  tokenId: string;
  walletId: string;
}

export interface LocalPositionCollectFeesRequest extends LocalPositionCollectFeesPreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface LocalPositionRemoveLiquidityPreviewRequest {
  burnIfEmpty: boolean;
  percent: number;
  platformId: PositionPlatformId;
  slippageBps: number;
  snapshotDigest: `sha256:${string}`;
  tokenId: string;
  walletId: string;
}

export interface LocalPositionRemoveLiquidityRequest extends LocalPositionRemoveLiquidityPreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface LocalPositionExecutionPreviewStep {
  feeLimit: LocalSwapFeeLimit;
  kind: LocalPositionStepKind;
  ordinal: number;
}

export interface LocalPositionExecutionPreviewBase {
  chainId: 31_337;
  deadline: string;
  expectedToken0DeltaBaseUnit: string;
  expectedToken1DeltaBaseUnit: string;
  expiresAt: string;
  feeLimitTotalBaseUnit: string;
  feeProceeds0BaseUnit: string;
  feeProceeds1BaseUnit: string;
  liquidityDelta: string;
  managerAddress: EvmAddress;
  minPrincipal0BaseUnit: string;
  minPrincipal1BaseUnit: string;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  principal0BaseUnit: string;
  principal1BaseUnit: string;
  remainingLiquidity: string;
  serviceFeeBps: 0;
  steps: LocalPositionExecutionPreviewStep[];
}

export interface LocalPositionCollectFeesPreview
  extends LocalPositionCollectFeesPreviewRequest, LocalPositionExecutionPreviewBase {
  burnIfEmpty: false;
  operationKind: "position-collect-fees";
  percent: null;
  slippageBps: null;
}

export interface LocalPositionRemoveLiquidityPreview
  extends LocalPositionRemoveLiquidityPreviewRequest, LocalPositionExecutionPreviewBase {
  operationKind: "position-remove-liquidity";
}

export type LocalPositionExecutionPreview =
  LocalPositionCollectFeesPreview | LocalPositionRemoveLiquidityPreview;

export interface LocalPositionStepTransactionView {
  active: boolean;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: Exclude<LocalPositionStepState, "blocked" | "queued" | "skipped" | "reconciling">;
  transactionHash: `0x${string}` | null;
}

export interface LocalPositionOperationStep {
  failureCode: string | null;
  feeLimit: LocalSwapFeeLimit;
  kind: LocalPositionStepKind;
  nonce: string;
  ordinal: number;
  state: LocalPositionStepState;
  stepId: string;
  transactions: LocalPositionStepTransactionView[];
}

export interface LocalPositionExecutionOperation {
  burnIfEmpty: boolean;
  chainId: 31_337;
  createdAt: string;
  failureCode: string | null;
  managerAddress: EvmAddress;
  operationId: string;
  operationKind: "position-collect-fees" | "position-remove-liquidity";
  percent: number | null;
  planDigest: `sha256:${string}`;
  platformId: PositionPlatformId;
  reconciliationReason: string | null;
  registryVersion: "p05-local-position-execution-v2";
  slippageBps: number | null;
  snapshotDigest: `sha256:${string}`;
  state: LocalPositionExecutionState;
  steps: LocalPositionOperationStep[];
  tokenId: string;
  updatedAt: string;
  walletId: string;
}

export type ChainOperationView =
  | HelperDeploymentOperation
  | LocalHelperSweepOperation
  | LocalPositionExecutionOperation
  | LocalSwapExecutionOperation;

export const localSwapExecutionContracts = Object.freeze({
  execute: Object.freeze({ method: "POST", path: "/api/swap/execute" }),
  get: Object.freeze({ method: "GET", path: "/api/chain-operations/{operationId}" }),
  preview: Object.freeze({ method: "POST", path: "/api/swap/execute/preview" }),
} as const);

export const localPositionExecutionContracts = Object.freeze({
  collectFees: Object.freeze({ method: "POST", path: "/api/positions/collect-fees" }),
  collectFeesPreview: Object.freeze({
    method: "POST",
    path: "/api/positions/collect-fees/preview",
  }),
  get: Object.freeze({ method: "GET", path: "/api/chain-operations/{operationId}" }),
  localCurrent: Object.freeze({ method: "GET", path: "/api/positions/local-current" }),
  removeLiquidity: Object.freeze({
    method: "POST",
    path: "/api/positions/remove-liquidity",
  }),
  removeLiquidityPreview: Object.freeze({
    method: "POST",
    path: "/api/positions/remove-liquidity/preview",
  }),
} as const);

export type PricingPositionPriceStatus = "current" | "missing" | "stale";
export type PricingPositionStatus = "active" | "hidden" | "withdrawn";

export interface PricingPositionCostBasisInput {
  amount0BaseUnit: string;
  amount1BaseUnit: string;
  priceObservedAt: string | null;
  priceSource: string | null;
  usdValueDecimal: string | null;
}

export interface PricingPositionCostBasis extends PricingPositionCostBasisInput {
  priceStatus: PricingPositionPriceStatus;
}

export interface ImportPricingPositionRequest {
  chainId: 56;
  costBasis: PricingPositionCostBasisInput;
  platformId: PositionPlatformId;
  snapshotDigest: `0x${string}`;
  tokenId: string;
  walletId: string;
}

export interface PricingPositionObservation {
  blockHash: `0x${string}`;
  blockNumber: string;
  liquidityAmount0BaseUnit: string;
  liquidityAmount1BaseUnit: string;
  liquidityRaw: string;
  observationId: string;
  observedAt: string;
  observedFee0BaseUnit: string;
  observedFee1BaseUnit: string;
  pageSnapshotDigest: `0x${string}`;
  recordedAt: string;
  snapshotDigest: `0x${string}`;
}

export interface PricingPosition {
  chainId: 56;
  costBasis: PricingPositionCostBasis;
  importedAt: string;
  observations: PricingPositionObservation[];
  platformId: PositionPlatformId;
  pool: {
    poolAddress: EvmAddress | null;
    poolId: `0x${string}` | null;
    token0: EvmAddress;
    token1: EvmAddress;
  };
  positionManager: EvmAddress;
  pricingId: string;
  revision: number;
  status: PricingPositionStatus;
  tokenId: string;
  updatedAt: string;
  walletAddress: EvmAddress;
  walletId: string;
}

export interface PricingPositionPage {
  items: PricingPosition[];
}

export interface MarkPricingPositionWithdrawnRequest {
  expectedRevision: number;
}

export const pricingPositionContracts = Object.freeze({
  import: Object.freeze({ method: "POST", path: "/api/pricing-positions/import" }),
  list: Object.freeze({ method: "GET", path: "/api/pricing-positions" }),
  stream: Object.freeze({ method: "GET", path: "/api/pricing-positions/stream" }),
  withdrawn: Object.freeze({
    method: "POST",
    path: "/api/pricing-positions/{pricingId}/withdrawn",
  }),
} as const);

export interface PricingPositionStreamBase {
  cursor: string;
  epoch: string;
  sequence: string;
}

export type PricingPositionStreamEvent =
  | (PricingPositionStreamBase & {
      items: PricingPosition[];
      type: "snapshot";
    })
  | (PricingPositionStreamBase & {
      position: PricingPosition;
      type: "diff";
    })
  | (PricingPositionStreamBase & {
      pricingId: string;
      revision: number;
      status: "withdrawn";
      type: "tombstone";
    })
  | (PricingPositionStreamBase & {
      observedAt: string;
      type: "heartbeat";
    });

export const helperReadStates = Object.freeze([
  "undeployed",
  "active",
  "degraded",
  "superseded",
  "residual",
] as const);
export type HelperReadState = (typeof helperReadStates)[number];

export type HelperVerificationFailure =
  | "address-mismatch"
  | "owner-mismatch"
  | "provider-read-failed"
  | "runtime-code-hash-mismatch"
  | "selector-set-mismatch"
  | "version-unregistered";

export interface HelperVerificationSnapshot {
  blockHash: `0x${string}`;
  blockNumber: string;
  blockTimestamp: string;
  checks: {
    address: boolean;
    owner: boolean;
    runtimeCodeHash: boolean;
    selectorSet: boolean;
    version: boolean;
  };
  digest: `0x${string}`;
  observedOwner: EvmAddress | null;
  observedRuntimeCodeHash: `0x${string}` | null;
  observedSelectors: `0x${string}`[];
  verifiedAt: string;
}

export interface WalletHelperStatus {
  address: EvmAddress | null;
  chainId: 56;
  failures: HelperVerificationFailure[];
  helperVersion: string | null;
  owner: EvmAddress | null;
  registryVersion: string;
  state: HelperReadState;
  verification: HelperVerificationSnapshot | null;
  walletId: string;
}

export const helperResidualReadStates = Object.freeze(["empty", "ready", "partial"] as const);
export type HelperResidualReadState = (typeof helperResidualReadStates)[number];

export const helperResidualUiStates = Object.freeze([
  "loading",
  "empty",
  "scanning",
  "ready",
  "partial",
  "error",
] as const);
export type HelperResidualUiState = (typeof helperResidualUiStates)[number];

interface HelperResidualAssetBase {
  amountBaseUnit: string;
  assetId: string;
  chainId: 56;
}

export interface HelperNativeResidual extends HelperResidualAssetBase {
  kind: "native";
  tokenAddress: null;
}

export interface HelperTokenResidual extends HelperResidualAssetBase {
  kind: "token";
  tokenAddress: EvmAddress;
}

export interface HelperAllowanceResidual extends HelperResidualAssetBase {
  kind: "allowance";
  spenderAddress: EvmAddress;
  tokenAddress: EvmAddress;
}

export interface HelperNftResidual extends HelperResidualAssetBase {
  kind: "nft";
  managerAddress: EvmAddress;
  tokenAddress: null;
  tokenId: string;
}

export type HelperResidualAsset =
  HelperNativeResidual | HelperTokenResidual | HelperAllowanceResidual | HelperNftResidual;

export interface HelperResidualPage {
  allowlistVersion: string;
  chainId: 56;
  coverage: {
    allowlistComplete: boolean;
    complete: boolean;
    missingSources: string[];
    positionTokensComplete: boolean;
    walletTokenRegistryComplete: boolean;
  };
  cursor: string | null;
  helperAddress: EvmAddress;
  items: HelperResidualAsset[];
  registryVersion: string;
  scanId: string;
  scannedAt: string;
  snapshot: PositionPageSnapshot;
  state: HelperResidualReadState;
  walletId: string;
}

export interface HelperResidualScanRequest {
  chainId: 56;
  idempotencyKey: string;
  walletId: string;
}

export const helperReadContracts = Object.freeze({
  residuals: Object.freeze({ method: "GET", path: "/api/wallets/helper-residuals" }),
  scanResiduals: Object.freeze({
    method: "POST",
    path: "/api/wallets/helper-residuals/scan",
  }),
  status: Object.freeze({ method: "GET", path: "/api/wallets/{address}/helper" }),
} as const);

export type LocalHelperSweepAssetKind = "native" | "token";
export type LocalHelperSweepOperationState = LocalSwapExecutionState | "confirmed" | "dropped";
export type LocalHelperSweepTransactionState = Exclude<
  LocalSwapStepState,
  "blocked" | "queued" | "reconciling" | "skipped"
>;

export interface LocalHelperResidualBalance {
  amountBaseUnit: string;
  assetId: string;
  dustBaseUnit: string;
  fixture: "TestOnlyERC20" | "TestOnlyWBNB" | null;
  kind: LocalHelperSweepAssetKind;
  runtimeCodeHash: `0x${string}` | null;
  tokenAddress: EvmAddress | null;
}

export interface LocalHelperResidualSnapshot {
  allowances: Array<{
    amountBaseUnit: string;
    assetId: string;
    spenderAddress: EvmAddress;
    spenderRole: "adapter" | "manager" | "permit2" | "router";
    tokenAddress: EvmAddress;
  }>;
  balances: LocalHelperResidualBalance[];
  binding: {
    adapterAddress: EvmAddress;
    bindingId: string;
    deploymentRegistryVersion: "p05-local-helper-deployment-v2";
    helperAddress: EvmAddress;
    helperVersion: "WalletHelperV1";
    ownerAddress: EvmAddress;
    permit2Address: EvmAddress;
    runtimeCodeHash: `0x${string}`;
    state: "active" | "degraded";
    verifiedBlockNumber: string;
    walletId: string;
  };
  block: { hash: `0x${string}`; number: string; timestamp: string };
  chainId: 31_337;
  coverage: {
    allowancesComplete: boolean;
    complete: boolean;
    helperIdentityComplete: boolean;
    nftCustodyComplete: boolean;
    tokenInventoryComplete: boolean;
  };
  degradationReasons: string[];
  expiresAt: string;
  identity: {
    bindingMatches: boolean;
    componentsMatch: boolean;
    observedOwner: EvmAddress | null;
    observedRuntimeCodeHash: `0x${string}` | null;
    ownerMatches: boolean;
    registryMatches: boolean;
    runtimeMatches: boolean;
    tokensMatch: boolean;
  };
  manualRecoveryRequired: boolean;
  nftCustody: Array<{ assetId: string; managerAddress: EvmAddress; tokenId: string }>;
  observedAt: string;
  registry: {
    digest: `sha256:${string}`;
    version: "p05-local-helper-sweep-v2";
  };
  schemaVersion: 2;
  snapshotDigest: `sha256:${string}`;
  snapshotVersion: "p05-local-helper-residual-snapshot-v2";
  unknownTokens: Array<{
    amountBaseUnit: string;
    assetId: string;
    runtimeCodeHash: `0x${string}`;
    tokenAddress: EvmAddress;
  }>;
  wallet: { address: EvmAddress; walletId: string };
}

export interface LocalHelperResidualScanRequest {
  chainId: 31_337;
  idempotencyKey: string;
  walletId: string;
}

export interface LocalHelperSweepPreviewRequest {
  assetIds: string[];
  chainId: 31_337;
  snapshotDigest: `sha256:${string}`;
  walletId: string;
}

export interface LocalHelperSweepSubmitRequest extends LocalHelperSweepPreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface LocalHelperSweepPreviewAsset {
  amountBaseUnit: string;
  assetId: string;
  dustBaseUnit: string;
  feeLimit: LocalSwapFeeLimit;
  kind: LocalHelperSweepAssetKind;
  recipient: EvmAddress;
  tokenAddress: EvmAddress | null;
}

export interface LocalHelperSweepPreview {
  assets: LocalHelperSweepPreviewAsset[];
  chainId: 31_337;
  deadline: string;
  expiresAt: string;
  feeLimitTotalBaseUnit: string;
  helperAddress: EvmAddress;
  manualRecoveryRequired: false;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  recipient: EvmAddress;
  registryVersion: "p05-local-helper-sweep-v2";
  snapshotDigest: `sha256:${string}`;
  walletId: string;
}

export interface LocalHelperSweepTransactionView {
  active: boolean;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: LocalHelperSweepTransactionState;
  transactionHash: `0x${string}` | null;
}

export interface LocalHelperSweepOperation {
  amountBaseUnit: string;
  assetId: string;
  assetKind: LocalHelperSweepAssetKind;
  batchId: string;
  chainId: 31_337;
  createdAt: string;
  failureCode: string | null;
  feeLimit: LocalSwapFeeLimit;
  helperAddress: EvmAddress;
  nonce: string;
  operationId: string;
  operationKind: "helper-residual-sweep";
  planDigest: `sha256:${string}`;
  recipient: EvmAddress;
  reconciliationReason: string | null;
  registryVersion: "p05-local-helper-sweep-v2";
  snapshotDigest: `sha256:${string}`;
  state: LocalHelperSweepOperationState;
  tokenAddress: EvmAddress | null;
  transactions: LocalHelperSweepTransactionView[];
  updatedAt: string;
  walletId: string;
}

export type LocalHelperSweepBatchState =
  | "queued"
  | "running"
  | "partial"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "manual-recovery-required";

export interface LocalHelperSweepBatch {
  batchId: string;
  chainId: 31_337;
  createdAt: string;
  helperAddress: EvmAddress;
  operations: LocalHelperSweepOperation[];
  registryVersion: "p05-local-helper-sweep-v2";
  snapshotDigest: `sha256:${string}`;
  state: LocalHelperSweepBatchState;
  updatedAt: string;
  walletId: string;
}

export const localHelperSweepContracts = Object.freeze({
  getBatch: Object.freeze({ method: "GET", path: "/api/chain-operation-batches/{batchId}" }),
  getOperation: Object.freeze({ method: "GET", path: "/api/chain-operations/{operationId}" }),
  preview: Object.freeze({
    method: "POST",
    path: "/api/wallets/helper-residuals/sweep/preview",
  }),
  scan: Object.freeze({ method: "POST", path: "/api/wallets/helper-residuals/scan" }),
  sweep: Object.freeze({ method: "POST", path: "/api/wallets/helper-residuals/sweep" }),
} as const);

export const localHelperUpgradeCursors = Object.freeze([
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
] as const);
export type LocalHelperUpgradeCursor = (typeof localHelperUpgradeCursors)[number];
export type LocalHelperUpgradeState =
  | "queued"
  | "running"
  | "manual-recovery-required"
  | "failed"
  | "completed";
export type LocalHelperUpgradeStepState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "manual-recovery-required";

export interface LocalHelperUpgradePreviewRequest {
  chainId: 31_337;
  walletId: string;
}

export interface LocalHelperUpgradeSubmitRequest extends LocalHelperUpgradePreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface LocalHelperUpgradeVersionView {
  comparison: "upgrade-available";
  source: "WalletHelperV1";
  target: "WalletHelperV2";
}

export interface LocalHelperUpgradePreview {
  blockers: string[];
  chainId: 31_337;
  expectedTargetAddress: EvmAddress;
  expectedTargetRuntimeCodeHash: `0x${string}`;
  expiresAt: string;
  feeLimit: LocalSwapFeeLimit;
  nonce: string;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  registryVersion: "p05-local-helper-upgrade-v3";
  residual: {
    allowanceCount: number;
    balancesAboveDust: number;
    nftCustodyCount: number;
    unknownTokenCount: number;
  };
  sourceHelperAddress: EvmAddress;
  steps: LocalHelperUpgradeCursor[];
  upgradeable: boolean;
  versions: LocalHelperUpgradeVersionView;
  walletId: string;
}

export interface LocalHelperUpgradeStepView {
  cursor: LocalHelperUpgradeCursor;
  failureCode: string | null;
  state: LocalHelperUpgradeStepState;
  updatedAt: string | null;
}

export interface LocalHelperUpgradeTransactionView {
  active: boolean;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: "signed" | "broadcast" | "pending" | "confirmed" | "failed" | "dropped" | "replaced";
  transactionHash: `0x${string}` | null;
  transactionId: string;
}

export interface LocalHelperUpgradeOperation {
  chainId: 31_337;
  createdAt: string;
  cursor: LocalHelperUpgradeCursor;
  expectedTargetAddress: EvmAddress;
  failureCode: string | null;
  manualRecovery: {
    blockers: string[];
    required: boolean;
  };
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  registryVersion: "p05-local-helper-upgrade-v3";
  sourceBindingId: string;
  sourceHelperAddress: EvmAddress;
  state: LocalHelperUpgradeState;
  steps: LocalHelperUpgradeStepView[];
  sweepBatchId: string | null;
  transactions: LocalHelperUpgradeTransactionView[];
  updatedAt: string;
  versions: LocalHelperUpgradeVersionView;
  walletId: string;
}

export const localHelperUpgradeContracts = Object.freeze({
  get: Object.freeze({ method: "GET", path: "/api/helper-upgrades/{operationId}" }),
  preview: Object.freeze({ method: "POST", path: "/api/wallets/helper/upgrade/preview" }),
  submit: Object.freeze({ method: "POST", path: "/api/wallets/helper/upgrade" }),
  walletOperation: Object.freeze({
    method: "GET",
    path: "/api/wallets/{walletId}/helper-upgrade",
  }),
} as const);

export const helperDeploymentStates = Object.freeze([
  "queued",
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "succeeded",
  "failed",
  "dropped",
  "reconciling",
] as const);
export type HelperDeploymentState = (typeof helperDeploymentStates)[number];

export interface HelperDeploymentPreviewRequest {
  chainId: 31_337;
  helperVersion: "WalletHelperV1";
  walletId: string;
}

export interface HelperDeploymentFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface HelperDeploymentPreview {
  chainId: 31_337;
  constructor: {
    adapter: EvmAddress;
    owner: EvmAddress;
    permit2: EvmAddress;
  };
  expectedAddress: EvmAddress;
  expectedRuntimeCodeHash: `0x${string}`;
  expiresAt: string;
  feeLimit: HelperDeploymentFeeLimit;
  helperVersion: "WalletHelperV1";
  nonce: string;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  registryVersion: string;
  walletId: string;
}

export interface HelperDeploymentSubmitRequest extends HelperDeploymentPreviewRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
}

export interface HelperDeploymentTransactionView {
  active: boolean;
  generation: number;
  state: "signed" | "broadcast" | "pending" | "confirmed" | "failed" | "dropped" | "replaced";
  transactionHash: `0x${string}` | null;
}

export interface HelperDeploymentOperation {
  chainId: 31_337;
  createdAt: string;
  expectedAddress: EvmAddress;
  failureCode: string | null;
  feeLimit: HelperDeploymentFeeLimit;
  helperVersion: "WalletHelperV1";
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  reconciliationReason: string | null;
  registryVersion: string;
  state: HelperDeploymentState;
  transactions: HelperDeploymentTransactionView[];
  updatedAt: string;
  walletId: string;
}

export const helperDeploymentContracts = Object.freeze({
  get: Object.freeze({ method: "GET", path: "/api/chain-operations/{operationId}" }),
  preview: Object.freeze({ method: "POST", path: "/api/wallets/helper/deploy/preview" }),
  submit: Object.freeze({ method: "POST", path: "/api/wallets/helper/deploy" }),
} as const);

export const walletTransferAmountPresets = ["25", "50", "75", "MAX"] as const;
export type WalletTransferAmountPreset = (typeof walletTransferAmountPresets)[number];
export type WalletTransferAsset = { kind: "native" } | { kind: "erc20"; tokenAddress: EvmAddress };
export type WalletTransferAmount =
  | { amountBaseUnit: string; kind: "exact" }
  | { kind: "preset"; preset: WalletTransferAmountPreset };

export interface WalletTransferPreviewRequest {
  amount: WalletTransferAmount;
  asset: WalletTransferAsset;
  chainId: number;
  recipient: EvmAddress;
  walletId: string;
}

export type WalletTransferAddressClassification = "known-external" | "new-external" | "own-wallet";

export interface WalletTransferBalanceChange {
  assetAfterBaseUnit: string;
  assetBeforeBaseUnit: string;
  assetDeltaBaseUnit: string;
  nativeAfterMinimumBaseUnit: string;
  nativeBeforeBaseUnit: string;
  nativeDeltaMaximumBaseUnit: string;
  recipientAssetDeltaBaseUnit: string;
}

export interface WalletTransferFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface WalletTransferPreview {
  addressClassification: WalletTransferAddressClassification;
  amountBaseUnit: string;
  asset: WalletTransferAsset & {
    decimals: number;
    name: string;
    symbol: string;
  };
  balanceChange: WalletTransferBalanceChange;
  chainId: number;
  expiresAt: string;
  feeLimit: WalletTransferFeeLimit;
  policyDigest: `sha256:${string}`;
  policyVersion: string;
  previewDigest: `sha256:${string}`;
  previewToken: string;
  recipient: EvmAddress;
  registryVersion: string;
  requiresSecurityPassword: boolean;
  walletId: string;
}

export interface WalletTransferSubmitRequest {
  previewDigest: `sha256:${string}`;
  previewToken: string;
  securityPassword?: string;
  walletId: string;
}

export const walletTransferStates = [
  "ready-for-approval",
  "queued",
  "signed",
  "broadcast",
  "pending",
  "confirmed",
  "failed",
  "dropped",
  "replaced",
  "reconciling",
] as const;
export type WalletTransferState = (typeof walletTransferStates)[number];

export interface WalletTransferTransactionView {
  active: boolean;
  createdAt: string;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  nonce: string;
  replacedByTransactionId: string | null;
  replacesTransactionId: string | null;
  state: Exclude<WalletTransferState, "ready-for-approval" | "queued" | "reconciling">;
  transactionHash: `0x${string}` | null;
  transactionId: string;
}

export interface WalletTransferOperation {
  activeTransactionId: string | null;
  addressClassification: WalletTransferAddressClassification;
  amountBaseUnit: string;
  asset: WalletTransferAsset;
  chainId: number;
  createdAt: string;
  failureCode: string | null;
  feeLimit: WalletTransferFeeLimit;
  nonce: string | null;
  operationId: string;
  planDigest: `sha256:${string}`;
  policyDigest: `sha256:${string}`;
  recipient: EvmAddress;
  reconciliationReason: string | null;
  state: WalletTransferState;
  transactions: WalletTransferTransactionView[];
  updatedAt: string;
  walletId: string;
}

export const walletTransferSecretMediaType =
  "application/vnd.lpbot.wallet-transfer-secret+json" as const;

export const walletTransferContracts = {
  get: "GET /api/wallets/transfers/:operationId",
  preview: "POST /api/wallets/transfers/preview",
  submit: "POST /api/wallets/transfers",
} as const;

export const walletAssetContracts = {
  balances: { method: "GET", path: "/api/wallets/{walletId}/balances" },
  deleteToken: { method: "DELETE", path: "/api/wallets/{walletId}/tokens/{tokenAddress}" },
  importToken: { method: "POST", path: "/api/wallets/{walletId}/tokens" },
  receive: { method: "GET", path: "/api/wallets/{walletId}/receive" },
  tokens: { method: "GET", path: "/api/wallets/{walletId}/tokens" },
} as const;

export const addressBookCategories = ["person", "exchange", "protocol", "other"] as const;
export type AddressBookCategory = (typeof addressBookCategories)[number];
export type AddressClassification = "known-external" | "new-external" | "own-wallet";

export interface AddressBookEntry {
  address: EvmAddress;
  category: AddressBookCategory;
  chainId: number;
  createdAt: string;
  entryId: string;
  label: string;
  note: string;
  revision: number;
  updatedAt: string;
}

export interface OwnedWalletAddress {
  address: EvmAddress;
  name: string;
  walletId: string;
}

export interface AddressClassificationView {
  address: EvmAddress;
  entryId: string | null;
  kind: AddressClassification;
  walletId: string | null;
}

export interface AddressBookPage {
  chainId: number;
  classification: AddressClassificationView | null;
  entries: AddressBookEntry[];
  ownWallets: OwnedWalletAddress[];
}

export interface CreateAddressBookEntryRequest {
  address: EvmAddress;
  category?: AddressBookCategory;
  chainId: number;
  label: string;
  note?: string;
  password: string;
}

export interface PatchAddressBookEntryRequest {
  changes: {
    category?: AddressBookCategory;
    label?: string;
    note?: string;
  };
  expectedRevision: number;
}

export const addressBookSecretMediaType = "application/vnd.lpbot.address-book-secret+json" as const;

export const addressBookContracts = {
  create: { method: "POST", path: "/api/address-book" },
  delete: { method: "DELETE", path: "/api/address-book/{entryId}" },
  list: { method: "GET", path: "/api/address-book" },
  patch: { method: "PATCH", path: "/api/address-book/{entryId}" },
} as const;

export interface WalletDeleteDependencies {
  assetIds: string[];
  policyIds: string[];
  positionIds: string[];
  taskIds: string[];
}

export interface WalletDeletePreview {
  assetCount: number;
  assetRiskDigest: string;
  confirmationPhrase: string;
  dependencies: WalletDeleteDependencies;
  expiresAt: string;
  forceEligible: boolean;
  policyCount: number;
  positionCount: number;
  previewToken: string;
  revision: number;
  taskCount: number;
  walletId: string;
}

export type WalletDeletionType = "force" | "normal";

export interface WalletDeletionReceipt {
  address: EvmAddress;
  auditId: string;
  deletedAt: string;
  deletionType: WalletDeletionType;
  finalRevision: number;
  walletId: string;
}

export type DeleteCustodyWalletRequest =
  | {
      expectedRevision: number;
      force: false;
      previewToken: string;
    }
  | {
      confirmationPhrase: string;
      dependencies: WalletDeleteDependencies;
      expectedRevision: number;
      force: true;
      previewToken: string;
    };

export interface RenameCustodyWalletRequest {
  expectedRevision: number;
  name: string;
}

export const securityPasswordSecretMediaType =
  "application/vnd.lpbot.security-password-secret+json" as const;

export type SecurityPasswordState = "locked-out" | "ready" | "unconfigured";

export interface SecurityPasswordStatus {
  configured: boolean;
  status: SecurityPasswordState;
  version: number;
}

export interface UpdateSecurityPasswordRequest {
  expectedVersion: number;
  newPassword: string;
  oldPassword: string | null;
}

export const securityPasswordContracts = {
  status: { method: "GET", path: "/api/security-password/status" },
  update: { method: "PUT", path: "/api/security-password" },
} as const;

export interface GenerateCustodyWalletRequest {
  mode: WalletEncryptionMode;
  name: string;
}

export const keystoreAutoLockMinutes = [1, 5, 15, 30, 60] as const;
export type KeystoreAutoLockMinutes = (typeof keystoreAutoLockMinutes)[number];
export const keystoreResetConfirmationPhrase = "I_LOSE_ALL_PASSWORD_WALLETS" as const;
export const keystoreSecretMediaType = "application/vnd.lpbot.keystore-secret+json" as const;

export type KeystoreState = "locked" | "locked-out" | "unconfigured" | "unlocked";

export interface KeystoreStatus {
  configured: boolean;
  status: KeystoreState;
  version: number;
}

export interface KeystoreResetPreview {
  confirmationPhrase: typeof keystoreResetConfirmationPhrase;
  expiresAt: string;
  policyCount: number;
  previewToken: string;
  secretVersion: number;
  strategyCount: number;
  taskCount: number;
  walletCount: number;
  walletsWithNonzeroAssets: number;
  walletsWithPositions: number;
}

export interface CreateKeystorePasswordRequest {
  newPassword: string;
}

export interface ChangeKeystorePasswordRequest {
  expectedVersion: number;
  newPassword: string;
  oldPassword: string;
}

export interface UnlockKeystoreRequest {
  password: string;
}

export interface UpdateKeystoreAutoLockRequest {
  expectedVersion: number;
  minutes: KeystoreAutoLockMinutes;
}

export interface KeystoreResetRequest {
  confirmationPhrase: typeof keystoreResetConfirmationPhrase;
  expectedVersion: number;
  previewToken: string;
}

export interface ChangeWalletEncryptionModeRequest {
  expectedRevision: number;
  expectedSecretVersion: number;
  mode: WalletEncryptionMode;
  password: string;
}

export const keystoreContracts = {
  autoLock: { method: "PATCH", path: "/api/keystore/auto-lock" },
  createPassword: { method: "POST", path: "/api/keystore/password" },
  lock: { method: "POST", path: "/api/keystore/lock" },
  reset: { method: "POST", path: "/api/keystore/reset" },
  resetPreview: { method: "GET", path: "/api/keystore/reset-preview" },
  status: { method: "GET", path: "/api/keystore/status" },
  switchWalletMode: {
    method: "POST",
    path: "/api/wallets/{walletId}/encryption-mode",
  },
  unlock: { method: "POST", path: "/api/keystore/unlock" },
  updatePassword: { method: "PUT", path: "/api/keystore/password" },
} as const;

export const loginWalletAuthContracts = {
  link: { method: "POST", path: "/api/auth/wallet/link" },
  linkNonce: { method: "POST", path: "/api/auth/wallet/link-nonce" },
  links: { method: "GET", path: "/api/auth/wallet/links" },
  login: { method: "POST", path: "/api/auth/wallet/login" },
  nonce: { method: "POST", path: "/api/auth/wallet/nonce" },
  unlink: { method: "DELETE", path: "/api/auth/wallet/link/{linkId}" },
} as const;

export const okxKeySecretMediaType = "application/vnd.lpbot.okx-key-secret+json" as const;
export const okxKeySecretBodyLimit = 8_192 as const;

export const okxKeyStatuses = [
  "unconfigured",
  "staged",
  "testing",
  "usable",
  "invalid",
  "revoked",
  "insufficient-permission",
  "unknown",
  "deleting",
] as const;

export type OkxKeyStatusName = (typeof okxKeyStatuses)[number];

export interface OkxKeyStatus {
  configured: boolean;
  status: OkxKeyStatusName;
  version: number;
}

export const okxKeyContracts = {
  delete: { method: "DELETE", path: "/api/settings/okx-key" },
  get: { method: "GET", path: "/api/settings/okx-key" },
  replace: { method: "PUT", path: "/api/settings/okx-key" },
  save: { method: "POST", path: "/api/settings/okx-key" },
  test: { method: "POST", path: "/api/settings/okx-key/test" },
} as const;

export type AuthState =
  | { status: "booting" }
  | { status: "anonymous" }
  | {
      status: "authenticating";
      method: "telegram-mini-app" | "telegram-bot-link" | "wallet";
    }
  | { status: "active"; session: SessionView }
  | { status: "blocked"; reason: AccountBlockReason; message: string | null }
  | { status: "maintenance"; message: string | null; until: string | null }
  | { status: "region-blocked"; region: string | null; message: string | null };

export interface ApiError {
  code: string;
  message: string;
  requestId: string | null;
  retryable: boolean;
}

export interface ErrorEnvelope {
  success: false;
  error: ApiError;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  requestId: string | null;
}

export function createErrorEnvelope(error: ApiError): ErrorEnvelope {
  return { success: false, error };
}

export function createSuccessEnvelope<T>(data: T, requestId: string | null): SuccessEnvelope<T> {
  return { success: true, data, requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSessionView(value: unknown): value is SessionView {
  if (!isRecord(value)) return false;

  return (
    typeof value.userId === "string" &&
    (value.role === "user" || value.role === "pro" || value.role === "admin") &&
    (value.tier === "normal" || value.tier === "pro") &&
    Array.isArray(value.allowedChainIds) &&
    value.allowedChainIds.every((chainId) => Number.isInteger(chainId)) &&
    (typeof value.displayName === "string" || value.displayName === null) &&
    (typeof value.avatarUrl === "string" || value.avatarUrl === null) &&
    typeof value.maintenanceBypass === "boolean"
  );
}

export function authStateDestination(state: AuthState): string | null {
  switch (state.status) {
    case "booting":
    case "active":
      return null;
    case "anonymous":
    case "authenticating":
      return "/login";
    case "blocked":
    case "region-blocked":
      return "/blocked";
    case "maintenance":
      return "/maintenance";
  }
}
