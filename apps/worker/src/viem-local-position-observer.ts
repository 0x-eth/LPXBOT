import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import {
  decodeAbiParameters,
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

import type {
  LocalPositionObservation,
  LocalPositionObserver,
  LocalPositionProviderObservation,
  LocalPositionReceiptObservation,
} from "./local-position-worker.js";

const erc20Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);
const managerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address owner)",
  "function positions(uint256 tokenId) view returns ((uint8 platformId,address token0,address token1,address poolAddress,bytes32 poolId,int24 tickLower,int24 tickUpper,int24 tickSpacing,uint24 feePips,uint128 liquidity,uint128 reserve0,uint128 reserve1,uint128 tokensOwed0,uint128 tokensOwed1) position)",
  "event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)",
  "event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
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

interface PositionState {
  liquidity: string;
  owner: Address;
  reserve0: string;
  reserve1: string;
  tokensOwed0: string;
  tokensOwed1: string;
}

export interface ViemLocalPositionObserverOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  timeoutMilliseconds?: number;
}

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error(`LOCAL_POSITION_OBSERVER_${label}_INVALID`);
  }
  return BigInt(value);
}

function bytes(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error(`LOCAL_POSITION_OBSERVER_${label}_INVALID`);
  }
  return value.toLowerCase() as Hex;
}

function decodeUint(value: unknown, label: string): string {
  return decodeAbiParameters([{ type: "uint256" }], bytes(value, label))[0].toString();
}

function delta(before: string | null, after: string | null): string | null {
  return before === null || after === null ? null : (BigInt(after) - BigInt(before)).toString();
}

export class ViemLocalPositionObserver implements LocalPositionObserver {
  readonly #chainId: 31_337;
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalPositionObserverOptions) {
    if (options.chainId !== 31_337) {
      throw new RangeError("LOCAL_POSITION_OBSERVER_CHAIN_INVALID");
    }
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_POSITION_OBSERVER_PROVIDER_COUNT_INVALID");
    }
    const providerIds = new Set(options.providers.map(({ providerId }) => providerId));
    if (providerIds.size !== options.providers.length) {
      throw new RangeError("LOCAL_POSITION_OBSERVER_PROVIDER_ID_DUPLICATE");
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

  async observe(
    input: Parameters<LocalPositionObserver["observe"]>[0],
  ): Promise<LocalPositionObservation> {
    if (
      input.plan.chainId !== this.#chainId ||
      !/^0x[0-9a-f]{64}$/u.test(input.transactionHash) ||
      !input.plan.steps.some(({ stepId }) => stepId === input.step.stepId)
    ) {
      throw new Error("LOCAL_POSITION_OBSERVER_INPUT_INVALID");
    }
    return {
      providers: await Promise.all(
        this.#providers.map((provider) => this.#observeProvider(provider, input)),
      ),
    };
  }

  async #observeProvider(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalPositionObserver["observe"]>[0],
  ): Promise<LocalPositionProviderObservation> {
    const [latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
      provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "latest"]),
      provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "pending"]),
      provider.request<RpcTransaction | null>("eth_getTransactionByHash", [input.transactionHash]),
      provider.request<RpcReceipt | null>("eth_getTransactionReceipt", [input.transactionHash]),
    ]);
    if (transaction) this.#assertTransaction(input, transaction);
    if (receipt && !transaction) {
      throw new Error("LOCAL_POSITION_OBSERVER_RECEIPT_TRANSACTION_MISSING");
    }
    return {
      latestNonce: quantity(latestNonce, "LATEST_NONCE").toString(),
      pendingNonce: quantity(pendingNonce, "PENDING_NONCE").toString(),
      providerId: provider.providerId,
      receipt: receipt ? await this.#receipt(provider, input, receipt) : null,
      transactionFound: transaction !== null,
    };
  }

  #assertTransaction(
    input: Parameters<LocalPositionObserver["observe"]>[0],
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
      throw new Error("LOCAL_POSITION_OBSERVER_TRANSACTION_MISMATCH");
    }
  }

  async #receipt(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalPositionObserver["observe"]>[0],
    receipt: RpcReceipt,
  ): Promise<LocalPositionReceiptObservation> {
    if (receipt.transactionHash.toLowerCase() !== input.transactionHash) {
      throw new Error("LOCAL_POSITION_OBSERVER_RECEIPT_TRANSACTION_MISMATCH");
    }
    const blockNumber = quantity(receipt.blockNumber, "BLOCK_NUMBER");
    const blockTag = toHex(blockNumber);
    const [canonicalBlock, latestBlock, managerCode] = await Promise.all([
      provider.request<RpcBlock | null>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
      provider.request<Hex>("eth_getCode", [input.plan.manager.address, blockTag]),
    ]);
    const latest = quantity(latestBlock, "LATEST_BLOCK");
    if (latest < blockNumber) throw new Error("LOCAL_POSITION_OBSERVER_BLOCK_INVALID");
    const status = quantity(receipt.status, "RECEIPT_STATUS");
    if (status !== 0n && status !== 1n) {
      throw new Error("LOCAL_POSITION_OBSERVER_STATUS_INVALID");
    }
    const base: LocalPositionReceiptObservation = {
      blockCanonical:
        canonicalBlock !== null &&
        canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase(),
      blockHash: receipt.blockHash.toLowerCase() as Hex,
      blockNumber: blockNumber.toString(),
      burnEvent: null,
      collectAmount0: null,
      collectAmount1: null,
      collectRecipient: null,
      confirmations: (latest - blockNumber + 1n).toString(),
      decreaseAmount0: null,
      decreaseAmount1: null,
      decreaseLiquidityDelta: null,
      liquidityAfter: null,
      liquidityBefore: null,
      managerRuntimeCodeHash: managerCode === "0x" ? null : keccak256(managerCode),
      ownerAfter: null,
      ownerBefore: null,
      receiptStatus: status === 1n ? "success" : "reverted",
      reserve0After: null,
      reserve0Before: null,
      reserve1After: null,
      reserve1Before: null,
      tokensOwed0After: null,
      tokensOwed0Before: null,
      tokensOwed1After: null,
      tokensOwed1Before: null,
      transactionHash: input.transactionHash,
      walletToken0After: null,
      walletToken0Before: null,
      walletToken0Delta: null,
      walletToken1After: null,
      walletToken1Before: null,
      walletToken1Delta: null,
    };
    if (status === 0n) return base;

    const beforeAvailable =
      blockNumber > 0n && quantity(receipt.transactionIndex, "TRANSACTION_INDEX") === 0n;
    if (!beforeAvailable) return base;
    const beforeTag = toHex(blockNumber - 1n);
    const [beforePosition, before0, before1, after0, after1, afterPosition] = await Promise.all([
      this.#position(provider, input, beforeTag),
      this.#balance(
        provider,
        input.plan.snapshot.position.pool.token0,
        input.plan.wallet.address,
        beforeTag,
      ),
      this.#balance(
        provider,
        input.plan.snapshot.position.pool.token1,
        input.plan.wallet.address,
        beforeTag,
      ),
      this.#balance(
        provider,
        input.plan.snapshot.position.pool.token0,
        input.plan.wallet.address,
        blockTag,
      ),
      this.#balance(
        provider,
        input.plan.snapshot.position.pool.token1,
        input.plan.wallet.address,
        blockTag,
      ),
      this.#positionAfter(provider, input, blockTag),
    ]);
    const events = this.#events(input, receipt.logs);
    return {
      ...base,
      burnEvent: events.burn,
      collectAmount0: events.collect?.amount0 ?? null,
      collectAmount1: events.collect?.amount1 ?? null,
      collectRecipient: events.collect?.recipient ?? null,
      decreaseAmount0: events.decrease?.amount0 ?? null,
      decreaseAmount1: events.decrease?.amount1 ?? null,
      decreaseLiquidityDelta: events.decrease?.liquidity ?? null,
      liquidityAfter: afterPosition?.liquidity ?? null,
      liquidityBefore: beforePosition.liquidity,
      ownerAfter: afterPosition?.owner ?? null,
      ownerBefore: beforePosition.owner,
      reserve0After: afterPosition?.reserve0 ?? null,
      reserve0Before: beforePosition.reserve0,
      reserve1After: afterPosition?.reserve1 ?? null,
      reserve1Before: beforePosition.reserve1,
      tokensOwed0After: afterPosition?.tokensOwed0 ?? null,
      tokensOwed0Before: beforePosition.tokensOwed0,
      tokensOwed1After: afterPosition?.tokensOwed1 ?? null,
      tokensOwed1Before: beforePosition.tokensOwed1,
      walletToken0After: after0,
      walletToken0Before: before0,
      walletToken0Delta: delta(before0, after0),
      walletToken1After: after1,
      walletToken1Before: before1,
      walletToken1Delta: delta(before1, after1),
    };
  }

  async #balance(
    provider: LocalEvmRpcClient,
    token: Address,
    owner: Address,
    blockTag: Hex,
  ): Promise<string> {
    const result = await provider.request<Hex>("eth_call", [
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          args: [getAddress(owner)],
          functionName: "balanceOf",
        }),
        to: token,
      },
      blockTag,
    ]);
    return decodeUint(result, "BALANCE");
  }

  async #position(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalPositionObserver["observe"]>[0],
    blockTag: Hex,
  ): Promise<PositionState> {
    const tokenId = BigInt(input.plan.snapshot.position.tokenId);
    const [ownerRaw, positionRaw] = await Promise.all([
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({ abi: managerAbi, args: [tokenId], functionName: "ownerOf" }),
          to: input.plan.manager.address,
        },
        blockTag,
      ]),
      provider.request<Hex>("eth_call", [
        {
          data: encodeFunctionData({ abi: managerAbi, args: [tokenId], functionName: "positions" }),
          to: input.plan.manager.address,
        },
        blockTag,
      ]),
    ]);
    const owner = decodeFunctionResult({
      abi: managerAbi,
      data: bytes(ownerRaw, "OWNER"),
      functionName: "ownerOf",
    });
    const position = decodeFunctionResult({
      abi: managerAbi,
      data: bytes(positionRaw, "POSITION"),
      functionName: "positions",
    });
    return {
      liquidity: position.liquidity.toString(),
      owner: owner.toLowerCase() as Address,
      reserve0: position.reserve0.toString(),
      reserve1: position.reserve1.toString(),
      tokensOwed0: position.tokensOwed0.toString(),
      tokensOwed1: position.tokensOwed1.toString(),
    };
  }

  async #positionAfter(
    provider: LocalEvmRpcClient,
    input: Parameters<LocalPositionObserver["observe"]>[0],
    blockTag: Hex,
  ): Promise<PositionState | null> {
    try {
      return await this.#position(provider, input, blockTag);
    } catch (error) {
      if (input.step.kind === "burn") return null;
      throw error;
    }
  }

  #events(
    input: Parameters<LocalPositionObserver["observe"]>[0],
    logs: readonly RpcReceiptLog[],
  ): {
    burn: boolean;
    collect: { amount0: string; amount1: string; recipient: Address } | null;
    decrease: { amount0: string; amount1: string; liquidity: string } | null;
  } {
    let burn = false;
    let collect: { amount0: string; amount1: string; recipient: Address } | null = null;
    let decrease: { amount0: string; amount1: string; liquidity: string } | null = null;
    const tokenId = BigInt(input.plan.snapshot.position.tokenId);
    for (const log of logs) {
      if (
        log.removed ||
        log.address.toLowerCase() !== input.plan.manager.address ||
        log.topics.length === 0
      ) {
        continue;
      }
      try {
        const decoded = decodeEventLog({
          abi: managerAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName === "DecreaseLiquidity" && decoded.args.tokenId === tokenId) {
          decrease = {
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString(),
            liquidity: decoded.args.liquidity.toString(),
          };
        } else if (decoded.eventName === "Collect" && decoded.args.tokenId === tokenId) {
          collect = {
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString(),
            recipient: decoded.args.recipient.toLowerCase() as Address,
          };
        } else if (
          decoded.eventName === "Transfer" &&
          decoded.args.tokenId === tokenId &&
          decoded.args.from.toLowerCase() === input.plan.wallet.address &&
          decoded.args.to === zeroAddress
        ) {
          burn = true;
        }
      } catch {
        // Unrelated Manager logs do not satisfy any required step event.
      }
    }
    return { burn, collect, decrease };
  }
}
