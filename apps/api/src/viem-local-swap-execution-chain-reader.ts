import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
  type LocalSwapExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type {
  LocalSwapExecutionChainReader,
  LocalSwapChainInspection,
} from "./local-swap-executions.js";

const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const helperAbi = parseAbi([
  "function adapter() view returns (address)",
  "function owner() view returns (address)",
  "function permit2() view returns (address)",
]);
const permit2Abi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
]);

interface RpcBlock {
  hash: Hex;
  number: Hex;
  timestamp: Hex;
}

export interface ViemLocalSwapExecutionChainReaderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: LocalSwapExecutionRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

function addressResult(value: unknown, functionName: "adapter" | "owner" | "permit2"): Address {
  return getAddress(
    decodeFunctionResult({
      abi: helperAbi,
      data: bytes(value, `${functionName.toUpperCase()}_RESULT`),
      functionName,
    }),
  ).toLowerCase() as Address;
}

export class ViemLocalSwapExecutionChainReader implements LocalSwapExecutionChainReader {
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(options: ViemLocalSwapExecutionChainReaderOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_SWAP_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_SWAP_PROVIDER_COUNT_INVALID");
    }
    this.#providers = options.providers.map(
      (provider) =>
        new LocalEvmRpcClient({
          expectedChainId: options.chainId,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...provider,
          ...(options.timeoutMilliseconds
            ? { timeoutMilliseconds: options.timeoutMilliseconds }
            : {}),
        }),
    );
    this.#registry = validateLocalSwapExecutionRegistry(
      options.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
  }

  async inspect(
    input: Parameters<LocalSwapExecutionChainReader["inspect"]>[0],
  ): Promise<LocalSwapChainInspection> {
    const primary = this.#providers[0]!;
    const block = await primary.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    const blockNumber = quantity(block.number, "BLOCK_NUMBER");
    const blockTag = toHex(blockNumber);
    if (!/^0x[0-9a-f]{64}$/iu.test(block.hash)) throw new Error("LOCAL_SWAP_BLOCK_HASH_INVALID");
    const call = (to: Address, data: Hex) =>
      primary.request<Hex>("eth_call", [{ data, to }, blockTag]);
    const allowanceCall = encodeFunctionData({
      abi: erc20Abi,
      args: [getAddress(input.walletAddress), getAddress(input.approvalSpender)],
      functionName: "allowance",
    });
    const inputBalanceCall = encodeFunctionData({
      abi: erc20Abi,
      args: [getAddress(input.walletAddress)],
      functionName: "balanceOf",
    });
    const outputBalanceCall = inputBalanceCall;
    const permit2AllowanceCall = encodeFunctionData({
      abi: permit2Abi,
      args: [
        getAddress(input.walletAddress),
        getAddress(input.quote.tokenIn),
        getAddress(input.binding.helperAddress),
      ],
      functionName: "allowance",
    });
    const [
      componentCodes,
      tokenCodes,
      helperCode,
      helperOwner,
      helperAdapter,
      helperPermit2,
      allowance,
      inputBalance,
      outputBalance,
      permit2Domain,
      permit2Allowance,
      nonceViews,
    ] = await Promise.all([
      Promise.all(
        this.#registry.components.map(({ address }) =>
          primary.request<Hex>("eth_getCode", [address, blockTag]),
        ),
      ),
      Promise.all(
        this.#registry.tokens.map(({ address }) =>
          primary.request<Hex>("eth_getCode", [address, blockTag]),
        ),
      ),
      primary.request<Hex>("eth_getCode", [input.binding.helperAddress, blockTag]),
      call(
        input.binding.helperAddress,
        encodeFunctionData({ abi: helperAbi, functionName: "owner" }),
      ),
      call(
        input.binding.helperAddress,
        encodeFunctionData({ abi: helperAbi, functionName: "adapter" }),
      ),
      call(
        input.binding.helperAddress,
        encodeFunctionData({ abi: helperAbi, functionName: "permit2" }),
      ),
      call(input.quote.tokenIn, allowanceCall),
      call(input.quote.tokenIn, inputBalanceCall),
      call(input.quote.tokenOut, outputBalanceCall),
      call(
        input.binding.permit2Address,
        encodeFunctionData({ abi: permit2Abi, functionName: "DOMAIN_SEPARATOR" }),
      ),
      call(input.binding.permit2Address, permit2AllowanceCall),
      Promise.all(
        this.#providers.map(async (provider) => {
          const [latest, pending] = await Promise.all([
            provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "latest"]),
            provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "pending"]),
          ]);
          return {
            latest: quantity(latest, "LATEST_NONCE").toString(),
            pending: quantity(pending, "PENDING_NONCE").toString(),
            providerId: provider.providerId,
          };
        }),
      ),
    ]);
    const decodeUint = (data: unknown, label: string) =>
      decodeAbiParameters([{ type: "uint256" }], bytes(data, `${label}_RESULT`))[0];
    const [, , permitNonce] = decodeFunctionResult({
      abi: permit2Abi,
      data: bytes(permit2Allowance, "PERMIT2_ALLOWANCE_RESULT"),
      functionName: "allowance",
    });
    return {
      allowanceBaseUnit: decodeUint(allowance, "ALLOWANCE").toString(),
      blockHash: block.hash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      blockTimestamp: new Date(
        Number(quantity(block.timestamp, "BLOCK_TIMESTAMP")) * 1_000,
      ).toISOString(),
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: codeHash(bytes(componentCodes[index], `${role.toUpperCase()}_CODE`)),
      })),
      helper: {
        adapter: addressResult(helperAdapter, "adapter"),
        codeHash: codeHash(bytes(helperCode, "HELPER_CODE")),
        owner: addressResult(helperOwner, "owner"),
        permit2: addressResult(helperPermit2, "permit2"),
      },
      nonceViews,
      ownerInputBalanceBaseUnit: decodeUint(inputBalance, "INPUT_BALANCE").toString(),
      ownerOutputBalanceBaseUnit: decodeUint(outputBalance, "OUTPUT_BALANCE").toString(),
      permit2: {
        domainSeparator: decodeFunctionResult({
          abi: permit2Abi,
          data: bytes(permit2Domain, "PERMIT2_DOMAIN_RESULT"),
          functionName: "DOMAIN_SEPARATOR",
        }),
        nonce: permitNonce.toString(),
      },
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(bytes(tokenCodes[index], "TOKEN_CODE")),
      })),
    };
  }
}
