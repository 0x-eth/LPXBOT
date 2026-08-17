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

export const loginWalletAuthContracts = {
  link: { method: "POST", path: "/api/auth/wallet/link" },
  linkNonce: { method: "POST", path: "/api/auth/wallet/link-nonce" },
  links: { method: "GET", path: "/api/auth/wallet/links" },
  login: { method: "POST", path: "/api/auth/wallet/login" },
  nonce: { method: "POST", path: "/api/auth/wallet/nonce" },
  unlink: { method: "DELETE", path: "/api/auth/wallet/link/{linkId}" },
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
