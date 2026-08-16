import { createHash } from "node:crypto";

import {
  validateProtocolDeploymentRegistry,
  type ProtocolDeployment,
  type ProtocolPlatformId,
} from "@lpbot/chain-registry";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  PROTOCOL_ABI_HASHES,
  PROTOCOL_EVENT_ABIS,
  PROTOCOL_EVENT_TOPICS,
} from "./abis.js";
import type {
  IndexerCursor,
  NormalizedPoolEvent,
  RawChainLog,
  RawLogDelivery,
} from "./types.js";

export type QuarantineReason =
  | "abi-conflict"
  | "inactive-protocol"
  | "malformed-log"
  | "pool-id-mismatch"
  | "pool-unregistered"
  | "unknown-topic"
  | "wrong-address"
  | "wrong-chain"
  | "wrong-protocol";

export interface QuarantinedLog {
  address: string;
  blockNumber: string;
  chainId: number;
  reason: QuarantineReason;
  topic0: string | null;
  transactionHash: string;
}

export interface QuarantineSink {
  write(entry: QuarantinedLog): Promise<void> | void;
}

interface V3PoolIdentity {
  feePips: string;
  platformId: "univ3" | "pcsv3";
  poolAddress: string;
  tickSpacing: string;
  token0: string;
  token1: string;
}

interface V4PoolIdentity {
  feePips: string;
  hooks: string;
  parameters: string | null;
  platformId: "univ4" | "pcsv4";
  poolId: string;
  tickSpacing: string;
  token0: string;
  token1: string;
}

interface DecodedFields {
  amount0: string | null;
  amount1: string | null;
  kind: NormalizedPoolEvent["kind"];
  liquidityDelta: string | null;
  payload: Record<string, string | null>;
  pool: NormalizedPoolEvent["pool"];
  protocol: NormalizedPoolEvent["protocol"];
  protocolGeneration: NormalizedPoolEvent["protocolGeneration"];
  sqrtPriceX96: string | null;
}

export interface ProductionBscEventDecoderOptions {
  deployments: readonly ProtocolDeployment[];
  quarantine?: QuarantineSink;
}

const nullQuarantine: QuarantineSink = { write: () => undefined };

function lower(value: string): string {
  return value.toLowerCase();
}

function decimal(value: bigint | number): string {
  return String(value);
}

function negative(value: bigint): string {
  return value === 0n ? "0" : String(-value);
}

function eventIdForRawLog(rawLog: RawChainLog): string {
  return createHash("sha256")
    .update([rawLog.chainId, rawLog.blockHash, rawLog.transactionHash, rawLog.logIndex].join(":"))
    .digest("hex");
}

function cursorForRawLog(rawLog: RawChainLog): IndexerCursor {
  return {
    blockHash: lower(rawLog.blockHash),
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
      lower(rawLog.blockHash),
    ].join(":"),
  };
}

function emptyPayload(eventName: string): Record<string, string | null> {
  return {
    amount0: null,
    amount1: null,
    eventName,
    feePips: null,
    liquidity: null,
    liquidityDelta: null,
    owner: null,
    parameters: null,
    positionId: null,
    protocolFee: null,
    protocolFeesToken0: null,
    protocolFeesToken1: null,
    recipient: null,
    salt: null,
    sender: null,
    sqrtPriceX96: null,
    tick: null,
    tickLower: null,
    tickUpper: null,
  };
}

function decodeWithAbi(abi: Abi, delivery: RawLogDelivery) {
  return decodeEventLog({
    abi,
    data: delivery.log.data as Hex,
    strict: true,
    topics: delivery.log.topics as [Hex, ...Hex[]],
  });
}

function sameV3Pool(left: V3PoolIdentity, right: V3PoolIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameV4Pool(left: V4PoolIdentity, right: V4PoolIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pcsv4TickSpacing(parameters: Hex): string {
  const encoded = BigInt(parameters);
  const unsigned = Number((encoded >> 16n) & 0xff_ffffn);
  return String(unsigned >= 0x80_0000 ? unsigned - 0x100_0000 : unsigned);
}

function univ4PoolId(args: {
  currency0: Address;
  currency1: Address;
  fee: number;
  hooks: Address;
  tickSpacing: number;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [args.currency0, args.currency1, args.fee, args.tickSpacing, args.hooks],
    ),
  );
}

function pcsv4PoolId(
  args: {
    currency0: Address;
    currency1: Address;
    fee: number;
    hooks: Address;
    parameters: Hex;
  },
  poolManager: Address,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "bytes32" },
      ],
      [
        args.currency0,
        args.currency1,
        args.hooks,
        poolManager,
        args.fee,
        args.parameters,
      ],
    ),
  );
}

export class ProductionBscEventDecoder {
  readonly #conflictingAbis = new Set<ProtocolPlatformId>();
  readonly #deployments: readonly ProtocolDeployment[];
  readonly #factoryByAddress = new Map<string, ProtocolDeployment>();
  readonly #managerByAddress = new Map<string, ProtocolDeployment>();
  readonly #quarantine: QuarantineSink;
  readonly #v3Pools = new Map<string, V3PoolIdentity>();
  readonly #v4Pools = new Map<string, V4PoolIdentity>();

  constructor(options: ProductionBscEventDecoderOptions) {
    validateProtocolDeploymentRegistry(options.deployments);
    this.#deployments = [...options.deployments];
    this.#quarantine = options.quarantine ?? nullQuarantine;
    for (const deployment of this.#deployments) {
      if (deployment.abiHash !== PROTOCOL_ABI_HASHES[deployment.platformId]) {
        this.#conflictingAbis.add(deployment.platformId);
      }
      if (deployment.factory) this.#factoryByAddress.set(deployment.factory, deployment);
      if (deployment.poolManager) this.#managerByAddress.set(deployment.poolManager, deployment);
    }
  }

  async #reject(delivery: RawLogDelivery, reason: QuarantineReason): Promise<never> {
    await this.#quarantine.write({
      address: lower(delivery.log.address),
      blockNumber: delivery.log.blockNumber,
      chainId: delivery.log.chainId,
      reason,
      topic0: delivery.log.topics[0]?.toLowerCase() ?? null,
      transactionHash: lower(delivery.log.transactionHash),
    });
    throw new Error(`DECODER_QUARANTINED: ${reason}`);
  }

  #deploymentInRange(deployment: ProtocolDeployment, blockNumber: string): boolean {
    const block = BigInt(blockNumber);
    return (
      block >= BigInt(deployment.validFromBlock) &&
      (deployment.validToBlock === null || block <= BigInt(deployment.validToBlock))
    );
  }

  async #route(delivery: RawLogDelivery): Promise<ProtocolDeployment> {
    const address = lower(delivery.log.address);
    const topic0 = delivery.log.topics[0]?.toLowerCase();
    if (!topic0) return this.#reject(delivery, "malformed-log");
    let deployment: ProtocolDeployment | undefined;
    if (topic0 === PROTOCOL_EVENT_TOPICS.v3.PoolCreated) {
      deployment = this.#factoryByAddress.get(address);
    } else if (
      topic0 === PROTOCOL_EVENT_TOPICS.v4.InitializePancake ||
      topic0 === PROTOCOL_EVENT_TOPICS.v4.InitializeUniswap ||
      topic0 === PROTOCOL_EVENT_TOPICS.v4.ModifyLiquidity ||
      topic0 === PROTOCOL_EVENT_TOPICS.v4.SwapPancake ||
      topic0 === PROTOCOL_EVENT_TOPICS.v4.SwapUniswap
    ) {
      deployment = this.#managerByAddress.get(address);
    } else if (
      topic0 === PROTOCOL_EVENT_TOPICS.v3.Mint ||
      topic0 === PROTOCOL_EVENT_TOPICS.v3.Burn ||
      topic0 === PROTOCOL_EVENT_TOPICS.v3.Collect ||
      topic0 === PROTOCOL_EVENT_TOPICS.v3.SwapPancake ||
      topic0 === PROTOCOL_EVENT_TOPICS.v3.SwapUniswap
    ) {
      const pool = this.#v3Pools.get(address);
      if (!pool) return this.#reject(delivery, "pool-unregistered");
      deployment = this.#deployments.find(({ platformId }) => platformId === pool.platformId);
      if (!deployment) return this.#reject(delivery, "inactive-protocol");
      const swapMatches =
        topic0 !== PROTOCOL_EVENT_TOPICS.v3.SwapPancake &&
        topic0 !== PROTOCOL_EVENT_TOPICS.v3.SwapUniswap
          ? true
          : (pool.platformId === "pcsv3") ===
            (topic0 === PROTOCOL_EVENT_TOPICS.v3.SwapPancake);
      if (!swapMatches) return this.#reject(delivery, "wrong-protocol");
    } else {
      return this.#reject(delivery, "unknown-topic");
    }
    if (!deployment) return this.#reject(delivery, "wrong-address");
    if (!this.#deploymentInRange(deployment, delivery.log.blockNumber)) {
      return this.#reject(delivery, "inactive-protocol");
    }
    if (this.#conflictingAbis.has(deployment.platformId)) {
      return this.#reject(delivery, "abi-conflict");
    }
    const wrongV4ProtocolTopic =
      (deployment.platformId === "univ4" &&
        (topic0 === PROTOCOL_EVENT_TOPICS.v4.InitializePancake ||
          topic0 === PROTOCOL_EVENT_TOPICS.v4.SwapPancake)) ||
      (deployment.platformId === "pcsv4" &&
        (topic0 === PROTOCOL_EVENT_TOPICS.v4.InitializeUniswap ||
          topic0 === PROTOCOL_EVENT_TOPICS.v4.SwapUniswap));
    if (wrongV4ProtocolTopic) {
      return this.#reject(delivery, "wrong-protocol");
    }
    return deployment;
  }

  async #decodeV3(
    delivery: RawLogDelivery,
    deployment: ProtocolDeployment,
  ): Promise<DecodedFields> {
    const decoded = decodeWithAbi(PROTOCOL_EVENT_ABIS[deployment.platformId], delivery);
    const args = decoded.args as unknown as Record<string, bigint | number | string>;
    const eventName = decoded.eventName;
    if (!eventName) return this.#reject(delivery, "malformed-log");
    const payload = emptyPayload(eventName);
    const protocol = deployment.platformId as "univ3" | "pcsv3";
    if (eventName === "PoolCreated") {
      const pool: V3PoolIdentity = {
        feePips: decimal(args.fee as number),
        platformId: protocol,
        poolAddress: lower(args.pool as string),
        tickSpacing: decimal(args.tickSpacing as number),
        token0: lower(args.token0 as string),
        token1: lower(args.token1 as string),
      };
      const existing = this.#v3Pools.get(pool.poolAddress);
      if (existing && !sameV3Pool(existing, pool)) return this.#reject(delivery, "abi-conflict");
      this.#v3Pools.set(pool.poolAddress, pool);
      payload.feePips = pool.feePips;
      payload.tick = null;
      return {
        amount0: null,
        amount1: null,
        kind: "pool.created",
        liquidityDelta: null,
        payload,
        pool: {
          feePips: pool.feePips,
          hooks: null,
          poolAddress: pool.poolAddress,
          poolId: null,
          tickSpacing: pool.tickSpacing,
          token0: pool.token0,
          token1: pool.token1,
        },
        protocol,
        protocolGeneration: "v3",
        sqrtPriceX96: null,
      };
    }
    const pool = this.#v3Pools.get(lower(delivery.log.address));
    if (!pool) return this.#reject(delivery, "pool-unregistered");
    const normalizedPool = {
      feePips: pool.feePips,
      hooks: null,
      poolAddress: pool.poolAddress,
      poolId: null,
      tickSpacing: pool.tickSpacing,
      token0: pool.token0,
      token1: pool.token1,
    };
    if (eventName === "Swap") {
      const amount0 = decimal(args.amount0 as bigint);
      const amount1 = decimal(args.amount1 as bigint);
      const sqrtPriceX96 = decimal(args.sqrtPriceX96 as bigint);
      payload.amount0 = amount0;
      payload.amount1 = amount1;
      payload.liquidity = decimal(args.liquidity as bigint);
      payload.protocolFeesToken0 =
        args.protocolFeesToken0 === undefined ? null : decimal(args.protocolFeesToken0 as bigint);
      payload.protocolFeesToken1 =
        args.protocolFeesToken1 === undefined ? null : decimal(args.protocolFeesToken1 as bigint);
      payload.recipient = lower(args.recipient as string);
      payload.sender = lower(args.sender as string);
      payload.sqrtPriceX96 = sqrtPriceX96;
      payload.tick = decimal(args.tick as number);
      return {
        amount0,
        amount1,
        kind: "swap",
        liquidityDelta: null,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v3",
        sqrtPriceX96,
      };
    }
    const tickLower = decimal(args.tickLower as number);
    const tickUpper = decimal(args.tickUpper as number);
    payload.owner = lower(args.owner as string);
    payload.tickLower = tickLower;
    payload.tickUpper = tickUpper;
    if (eventName === "Mint") {
      const amount0 = decimal(args.amount0 as bigint);
      const amount1 = decimal(args.amount1 as bigint);
      const liquidityDelta = decimal(args.amount as bigint);
      payload.amount0 = amount0;
      payload.amount1 = amount1;
      payload.liquidityDelta = liquidityDelta;
      payload.sender = lower(args.sender as string);
      return {
        amount0,
        amount1,
        kind: "liquidity.add",
        liquidityDelta,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v3",
        sqrtPriceX96: null,
      };
    }
    if (eventName === "Burn") {
      const amount0 = negative(args.amount0 as bigint);
      const amount1 = negative(args.amount1 as bigint);
      const liquidityDelta = negative(args.amount as bigint);
      payload.amount0 = amount0;
      payload.amount1 = amount1;
      payload.liquidityDelta = liquidityDelta;
      return {
        amount0,
        amount1,
        kind: "liquidity.remove",
        liquidityDelta,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v3",
        sqrtPriceX96: null,
      };
    }
    if (eventName === "Collect") {
      const amount0 = negative(args.amount0 as bigint);
      const amount1 = negative(args.amount1 as bigint);
      payload.amount0 = amount0;
      payload.amount1 = amount1;
      payload.recipient = lower(args.recipient as string);
      return {
        amount0,
        amount1,
        kind: "collect",
        liquidityDelta: null,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v3",
        sqrtPriceX96: null,
      };
    }
    return this.#reject(delivery, "unknown-topic");
  }

  async #decodeV4(
    delivery: RawLogDelivery,
    deployment: ProtocolDeployment,
  ): Promise<DecodedFields> {
    const decoded = decodeWithAbi(PROTOCOL_EVENT_ABIS[deployment.platformId], delivery);
    const args = decoded.args as unknown as Record<string, bigint | number | string>;
    const eventName = decoded.eventName;
    if (!eventName) return this.#reject(delivery, "malformed-log");
    const payload = emptyPayload(eventName);
    const protocol = deployment.platformId as "univ4" | "pcsv4";
    const poolId = lower(args.id as string);
    if (eventName === "Initialize") {
      const manager = deployment.poolManager as Address;
      const hooks = lower(args.hooks as string);
      const parameters = protocol === "pcsv4" ? lower(args.parameters as string) : null;
      const tickSpacing =
        protocol === "pcsv4"
          ? pcsv4TickSpacing(parameters as Hex)
          : decimal(args.tickSpacing as number);
      const calculated =
        protocol === "pcsv4"
          ? pcsv4PoolId(
              {
                currency0: args.currency0 as Address,
                currency1: args.currency1 as Address,
                fee: args.fee as number,
                hooks: args.hooks as Address,
                parameters: args.parameters as Hex,
              },
              manager,
            )
          : univ4PoolId({
              currency0: args.currency0 as Address,
              currency1: args.currency1 as Address,
              fee: args.fee as number,
              hooks: args.hooks as Address,
              tickSpacing: args.tickSpacing as number,
            });
      if (lower(calculated) !== poolId) return this.#reject(delivery, "pool-id-mismatch");
      const pool: V4PoolIdentity = {
        feePips: decimal(args.fee as number),
        hooks,
        parameters,
        platformId: protocol,
        poolId,
        tickSpacing,
        token0: lower(args.currency0 as string),
        token1: lower(args.currency1 as string),
      };
      const existing = this.#v4Pools.get(poolId);
      if (existing && !sameV4Pool(existing, pool)) return this.#reject(delivery, "abi-conflict");
      this.#v4Pools.set(poolId, pool);
      const sqrtPriceX96 = decimal(args.sqrtPriceX96 as bigint);
      payload.feePips = pool.feePips;
      payload.parameters = parameters;
      payload.sqrtPriceX96 = sqrtPriceX96;
      payload.tick = decimal(args.tick as number);
      return {
        amount0: null,
        amount1: null,
        kind: "pool.created",
        liquidityDelta: null,
        payload,
        pool: {
          feePips: pool.feePips,
          hooks: pool.hooks,
          poolAddress: null,
          poolId,
          tickSpacing: pool.tickSpacing,
          token0: pool.token0,
          token1: pool.token1,
        },
        protocol,
        protocolGeneration: "v4",
        sqrtPriceX96,
      };
    }
    const pool = this.#v4Pools.get(poolId);
    if (!pool) return this.#reject(delivery, "pool-unregistered");
    if (pool.platformId !== protocol) return this.#reject(delivery, "wrong-protocol");
    const normalizedPool = {
      feePips: pool.feePips,
      hooks: pool.hooks,
      poolAddress: null,
      poolId,
      tickSpacing: pool.tickSpacing,
      token0: pool.token0,
      token1: pool.token1,
    };
    payload.sender = lower(args.sender as string);
    if (eventName === "Swap") {
      const amount0 = decimal(args.amount0 as bigint);
      const amount1 = decimal(args.amount1 as bigint);
      const sqrtPriceX96 = decimal(args.sqrtPriceX96 as bigint);
      payload.amount0 = amount0;
      payload.amount1 = amount1;
      payload.feePips = decimal(args.fee as number);
      payload.liquidity = decimal(args.liquidity as bigint);
      payload.protocolFee =
        args.protocolFee === undefined ? null : decimal(args.protocolFee as number);
      payload.sqrtPriceX96 = sqrtPriceX96;
      payload.tick = decimal(args.tick as number);
      return {
        amount0,
        amount1,
        kind: "swap",
        liquidityDelta: null,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v4",
        sqrtPriceX96,
      };
    }
    if (eventName === "ModifyLiquidity") {
      const liquidityDelta = decimal(args.liquidityDelta as bigint);
      payload.liquidityDelta = liquidityDelta;
      payload.salt = lower(args.salt as string);
      payload.tickLower = decimal(args.tickLower as number);
      payload.tickUpper = decimal(args.tickUpper as number);
      return {
        amount0: null,
        amount1: null,
        kind: BigInt(liquidityDelta) >= 0n ? "liquidity.add" : "liquidity.remove",
        liquidityDelta,
        payload,
        pool: normalizedPool,
        protocol,
        protocolGeneration: "v4",
        sqrtPriceX96: null,
      };
    }
    return this.#reject(delivery, "unknown-topic");
  }

  async decode(delivery: RawLogDelivery): Promise<NormalizedPoolEvent> {
    if (
      delivery.log.chainId !== 56 ||
      delivery.block.chainId !== 56 ||
      delivery.log.chainId !== delivery.block.chainId
    ) {
      return this.#reject(delivery, "wrong-chain");
    }
    if (
      delivery.log.blockHash.toLowerCase() !== delivery.block.blockHash.toLowerCase() ||
      delivery.log.blockNumber !== delivery.block.blockNumber
    ) {
      return this.#reject(delivery, "malformed-log");
    }
    let fields: DecodedFields;
    try {
      const deployment = await this.#route(delivery);
      fields =
        deployment.generation === "v3"
          ? await this.#decodeV3(delivery, deployment)
          : await this.#decodeV4(delivery, deployment);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("DECODER_QUARANTINED:")) throw error;
      return this.#reject(delivery, "malformed-log");
    }
    const log = delivery.log;
    return {
      amount0: fields.amount0,
      amount1: fields.amount1,
      blockHash: lower(log.blockHash),
      blockNumber: log.blockNumber,
      blockTimestamp: delivery.block.blockTimestamp,
      chainId: log.chainId,
      contractAddress: lower(log.address),
      cursor: cursorForRawLog(log),
      eventId: eventIdForRawLog(log),
      finality: log.removed ? "reverted" : "observed",
      kind: fields.kind,
      liquidityDelta: fields.liquidityDelta,
      logIndex: log.logIndex,
      market: {},
      payload: fields.payload,
      pool: fields.pool,
      protocol: fields.protocol,
      protocolGeneration: fields.protocolGeneration,
      rawRef: `bsc:${lower(log.transactionHash)}:${String(log.logIndex)}`,
      removed: log.removed,
      schemaVersion: "1.0.0",
      sqrtPriceX96: fields.sqrtPriceX96,
      transactionHash: lower(log.transactionHash),
      transactionIndex: log.transactionIndex,
    };
  }
}
