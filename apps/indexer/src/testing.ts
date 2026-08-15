import { createHash } from "node:crypto";

import type {
  EventDecoder,
  IndexerCursor,
  NormalizedPoolEvent,
  RawChainLog,
  RawLogDelivery,
  RawLogPage,
  RawLogSource,
} from "./types.js";

interface FixtureDecodedInput {
  kind: NormalizedPoolEvent["kind"];
  payload: Record<string, string | null>;
  pool: Partial<NormalizedPoolEvent["pool"]> & {
    poolAddress: string | null;
    poolId: string | null;
  };
  protocol: NormalizedPoolEvent["protocol"];
  protocolGeneration: NormalizedPoolEvent["protocolGeneration"];
}

export interface FixtureLogInput {
  decoderFixtureId: string;
  fixtureDecoded: FixtureDecodedInput;
  fixtureLogId?: string;
  rawLog: RawChainLog;
}

export interface FixtureMarketProjection {
  fdvUsd?: string | null;
  feesUsd?: string | null;
  token0Symbol?: string | null;
  token1Symbol?: string | null;
  tvlUsd?: string | null;
  volumeUsd?: string | null;
}

export interface FixtureEventDecoderOptions {
  marketFor?(entry: FixtureLogInput, index: number): FixtureMarketProjection;
}

function rawFingerprint(rawLog: RawChainLog): string {
  return JSON.stringify([
    rawLog.chainId,
    rawLog.blockNumber,
    rawLog.blockHash,
    rawLog.transactionHash,
    rawLog.transactionIndex,
    rawLog.logIndex,
    rawLog.address,
    rawLog.topics,
    rawLog.data,
    rawLog.removed,
  ]);
}

export function eventIdForRawLog(rawLog: RawChainLog): string {
  return createHash("sha256")
    .update([rawLog.chainId, rawLog.blockHash, rawLog.transactionHash, rawLog.logIndex].join(":"))
    .digest("hex");
}

export function cursorForRawLog(rawLog: RawChainLog): IndexerCursor {
  return {
    blockHash: rawLog.blockHash,
    blockNumber: rawLog.blockNumber,
    chainId: rawLog.chainId,
    logIndex: rawLog.logIndex,
    transactionIndex: rawLog.transactionIndex,
    value: [
      "v1",
      rawLog.chainId,
      rawLog.blockNumber,
      rawLog.transactionIndex,
      rawLog.logIndex,
      rawLog.blockHash,
    ].join(":"),
  };
}

export class FixtureEventDecoder implements EventDecoder {
  readonly #entries = new Map<
    string,
    { decoded: FixtureDecodedInput; index: number; input: FixtureLogInput }
  >();
  readonly #options: FixtureEventDecoderOptions;

  constructor(entries: readonly FixtureLogInput[], options: FixtureEventDecoderOptions = {}) {
    this.#options = options;
    entries.forEach((entry, index) => {
      const fingerprint = rawFingerprint(entry.rawLog);
      if (!this.#entries.has(fingerprint)) {
        this.#entries.set(fingerprint, { decoded: entry.fixtureDecoded, index, input: entry });
      }
    });
  }

  decode(delivery: RawLogDelivery): NormalizedPoolEvent {
    const fixture = this.#entries.get(rawFingerprint(delivery.log));
    if (!fixture) throw new Error("FIXTURE_DECODER_MISS: raw log is not in the local fixture");
    const { decoded, index, input } = fixture;
    const market = this.#options.marketFor?.(input, index) ?? {};
    return {
      amount0: decoded.payload.amount0 ?? null,
      amount1: decoded.payload.amount1 ?? null,
      blockHash: delivery.log.blockHash,
      blockNumber: delivery.log.blockNumber,
      blockTimestamp: delivery.block.blockTimestamp,
      chainId: delivery.log.chainId,
      contractAddress: delivery.log.address,
      cursor: cursorForRawLog(delivery.log),
      eventId: eventIdForRawLog(delivery.log),
      finality: delivery.log.removed ? "reverted" : "observed",
      kind: decoded.kind,
      liquidityDelta: decoded.payload.liquidityDelta ?? null,
      logIndex: delivery.log.logIndex,
      market,
      payload: structuredClone(decoded.payload),
      pool: {
        feePips: decoded.pool.feePips ?? null,
        hooks: decoded.pool.hooks ?? null,
        poolAddress: decoded.pool.poolAddress,
        poolId: decoded.pool.poolId,
        tickSpacing: decoded.pool.tickSpacing ?? null,
        token0: decoded.pool.token0 ?? null,
        token1: decoded.pool.token1 ?? null,
      },
      protocol: decoded.protocol,
      protocolGeneration: decoded.protocolGeneration,
      rawRef: input.fixtureLogId ?? input.decoderFixtureId,
      removed: delivery.log.removed,
      schemaVersion: "1.0.0",
      sqrtPriceX96: decoded.payload.sqrtPriceX96 ?? null,
      transactionHash: delivery.log.transactionHash,
      transactionIndex: delivery.log.transactionIndex,
    };
  }
}

function cursorPositionAfter(log: RawChainLog, cursor: IndexerCursor): boolean {
  const blockNumber = BigInt(log.blockNumber);
  const cursorBlock = BigInt(cursor.blockNumber);
  if (blockNumber !== cursorBlock) return blockNumber > cursorBlock;
  if (log.transactionIndex !== cursor.transactionIndex) {
    return log.transactionIndex > cursor.transactionIndex;
  }
  if (log.logIndex !== cursor.logIndex) return log.logIndex > cursor.logIndex;
  return log.blockHash !== cursor.blockHash;
}

export class FixtureRawLogSource implements RawLogSource {
  readonly #entries: readonly FixtureLogInput[];
  readonly #timestampForBlock: (blockNumber: string) => string;
  #read = false;

  constructor(
    entries: readonly FixtureLogInput[],
    timestampForBlock: (blockNumber: string) => string,
  ) {
    this.#entries = entries;
    this.#timestampForBlock = timestampForBlock;
  }

  async read(after: IndexerCursor | null): Promise<RawLogPage | null> {
    if (this.#read) return null;
    this.#read = true;
    const eligible = this.#entries.filter(
      ({ rawLog }) => !after || rawLog.removed || cursorPositionAfter(rawLog, after),
    );
    if (eligible.length === 0) return null;

    const priorByHeight = [...this.#entries]
      .filter(({ rawLog }) => !rawLog.removed)
      .sort((left, right) =>
        Number(BigInt(left.rawLog.blockNumber) - BigInt(right.rawLog.blockNumber)),
      );
    const deliveries: RawLogDelivery[] = eligible.map(({ rawLog }) => {
      const prior = priorByHeight
        .filter((entry) => BigInt(entry.rawLog.blockNumber) < BigInt(rawLog.blockNumber))
        .at(-1);
      return {
        block: {
          blockHash: rawLog.blockHash,
          blockNumber: rawLog.blockNumber,
          blockTimestamp: this.#timestampForBlock(rawLog.blockNumber),
          chainId: rawLog.chainId,
          parentHash: prior?.rawLog.blockHash ?? null,
        },
        log: structuredClone(rawLog),
      };
    });
    return { chainId: 56, deliveries };
  }
}
