import type { HelperDeploymentFeeLimit } from "@lpbot/api-contract";
import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  type HelperDeploymentRegistry,
} from "@lpbot/chain-registry";
import { keccak256, toHex, type Hex } from "viem";

import type {
  HelperDeploymentChainReader,
  HelperDeploymentInspection,
} from "./helper-deployments.js";

interface RpcBlock {
  baseFeePerGas?: Hex | null;
  hash: Hex;
  number: Hex;
  timestamp: Hex;
}

export interface ViemLocalHelperDeploymentChainReaderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: HelperDeploymentRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_HELPER_${label}_INVALID`);
  }
  return BigInt(value);
}

function code(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_HELPER_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: Hex): `0x${string}` | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalHelperDeploymentChainReader implements HelperDeploymentChainReader {
  readonly #chainId: 31_337;
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: HelperDeploymentRegistry;

  constructor(options: ViemLocalHelperDeploymentChainReaderOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_CHAIN_ID_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_PROVIDER_COUNT_INVALID");
    }
    this.#chainId = options.chainId;
    this.#registry = options.registry ?? P05_HELPER_DEPLOYMENT_REGISTRY;
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
  }

  async nonceSnapshot(input: { chainId: 31_337; walletAddress: `0x${string}` }) {
    this.#assertChain(input.chainId);
    const primary = this.#providers[0]!;
    const [block, views] = await Promise.all([
      primary.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]),
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
    const blockNumber = quantity(block.number, "BLOCK_NUMBER");
    const timestamp = quantity(block.timestamp, "BLOCK_TIMESTAMP");
    if (!/^0x[0-9a-f]{64}$/iu.test(block.hash)) {
      throw new Error("LOCAL_HELPER_BLOCK_HASH_INVALID");
    }
    return {
      blockHash: block.hash.toLowerCase() as `0x${string}`,
      blockNumber: blockNumber.toString(),
      blockTimestamp: new Date(Number(timestamp) * 1_000).toISOString(),
      chainId: this.#chainId,
      views,
    };
  }

  async inspectDeployment(input: {
    blockNumber: string;
    chainId: 31_337;
    expectedAddress: `0x${string}`;
    initCode: Hex;
    walletAddress: `0x${string}`;
  }): Promise<HelperDeploymentInspection> {
    this.#assertChain(input.chainId);
    const provider = this.#providers[0]!;
    const blockTag = toHex(BigInt(input.blockNumber));
    const componentCodes = await Promise.all(
      this.#registry.components.map(({ address }) =>
        provider.request<Hex>("eth_getCode", [address, blockTag]),
      ),
    );
    const tokenCodes = await Promise.all(
      this.#registry.tokens.map(({ address }) =>
        provider.request<Hex>("eth_getCode", [address, blockTag]),
      ),
    );
    const [addressCode, simulatedRuntime, estimatedGas, block, priority] = await Promise.all([
      provider.request<Hex>("eth_getCode", [input.expectedAddress, blockTag]),
      provider.request<Hex>("eth_call", [
        { data: input.initCode, from: input.walletAddress, value: "0x0" },
        blockTag,
      ]),
      provider.request<Hex>("eth_estimateGas", [
        { data: input.initCode, from: input.walletAddress, value: "0x0" },
        blockTag,
      ]),
      provider.request<RpcBlock>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_maxPriorityFeePerGas", []),
    ]);
    const runtime = code(simulatedRuntime, "SIMULATED_RUNTIME");
    if (runtime === "0x") throw new Error("LOCAL_HELPER_SIMULATED_RUNTIME_EMPTY");
    const gasEstimate = quantity(estimatedGas, "GAS_ESTIMATE");
    const gasLimit = (gasEstimate * 120n + 99n) / 100n;
    const baseFee = quantity(block.baseFeePerGas, "BASE_FEE");
    const priorityFee = quantity(priority, "PRIORITY_FEE");
    const maxFee = baseFee * 2n + priorityFee;
    const fees: HelperDeploymentFeeLimit = {
      feeCapBaseUnit: (gasLimit * maxFee).toString(),
      gasLimit: gasLimit.toString(),
      maxFeePerGasBaseUnit: maxFee.toString(),
      maxPriorityFeePerGasBaseUnit: priorityFee.toString(),
    };
    return {
      componentCode: this.#registry.components.map(({ address, role }, index) => ({
        address,
        role,
        runtimeCodeHash: codeHash(code(componentCodes[index], `${role.toUpperCase()}_CODE`)),
      })),
      expectedAddressCode: code(addressCode, "EXPECTED_ADDRESS_CODE"),
      expectedRuntimeCodeHash: keccak256(runtime),
      feeLimit: fees,
      tokenCode: this.#registry.tokens.map(({ address }, index) => ({
        address,
        runtimeCodeHash: codeHash(code(tokenCodes[index], "TOKEN_CODE")),
      })),
    };
  }

  #assertChain(chainId: number): void {
    if (chainId !== this.#chainId) throw new Error("LOCAL_HELPER_CHAIN_MISMATCH");
  }
}
