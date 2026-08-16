import { chainRegistryPackage } from "@lpbot/chain-registry";
import { marketMetricsPackage } from "@lpbot/market-metrics";
import { observabilityPackage } from "@lpbot/observability";

export {
  initializeProductionIndexerAdapters,
  validateProductionIndexerConfig,
} from "./production-config.js";
export type {
  InitializedProductionIndexerAdapters,
  ProductionIndexerConfig,
} from "./production-config.js";
export {
  ProductionBscEventDecoder,
  READONLY_BSC_RPC_METHODS,
  ViemBscLogSource,
} from "@lpbot/chain-adapters";
export type {
  ProductionBscEventDecoderOptions,
  QuarantinedLog,
  QuarantineSink,
  ViemBscLogSourceOptions,
} from "@lpbot/chain-adapters";
export { compareRawLogDeliveries, IndexerRunner } from "./runner.js";
export type { IndexerRunnerOptions } from "./runner.js";
export { PostgresCanonicalEventStore } from "./postgres-canonical-event-store.js";
export {
  compareLiquidityFlowEvents,
  projectLiquidityFlowEvent,
  stableLiquidityFlowEvents,
} from "./liquidity-flow.js";
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
