import { apiContractPackage } from "@lpbot/api-contract";
import { domainPackage } from "@lpbot/domain";
import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export { buildApiApp } from "./app.js";
export type {
  ApiAppOptions,
  MaintenanceConfig,
  RegionPolicyResult,
} from "./app.js";
export {
  sessionCookieName,
  setBrowserSessionCookie,
} from "./browser-session-cookie.js";
export { PostgresSessionStore } from "./postgres-session-store.js";

export const apiApp = {
  contract: apiContractPackage.name,
  domain: domainPackage.name,
  name: "@lpbot/api",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
