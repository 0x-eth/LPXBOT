import { createHash } from "node:crypto";

import type { ProtocolPlatformId } from "@lpbot/chain-registry";
import { parseAbi, toEventSelector, type Abi, type Hex } from "viem";

// Event declarations are transcribed from the pinned official interfaces named in P02-03/abi-index.json.
const commonV3Events = [
  "event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)",
  "event Mint(address sender,address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)",
  "event Burn(address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)",
  "event Collect(address indexed owner,address recipient,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount0,uint128 amount1)",
] as const;

export const UNIV3_EVENT_ABI = parseAbi([
  ...commonV3Events,
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);

export const PCSV3_EVENT_ABI = parseAbi([
  ...commonV3Events,
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint128 protocolFeesToken0,uint128 protocolFeesToken1)",
]);

export const UNIV4_EVENT_ABI = parseAbi([
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)",
]);

export const PCSV4_EVENT_ABI = parseAbi([
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,address hooks,uint24 fee,bytes32 parameters,uint160 sqrtPriceX96,int24 tick)",
  "event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)",
  "event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee,uint16 protocolFee)",
]);

export const PROTOCOL_EVENT_ABIS = {
  pcsv3: PCSV3_EVENT_ABI,
  pcsv4: PCSV4_EVENT_ABI,
  univ3: UNIV3_EVENT_ABI,
  univ4: UNIV4_EVENT_ABI,
} as const satisfies Record<ProtocolPlatformId, Abi>;

function abiHash(abi: Abi): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(abi)).digest("hex")}`;
}

export const PROTOCOL_ABI_HASHES = {
  pcsv3: abiHash(PCSV3_EVENT_ABI),
  pcsv4: abiHash(PCSV4_EVENT_ABI),
  univ3: abiHash(UNIV3_EVENT_ABI),
  univ4: abiHash(UNIV4_EVENT_ABI),
} as const satisfies Record<ProtocolPlatformId, `sha256:${string}`>;

function eventTopic(signature: string): Hex {
  return toEventSelector(signature);
}

export const PROTOCOL_EVENT_TOPICS = {
  v3: {
    Burn: eventTopic("Burn(address,int24,int24,uint128,uint256,uint256)"),
    Collect: eventTopic("Collect(address,address,int24,int24,uint128,uint128)"),
    Mint: eventTopic("Mint(address,address,int24,int24,uint128,uint256,uint256)"),
    PoolCreated: eventTopic("PoolCreated(address,address,uint24,int24,address)"),
    SwapPancake: eventTopic(
      "Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)",
    ),
    SwapUniswap: eventTopic("Swap(address,address,int256,int256,uint160,uint128,int24)"),
  },
  v4: {
    InitializePancake: eventTopic(
      "Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)",
    ),
    InitializeUniswap: eventTopic(
      "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
    ),
    ModifyLiquidity: eventTopic(
      "ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)",
    ),
    SwapPancake: eventTopic(
      "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)",
    ),
    SwapUniswap: eventTopic(
      "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)",
    ),
  },
} as const;

export const SUPPORTED_EVENT_TOPICS = [
  ...Object.values(PROTOCOL_EVENT_TOPICS.v3),
  ...Object.values(PROTOCOL_EVENT_TOPICS.v4),
] as const;
