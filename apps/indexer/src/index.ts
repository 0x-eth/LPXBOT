import { chainRegistryPackage } from "@lpbot/chain-registry";
import { marketMetricsPackage } from "@lpbot/market-metrics";
import { observabilityPackage } from "@lpbot/observability";

export { validateProductionIndexerConfig } from "./production-config.js";
export type {
  ProductionIndexerConfig,
  ProductionProtocolDecoderConfig,
} from "./production-config.js";
export { compareRawLogDeliveries, IndexerRunner } from "./runner.js";
export type { IndexerRunnerOptions } from "./runner.js";
export type {
  CanonicalCommit,
  CanonicalEventStore,
  EventDecoder,
  IndexerCursor,
  IndexerRunResult,
  NormalizedPoolEvent,
  PoolEventFinality,
  RawChainBlock,
  RawChainLog,
  RawLogDelivery,
  RawLogPage,
  RawLogSource,
} from "./types.js";

export const indexerApp = {
  metrics: marketMetricsPackage.name,
  name: "@lpbot/indexer",
  observability: observabilityPackage.name,
  registry: chainRegistryPackage.name,
} as const;
