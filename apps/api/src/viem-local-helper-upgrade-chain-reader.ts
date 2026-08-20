import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  type LocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import { decodeFunctionResult, encodeFunctionData, keccak256, toHex, type Hex } from "viem";

import type {
  LocalHelperUpgradeChainInspection,
  LocalHelperUpgradeChainReader,
} from "./local-helper-upgrades.js";

interface RpcBlock {
  baseFeePerGas?: Hex | null;
  hash: Hex;
  number: Hex;
}

const addressGetterAbi = [
  {
    inputs: [],
    name: "owner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "adapter",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "permit2",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface ViemLocalHelperUpgradeChainReaderOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: LocalHelperUpgradeRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, code: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) throw new Error(code);
  return BigInt(value);
}

function code(value: unknown, codeValue: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(codeValue);
  }
  return value.toLowerCase() as Hex;
}

function block(value: RpcBlock): { hash: `0x${string}`; number: string } {
  if (!/^0x[0-9a-f]{64}$/iu.test(value.hash)) {
    throw new Error("LOCAL_HELPER_UPGRADE_BLOCK_INVALID");
  }
  return {
    hash: value.hash.toLowerCase() as `0x${string}`,
    number: quantity(value.number, "LOCAL_HELPER_UPGRADE_BLOCK_INVALID").toString(),
  };
}

function runtimeHash(value: Hex): `0x${string}` | null {
  return value === "0x" ? null : keccak256(value);
}

export class ViemLocalHelperUpgradeChainReader implements LocalHelperUpgradeChainReader {
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: LocalHelperUpgradeRegistry;

  constructor(options: ViemLocalHelperUpgradeChainReaderOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_UPGRADE_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_PROVIDER_COUNT_INVALID");
    }
    this.#registry = options.registry ?? P05_LOCAL_HELPER_UPGRADE_REGISTRY;
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

  async nonceSnapshot(input: { chainId: 31_337; walletAddress: `0x${string}` }) {
    if (input.chainId !== 31_337) throw new Error("LOCAL_HELPER_UPGRADE_CHAIN_MISMATCH");
    return Promise.all(
      this.#providers.map(async (provider) => {
        const [latestBlock, latestNonce, pendingNonce] = await Promise.all([
          provider.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]),
          provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "latest"]),
          provider.request<Hex>("eth_getTransactionCount", [input.walletAddress, "pending"]),
        ]);
        const canonicalBlock = block(latestBlock);
        return {
          blockHash: canonicalBlock.hash,
          blockNumber: canonicalBlock.number,
          latestNonce: quantity(
            latestNonce,
            "LOCAL_HELPER_UPGRADE_LATEST_NONCE_INVALID",
          ).toString(),
          pendingNonce: quantity(
            pendingNonce,
            "LOCAL_HELPER_UPGRADE_PENDING_NONCE_INVALID",
          ).toString(),
          providerId: provider.providerId,
        };
      }),
    );
  }

  async inspect(input: Parameters<LocalHelperUpgradeChainReader["inspect"]>[0]) {
    const provider = this.#providers[0]!;
    const blockTag = toHex(BigInt(input.blockNumber));
    const addressCall = async (name: "adapter" | "owner" | "permit2") => {
      const data = encodeFunctionData({ abi: addressGetterAbi, functionName: name });
      const result = await provider.request<Hex>("eth_call", [
        { data, to: input.binding.helperAddress },
        blockTag,
      ]);
      return decodeFunctionResult({
        abi: addressGetterAbi,
        data: code(result, "CALL_INVALID"),
        functionName: name,
      }).toLowerCase() as `0x${string}`;
    };
    const componentReads = P05_HELPER_DEPLOYMENT_REGISTRY.components.map(({ address }) =>
      provider.request<Hex>("eth_getCode", [address, blockTag]),
    );
    const tokenReads = P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address }) =>
      provider.request<Hex>("eth_getCode", [address, blockTag]),
    );
    const [
      expectedAddressCode,
      simulatedRuntime,
      estimatedGas,
      rpcBlock,
      priorityFee,
      sourceCode,
      owner,
      adapter,
      permit2,
      componentCodes,
      tokenCodes,
    ] = await Promise.all([
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
      provider.request<Hex>("eth_getCode", [input.binding.helperAddress, blockTag]),
      addressCall("owner"),
      addressCall("adapter"),
      addressCall("permit2"),
      Promise.all(componentReads),
      Promise.all(tokenReads),
    ]);
    const runtime = code(simulatedRuntime, "LOCAL_HELPER_UPGRADE_SIMULATED_RUNTIME_INVALID");
    if (runtime === "0x") throw new Error("LOCAL_HELPER_UPGRADE_SIMULATED_RUNTIME_EMPTY");
    const gasLimit =
      (quantity(estimatedGas, "LOCAL_HELPER_UPGRADE_GAS_INVALID") * 120n + 99n) / 100n;
    const baseFee = quantity(rpcBlock.baseFeePerGas, "LOCAL_HELPER_UPGRADE_BASE_FEE_INVALID");
    const priority = quantity(priorityFee, "LOCAL_HELPER_UPGRADE_PRIORITY_FEE_INVALID");
    const maxFee = baseFee * 2n + priority;
    const sourceRuntimeHash = runtimeHash(
      code(sourceCode, "LOCAL_HELPER_UPGRADE_SOURCE_CODE_INVALID"),
    );
    const componentsMatch = P05_HELPER_DEPLOYMENT_REGISTRY.components.every(
      (expected, index) =>
        runtimeHash(code(componentCodes[index], "LOCAL_HELPER_UPGRADE_COMPONENT_CODE_INVALID")) ===
        expected.runtimeCodeHash,
    );
    const tokensMatch = P05_HELPER_DEPLOYMENT_REGISTRY.tokens.every(
      (expected, index) =>
        runtimeHash(code(tokenCodes[index], "LOCAL_HELPER_UPGRADE_TOKEN_CODE_INVALID")) ===
        expected.runtimeCodeHash,
    );
    return {
      expectedAddressCode: code(expectedAddressCode, "LOCAL_HELPER_UPGRADE_TARGET_CODE_INVALID"),
      expectedRuntimeCodeHash: keccak256(runtime),
      feeLimit: {
        feeCapBaseUnit: (gasLimit * maxFee).toString(),
        gasLimit: gasLimit.toString(),
        maxFeePerGasBaseUnit: maxFee.toString(),
        maxPriorityFeePerGasBaseUnit: priority.toString(),
      },
      sourceIdentity: {
        bindingMatches:
          input.binding.helperVersion === "WalletHelperV1" &&
          input.binding.deploymentRegistryVersion ===
            this.#registry.source.bindingRegistryVersion &&
          adapter === input.binding.adapterAddress &&
          permit2 === input.binding.permit2Address,
        observedOwner: owner,
        observedRuntimeCodeHash: sourceRuntimeHash,
        ownerMatches: owner === input.binding.ownerAddress,
        registryMatches:
          componentsMatch &&
          tokensMatch &&
          adapter === P05_HELPER_DEPLOYMENT_REGISTRY.components[0]!.address &&
          permit2 === P05_HELPER_DEPLOYMENT_REGISTRY.components[1]!.address,
        runtimeMatches: sourceRuntimeHash === input.binding.runtimeCodeHash,
      },
    } satisfies LocalHelperUpgradeChainInspection;
  }
}
