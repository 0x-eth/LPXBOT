import { LocalEvmRpcClient, type LocalEvmRpcClientOptions } from "@lpbot/chain-adapters";
import { decodeAbiParameters, keccak256, type Hex } from "viem";

import type {
  HelperDeploymentObservation,
  HelperDeploymentObserver,
  HelperDeploymentReceiptObservation,
} from "./helper-deployment-worker.js";

interface RpcBlock {
  hash: Hex;
}

interface RpcReceipt {
  blockHash: Hex;
  blockNumber: Hex;
  contractAddress: `0x${string}` | null;
  status: Hex;
  transactionHash: Hex;
}

interface RpcTransaction {
  blockHash: Hex | null;
  from: `0x${string}`;
  hash: Hex;
  input: Hex;
  nonce: Hex;
  to: `0x${string}` | null;
  value: Hex;
}

export interface ViemLocalHelperDeploymentObserverOptions {
  chainId: 31_337;
  fetch?: typeof fetch;
  providers: ReadonlyArray<Pick<LocalEvmRpcClientOptions, "providerId" | "rpcUrl">>;
  timeoutMilliseconds?: number;
}

const ownerSelector = "0x8da5cb5b";
const adapterSelector = "0x03eadcfc";
const permit2Selector = "0x12261ee7";

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_OBSERVER_QUANTITY_INVALID");
  }
  return BigInt(value);
}

function code(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value)) {
    throw new Error("LOCAL_HELPER_OBSERVER_CODE_INVALID");
  }
  return value.toLowerCase() as Hex;
}

function addressResult(value: unknown): `0x${string}` {
  const decoded = decodeAbiParameters([{ type: "address" }], code(value))[0];
  return decoded.toLowerCase() as `0x${string}`;
}

export class ViemLocalHelperDeploymentObserver implements HelperDeploymentObserver {
  readonly #chainId: 31_337;
  readonly #providers: readonly LocalEvmRpcClient[];

  constructor(options: ViemLocalHelperDeploymentObserverOptions) {
    if (options.chainId !== 31_337) throw new RangeError("LOCAL_HELPER_OBSERVER_CHAIN_INVALID");
    if (options.providers.length < 1 || options.providers.length > 4) {
      throw new RangeError("LOCAL_HELPER_OBSERVER_PROVIDER_COUNT_INVALID");
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
    input: Parameters<HelperDeploymentObserver["observe"]>[0],
  ): Promise<HelperDeploymentObservation> {
    if (input.plan.chainId !== this.#chainId || !/^0x[0-9a-f]{64}$/u.test(input.transactionHash)) {
      throw new Error("LOCAL_HELPER_OBSERVER_INPUT_INVALID");
    }
    return {
      providers: await Promise.all(
        this.#providers.map(async (provider) => {
          const [latestNonce, pendingNonce, transaction, receipt] = await Promise.all([
            provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "latest"]),
            provider.request<Hex>("eth_getTransactionCount", [input.plan.wallet.address, "pending"]),
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
              ? await this.#receipt(provider, input.plan, input.transactionHash, transaction, receipt)
              : null,
            transactionFound: transaction !== null,
          };
        }),
      ),
    };
  }

  async #receipt(
    provider: LocalEvmRpcClient,
    plan: Parameters<HelperDeploymentObserver["observe"]>[0]["plan"],
    transactionHash: `0x${string}`,
    transaction: RpcTransaction | null,
    receipt: RpcReceipt,
  ): Promise<HelperDeploymentReceiptObservation> {
    const blockNumber = quantity(receipt.blockNumber);
    const blockTag = `0x${blockNumber.toString(16)}` as Hex;
    const [canonicalBlock, latestBlock] = await Promise.all([
      provider.request<RpcBlock>("eth_getBlockByNumber", [blockTag, false]),
      provider.request<Hex>("eth_blockNumber", []),
    ]);
    const latest = quantity(latestBlock);
    if (latest < blockNumber) throw new Error("LOCAL_HELPER_OBSERVER_BLOCK_INVALID");
    const receiptStatus = quantity(receipt.status) === 1n ? "success" : "reverted";
    const contractAddress = receipt.contractAddress?.toLowerCase() as `0x${string}` | null;
    let runtimeCodeHash: `0x${string}` | null = null;
    let observedOwner: `0x${string}` | null = null;
    let observedAdapter: `0x${string}` | null = null;
    let observedPermit2: `0x${string}` | null = null;
    if (receiptStatus === "success" && contractAddress) {
      const [runtime, owner, adapter, permit2] = await Promise.all([
        provider.request<Hex>("eth_getCode", [contractAddress, blockTag]),
        provider.request<Hex>("eth_call", [{ data: ownerSelector, to: contractAddress }, blockTag]),
        provider.request<Hex>("eth_call", [
          { data: adapterSelector, to: contractAddress },
          blockTag,
        ]),
        provider.request<Hex>("eth_call", [
          { data: permit2Selector, to: contractAddress },
          blockTag,
        ]),
      ]);
      const deployedCode = code(runtime);
      runtimeCodeHash = deployedCode === "0x" ? null : keccak256(deployedCode);
      observedOwner = addressResult(owner);
      observedAdapter = addressResult(adapter);
      observedPermit2 = addressResult(permit2);
    }
    const transactionReconciled =
      transaction !== null &&
      transaction.hash.toLowerCase() === transactionHash &&
      transaction.from.toLowerCase() === plan.wallet.address &&
      quantity(transaction.nonce).toString() === plan.nonce &&
      transaction.to === null &&
      quantity(transaction.value) === 0n &&
      transaction.input.toLowerCase() === plan.transaction.data;
    return {
      blockCanonical: canonicalBlock.hash.toLowerCase() === receipt.blockHash.toLowerCase(),
      blockHash: receipt.blockHash.toLowerCase() as `0x${string}`,
      blockNumber: blockNumber.toString(),
      confirmations: (latest - blockNumber + 1n).toString(),
      constructorReconciled:
        transactionReconciled &&
        observedAdapter === plan.deployment.adapter &&
        observedPermit2 === plan.deployment.permit2,
      contractAddress,
      contractAddressReconciled: contractAddress === plan.deployment.expectedAddress,
      observedAdapter,
      observedOwner,
      observedPermit2,
      ownerReconciled: observedOwner === plan.deployment.owner,
      receiptStatus,
      runtimeCodeHash,
      runtimeCodeReconciled: runtimeCodeHash === plan.deployment.expectedRuntimeCodeHash,
      transactionHash,
    };
  }
}
