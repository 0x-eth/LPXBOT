import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import { canonicalTransferAddress, transferHashPattern } from "@lpbot/domain/wallet-transfer";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toHex,
  type Hex,
} from "viem";

import type {
  WalletTransferObservation,
  WalletTransferObserver,
  WalletTransferProviderObservation,
} from "./wallet-transfer-worker.js";

const erc20EvidenceAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);

interface RpcTransaction {
  from: Hex;
  hash: Hex;
  input: Hex;
  nonce: Hex;
  to: Hex | null;
  value: Hex;
}

interface RpcReceiptLog {
  address: Hex;
  data: Hex;
  removed?: boolean;
  topics: Hex[];
}

interface RpcReceipt {
  blockHash: Hex;
  blockNumber: Hex;
  effectiveGasPrice: Hex;
  from: Hex;
  gasUsed: Hex;
  logs: RpcReceiptLog[];
  status: Hex;
  to: Hex | null;
  transactionHash: Hex;
  transactionIndex: Hex;
}

interface RpcBlock {
  hash: Hex;
}

export interface ViemLocalWalletTransferObserverOptions {
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

function positiveDelta(before: bigint, after: bigint): bigint | null {
  return before >= after ? before - after : null;
}

function gain(before: bigint, after: bigint): bigint | null {
  return after >= before ? after - before : null;
}

export class ViemLocalWalletTransferObserver implements WalletTransferObserver {
  readonly #chainId: number;
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalWalletTransferObserverOptions) {
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

  async observe(input: {
    plan: Parameters<WalletTransferObserver["observe"]>[0]["plan"];
    transactionHash: `0x${string}`;
  }): Promise<WalletTransferObservation> {
    if (input.plan.chainId !== this.#chainId || !transferHashPattern.test(input.transactionHash)) {
      throw new Error("LOCAL_EVM_TRANSFER_IDENTITY_INVALID");
    }
    return {
      providers: await Promise.all(
        this.#providers.map((provider) => this.#observeProvider(provider, input)),
      ),
    };
  }

  async #observeProvider(
    provider: LocalEvmRpcClient,
    input: Parameters<WalletTransferObserver["observe"]>[0],
  ): Promise<WalletTransferProviderObservation> {
    const [latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
      provider.request<Hex>("eth_getTransactionCount", [input.plan.walletAddress, "latest"]),
      provider.request<Hex>("eth_getTransactionCount", [input.plan.walletAddress, "pending"]),
      provider.request<RpcTransaction | null>("eth_getTransactionByHash", [input.transactionHash]),
      provider.request<RpcReceipt | null>("eth_getTransactionReceipt", [input.transactionHash]),
    ]);
    if (!receipt) {
      return {
        latestNonce: quantity(latestNonce, "LATEST_NONCE").toString(),
        pendingNonce: quantity(pendingNonce, "PENDING_NONCE").toString(),
        providerId: provider.providerId,
        receipt: null,
        transactionFound: transaction !== null,
      };
    }
    if (!transaction) throw new Error("LOCAL_EVM_RECEIPT_TRANSACTION_MISSING");
    const blockNumber = quantity(receipt.blockNumber, "RECEIPT_BLOCK_NUMBER");
    const block = await provider.request<RpcBlock | null>("eth_getBlockByNumber", [
      toHex(blockNumber),
      false,
    ]);
    const receiptStatus = quantity(receipt.status, "RECEIPT_STATUS") === 1n ? "success" : "reverted";
    const identityMatches =
      transaction.hash.toLowerCase() === input.transactionHash &&
      transaction.input.toLowerCase() === input.plan.transactionData &&
      quantity(transaction.value, "TRANSACTION_VALUE").toString() ===
        input.plan.transactionValueBaseUnit;
    const reconciled =
      receiptStatus === "success"
        ? await this.#reconcileBalancesAndLogs(provider, input.plan, receipt, blockNumber)
        : { balanceReconciled: false, tokenTransferLogReconciled: false };
    return {
      latestNonce: quantity(latestNonce, "LATEST_NONCE").toString(),
      pendingNonce: quantity(pendingNonce, "PENDING_NONCE").toString(),
      providerId: provider.providerId,
      receipt: {
        balanceReconciled: identityMatches && reconciled.balanceReconciled,
        blockCanonical: block?.hash.toLowerCase() === receipt.blockHash.toLowerCase(),
        blockHash: receipt.blockHash.toLowerCase() as `0x${string}`,
        blockNumber: blockNumber.toString(),
        from: canonicalTransferAddress(receipt.from),
        nonce: quantity(transaction.nonce, "TRANSACTION_NONCE").toString(),
        receiptStatus,
        tokenTransferLogReconciled:
          identityMatches && reconciled.tokenTransferLogReconciled,
        transactionHash: receipt.transactionHash.toLowerCase() as `0x${string}`,
        transactionTarget: canonicalTransferAddress(transaction.to),
      },
      transactionFound: true,
    };
  }

  async #reconcileBalancesAndLogs(
    provider: LocalEvmRpcClient,
    plan: Parameters<WalletTransferObserver["observe"]>[0]["plan"],
    receipt: RpcReceipt,
    blockNumber: bigint,
  ): Promise<{ balanceReconciled: boolean; tokenTransferLogReconciled: boolean }> {
    if (blockNumber === 0n || quantity(receipt.transactionIndex, "TRANSACTION_INDEX") !== 0n) {
      return { balanceReconciled: false, tokenTransferLogReconciled: false };
    }
    const beforeTag = toHex(blockNumber - 1n);
    const afterTag = toHex(blockNumber);
    const fee =
      quantity(receipt.gasUsed, "GAS_USED") *
      quantity(receipt.effectiveGasPrice, "EFFECTIVE_GAS_PRICE");
    const amount = BigInt(plan.amountBaseUnit);
    if (plan.asset.kind === "native") {
      const [senderBefore, senderAfter, recipientBefore, recipientAfter] = await Promise.all([
        provider.request<Hex>("eth_getBalance", [plan.walletAddress, beforeTag]),
        provider.request<Hex>("eth_getBalance", [plan.walletAddress, afterTag]),
        provider.request<Hex>("eth_getBalance", [plan.recipient, beforeTag]),
        provider.request<Hex>("eth_getBalance", [plan.recipient, afterTag]),
      ]);
      const senderSpent = positiveDelta(
        quantity(senderBefore, "SENDER_BALANCE_BEFORE"),
        quantity(senderAfter, "SENDER_BALANCE_AFTER"),
      );
      const recipientGain = gain(
        quantity(recipientBefore, "RECIPIENT_BALANCE_BEFORE"),
        quantity(recipientAfter, "RECIPIENT_BALANCE_AFTER"),
      );
      return {
        balanceReconciled: senderSpent === amount + fee && recipientGain === amount,
        tokenTransferLogReconciled: true,
      };
    }
    const balanceOf = (address: `0x${string}`) =>
      encodeFunctionData({
        abi: erc20EvidenceAbi,
        args: [getAddress(address)],
        functionName: "balanceOf",
      });
    const tokenAddress = plan.asset.tokenAddress;
    const [nativeBefore, nativeAfter, senderBefore, senderAfter, recipientBefore, recipientAfter] =
      await Promise.all([
        provider.request<Hex>("eth_getBalance", [plan.walletAddress, beforeTag]),
        provider.request<Hex>("eth_getBalance", [plan.walletAddress, afterTag]),
        provider.request<Hex>("eth_call", [
          { data: balanceOf(plan.walletAddress), to: tokenAddress },
          beforeTag,
        ]),
        provider.request<Hex>("eth_call", [
          { data: balanceOf(plan.walletAddress), to: tokenAddress },
          afterTag,
        ]),
        provider.request<Hex>("eth_call", [
          { data: balanceOf(plan.recipient), to: tokenAddress },
          beforeTag,
        ]),
        provider.request<Hex>("eth_call", [
          { data: balanceOf(plan.recipient), to: tokenAddress },
          afterTag,
        ]),
      ]);
    const decodeBalance = (data: Hex) =>
      decodeFunctionResult({ abi: erc20EvidenceAbi, data, functionName: "balanceOf" });
    const nativeSpent = positiveDelta(
      quantity(nativeBefore, "NATIVE_BALANCE_BEFORE"),
      quantity(nativeAfter, "NATIVE_BALANCE_AFTER"),
    );
    const senderSpent = positiveDelta(decodeBalance(senderBefore), decodeBalance(senderAfter));
    const recipientGain = gain(decodeBalance(recipientBefore), decodeBalance(recipientAfter));
    const transferLog = receipt.logs.some((log) => {
      if (log.removed || log.address.toLowerCase() !== tokenAddress) return false;
      try {
        const decoded = decodeEventLog({
          abi: erc20EvidenceAbi,
          data: log.data,
          eventName: "Transfer",
          topics: log.topics,
        });
        return (
          decoded.args.from.toLowerCase() === plan.walletAddress &&
          decoded.args.to.toLowerCase() === plan.recipient &&
          decoded.args.value === amount
        );
      } catch {
        return false;
      }
    });
    return {
      balanceReconciled:
        nativeSpent === fee && senderSpent === amount && recipientGain === amount,
      tokenTransferLogReconciled: transferLog,
    };
  }
}
