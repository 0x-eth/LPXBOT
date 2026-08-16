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

export const userPreferenceSchemaVersion = 2 as const;

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

export interface NavigationPreference {
  key: NavigationKey;
  visible: boolean;
}

export interface UserPreferences {
  colorTheme: ColorTheme;
  customColor: string | null;
  navConfig: NavigationPreference[];
  poolsPanelCollapsed: boolean;
  showHotPools: boolean;
  showScanTab: boolean;
  taskViewMode: TaskViewMode;
  theme: ThemePreference;
}

export const defaultUserPreferences: Readonly<UserPreferences> = Object.freeze({
  colorTheme: "neutral",
  customColor: null,
  navConfig: navigationKeys.map((key) => ({ key, visible: true })),
  poolsPanelCollapsed: false,
  showHotPools: false,
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

export interface ShellStats {
  fps: number | null;
  gas: ShellGasStats;
  online: boolean | null;
  pingMs: number | null;
  recommendedPools: string[] | null;
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
  recommendedPools?: string[] | null;
  taskCounts?: Partial<ShellTaskCounts>;
}

export type ShellStatsEvent =
  | (ShellStatsSnapshot & { type: "snapshot" })
  | { observedAt: string; sequence: number; stats: ShellStatsPatch; type: "update" }
  | {
      observedAt: string;
      recommendedPools: string[] | null;
      sequence: number;
      type: "rec_pools_snapshot";
    }
  | { observedAt: string; sequence: number; type: "heartbeat" };

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

export function canonicalizeLiquidityProtocols(
  values: readonly string[],
): LiquidityFlowProtocol[] {
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

export interface MarketPoolRow {
  activeTvlUsd: null;
  chainId: 56;
  fdvUsd: string | null;
  feeActiveTvl: null;
  feesUsd: string | null;
  feeTvl: string | null;
  poolAddress: EvmAddress | null;
  poolId: `0x${string}` | null;
  protocol: MarketProtocol;
  token0Symbol: string | null;
  token1Symbol: string | null;
  transactionCount: string;
  tvlUsd: string | null;
  volumeUsd: string | null;
}

export interface MarketPoolSnapshot {
  chainId: 56;
  generatedAt: string;
  minutes: MarketWindowMinutes;
  rows: MarketPoolRow[];
  version: string;
  windowEnd: string;
  windowStart: string;
}

export interface MarketPoolDiff {
  tombstones: string[];
  upserts: MarketPoolRow[];
  version: string;
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
  snapshot: { method: "GET", path: "/api/pools/top-fees/{minutes}" },
  stream: { method: "GET", path: "/api/pools/top-fees/{minutes}/stream" },
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
