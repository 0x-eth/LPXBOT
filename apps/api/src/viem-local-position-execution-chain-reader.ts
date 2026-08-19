import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_LOCAL_POSITION_EXECUTION_REGISTRY,
  validateLocalPositionExecutionRegistry,
  type LocalPositionExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import type {
  LocalPositionChainInspection,
  LocalPositionExecutionChainReader,
} from "./local-position-executions.js";

const managerAbi = [
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
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "positions",
    outputs: [
      {
        components: [
          { name: "platformId", type: "uint8" },
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "poolAddress", type: "address" },
          { name: "poolId", type: "bytes32" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "tickSpacing", type: "int24" },
          { name: "feePips", type: "uint24" },
          { name: "liquidity", type: "uint128" },
          { name: "reserve0", type: "uint128" },
          { name: "reserve1", type: "uint128" },
          { name: "tokensOwed0", type: "uint128" },
          { name: "tokensOwed1", type: "uint128" },
        ],
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

interface RpcBlock {
  hash: Hex;
  number: Hex;
}

interface ProviderInspection extends LocalPositionChainInspection {
  providerId: string;
}

export interface ViemLocalPositionExecutionChainReaderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: LocalPositionExecutionRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_POSITION_CHAIN_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_POSITION_CHAIN_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: unknown): Hex | null {
  const code = bytes(value, "CODE");
  return code === "0x" ? null : keccak256(code);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((entry) => JSON.parse(stable(entry))));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, JSON.parse(stable(entry))]),
      ),
    );
  }
  return JSON.stringify(value);
}

export class ViemLocalPositionExecutionChainReader
  implements LocalPositionExecutionChainReader
{
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: LocalPositionExecutionRegistry;

  constructor(options: ViemLocalPositionExecutionChainReaderOptions) {
    if (options.chainId !== 31_337) {
      throw new RangeError("LOCAL_POSITION_CHAIN_ID_INVALID");
    }
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_POSITION_PROVIDER_COUNT_INVALID");
    }
    const providerIds = new Set(options.providers.map(({ providerId }) => providerId));
    if (providerIds.size !== options.providers.length) {
      throw new RangeError("LOCAL_POSITION_PROVIDER_ID_DUPLICATE");
    }
    this.#registry = validateLocalPositionExecutionRegistry(
      options.registry ?? P05_LOCAL_POSITION_EXECUTION_REGISTRY,
    );
    this.#providers = options.providers.map(
      (provider) =>
        new LocalEvmRpcClient({
          expectedChainId: 31_337,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...provider,
          ...(options.timeoutMilliseconds
            ? { timeoutMilliseconds: options.timeoutMilliseconds }
            : {}),
        }),
    );
  }

  async inspect(
    input: Parameters<LocalPositionExecutionChainReader["inspect"]>[0],
  ): Promise<LocalPositionChainInspection> {
    if (
      input.snapshot.chainId !== 31_337 ||
      input.snapshot.manager.address !== this.#registry.manager.address ||
      input.walletAddress !== input.snapshot.wallet.address
    ) {
      throw new Error("LOCAL_POSITION_CHAIN_INPUT_INVALID");
    }
    const observations = await Promise.all(
      this.#providers.map((provider) => this.#inspectProvider(provider, input)),
    );
    const first = observations[0]!;
    const identity = (observation: ProviderInspection) => ({
      blockHash: observation.blockHash,
      blockNumber: observation.blockNumber,
      headBlockNumber: observation.headBlockNumber,
      manager: observation.manager,
      position: observation.position,
      tokenCode: observation.tokenCode,
    });
    if (observations.some((observation) => stable(identity(observation)) !== stable(identity(first)))) {
      throw new Error("LOCAL_POSITION_PROVIDER_DIVERGENCE");
    }
    return {
      ...identity(first),
      nonceViews: observations.map(({ nonceViews }) => nonceViews[0]!),
    };
  }

  async #inspectProvider(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalPositionExecutionChainReader["inspect"]>[0],
  ): Promise<ProviderInspection> {
    const manager = this.#registry.manager.address;
    const tokenId = BigInt(input.snapshot.position.tokenId);
    const call = (functionName: "getApproved" | "ownerOf" | "positions", args: readonly unknown[]) =>
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: managerAbi,
            args: args as never,
            functionName,
          }),
          to: manager,
        },
        "latest",
      ]);
    const approvalOperator = input.snapshot.position.approval.operator;
    const approvalForAll = approvalOperator
      ? provider.request<Hex>("eth_call", [
          {
            data: encodeFunctionData({
              abi: managerAbi,
              args: [getAddress(input.walletAddress), getAddress(approvalOperator)],
              functionName: "isApprovedForAll",
            }),
            to: manager,
          },
          "latest",
        ])
      : Promise.resolve<Hex | null>(null);
    const blockTag = toHex(BigInt(input.snapshot.block.number));
    const [
      canonicalBlock,
      head,
      latestNonce,
      pendingNonce,
      managerCode,
      tokenCode,
      ownerRaw,
      approvedRaw,
      approvedForAllRaw,
      positionRaw,
    ] = await Promise.all([
      provider.request<RpcBlock | null>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
      provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "latest"]),
      provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "pending"]),
      provider.request<Hex>("eth_getCode", [manager, "latest"]),
      Promise.all(
        input.snapshot.tokens.map(({ address }) =>
          provider.request<Hex>("eth_getCode", [address, "latest"]),
        ),
      ),
      call("ownerOf", [tokenId]),
      call("getApproved", [tokenId]),
      approvalForAll,
      call("positions", [tokenId]),
    ]);
    if (!canonicalBlock || quantity(canonicalBlock.number, "BLOCK_NUMBER").toString() !== input.snapshot.block.number) {
      throw new Error("LOCAL_POSITION_CANONICAL_BLOCK_MISSING");
    }
    const owner = decodeFunctionResult({
      abi: managerAbi,
      data: bytes(ownerRaw, "OWNER"),
      functionName: "ownerOf",
    }).toLowerCase() as Address;
    const approved = decodeFunctionResult({
      abi: managerAbi,
      data: bytes(approvedRaw, "APPROVED"),
      functionName: "getApproved",
    }).toLowerCase() as Address;
    const position = decodeFunctionResult({
      abi: managerAbi,
      data: bytes(positionRaw, "POSITION"),
      functionName: "positions",
    });
    const v3 = position.platformId === 1 || position.platformId === 2;
    const approvedForAll = approvedForAllRaw
      ? decodeFunctionResult({
          abi: managerAbi,
          data: bytes(approvedForAllRaw, "APPROVED_FOR_ALL"),
          functionName: "isApprovedForAll",
        })
      : false;
    return {
      blockHash: canonicalBlock.hash.toLowerCase() as Hex,
      blockNumber: input.snapshot.block.number,
      headBlockNumber: quantity(head, "HEAD").toString(),
      manager: { address: manager, runtimeCodeHash: codeHash(managerCode) },
      nonceViews: [
        {
          latest: quantity(latestNonce, "LATEST_NONCE").toString(),
          pending: quantity(pendingNonce, "PENDING_NONCE").toString(),
          providerId: provider.providerId,
        },
      ],
      position: {
        approval: {
          approvedAddress: approved === zeroAddress ? null : approved,
          approvedForAll,
          operator: approvalOperator,
        },
        liquidity: position.liquidity.toString(),
        owner,
        platformId: position.platformId as 1 | 2 | 4 | 5,
        pool: {
          feePips: position.feePips.toString(),
          poolAddress: v3 ? (position.poolAddress.toLowerCase() as Address) : null,
          poolId: v3 ? null : (position.poolId.toLowerCase() as Hex),
          tickSpacing: position.tickSpacing.toString(),
          token0: position.token0.toLowerCase() as Address,
          token1: position.token1.toLowerCase() as Address,
        },
        reserve0BaseUnit: position.reserve0.toString(),
        reserve1BaseUnit: position.reserve1.toString(),
        ticks: { lower: position.tickLower.toString(), upper: position.tickUpper.toString() },
        tokenId: input.snapshot.position.tokenId,
        tokensOwed0BaseUnit: position.tokensOwed0.toString(),
        tokensOwed1BaseUnit: position.tokensOwed1.toString(),
      },
      providerId: provider.providerId,
      tokenCode: input.snapshot.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(tokenCode[index]),
      })),
    };
  }
}
