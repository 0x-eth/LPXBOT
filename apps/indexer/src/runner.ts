import type {
  CanonicalEventStore,
  EventDecoder,
  IndexerRunResult,
  NormalizedPoolEvent,
  RawLogDelivery,
  RawLogSource,
} from "./types.js";

export interface IndexerRunnerOptions {
  decoder: EventDecoder;
  evaluationTime(): Date;
  source: RawLogSource;
  store: CanonicalEventStore;
}

function compareDecimalInteger(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function samePosition(left: RawLogDelivery, right: RawLogDelivery): boolean {
  return (
    left.log.blockHash === right.log.blockHash &&
    left.log.transactionHash === right.log.transactionHash &&
    left.log.logIndex === right.log.logIndex
  );
}

export function compareRawLogDeliveries(left: RawLogDelivery, right: RawLogDelivery): number {
  const blockOrder = compareDecimalInteger(left.log.blockNumber, right.log.blockNumber);
  if (blockOrder !== 0) return blockOrder;

  if (samePosition(left, right) && left.log.removed !== right.log.removed) {
    return left.log.removed ? 1 : -1;
  }
  if (left.log.removed !== right.log.removed) return left.log.removed ? -1 : 1;

  const transactionOrder = left.log.transactionIndex - right.log.transactionIndex;
  if (transactionOrder !== 0) return transactionOrder;
  const logOrder = left.log.logIndex - right.log.logIndex;
  if (logOrder !== 0) return logOrder;
  const hashOrder = left.log.transactionHash.localeCompare(right.log.transactionHash);
  if (hashOrder !== 0) return hashOrder;
  return left.log.blockHash.localeCompare(right.log.blockHash);
}

export class IndexerRunner {
  readonly #decoder: EventDecoder;
  readonly #evaluationTime: () => Date;
  readonly #source: RawLogSource;
  readonly #store: CanonicalEventStore;

  constructor(options: IndexerRunnerOptions) {
    this.#decoder = options.decoder;
    this.#evaluationTime = options.evaluationTime;
    this.#source = options.source;
    this.#store = options.store;
  }

  async runOnce(): Promise<IndexerRunResult> {
    const cursor = await this.#store.getCursor(56);
    const page = await this.#source.read(cursor);
    if (!page || page.deliveries.length === 0) {
      return {
        acceptedCount: 0,
        conflictCount: 0,
        cursor,
        duplicateCount: 0,
        revertedCount: 0,
      };
    }
    if (page.chainId !== 56 || page.deliveries.some(({ log }) => log.chainId !== 56)) {
      throw new RangeError("INDEXER_CHAIN_UNSUPPORTED: only BSC chainId 56 is enabled");
    }

    const deliveries = [...page.deliveries].sort(compareRawLogDeliveries);
    const events: NormalizedPoolEvent[] = [];
    for (const delivery of deliveries) events.push(await this.#decoder.decode(delivery));
    const evaluationTime = this.#evaluationTime();
    if (!Number.isFinite(evaluationTime.getTime())) {
      throw new RangeError("INDEXER_EVALUATION_TIME_INVALID");
    }
    return this.#store.commit({
      chainId: page.chainId,
      deliveries,
      evaluationTime: evaluationTime.toISOString(),
      events,
    });
  }
}

