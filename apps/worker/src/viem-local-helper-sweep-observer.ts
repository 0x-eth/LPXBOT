import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  LocalHelperSweepWorkerError,
  type LocalHelperSweepObservation,
  type LocalHelperSweepObserver,
  type LocalHelperSweepReceiptObservation,
} from "./local-helper-sweep-worker.js";

const erc20Abi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const helperAbi = parseAbi([
  "event PlanExecuted(bytes32 indexed planDigest,bytes4 indexed selector)",
  "event Swept(bytes32 indexed planDigest,address indexed asset,uint256 amount)",
  "function owner() view returns (address)",
]);

interface RpcBlock {
  hash: Hex;
  number: Hex;
}

interface RpcTransaction {
  from: Address;
  hash: Hex;
  input: Hex;
  nonce: Hex;
  to: Address | null;
  value: Hex;
}

interface RpcReceiptLog {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
}

interface RpcReceipt {
  blockHash: Hex;
  blockNumber: Hex;
  effectiveGasPrice: Hex;
  gasUsed: Hex;
  logs: readonly RpcReceiptLog[];
  status: Hex;
  transactionHash: Hex;
}

export interface ViemLocalHelperSweepObserverOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new LocalHelperSweepWorkerError(`LOCAL_HELPER_SWEEP_${label}_INVALID`, true);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new LocalHelperSweepWorkerError(`LOCAL_HELPER_SWEEP_${label}_INVALID`, true);
  }
  return value.toLowerCase() as Hex;
}

function codeHash(value: unknown): Hex | null {
  const code = bytes(value, "HELPER_CODE");
  return code === "0x" ? null : keccak256(code);
}

function canonicalAddress(value: string): Address {
  return getAddress(value).toLowerCase() as Address;
}

export class ViemLocalHelperSweepObserver implements LocalHelperSweepObserver {
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalHelperSweepObserverOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_SWEEP_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_SWEEP_PROVIDER_COUNT_INVALID");
    }
    const providerIds = new Set(options.providers.map(({ providerId }) => providerId));
    if (providerIds.size !== options.providers.length) {
      throw new RangeError("LOCAL_HELPER_SWEEP_PROVIDER_ID_DUPLICATE");
    }
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

  async observe(
    input: Parameters<LocalHelperSweepObserver["observe"]>[0],
  ): Promise<LocalHelperSweepObservation> {
    if (input.plan.chainId !== 31_337 || !/^0x[0-9a-f]{64}$/u.test(input.transactionHash)) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_OBSERVATION_INPUT_INVALID");
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
          if (transaction) this.#transaction(input.plan, input.transactionHash, transaction);
          return {
            latestNonce: quantity(latestNonce, "LATEST_NONCE").toString(),
            pendingNonce: quantity(pendingNonce, "PENDING_NONCE").toString(),
            providerId: provider.providerId,
            receipt: receipt
              ? await this.#receipt(provider, input.plan, input.transactionHash, receipt)
              : null,
            transactionFound: transaction !== null,
          };
        }),
      ),
    };
  }

  #transaction(
    plan: Parameters<LocalHelperSweepObserver["observe"]>[0]["plan"],
    transactionHash: Hex,
    transaction: RpcTransaction,
  ): void {
    if (
      transaction.hash.toLowerCase() !== transactionHash ||
      transaction.to?.toLowerCase() !== plan.transaction.to ||
      transaction.from.toLowerCase() !== plan.wallet.address ||
      transaction.input.toLowerCase() !== plan.transaction.data ||
      quantity(transaction.nonce, "TRANSACTION_NONCE").toString() !== plan.nonce ||
      quantity(transaction.value, "TRANSACTION_VALUE") !== 0n
    ) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_TRANSACTION_MISMATCH");
    }
  }

  async #receipt(
    provider: LocalEvmRpcClient,
    plan: Parameters<LocalHelperSweepObserver["observe"]>[0]["plan"],
    transactionHash: Hex,
    receipt: RpcReceipt,
  ): Promise<LocalHelperSweepReceiptObservation> {
    if (receipt.transactionHash.toLowerCase() !== transactionHash) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RECEIPT_MISMATCH");
    }
    const blockNumber = quantity(receipt.blockNumber, "RECEIPT_BLOCK_NUMBER");
    const parentNumber = blockNumber > 0n ? blockNumber - 1n : 0n;
    const blockTag = toHex(blockNumber);
    const parentTag = toHex(parentNumber);
    const balance = async (account: Address, tag: Hex): Promise<bigint> => {
      if (plan.asset.kind === "native") {
        return quantity(
          await provider.request<Hex>("eth_getBalance", [account, tag]),
          "NATIVE_BALANCE",
        );
      }
      return decodeFunctionResult({
        abi: erc20Abi,
        data: bytes(
          await provider.request<Hex>("eth_call", [
            {
              data: encodeFunctionData({
                abi: erc20Abi,
                args: [account],
                functionName: "balanceOf",
              }),
              to: plan.asset.tokenAddress!,
            },
            tag,
          ]),
          "TOKEN_BALANCE_RESULT",
        ),
        functionName: "balanceOf",
      });
    };
    const [
      canonicalBlock,
      head,
      helperCode,
      helperOwnerRaw,
      helperBalanceBefore,
      helperBalanceAfter,
      ownerBalanceBefore,
      ownerBalanceAfter,
    ] = await Promise.all([
      provider.request<RpcBlock | null>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
      provider.request<Hex>("eth_getCode", [plan.helper.helperAddress, blockTag]),
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({ abi: helperAbi, functionName: "owner" }),
          to: plan.helper.helperAddress,
        },
        blockTag,
      ]),
      balance(plan.helper.helperAddress, parentTag),
      balance(plan.helper.helperAddress, blockTag),
      balance(plan.recipient, parentTag),
      balance(plan.recipient, blockTag),
    ]);
    const canonical =
      canonicalBlock !== null &&
      canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase() &&
      quantity(canonicalBlock.number, "CANONICAL_BLOCK_NUMBER") === blockNumber;
    const headNumber = quantity(head, "HEAD_BLOCK_NUMBER");
    const confirmations =
      canonical && headNumber >= blockNumber ? headNumber - blockNumber + 1n : 0n;
    const events = this.#events(plan, receipt.logs);
    return {
      blockCanonical: canonical,
      blockHash: receipt.blockHash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      confirmations: confirmations.toString(),
      effectiveGasPrice: quantity(receipt.effectiveGasPrice, "EFFECTIVE_GAS_PRICE").toString(),
      gasUsed: quantity(receipt.gasUsed, "GAS_USED").toString(),
      helperBalanceAfter: helperBalanceAfter.toString(),
      helperBalanceBefore: helperBalanceBefore.toString(),
      helperRuntimeCodeHash: codeHash(helperCode),
      observedOwner: canonicalAddress(
        decodeFunctionResult({
          abi: helperAbi,
          data: bytes(helperOwnerRaw, "HELPER_OWNER_RESULT"),
          functionName: "owner",
        }),
      ),
      ownerBalanceAfter: ownerBalanceAfter.toString(),
      ownerBalanceBefore: ownerBalanceBefore.toString(),
      planExecutedEvent: events.planExecuted,
      receiptStatus: quantity(receipt.status, "RECEIPT_STATUS") === 1n ? "success" : "reverted",
      sweptEvent: events.swept,
      tokenAddress: plan.asset.tokenAddress,
      transactionHash,
      transferAmountBaseUnit: events.transfer?.amount.toString() ?? null,
      transferFrom: events.transfer?.from ?? null,
      transferTo: events.transfer?.to ?? null,
    };
  }

  #events(
    plan: Parameters<LocalHelperSweepObserver["observe"]>[0]["plan"],
    logs: readonly RpcReceiptLog[],
  ): {
    planExecuted: boolean;
    swept: boolean;
    transfer: { amount: bigint; from: Address; to: Address } | null;
  } {
    const planDigest = `0x${plan.planDigest.slice("sha256:".length)}` as Hex;
    const expectedAsset = plan.asset.tokenAddress ?? zeroAddress;
    let planExecuted = false;
    let swept = false;
    let transfer: { amount: bigint; from: Address; to: Address } | null = null;
    for (const log of logs) {
      const logAddress = log.address.toLowerCase() as Address;
      if (logAddress === plan.helper.helperAddress) {
        try {
          const event = decodeEventLog({
            abi: helperAbi,
            data: log.data,
            strict: true,
            topics: log.topics as [signature: Hex, ...args: Hex[]],
          });
          if (event.eventName === "PlanExecuted") {
            planExecuted =
              event.args.planDigest.toLowerCase() === planDigest &&
              event.args.selector.toLowerCase() === plan.transaction.selector;
          } else if (event.eventName === "Swept") {
            swept =
              event.args.planDigest.toLowerCase() === planDigest &&
              event.args.asset.toLowerCase() === expectedAsset &&
              event.args.amount === BigInt(plan.asset.amountBaseUnit);
          }
        } catch {
          continue;
        }
      } else if (plan.asset.tokenAddress && logAddress === plan.asset.tokenAddress) {
        try {
          const event = decodeEventLog({
            abi: erc20Abi,
            data: log.data,
            strict: true,
            topics: log.topics as [signature: Hex, ...args: Hex[]],
          });
          if (
            event.eventName === "Transfer" &&
            event.args.from.toLowerCase() === plan.helper.helperAddress
          ) {
            transfer = {
              amount: event.args.value,
              from: event.args.from.toLowerCase() as Address,
              to: event.args.to.toLowerCase() as Address,
            };
          }
        } catch {
          continue;
        }
      }
    }
    return { planExecuted, swept, transfer };
  }
}
