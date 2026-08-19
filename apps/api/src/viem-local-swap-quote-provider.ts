import { randomUUID } from "node:crypto";

import {
  LocalEvmRpcClient,
  type LocalEvmRpcClientOptions,
  type LocalSwapQuoteInput,
  type LocalSwapQuoteProvider,
  type LocalSwapQuoteSnapshot,
} from "@lpbot/chain-adapters";
import {
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
  type LocalSwapExecutionRegistry,
} from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

const routerAbi = parseAbi(["function amountOutBps() view returns (uint256)"]);
const helperAbi = parseAbi([
  "function adapter() view returns (address)",
  "function owner() view returns (address)",
  "function permit2() view returns (address)",
]);

interface RpcBlock {
  baseFeePerGas?: Hex | null;
  hash: Hex;
  number: Hex;
  timestamp: Hex;
}

export interface ViemLocalSwapQuoteProviderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  gasLimit?: string;
  provider: Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">;
  registry?: LocalSwapExecutionRegistry;
  timeoutMilliseconds?: number;
  uuid?: () => string;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_QUOTE_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_QUOTE_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function runtimeCodeHash(value: Hex): Hex | null {
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

export class ViemLocalSwapQuoteProvider implements LocalSwapQuoteProvider {
  readonly #client: LocalEvmRpcClient;
  readonly #gasLimit: string;
  readonly #registry: LocalSwapExecutionRegistry;
  readonly #uuid: () => string;

  constructor(options: ViemLocalSwapQuoteProviderOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_SWAP_QUOTE_CHAIN_INVALID");
    const gasLimit = options.gasLimit ?? "500000";
    if (!/^[1-9][0-9]*$/u.test(gasLimit) || BigInt(gasLimit) > 1_500_000n) {
      throw new RangeError("LOCAL_SWAP_QUOTE_GAS_LIMIT_INVALID");
    }
    this.#client = new LocalEvmRpcClient({
      expectedChainId: options.chainId,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...options.provider,
      ...(options.timeoutMilliseconds ? { timeoutMilliseconds: options.timeoutMilliseconds } : {}),
    });
    this.#gasLimit = gasLimit;
    this.#registry = validateLocalSwapExecutionRegistry(
      options.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
    this.#uuid = options.uuid ?? randomUUID;
  }

  async inspect(input: LocalSwapQuoteInput): Promise<LocalSwapQuoteSnapshot> {
    if (input.chainId !== 31_337) throw new Error("LOCAL_SWAP_QUOTE_CHAIN_MISMATCH");
    const block = await this.#client.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    const blockNumber = quantity(block.number, "BLOCK_NUMBER");
    const blockTag = toHex(blockNumber);
    if (!/^0x[0-9a-f]{64}$/iu.test(block.hash)) {
      throw new Error("LOCAL_SWAP_QUOTE_BLOCK_HASH_INVALID");
    }
    const router = this.#registry.components.find(({ role }) => role === "router")!;
    const componentCodePromise = Promise.all(
      this.#registry.components.map(({ address }) =>
        this.#client.request<Hex>("eth_getCode", [address, blockTag]),
      ),
    );
    const tokenCodePromise = Promise.all(
      this.#registry.tokens.map(({ address }) =>
        this.#client.request<Hex>("eth_getCode", [address, blockTag]),
      ),
    );
    const call = (to: Address, data: Hex) =>
      this.#client.request<Hex>("eth_call", [{ data, to }, blockTag]);
    const [
      componentCodes,
      tokenCodes,
      helperCode,
      owner,
      adapter,
      permit2,
      amountOutBpsResult,
      priorityResult,
    ] = await Promise.all([
      componentCodePromise,
      tokenCodePromise,
      this.#client.request<Hex>("eth_getCode", [input.helper.address, blockTag]),
      call(input.helper.address, encodeFunctionData({ abi: helperAbi, functionName: "owner" })),
      call(input.helper.address, encodeFunctionData({ abi: helperAbi, functionName: "adapter" })),
      call(input.helper.address, encodeFunctionData({ abi: helperAbi, functionName: "permit2" })),
      call(router.address, encodeFunctionData({ abi: routerAbi, functionName: "amountOutBps" })),
      this.#client.request<Hex>("eth_maxPriorityFeePerGas", []),
    ]);
    const amountOutBps = decodeFunctionResult({
      abi: routerAbi,
      data: bytes(amountOutBpsResult, "ROUTER_RATE_RESULT"),
      functionName: "amountOutBps",
    });
    if (amountOutBps > 20_000n) throw new Error("LOCAL_SWAP_QUOTE_ROUTER_RATE_INVALID");
    const baseFee = quantity(block.baseFeePerGas, "BASE_FEE");
    const priorityFee = quantity(priorityResult, "PRIORITY_FEE");
    return {
      amountOutBaseUnit: ((BigInt(input.amountInBaseUnit) * amountOutBps) / 10_000n).toString(),
      blockHash: block.hash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      blockTimestamp: new Date(
        Number(quantity(block.timestamp, "BLOCK_TIMESTAMP")) * 1_000,
      ).toISOString(),
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: runtimeCodeHash(
          bytes(componentCodes[index], `${role.toUpperCase()}_CODE`),
        ),
      })),
      gasLimit: this.#gasLimit,
      helper: {
        adapter: addressResult(adapter, "adapter"),
        codeHash: runtimeCodeHash(bytes(helperCode, "HELPER_CODE")),
        owner: addressResult(owner, "owner"),
        permit2: addressResult(permit2, "permit2"),
      },
      maxFeePerGasBaseUnit: (baseFee * 2n + priorityFee).toString(),
      maxPriorityFeePerGasBaseUnit: priorityFee.toString(),
      providerSnapshotId: this.#uuid().toLowerCase(),
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: runtimeCodeHash(bytes(tokenCodes[index], "TOKEN_CODE")),
      })),
    };
  }
}
