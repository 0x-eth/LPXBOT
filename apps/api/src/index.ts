import { apiContractPackage } from "@lpbot/api-contract";
import { domainPackage } from "@lpbot/domain";
import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export const apiApp = {
  contract: apiContractPackage.name,
  domain: domainPackage.name,
  name: "@lpbot/api",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
