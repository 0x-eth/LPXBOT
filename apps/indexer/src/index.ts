import { chainRegistryPackage } from "@lpbot/chain-registry";
import { marketMetricsPackage } from "@lpbot/market-metrics";
import { observabilityPackage } from "@lpbot/observability";

export const indexerApp = {
  metrics: marketMetricsPackage.name,
  name: "@lpbot/indexer",
  observability: observabilityPackage.name,
  registry: chainRegistryPackage.name,
} as const;
