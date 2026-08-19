import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import { localSwapComponent } from "@lpbot/chain-registry";
import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

import type {
  LocalSwapObservation,
  LocalSwapObserver,
  LocalSwapProviderObservation,
  LocalSwapReceiptObservation,
} from "./local-swap-worker.js";

const erc20Abi = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const helperAbi = parseAbi([
  "function executedPlans(bytes32 planDigest) view returns (bool)",
  "event PlanExecuted(bytes32 indexed planDigest,bytes4 indexed selector)",
  "event SwapExecuted(bytes32 indexed planDigest,address indexed tokenIn,address indexed tokenOut,uint256 amountOut)",
]);

interface RpcBlock {
  hash: Hex;
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
  removed?: boolean;
  topics: Hex[];
}

interface RpcReceipt {
  blockHash: Hex;
  blockNumber: Hex;
  logs: RpcReceiptLog[];
  status: Hex;
  transactionHash: Hex;
  transactionIndex: Hex;
}

export interface ViemLocalSwapObserverOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_OBSERVER_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_SWAP_OBSERVER_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function decodeUint(value: unknown, label: string): string {
  return decodeAbiParameters([{ type: "uint256" }], bytes(value, label))[0].toString();
}

export class ViemLocalSwapObserver implements LocalSwapObserver {
  readonly #chainId: 31_337;
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalSwapObserverOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_SWAP_OBSERVER_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_SWAP_OBSERVER_PROVIDER_COUNT_INVALID");
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

  async observe(input: Parameters<LocalSwapObserver["observe"]>[0]): Promise<LocalSwapObservation> {
    if (
      input.plan.chainId !== this.#chainId ||
      !/^0x[0-9a-f]{64}$/u.test(input.transactionHash) ||
      !input.plan.steps.some(({ stepId }) => stepId === input.step.stepId)
    ) {
      throw new Error("LOCAL_SWAP_OBSERVER_INPUT_INVALID");
    }
    return {
      providers: await Promise.all(
        this.#providers.map((provider) => this.#observeProvider(provider, input)),
      ),
    };
  }

  async #observeProvider(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalSwapObserver["observe"]>[0],
  ): Promise<LocalSwapProviderObservation> {
    const [latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
      provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "latest"]),
      provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "pending"]),
      provider.request<RpcTransaction | null>("eth_getTransactionByHash", [input.transactionHash]),
      provider.request<RpcReceipt | null>("eth_getTransactionReceipt", [input.transactionHash]),
    ]);
    if (transaction) this.#assertTransaction(input, transaction);
    if (receipt && !transaction) throw new Error("LOCAL_SWAP_OBSERVER_RECEIPT_TRANSACTION_MISSING");
    return {
      latestNonce: quantity(latestNonce, "LATEST_NONCE").toString(),
      pendingNonce: quantity(pendingNonce, "PENDING_NONCE").toString(),
      providerId: provider.providerId,
      receipt: receipt ? await this.#receipt(provider, input, receipt) : null,
      transactionFound: transaction !== null,
    };
  }

  #assertTransaction(
    input: Parameters<LocalSwapObserver["observe"]>[0],
    transaction: RpcTransaction,
  ): void {
    if (
      transaction.hash.toLowerCase() !== input.transactionHash ||
      transaction.from.toLowerCase() !== input.plan.wallet.address ||
      transaction.to?.toLowerCase() !== input.step.transaction.to ||
      bytes(transaction.input, "TRANSACTION_INPUT") !== input.step.transaction.data ||
      quantity(transaction.nonce, "TRANSACTION_NONCE").toString() !== input.step.nonce ||
      quantity(transaction.value, "TRANSACTION_VALUE") !== 0n
    ) {
      throw new Error("LOCAL_SWAP_OBSERVER_TRANSACTION_MISMATCH");
    }
  }

  async #receipt(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalSwapObserver["observe"]>[0],
    receipt: RpcReceipt,
  ): Promise<LocalSwapReceiptObservation> {
    if (receipt.transactionHash.toLowerCase() !== input.transactionHash) {
      throw new Error("LOCAL_SWAP_OBSERVER_RECEIPT_TRANSACTION_MISMATCH");
    }
    const blockNumber = quantity(receipt.blockNumber, "BLOCK_NUMBER");
    const blockTag = toHex(blockNumber);
    const [canonicalBlock, latestBlock] = await Promise.all([
      provider.request<RpcBlock | null>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
    ]);
    const latest = quantity(latestBlock, "LATEST_BLOCK");
    if (latest < blockNumber) throw new Error("LOCAL_SWAP_OBSERVER_BLOCK_INVALID");
    const status = quantity(receipt.status, "RECEIPT_STATUS");
    if (status !== 0n && status !== 1n) throw new Error("LOCAL_SWAP_OBSERVER_STATUS_INVALID");
    const ownerToSpenderAllowance = await this.#allowance(
      provider,
      input.plan.quote.tokenIn,
      input.plan.wallet.address,
      input.plan.authorization.approvalSpender,
      blockTag,
    );
    const base: LocalSwapReceiptObservation = {
      adapterToRouterAllowance: null,
      blockCanonical:
        canonicalBlock !== null &&
        canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase(),
      blockHash: receipt.blockHash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      confirmations: (latest - blockNumber + 1n).toString(),
      helperInputDust: null,
      helperOutputDust: null,
      helperToAdapterAllowance: null,
      minOutBaseUnit: null,
      ownerOutputAfter: null,
      ownerOutputBefore: null,
      ownerToSpenderAllowance,
      planExecutedEvent: null,
      planReplayRecorded: null,
      receiptStatus: status === 1n ? "success" : "reverted",
      swapExecutedEvent: null,
      transactionHash: input.transactionHash,
    };
    if (input.step.kind !== "swap") return base;

    const router = localSwapComponent("router").address;
    const balance = (token: Address, owner: Address, tag: Hex) =>
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [getAddress(owner)],
            functionName: "balanceOf",
          }),
          to: token,
        },
        tag,
      ]);
    const beforeAvailable =
      blockNumber > 0n && quantity(receipt.transactionIndex, "TRANSACTION_INDEX") === 0n;
    const beforeTag = beforeAvailable ? toHex(blockNumber - 1n) : null;
    const [
      ownerOutputBefore,
      ownerOutputAfter,
      helperToAdapterAllowance,
      adapterToRouterAllowance,
      helperInputDust,
      helperOutputDust,
      replayResult,
    ] = await Promise.all([
      beforeTag
        ? balance(input.plan.quote.tokenOut, input.plan.wallet.address, beforeTag)
        : Promise.resolve<Hex | null>(null),
      balance(input.plan.quote.tokenOut, input.plan.wallet.address, blockTag),
      this.#allowance(
        provider,
        input.plan.quote.tokenIn,
        input.plan.helper.address,
        input.plan.helper.adapter,
        blockTag,
      ),
      this.#allowance(
        provider,
        input.plan.quote.tokenIn,
        input.plan.helper.adapter,
        router,
        blockTag,
      ),
      balance(input.plan.quote.tokenIn, input.plan.helper.address, blockTag),
      balance(input.plan.quote.tokenOut, input.plan.helper.address, blockTag),
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({
            abi: helperAbi,
            args: [input.plan.helperPlanDigest],
            functionName: "executedPlans",
          }),
          to: input.plan.helper.address,
        },
        blockTag,
      ]),
    ]);
    const events = this.#events(input, receipt.logs);
    return {
      ...base,
      adapterToRouterAllowance,
      helperInputDust: decodeUint(helperInputDust, "HELPER_INPUT_DUST"),
      helperOutputDust: decodeUint(helperOutputDust, "HELPER_OUTPUT_DUST"),
      helperToAdapterAllowance,
      minOutBaseUnit: input.plan.quote.minOutBaseUnit,
      ownerOutputAfter: decodeUint(ownerOutputAfter, "OWNER_OUTPUT_AFTER"),
      ownerOutputBefore: ownerOutputBefore
        ? decodeUint(ownerOutputBefore, "OWNER_OUTPUT_BEFORE")
        : null,
      planExecutedEvent: events.planExecuted,
      planReplayRecorded: decodeFunctionResult({
        abi: helperAbi,
        data: bytes(replayResult, "PLAN_REPLAY_RESULT"),
        functionName: "executedPlans",
      }),
      swapExecutedEvent: events.swapExecuted,
    };
  }

  async #allowance(
    provider: LocalEvmRpcClient,
    token: Address,
    owner: Address,
    spender: Address,
    blockTag: Hex,
  ): Promise<string> {
    const result = await provider.request<Hex>("eth_call", [
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          args: [getAddress(owner), getAddress(spender)],
          functionName: "allowance",
        }),
        to: token,
      },
      blockTag,
    ]);
    return decodeUint(result, "ALLOWANCE");
  }

  #events(
    input: Parameters<LocalSwapObserver["observe"]>[0],
    logs: readonly RpcReceiptLog[],
  ): { planExecuted: boolean; swapExecuted: boolean } {
    let planExecuted = false;
    let swapExecuted = false;
    for (const log of logs) {
      if (
        log.removed ||
        log.address.toLowerCase() !== input.plan.helper.address ||
        log.topics.length === 0
      ) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: helperAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (
          decoded.eventName === "PlanExecuted" &&
          decoded.args.planDigest === input.plan.helperPlanDigest &&
          decoded.args.selector === "0x5a547e89"
        ) {
          planExecuted = true;
        }
        if (
          decoded.eventName === "SwapExecuted" &&
          decoded.args.planDigest === input.plan.helperPlanDigest &&
          decoded.args.tokenIn.toLowerCase() === input.plan.quote.tokenIn &&
          decoded.args.tokenOut.toLowerCase() === input.plan.quote.tokenOut &&
          decoded.args.amountOut >= BigInt(input.plan.quote.minOutBaseUnit)
        ) {
          swapExecuted = true;
        }
      } catch {
        // Unrelated Helper logs are ignored; both required events are checked below.
      }
    }
    return { planExecuted, swapExecuted };
  }
}
