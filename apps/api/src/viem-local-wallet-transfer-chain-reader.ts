import type { EvmAddress, WalletTransferAsset } from "@lpbot/api-contract";
import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import { canonicalBaseUnit, canonicalTransferAddress } from "@lpbot/domain/wallet-transfer";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toHex,
  type Hex,
} from "viem";

import type {
  WalletTransferAssetDefinition,
  WalletTransferChainReader,
} from "./wallet-transfers.js";

const erc20ReadAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

interface FeeBlock {
  baseFeePerGas?: Hex | null;
}

export interface ViemLocalWalletTransferChainReaderOptions {
  chainId: number;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_EVM_${label}_INVALID`);
  }
  return BigInt(value);
}

function callData(asset: WalletTransferAsset, recipient: EvmAddress, amountBaseUnit: string): Hex {
  return asset.kind === "native"
    ? "0x"
    : encodeFunctionData({
        abi: erc20ReadAbi,
        args: [
          getAddress(recipient),
          BigInt(canonicalBaseUnit(amountBaseUnit, { positive: true })),
        ],
        functionName: "transfer",
      });
}

export class ViemLocalWalletTransferChainReader implements WalletTransferChainReader {
  readonly #chainId: number;
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalWalletTransferChainReaderOptions) {
    if (!Number.isSafeInteger(options.chainId) || options.chainId < 1) {
      throw new RangeError("LOCAL_EVM_CHAIN_ID_INVALID");
    }
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_EVM_PROVIDER_COUNT_INVALID");
    }
    this.#chainId = options.chainId;
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

  async estimateFee(input: {
    amountBaseUnit: string;
    asset: WalletTransferAsset;
    chainId: number;
    recipient: EvmAddress;
    walletAddress: EvmAddress;
  }) {
    this.#assertChain(input.chainId);
    const client = this.#providers[0]!;
    const data = callData(input.asset, input.recipient, input.amountBaseUnit);
    const target = input.asset.kind === "native" ? input.recipient : input.asset.tokenAddress;
    const value = input.asset.kind === "native" ? toHex(BigInt(input.amountBaseUnit)) : "0x0";
    const [gas, block, priority] = await Promise.all([
      client.request<Hex>("eth_estimateGas", [
        {
          data,
          from: canonicalTransferAddress(input.walletAddress),
          to: canonicalTransferAddress(target),
          value,
        },
      ]),
      client.request<FeeBlock>("eth_getBlockByNumber", ["latest", false]),
      client.request<Hex>("eth_maxPriorityFeePerGas", []),
    ]);
    const gasLimit = quantity(gas, "GAS_LIMIT");
    const baseFee = quantity(block.baseFeePerGas, "BASE_FEE");
    const priorityFee = quantity(priority, "PRIORITY_FEE");
    const maxFee = baseFee * 2n + priorityFee;
    return {
      feeCapBaseUnit: (gasLimit * maxFee).toString(),
      gasLimit: gasLimit.toString(),
      maxFeePerGasBaseUnit: maxFee.toString(),
      maxPriorityFeePerGasBaseUnit: priorityFee.toString(),
    };
  }

  async nonceViews(input: { chainId: number; walletAddress: EvmAddress }) {
    this.#assertChain(input.chainId);
    const address = canonicalTransferAddress(input.walletAddress);
    return Promise.all(
      this.#providers.map(async (provider) => {
        const [latest, pending] = await Promise.all([
          provider.request<Hex>("eth_getTransactionCount", [address, "latest"]),
          provider.request<Hex>("eth_getTransactionCount", [address, "pending"]),
        ]);
        return {
          latest: quantity(latest, "LATEST_NONCE").toString(),
          pending: quantity(pending, "PENDING_NONCE").toString(),
          providerId: provider.providerId,
        };
      }),
    );
  }

  async readAssetState(input: {
    asset: WalletTransferAsset;
    chainId: number;
    tokenDefinition: WalletTransferAssetDefinition | null;
    walletAddress: EvmAddress;
  }) {
    this.#assertChain(input.chainId);
    const client = this.#providers[0]!;
    const walletAddress = canonicalTransferAddress(input.walletAddress);
    const [nativeBalance, blockNumber] = await Promise.all([
      client.request<Hex>("eth_getBalance", [walletAddress, "latest"]),
      client.request<Hex>("eth_blockNumber", []),
    ]);
    const nativeBalanceBaseUnit = quantity(nativeBalance, "NATIVE_BALANCE").toString();
    if (input.asset.kind === "native") {
      return {
        assetBalanceBaseUnit: nativeBalanceBaseUnit,
        blockNumber: quantity(blockNumber, "BLOCK_NUMBER").toString(),
        nativeBalanceBaseUnit,
        tokenCodePresent: true,
        tokenMetadataMatches: true,
      };
    }
    if (!input.tokenDefinition) throw new Error("LOCAL_EVM_TOKEN_DEFINITION_MISSING");
    const tokenAddress = canonicalTransferAddress(input.asset.tokenAddress);
    const calls = {
      balance: encodeFunctionData({
        abi: erc20ReadAbi,
        args: [getAddress(walletAddress)],
        functionName: "balanceOf",
      }),
      decimals: encodeFunctionData({ abi: erc20ReadAbi, functionName: "decimals" }),
      name: encodeFunctionData({ abi: erc20ReadAbi, functionName: "name" }),
      symbol: encodeFunctionData({ abi: erc20ReadAbi, functionName: "symbol" }),
    } as const;
    const [code, balanceResult, decimalsResult, nameResult, symbolResult] = await Promise.all([
      client.request<Hex>("eth_getCode", [tokenAddress, "latest"]),
      client.request<Hex>("eth_call", [{ data: calls.balance, to: tokenAddress }, "latest"]),
      client.request<Hex>("eth_call", [{ data: calls.decimals, to: tokenAddress }, "latest"]),
      client.request<Hex>("eth_call", [{ data: calls.name, to: tokenAddress }, "latest"]),
      client.request<Hex>("eth_call", [{ data: calls.symbol, to: tokenAddress }, "latest"]),
    ]);
    const balance = decodeFunctionResult({
      abi: erc20ReadAbi,
      data: balanceResult,
      functionName: "balanceOf",
    });
    const decimals = decodeFunctionResult({
      abi: erc20ReadAbi,
      data: decimalsResult,
      functionName: "decimals",
    });
    const name = decodeFunctionResult({
      abi: erc20ReadAbi,
      data: nameResult,
      functionName: "name",
    });
    const symbol = decodeFunctionResult({
      abi: erc20ReadAbi,
      data: symbolResult,
      functionName: "symbol",
    });
    return {
      assetBalanceBaseUnit: balance.toString(),
      blockNumber: quantity(blockNumber, "BLOCK_NUMBER").toString(),
      nativeBalanceBaseUnit,
      tokenCodePresent: code !== "0x",
      tokenMetadataMatches:
        decimals === input.tokenDefinition.decimals &&
        name === input.tokenDefinition.name &&
        symbol === input.tokenDefinition.symbol,
    };
  }

  #assertChain(chainId: number): void {
    if (chainId !== this.#chainId) throw new Error("LOCAL_EVM_CHAIN_MISMATCH");
  }
}
