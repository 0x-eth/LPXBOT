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
