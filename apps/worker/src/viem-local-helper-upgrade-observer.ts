import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  validateLocalHelperUpgradeRegistry,
  type LocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import {
  localHelperUpgradeSelectorSetHash,
  type LocalHelperUpgradePlan,
  type WalletHelperV2Verification,
} from "@lpbot/domain/local-helper-upgrade";
import { decodeFunctionResult, encodeFunctionData, keccak256, type Address, type Hex } from "viem";

import type {
  LocalHelperUpgradeObservation,
  LocalHelperUpgradeObserver,
  LocalHelperUpgradeReceiptObservation,
} from "./local-helper-upgrade-worker.js";

interface RpcBlock {
  hash: Hex;
  number: Hex;
}

interface RpcReceipt {
  blockHash: Hex;
  blockNumber: Hex;
  contractAddress: Address | null;
  status: Hex;
  transactionHash: Hex;
}

interface RpcTransaction {
  from: Address;
  hash: Hex;
  input: Hex;
  nonce: Hex;
  to: Address | null;
  value: Hex;
}

const helperReadAbi = [
  {
    inputs: [],
    name: "ATOMIC_LIQUIDITY_EXECUTION_ENABLED",
    outputs: [{ type: "bool" }],
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
    name: "allowedTokenA",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "allowedTokenACodeHash",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "allowedTokenB",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "allowedTokenBCodeHash",
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
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

type GetterName = (typeof helperReadAbi)[number]["name"];

export interface ViemLocalHelperUpgradeObserverOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  registry?: LocalHelperUpgradeRegistry;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function code(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function runtimeHash(value: Hex): Hex | null {
  return value === "0x" ? null : keccak256(value);
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_ADDRESS_INVALID");
  }
  return value.toLowerCase() as Address;
}

export class ViemLocalHelperUpgradeObserver implements LocalHelperUpgradeObserver {
  readonly #providers: readonly LocalEvmRpcClient[];
  readonly #registry: LocalHelperUpgradeRegistry;

  constructor(options: ViemLocalHelperUpgradeObserverOptions) {
    if (options.chainId !== 31_337) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_OBSERVER_CHAIN_INVALID");
    }
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_OBSERVER_PROVIDER_COUNT_INVALID");
    }
    const ids = new Set(options.providers.map(({ providerId }) => providerId));
    if (ids.size !== options.providers.length) {
      throw new RangeError("LOCAL_HELPER_UPGRADE_OBSERVER_PROVIDER_DUPLICATE");
    }
    this.#registry = validateLocalHelperUpgradeRegistry(
      options.registry ?? P05_LOCAL_HELPER_UPGRADE_REGISTRY,
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

  async observeDeployment(input: {
    plan: LocalHelperUpgradePlan;
    transactionHash: `0x${string}`;
  }): Promise<LocalHelperUpgradeObservation> {
    if (input.plan.chainId !== 31_337 || !/^0x[0-9a-f]{64}$/u.test(input.transactionHash)) {
      throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_INPUT_INVALID");
    }
    return {
      providers: await Promise.all(
        this.#providers.map(async (provider) => {
          const [latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
            provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "latest"]),
            provider.request<Hex>("eth_getTransactionCount", [
              input.plan.wallet.address,
              "pending",
            ]),
            provider.request<RpcTransaction | null>("eth_getTransactionByHash", [
              input.transactionHash,
            ]),
            provider.request<RpcReceipt | null>("eth_getTransactionReceipt", [
              input.transactionHash,
            ]),
          ]);
          return {
            latestNonce: quantity(latestNonce).toString(),
            pendingNonce: quantity(pendingNonce).toString(),
            providerId: provider.providerId,
            receipt: receipt
              ? await this.#receipt(
                  provider,
                  input.plan,
                  input.transactionHash,
                  transaction,
                  receipt,
                )
              : null,
            transactionFound: transaction !== null,
          };
        }),
      ),
    };
  }

  async verifyV2(input: { plan: LocalHelperUpgradePlan }): Promise<WalletHelperV2Verification> {
    const observations = await Promise.all(
      this.#providers.map((provider) => this.#verifyProvider(provider, input.plan)),
    );
    const encoded = new Set(observations.map((observation) => JSON.stringify(observation)));
    if (encoded.size !== 1) {
      throw new Error("LOCAL_HELPER_UPGRADE_VERIFY_PROVIDER_DIVERGENCE");
    }
    return observations[0]!;
  }

  async #receipt(
    provider: LocalEvmRpcClient,
    plan: LocalHelperUpgradePlan,
    transactionHash: `0x${string}`,
    transaction: RpcTransaction | null,
    receipt: RpcReceipt,
  ): Promise<LocalHelperUpgradeReceiptObservation> {
    const blockNumber = quantity(receipt.blockNumber);
    const blockTag = `0x${blockNumber.toString(16)}` as Hex;
    const [canonicalBlock, latestBlock, runtime] = await Promise.all([
      provider.request<RpcBlock>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
      receipt.contractAddress
        ? provider.request<Hex>("eth_getCode", [receipt.contractAddress, blockTag])
        : Promise.resolve("0x" as Hex),
    ]);
    const latest = quantity(latestBlock);
    if (latest < blockNumber || receipt.transactionHash.toLowerCase() !== transactionHash) {
      throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_RECEIPT_INVALID");
    }
    const status = quantity(receipt.status);
    if (status !== 0n && status !== 1n) {
      throw new Error("LOCAL_HELPER_UPGRADE_OBSERVER_RECEIPT_INVALID");
    }
    const contractAddress = receipt.contractAddress ? address(receipt.contractAddress) : null;
    return {
      blockCanonical: canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase(),
      blockHash: receipt.blockHash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      confirmations: (latest - blockNumber + 1n).toString(),
      contractAddress,
      receiptStatus: status === 1n ? "success" : "reverted",
      runtimeCodeHash: runtimeHash(code(runtime)),
      transactionHash: transactionHash.toLowerCase() as Hex,
      transactionReconciled:
        transaction !== null &&
        transaction.hash.toLowerCase() === transactionHash &&
        transaction.from.toLowerCase() === plan.wallet.address &&
        quantity(transaction.nonce).toString() === plan.nonce &&
        transaction.to === null &&
        quantity(transaction.value) === 0n &&
        transaction.input.toLowerCase() === plan.transaction.data,
    };
  }

  async #verifyProvider(
    provider: LocalEvmRpcClient,
    plan: LocalHelperUpgradePlan,
  ): Promise<WalletHelperV2Verification> {
    const latest = await provider.request<RpcBlock>("eth_getBlockByNumber", ["latest", false]);
    const blockNumber = quantity(latest.number);
    const blockTag = `0x${blockNumber.toString(16)}` as Hex;
    const read = async (name: GetterName): Promise<Hex> =>
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({ abi: helperReadAbi, functionName: name }),
          to: plan.target.expectedAddress,
        },
        blockTag,
      ]);
    const [
      runtime,
      ownerRaw,
      adapterRaw,
      permit2Raw,
      tokenARaw,
      tokenAHashRaw,
      tokenBRaw,
      tokenBHashRaw,
      atomicRaw,
      componentCodes,
      tokenCodes,
    ] = await Promise.all([
      provider.request<Hex>("eth_getCode", [plan.target.expectedAddress, blockTag]),
      read("owner"),
      read("adapter"),
      read("permit2"),
      read("allowedTokenA"),
      read("allowedTokenACodeHash"),
      read("allowedTokenB"),
      read("allowedTokenBCodeHash"),
      read("ATOMIC_LIQUIDITY_EXECUTION_ENABLED"),
      Promise.all(
        P05_HELPER_DEPLOYMENT_REGISTRY.components.map(({ address: componentAddress }) =>
          provider.request<Hex>("eth_getCode", [componentAddress, blockTag]),
        ),
      ),
      Promise.all(
        P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address: tokenAddress }) =>
          provider.request<Hex>("eth_getCode", [tokenAddress, blockTag]),
        ),
      ),
    ]);
    const componentsMatch = P05_HELPER_DEPLOYMENT_REGISTRY.components.every(
      (component, index) => runtimeHash(code(componentCodes[index])) === component.runtimeCodeHash,
    );
    const tokensMatch = P05_HELPER_DEPLOYMENT_REGISTRY.tokens.every(
      (token, index) => runtimeHash(code(tokenCodes[index])) === token.runtimeCodeHash,
    );
    if (!componentsMatch || !tokensMatch) {
      throw new Error("LOCAL_HELPER_UPGRADE_SYNTHETIC_IDENTITY_MISMATCH");
    }
    const owner = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(ownerRaw),
      functionName: "owner",
    });
    const adapter = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(adapterRaw),
      functionName: "adapter",
    });
    const permit2 = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(permit2Raw),
      functionName: "permit2",
    });
    const tokenA = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(tokenARaw),
      functionName: "allowedTokenA",
    });
    const tokenAHash = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(tokenAHashRaw),
      functionName: "allowedTokenACodeHash",
    });
    const tokenB = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(tokenBRaw),
      functionName: "allowedTokenB",
    });
    const tokenBHash = decodeFunctionResult({
      abi: helperReadAbi,
      data: code(tokenBHashRaw),
      functionName: "allowedTokenBCodeHash",
    });
    if (
      tokenAHash !== plan.target.tokenA.runtimeCodeHash ||
      tokenBHash !== plan.target.tokenB.runtimeCodeHash
    ) {
      throw new Error("LOCAL_HELPER_UPGRADE_TOKEN_IDENTITY_MISMATCH");
    }
    return {
      abiHash: this.#registry.target.abiHash,
      adapter: address(adapter),
      atomicLiquidityExecutionEnabled: decodeFunctionResult({
        abi: helperReadAbi,
        data: code(atomicRaw),
        functionName: "ATOMIC_LIQUIDITY_EXECUTION_ENABLED",
      }),
      blockHash: latest.hash.toLowerCase() as Hex,
      helperAddress: plan.target.expectedAddress,
      observedAtBlock: blockNumber.toString(),
      owner: address(owner),
      permit2: address(permit2),
      runtimeCodeHash: runtimeHash(code(runtime)),
      selectorSetHash: localHelperUpgradeSelectorSetHash(this.#registry.target.selectors),
      tokenA: { address: address(tokenA), runtimeCodeHash: runtimeHash(code(tokenCodes[0])) },
      tokenB: { address: address(tokenB), runtimeCodeHash: runtimeHash(code(tokenCodes[1])) },
    };
  }
}
