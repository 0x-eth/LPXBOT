import type { MarketMetricValues, MarketMetricKind, MarketMetricProtocol } from "@lpbot/market-metrics";

export interface RawChainBlock {
  blockHash: string;
  blockNumber: string;
  blockTimestamp: string;
  chainId: number;
  parentHash: string | null;
}

export interface RawChainLog {
  address: string;
  blockHash: string;
  blockNumber: string;
  chainId: number;
  data: string;
  logIndex: number;
  removed: boolean;
  topics: string[];
  transactionHash: string;
  transactionIndex: number;
}

export interface RawLogDelivery {
  block: RawChainBlock;
  log: RawChainLog;
}

export interface RawLogPage {
  chainId: number;
  deliveries: RawLogDelivery[];
}

export interface IndexerCursor {
  blockHash: string;
  blockNumber: string;
  chainId: number;
  logIndex: number;
  transactionIndex: number;
  value: string;
}

export type PoolEventFinality = "observed" | "confirmed" | "finalized" | "reverted";

export interface NormalizedPoolEvent {
  amount0: string | null;
  amount1: string | null;
  blockHash: string;
  blockNumber: string;
  blockTimestamp: string;
  chainId: number;
  contractAddress: string;
  cursor: IndexerCursor;
  eventId: string;
  finality: PoolEventFinality;
  kind: MarketMetricKind;
  liquidityDelta: string | null;
  logIndex: number;
  market: MarketMetricValues & {
    token0Symbol?: string | null;
    token1Symbol?: string | null;
  };
  payload: Record<string, string | null>;
  pool: {
    feePips: string | null;
    hooks: string | null;
    poolAddress: string | null;
    poolId: string | null;
    tickSpacing: string | null;
    token0: string | null;
    token1: string | null;
  };
  protocol: MarketMetricProtocol;
  protocolGeneration: "v3" | "v4";
  rawRef: string | null;
  removed: boolean;
  schemaVersion: "1.0.0";
  sqrtPriceX96: string | null;
  transactionHash: string;
  transactionIndex: number;
}

export interface CanonicalCommit {
  chainId: number;
  deliveries: RawLogDelivery[];
  evaluationTime: string;
  events: NormalizedPoolEvent[];
}

export interface IndexerRunResult {
  acceptedCount: number;
  conflictCount: number;
  cursor: IndexerCursor | null;
  duplicateCount: number;
  revertedCount: number;
}

export interface RawLogSource {
  read(after: IndexerCursor | null): Promise<RawLogPage | null>;
}

export interface EventDecoder {
  decode(delivery: RawLogDelivery): NormalizedPoolEvent | Promise<NormalizedPoolEvent>;
}

export interface CanonicalEventStore {
  commit(commit: CanonicalCommit): Promise<IndexerRunResult>;
  getCursor(chainId: number): Promise<IndexerCursor | null>;
}

