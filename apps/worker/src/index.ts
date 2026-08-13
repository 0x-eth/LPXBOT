import { chainRegistryPackage } from "@lpbot/chain-registry";
import { domainPackage } from "@lpbot/domain";
import { observabilityPackage } from "@lpbot/observability";

export const workerApp = {
  domain: domainPackage.name,
  name: "@lpbot/worker",
  observability: observabilityPackage.name,
  registry: chainRegistryPackage.name,
} as const;
