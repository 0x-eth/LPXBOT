import type { BscPositionReadDeployment, ProtocolId } from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const erc721ReadItems = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getApproved",
    outputs: [{ name: "operator", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "approved", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

const v3PositionsItem = {
  inputs: [{ name: "tokenId", type: "uint256" }],
  name: "positions",
  outputs: [
    { name: "nonce", type: "uint96" },
    { name: "operator", type: "address" },
    { name: "token0", type: "address" },
    { name: "token1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickLower", type: "int24" },
    { name: "tickUpper", type: "int24" },
    { name: "liquidity", type: "uint128" },
    { name: "feeGrowthInside0LastX128", type: "uint256" },
    { name: "feeGrowthInside1LastX128", type: "uint256" },
    { name: "tokensOwed0", type: "uint128" },
    { name: "tokensOwed1", type: "uint128" },
  ],
  stateMutability: "view",
  type: "function",
} as const;

const uniV4PoolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const pcsV4PoolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
] as const;

export const UNIV3_POSITION_MANAGER_READ_ABI = [
  ...erc721ReadItems,
  { ...v3PositionsItem, outputs: [...v3PositionsItem.outputs] },
] as const satisfies Abi;

export const PCSV3_POSITION_MANAGER_READ_ABI = [
  ...erc721ReadItems.map((item) => ({ ...item })),
  { ...v3PositionsItem, outputs: [...v3PositionsItem.outputs] },
] as const satisfies Abi;

export const UNIV4_POSITION_MANAGER_READ_ABI = [
  ...erc721ReadItems.map((item) => ({ ...item })),
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getPoolAndPositionInfo",
    outputs: [
      { components: uniV4PoolKeyComponents, name: "poolKey", type: "tuple" },
      { name: "info", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getPositionLiquidity",
    outputs: [{ name: "liquidity", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const PCSV4_POSITION_MANAGER_READ_ABI = [
  ...erc721ReadItems.map((item) => ({ ...item })),
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getPoolAndPositionInfo",
    outputs: [
      { components: pcsV4PoolKeyComponents, name: "poolKey", type: "tuple" },
      { name: "info", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "getPositionLiquidity",
    outputs: [{ name: "liquidity", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const UNIV3_FACTORY_READ_ABI = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ name: "pool", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const PCSV3_FACTORY_READ_ABI = [
  {
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    name: "getPool",
    outputs: [{ name: "pool", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const UNIV3_POOL_READ_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ name: "spacing", type: "int24" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const PCSV3_POOL_READ_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "tickSpacing",
    outputs: [{ name: "spacing", type: "int24" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const UNIV4_POOL_MANAGER_READ_ABI = [
  {
    inputs: [{ name: "slot", type: "bytes32" }],
    name: "extsload",
    outputs: [{ name: "value", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export const PCSV4_POOL_MANAGER_READ_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getSlot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

export interface PositionReadSnapshot {
  blockHash: Hex;
  blockNumber: string;
  blockTimestamp: string;
}

export interface PositionReadLog {
  address: Address;
  blockHash: Hex;
  blockNumber: string;
  data: Hex;
  logIndex: number;
  topics: readonly Hex[];
  transactionHash: Hex;
}

export interface PositionReadRpc {
  call(input: { blockNumber: string; data: Hex; to: Address }): Promise<Hex>;
  getBalance(address: Address, blockNumber: string): Promise<bigint>;
  getBlock(blockNumber: string | "latest"): Promise<PositionReadSnapshot>;
  getCode(address: Address, blockNumber: string): Promise<Hex>;
  getLogs(input: {
    address: Address;
    fromBlock: string;
    toBlock: string;
    topics: readonly (Hex | readonly Hex[] | null)[];
  }): Promise<readonly PositionReadLog[]>;
}

export interface PositionReadResult {
  approval: {
    approvedAddress: Address | null;
    approvedForAll: boolean;
    helperAuthorized: boolean;
    nftOwner: Address;
    observedAtBlock: string;
  };
  chainId: 56;
  fees: {
    estimated0BaseUnit: string | null;
    estimated1BaseUnit: string | null;
    owed0BaseUnit: string;
    owed1BaseUnit: string;
  };
  liquidity: {
    amount0BaseUnit: string;
    amount1BaseUnit: string;
    raw: string;
  };
  owner: Address;
  platformId: ProtocolId;
  pool: {
    feePips: string;
    hooks: Address | null;
    poolAddress: Address | null;
    poolId: Hex | null;
    tickSpacing: string;
    token0: Address;
    token1: Address;
  };
  snapshot: PositionReadSnapshot & {
    digest: Hex;
    positionManager: Address;
    positionManagerCodeHash: Hex;
    registryVersion: string;
  };
  ticks: { current: string; inRange: boolean; lower: string; upper: string };
  tokenId: string;
}

export interface PositionReadInput {
  helperAddress: Address | null;
  owner: Address;
  snapshot: PositionReadSnapshot;
  tokenId: string;
}

export interface PositionReadAdapter {
  readonly deployment: BscPositionReadDeployment;
  readPosition(input: PositionReadInput): Promise<Readonly<PositionReadResult>>;
}

export type PositionReadAdapterErrorReason =
  | "abi-decode-failed"
  | "deployment-mismatch"
  | "invalid-token-id"
  | "owner-mismatch"
  | "position-manager-code-hash-mismatch"
  | "rpc-read-failed";

export class PositionReadAdapterError extends Error {
  readonly reason: PositionReadAdapterErrorReason;

  constructor(reason: PositionReadAdapterErrorReason, cause?: unknown) {
    super(`POSITION_READ_QUARANTINED: ${reason}`, cause === undefined ? undefined : { cause });
    this.name = "PositionReadAdapterError";
    this.reason = reason;
  }
}

interface CommonPositionData {
  currentTick: bigint;
  feePips: bigint;
  hooks: Address | null;
  liquidity: bigint;
  owed0: bigint;
  owed1: bigint;
  poolAddress: Address | null;
  poolId: Hex | null;
  poolManager: Address | null;
  sqrtPriceX96: bigint;
  tickLower: bigint;
  tickSpacing: bigint;
  tickUpper: bigint;
  token0: Address;
  token1: Address;
}

const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function decimalUint(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new PositionReadAdapterError("invalid-token-id");
  }
  return BigInt(value);
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new PositionReadAdapterError("abi-decode-failed");
  return value;
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new PositionReadAdapterError("abi-decode-failed");
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new PositionReadAdapterError("abi-decode-failed");
  return value;
}

function asAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new PositionReadAdapterError("abi-decode-failed");
  }
  return value.toLowerCase() as Address;
}

function asHex32(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new PositionReadAdapterError("abi-decode-failed");
  }
  return value.toLowerCase() as Hex;
}

function tupleField(value: unknown, name: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  if (typeof value === "object" && value !== null && name in value) {
    return (value as Record<string, unknown>)[name];
  }
  throw new PositionReadAdapterError("abi-decode-failed");
}

function signed24(value: bigint): bigint {
  return BigInt.asIntN(24, value);
}

function sqrtRatioAtTick(tickValue: bigint): bigint {
  const tick = Number(tickValue);
  if (!Number.isSafeInteger(tick) || tick < -887_272 || tick > 887_272) {
    throw new PositionReadAdapterError("abi-decode-failed");
  }
  const absoluteTick = BigInt(Math.abs(tick));
  let ratio =
    (absoluteTick & 0x1n) === 0n
      ? 0x100000000000000000000000000000000n
      : 0xfffcb933bd6fad37aa2d162d1a594001n;
  const factors = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bcn],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ] as const;
  for (const [mask, factor] of factors) {
    if ((absoluteTick & mask) !== 0n) ratio = (ratio * factor) >> 128n;
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  const remainderMask = (1n << 32n) - 1n;
  return (ratio >> 32n) + ((ratio & remainderMask) === 0n ? 0n : 1n);
}

function tokenAmounts(
  liquidity: bigint,
  sqrtPriceX96: bigint,
  tickLower: bigint,
  tickUpper: bigint,
): readonly [bigint, bigint] {
  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);
  if (sqrtPriceX96 <= sqrtLower) {
    return [((liquidity << 96n) * (sqrtUpper - sqrtLower)) / sqrtUpper / sqrtLower, 0n];
  }
  if (sqrtPriceX96 < sqrtUpper) {
    return [
      ((liquidity << 96n) * (sqrtUpper - sqrtPriceX96)) / sqrtUpper / sqrtPriceX96,
      (liquidity * (sqrtPriceX96 - sqrtLower)) / Q96,
    ];
  }
  return [0n, (liquidity * (sqrtUpper - sqrtLower)) / Q96];
}

function freezeResult(result: PositionReadResult): Readonly<PositionReadResult> {
  Object.freeze(result.approval);
  Object.freeze(result.fees);
  Object.freeze(result.liquidity);
  Object.freeze(result.pool);
  Object.freeze(result.snapshot);
  Object.freeze(result.ticks);
  return Object.freeze(result);
}

function positionDigest(
  result: Omit<PositionReadResult, "snapshot"> & {
    snapshot: Omit<PositionReadResult["snapshot"], "digest">;
  },
): Hex {
  return keccak256(stringToHex(JSON.stringify(result)));
}

abstract class BasePositionReadAdapter implements PositionReadAdapter {
  readonly deployment: BscPositionReadDeployment;
  readonly #managerAbi: Abi;
  readonly #rpc: PositionReadRpc;

  protected constructor(options: {
    deployment: BscPositionReadDeployment;
    expectedPlatformId: ProtocolId;
    managerAbi: Abi;
    rpc: PositionReadRpc;
  }) {
    if (options.deployment.platformId !== options.expectedPlatformId) {
      throw new PositionReadAdapterError("deployment-mismatch");
    }
    this.deployment = options.deployment;
    this.#managerAbi = options.managerAbi;
    this.#rpc = options.rpc;
  }

  protected get rpc(): PositionReadRpc {
    return this.#rpc;
  }

  protected async contractRead(
    abi: Abi,
    address: Address,
    functionName: string,
    args: readonly unknown[],
    blockNumber: string,
  ): Promise<unknown> {
    const data = encodeFunctionData({ abi, args, functionName } as never);
    let response: Hex;
    try {
      response = await this.#rpc.call({ blockNumber, data, to: address });
    } catch (error) {
      throw new PositionReadAdapterError("rpc-read-failed", error);
    }
    try {
      return decodeFunctionResult({ abi, data: response, functionName } as never) as unknown;
    } catch (error) {
      throw new PositionReadAdapterError("abi-decode-failed", error);
    }
  }

  protected abstract readProtocolPosition(
    tokenId: bigint,
    blockNumber: string,
  ): Promise<CommonPositionData>;

  async readPosition(input: PositionReadInput): Promise<Readonly<PositionReadResult>> {
    const tokenId = decimalUint(input.tokenId);
    let code: Hex;
    try {
      code = await this.#rpc.getCode(
        this.deployment.positionManager.address,
        input.snapshot.blockNumber,
      );
    } catch (error) {
      throw new PositionReadAdapterError("rpc-read-failed", error);
    }
    if (
      keccak256(code).toLowerCase() !==
      this.deployment.positionManager.runtimeCodeHash.toLowerCase()
    ) {
      throw new PositionReadAdapterError("position-manager-code-hash-mismatch");
    }

    const manager = this.deployment.positionManager.address;
    const owner = asAddress(
      await this.contractRead(
        this.#managerAbi,
        manager,
        "ownerOf",
        [tokenId],
        input.snapshot.blockNumber,
      ),
    );
    if (owner !== input.owner.toLowerCase()) throw new PositionReadAdapterError("owner-mismatch");
    const observedApprovedAddress = asAddress(
      await this.contractRead(
        this.#managerAbi,
        manager,
        "getApproved",
        [tokenId],
        input.snapshot.blockNumber,
      ),
    );
    const approvedForAll = input.helperAddress
      ? asBoolean(
          await this.contractRead(
            this.#managerAbi,
            manager,
            "isApprovedForAll",
            [owner, input.helperAddress],
            input.snapshot.blockNumber,
          ),
        )
      : false;
    const data = await this.readProtocolPosition(tokenId, input.snapshot.blockNumber);
    const [amount0, amount1] = tokenAmounts(
      data.liquidity,
      data.sqrtPriceX96,
      data.tickLower,
      data.tickUpper,
    );
    const helper = input.helperAddress?.toLowerCase() ?? null;
    const approvedAddress =
      observedApprovedAddress === ZERO_ADDRESS ? null : observedApprovedAddress;
    const snapshot = {
      ...input.snapshot,
      positionManager: manager.toLowerCase() as Address,
      positionManagerCodeHash: this.deployment.positionManager.runtimeCodeHash,
      registryVersion: this.deployment.registryVersion,
    };
    const resultWithoutDigest = {
      approval: {
        approvedAddress,
        approvedForAll,
        helperAuthorized:
          helper !== null && (approvedForAll || observedApprovedAddress.toLowerCase() === helper),
        nftOwner: owner,
        observedAtBlock: input.snapshot.blockNumber,
      },
      chainId: 56,
      fees: {
        estimated0BaseUnit: null,
        estimated1BaseUnit: null,
        owed0BaseUnit: data.owed0.toString(),
        owed1BaseUnit: data.owed1.toString(),
      },
      liquidity: {
        amount0BaseUnit: amount0.toString(),
        amount1BaseUnit: amount1.toString(),
        raw: data.liquidity.toString(),
      },
      owner,
      platformId: this.deployment.platformId,
      pool: {
        feePips: data.feePips.toString(),
        hooks: data.hooks,
        poolAddress: data.poolAddress,
        poolId: data.poolId,
        tickSpacing: data.tickSpacing.toString(),
        token0: data.token0,
        token1: data.token1,
      },
      snapshot,
      ticks: {
        current: data.currentTick.toString(),
        inRange: data.currentTick >= data.tickLower && data.currentTick < data.tickUpper,
        lower: data.tickLower.toString(),
        upper: data.tickUpper.toString(),
      },
      tokenId: tokenId.toString(),
    } satisfies Omit<PositionReadResult, "snapshot"> & {
      snapshot: Omit<PositionReadResult["snapshot"], "digest">;
    };
    return freezeResult({
      ...resultWithoutDigest,
      snapshot: { ...snapshot, digest: positionDigest(resultWithoutDigest) },
    });
  }
}

abstract class V3PositionReadAdapter extends BasePositionReadAdapter {
  readonly #factoryAbi: Abi;
  readonly #managerAbi: Abi;
  readonly #poolAbi: Abi;

  protected constructor(options: {
    deployment: BscPositionReadDeployment;
    expectedPlatformId: 1 | 2;
    factoryAbi: Abi;
    managerAbi: Abi;
    poolAbi: Abi;
    rpc: PositionReadRpc;
  }) {
    super(options);
    if (!options.deployment.factory || options.deployment.poolIdentity !== "poolAddress") {
      throw new PositionReadAdapterError("deployment-mismatch");
    }
    this.#factoryAbi = options.factoryAbi;
    this.#managerAbi = options.managerAbi;
    this.#poolAbi = options.poolAbi;
  }

  protected async readProtocolPosition(
    tokenId: bigint,
    blockNumber: string,
  ): Promise<CommonPositionData> {
    const values = asArray(
      await this.contractRead(
        this.#managerAbi,
        this.deployment.positionManager.address,
        "positions",
        [tokenId],
        blockNumber,
      ),
    );
    if (values.length !== 12) throw new PositionReadAdapterError("abi-decode-failed");
    const token0 = asAddress(values[2]);
    const token1 = asAddress(values[3]);
    const fee = asBigInt(values[4]);
    const tickLower = asBigInt(values[5]);
    const tickUpper = asBigInt(values[6]);
    const liquidity = asBigInt(values[7]);
    const poolAddress = asAddress(
      await this.contractRead(
        this.#factoryAbi,
        this.deployment.factory!.address,
        "getPool",
        [token0, token1, fee],
        blockNumber,
      ),
    );
    if (poolAddress === ZERO_ADDRESS) throw new PositionReadAdapterError("abi-decode-failed");
    const slot0 = asArray(
      await this.contractRead(this.#poolAbi, poolAddress, "slot0", [], blockNumber),
    );
    const tickSpacing = asBigInt(
      await this.contractRead(this.#poolAbi, poolAddress, "tickSpacing", [], blockNumber),
    );
    return {
      currentTick: asBigInt(slot0[1]),
      feePips: fee,
      hooks: null,
      liquidity,
      owed0: asBigInt(values[10]),
      owed1: asBigInt(values[11]),
      poolAddress,
      poolId: null,
      poolManager: null,
      sqrtPriceX96: asBigInt(slot0[0]),
      tickLower,
      tickSpacing,
      tickUpper,
      token0,
      token1,
    };
  }
}

export class UniswapV3PositionReadAdapter extends V3PositionReadAdapter {
  constructor(options: { deployment: BscPositionReadDeployment; rpc: PositionReadRpc }) {
    super({
      ...options,
      expectedPlatformId: 1,
      factoryAbi: UNIV3_FACTORY_READ_ABI,
      managerAbi: UNIV3_POSITION_MANAGER_READ_ABI,
      poolAbi: UNIV3_POOL_READ_ABI,
    });
  }
}

export class PancakeV3PositionReadAdapter extends V3PositionReadAdapter {
  constructor(options: { deployment: BscPositionReadDeployment; rpc: PositionReadRpc }) {
    super({
      ...options,
      expectedPlatformId: 2,
      factoryAbi: PCSV3_FACTORY_READ_ABI,
      managerAbi: PCSV3_POSITION_MANAGER_READ_ABI,
      poolAbi: PCSV3_POOL_READ_ABI,
    });
  }
}

abstract class V4PositionReadAdapter extends BasePositionReadAdapter {
  readonly #managerAbi: Abi;
  readonly #poolManagerAbi: Abi;

  protected constructor(options: {
    deployment: BscPositionReadDeployment;
    expectedPlatformId: 4 | 5;
    managerAbi: Abi;
    poolManagerAbi: Abi;
    rpc: PositionReadRpc;
  }) {
    super(options);
    if (!options.deployment.poolManager || options.deployment.poolIdentity !== "poolId") {
      throw new PositionReadAdapterError("deployment-mismatch");
    }
    this.#managerAbi = options.managerAbi;
    this.#poolManagerAbi = options.poolManagerAbi;
  }

  protected abstract poolData(
    poolKey: unknown,
    blockNumber: string,
  ): Promise<
    Pick<
      CommonPositionData,
      | "currentTick"
      | "feePips"
      | "hooks"
      | "poolId"
      | "sqrtPriceX96"
      | "tickSpacing"
      | "token0"
      | "token1"
    >
  >;

  protected async readProtocolPosition(
    tokenId: bigint,
    blockNumber: string,
  ): Promise<CommonPositionData> {
    const positionInfo = asArray(
      await this.contractRead(
        this.#managerAbi,
        this.deployment.positionManager.address,
        "getPoolAndPositionInfo",
        [tokenId],
        blockNumber,
      ),
    );
    if (positionInfo.length !== 2) throw new PositionReadAdapterError("abi-decode-failed");
    const packedInfo = asBigInt(positionInfo[1]);
    const tickLower = signed24(packedInfo >> 8n);
    const tickUpper = signed24(packedInfo >> 32n);
    const liquidity = asBigInt(
      await this.contractRead(
        this.#managerAbi,
        this.deployment.positionManager.address,
        "getPositionLiquidity",
        [tokenId],
        blockNumber,
      ),
    );
    const pool = await this.poolData(positionInfo[0], blockNumber);
    return {
      ...pool,
      liquidity,
      owed0: 0n,
      owed1: 0n,
      poolAddress: null,
      poolManager: this.deployment.poolManager!.address.toLowerCase() as Address,
      tickLower,
      tickUpper,
    };
  }

  protected async poolManagerRead(
    functionName: string,
    args: readonly unknown[],
    blockNumber: string,
  ): Promise<unknown> {
    return this.contractRead(
      this.#poolManagerAbi,
      this.deployment.poolManager!.address,
      functionName,
      args,
      blockNumber,
    );
  }
}

export class UniswapV4PositionReadAdapter extends V4PositionReadAdapter {
  constructor(options: { deployment: BscPositionReadDeployment; rpc: PositionReadRpc }) {
    super({
      ...options,
      expectedPlatformId: 4,
      managerAbi: UNIV4_POSITION_MANAGER_READ_ABI,
      poolManagerAbi: UNIV4_POOL_MANAGER_READ_ABI,
    });
  }

  protected async poolData(poolKey: unknown, blockNumber: string) {
    const token0 = asAddress(tupleField(poolKey, "currency0", 0));
    const token1 = asAddress(tupleField(poolKey, "currency1", 1));
    const feePips = asBigInt(tupleField(poolKey, "fee", 2));
    const tickSpacing = asBigInt(tupleField(poolKey, "tickSpacing", 3));
    const hooks = asAddress(tupleField(poolKey, "hooks", 4));
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [token0, token1, Number(feePips), Number(tickSpacing), hooks],
      ),
    );
    const poolsSlot = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, 6n]),
    );
    const packedSlot0 = BigInt(
      asHex32(await this.poolManagerRead("extsload", [poolsSlot], blockNumber)),
    );
    return {
      currentTick: signed24(packedSlot0 >> 160n),
      feePips,
      hooks,
      poolId,
      sqrtPriceX96: packedSlot0 & ((1n << 160n) - 1n),
      tickSpacing,
      token0,
      token1,
    };
  }
}

export class PancakeV4PositionReadAdapter extends V4PositionReadAdapter {
  constructor(options: { deployment: BscPositionReadDeployment; rpc: PositionReadRpc }) {
    super({
      ...options,
      expectedPlatformId: 5,
      managerAbi: PCSV4_POSITION_MANAGER_READ_ABI,
      poolManagerAbi: PCSV4_POOL_MANAGER_READ_ABI,
    });
  }

  protected async poolData(poolKey: unknown, blockNumber: string) {
    const token0 = asAddress(tupleField(poolKey, "currency0", 0));
    const token1 = asAddress(tupleField(poolKey, "currency1", 1));
    const hooks = asAddress(tupleField(poolKey, "hooks", 2));
    const poolManager = asAddress(tupleField(poolKey, "poolManager", 3));
    if (poolManager !== this.deployment.poolManager!.address.toLowerCase()) {
      throw new PositionReadAdapterError("abi-decode-failed");
    }
    const feePips = asBigInt(tupleField(poolKey, "fee", 4));
    const parameters = asHex32(tupleField(poolKey, "parameters", 5));
    const tickSpacing = signed24(BigInt(parameters) >> 16n);
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "bytes32" },
        ],
        [token0, token1, hooks, poolManager, Number(feePips), parameters],
      ),
    );
    const slot0 = asArray(await this.poolManagerRead("getSlot0", [poolId], blockNumber));
    return {
      currentTick: asBigInt(slot0[1]),
      feePips,
      hooks,
      poolId,
      sqrtPriceX96: asBigInt(slot0[0]),
      tickSpacing,
      token0,
      token1,
    };
  }
}
