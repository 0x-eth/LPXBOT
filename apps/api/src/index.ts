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
  RegionPolicyResult,
} from "./app.js";
export { sessionCookieName, setBrowserSessionCookie } from "./browser-session-cookie.js";
export { createLoginWalletAuthenticationFromEnvironment } from "./login-wallet-auth-config.js";
export type { LoginWalletAuthEnvironment } from "./login-wallet-auth-config.js";
export { PostgresSessionStore } from "./postgres-session-store.js";
export { PostgresChainAccessPolicyStore } from "./postgres-chain-access-policy-store.js";
export { PostgresUserPreferencesStore } from "./postgres-user-preferences-store.js";
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
export { UnavailableShellStatsProvider } from "./shell-stats.js";
export type {
  ShellStatsContext,
  ShellStatsProvider,
  ShellStatsSubscriptionContext,
} from "./shell-stats.js";
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
