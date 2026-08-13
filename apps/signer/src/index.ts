import { observabilityPackage } from "@lpbot/observability";
import { securityPackage } from "@lpbot/security";

export const signerApp = {
  name: "@lpbot/signer",
  observability: observabilityPackage.name,
  security: securityPackage.name,
} as const;
