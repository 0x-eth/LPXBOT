import { createPublicClient, custom, toHex, type Hex } from "viem";

import type {
  IndexerCursor,
  RawChainBlock,
  RawChainLog,
  RawLogDelivery,
  RawLogPage,
  RawLogSource,
} from "./types.js";

export const READONLY_BSC_RPC_METHODS = [
  "eth_chainId",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getTransactionReceipt",
  "eth_getCode",
] as const;

export type ReadonlyBscRpcMethod = (typeof READONLY_BSC_RPC_METHODS)[number];

const allowedMethods = new Set<string>(READONLY_BSC_RPC_METHODS);

interface RpcBlock {
  hash: Hex;
  number: Hex;
  parentHash: Hex;
  timestamp: Hex;
}

interface RpcLog {
  address: Hex;
  blockHash: Hex;
  blockNumber: Hex;
  data: Hex;
  logIndex: Hex;
  removed?: boolean;
  topics: Hex[];
  transactionHash: Hex;
  transactionIndex: Hex;
}

interface RpcResponse {
  error?: { code?: number };
  id?: number;
  jsonrpc?: string;
  result?: unknown;
}

export interface ViemBscLogSourceOptions {
  addresses?: readonly `0x${string}`[];
  fetch?: typeof fetch;
  fromBlock: string;
  maxAttempts?: number;
  maxBlockSpan?: number;
  maxPagesPerRead?: number;
  retryBaseMilliseconds?: number;
  rpcUrl: string;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMilliseconds?: number;
  topics?: readonly `0x${string}`[];
}

export type ViemBscLogSourceEnvOptions = Omit<ViemBscLogSourceOptions, "rpcUrl">;

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be positive`);
  return value;
}

function decimalBlock(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new RangeError(`${label} must be decimal`);
  return BigInt(value);
}

function lowerHex(value: string): string {
  return value.toLowerCase();
}

function decimalQuantity(value: Hex): string {
  return String(BigInt(value));
}

function blockTimestamp(value: Hex): string {
  const milliseconds = BigInt(value) * 1_000n;
  if (milliseconds > 8_640_000_000_000_000n) {
    throw new RangeError("RPC_BLOCK_TIMESTAMP_INVALID");
  }
  return new Date(Number(milliseconds)).toISOString();
}

function numericQuantity(value: Hex, label: string): number {
  const number = Number(BigInt(value));
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`RPC_${label.toUpperCase()}_INVALID`);
  }
  return number;
}

function afterCursor(log: RawChainLog, cursor: IndexerCursor): boolean {
  const logBlock = BigInt(log.blockNumber);
  const cursorBlock = BigInt(cursor.blockNumber);
  if (log.removed || log.blockHash !== cursor.blockHash.toLowerCase())
    return logBlock >= cursorBlock;
  if (logBlock !== cursorBlock) return logBlock > cursorBlock;
  if (log.transactionIndex !== cursor.transactionIndex) {
    return log.transactionIndex > cursor.transactionIndex;
  }
  return log.logIndex > cursor.logIndex;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ViemBscLogSource implements RawLogSource {
  readonly #addresses: readonly `0x${string}`[];
  readonly #client: ReturnType<typeof createPublicClient>;
  readonly #fetch: typeof fetch;
  readonly #fromBlock: bigint;
  readonly #maxAttempts: number;
  readonly #maxBlockSpan: bigint;
  readonly #maxPagesPerRead: number;
  readonly #retryBaseMilliseconds: number;
  readonly #rpcUrl: string;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMilliseconds: number;
  readonly #topics: readonly `0x${string}`[];
  #chainVerified = false;
  #nextScanBlock: bigint;
  #requestId = 0;
  #scanAfterValue: string | null = null;
  #scanInitialized = false;

  constructor(options: ViemBscLogSourceOptions) {
    if (!options.rpcUrl) throw new Error("BSC_RPC_URL_MISSING");
    this.#rpcUrl = options.rpcUrl;
    this.#fromBlock = decimalBlock(options.fromBlock, "fromBlock");
    this.#nextScanBlock = this.#fromBlock;
    this.#maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.#maxBlockSpan = BigInt(positiveInteger(options.maxBlockSpan ?? 2_000, "maxBlockSpan"));
    this.#maxPagesPerRead = positiveInteger(options.maxPagesPerRead ?? 16, "maxPagesPerRead");
    this.#retryBaseMilliseconds = positiveInteger(
      options.retryBaseMilliseconds ?? 100,
      "retryBaseMilliseconds",
    );
    this.#timeoutMilliseconds = positiveInteger(
      options.timeoutMilliseconds ?? 10_000,
      "timeoutMilliseconds",
    );
    this.#addresses = (options.addresses ?? []).map(
      (address) => address.toLowerCase() as `0x${string}`,
    );
    this.#topics = (options.topics ?? []).map((topic) => topic.toLowerCase() as `0x${string}`);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#client = createPublicClient({
      transport: custom(
        {
          request: async ({ method, params }) =>
            this.#fetchRpc(method, Array.isArray(params) ? params : []),
        },
        { retryCount: 0 },
      ),
    });
  }

  async #fetchRpc(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!allowedMethods.has(method)) throw new Error(`RPC_METHOD_FORBIDDEN: ${method}`);
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
      try {
        const response = await this.#fetch(this.#rpcUrl, {
          body: JSON.stringify({
            id: ++this.#requestId,
            jsonrpc: "2.0",
            method,
            params,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt === this.#maxAttempts) {
            throw new Error(`RPC_HTTP_STATUS: ${String(response.status)}`);
          }
        } else {
          const payload = (await response.json()) as RpcResponse;
          if (payload.error) {
            throw new Error(`RPC_RESPONSE_ERROR: ${String(payload.error.code ?? "unknown")}`);
          }
          return payload.result;
        }
      } catch (error) {
        const retryableTransportError =
          !(error instanceof Error) ||
          (!error.message.startsWith("RPC_HTTP_STATUS:") &&
            !error.message.startsWith("RPC_RESPONSE_ERROR:"));
        if (!retryableTransportError || attempt === this.#maxAttempts) {
          throw new Error(`RPC_REQUEST_FAILED: ${method}`, { cause: error });
        }
      } finally {
        clearTimeout(timeout);
      }
      const delay = Math.min(this.#retryBaseMilliseconds * 2 ** (attempt - 1), 1_000);
      await this.#sleep(delay);
    }
    throw new Error(`RPC_REQUEST_FAILED: ${method}`);
  }

  async #rpc<T>(method: ReadonlyBscRpcMethod, params: readonly unknown[]): Promise<T> {
    const request = this.#client.request as unknown as (args: {
      method: string;
      params: readonly unknown[];
    }) => Promise<unknown>;
    return (await request({ method, params })) as T;
  }

  async #ensureChain(): Promise<void> {
    if (this.#chainVerified) return;
    const chainId = await this.#rpc<Hex>("eth_chainId", []);
    if (BigInt(chainId) !== 56n) throw new Error("RPC_CHAIN_UNSUPPORTED: expected BSC chainId 56");
    this.#chainVerified = true;
  }

  async #block(blockNumber: "latest" | bigint): Promise<RpcBlock> {
    const tag = blockNumber === "latest" ? blockNumber : toHex(blockNumber);
    const block = await this.#rpc<RpcBlock | null>("eth_getBlockByNumber", [tag, false]);
    if (!block?.hash || !block.number || !block.parentHash || !block.timestamp) {
      throw new Error("RPC_BLOCK_HEADER_MISSING");
    }
    return block;
  }

  async #logs(fromBlock: bigint, toBlock: bigint): Promise<RpcLog[]> {
    const filter: Record<string, unknown> = {
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    };
    if (this.#addresses.length === 1) filter.address = this.#addresses[0];
    if (this.#addresses.length > 1) filter.address = this.#addresses;
    if (this.#topics.length > 0) filter.topics = [this.#topics];
    const logs = await this.#rpc<unknown>("eth_getLogs", [filter]);
    if (!Array.isArray(logs)) throw new Error("RPC_LOG_RESPONSE_INVALID");
    return logs as RpcLog[];
  }

  #normalizeLog(log: RpcLog): RawChainLog {
    if (
      !log.address ||
      !log.blockHash ||
      !log.blockNumber ||
      !log.data ||
      !log.logIndex ||
      !Array.isArray(log.topics) ||
      !log.transactionHash ||
      !log.transactionIndex
    ) {
      throw new Error("RPC_LOG_RESPONSE_INVALID");
    }
    return {
      address: lowerHex(log.address),
      blockHash: lowerHex(log.blockHash),
      blockNumber: decimalQuantity(log.blockNumber),
      chainId: 56,
      data: lowerHex(log.data),
      logIndex: numericQuantity(log.logIndex, "logIndex"),
      removed: log.removed ?? false,
      topics: log.topics.map(lowerHex),
      transactionHash: lowerHex(log.transactionHash),
      transactionIndex: numericQuantity(log.transactionIndex, "transactionIndex"),
    };
  }

  async #delivery(log: RawChainLog): Promise<RawLogDelivery> {
    const header = await this.#block(BigInt(log.blockNumber));
    const block: RawChainBlock = {
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      blockTimestamp: blockTimestamp(header.timestamp),
      chainId: 56,
      parentHash: lowerHex(header.parentHash),
    };
    return { block, log };
  }

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!allowedMethods.has(method)) throw new Error(`RPC_METHOD_FORBIDDEN: ${method}`);
    return this.#rpc(method as ReadonlyBscRpcMethod, params);
  }

  async getTransactionReceipt(transactionHash: `0x${string}`): Promise<unknown> {
    await this.#ensureChain();
    const receipt = await this.#rpc<unknown>("eth_getTransactionReceipt", [
      transactionHash.toLowerCase(),
    ]);
    if (!receipt) throw new Error("RPC_TRANSACTION_RECEIPT_MISSING");
    return receipt;
  }

  async getCode(address: `0x${string}`, blockNumber: "latest" | string): Promise<Hex> {
    await this.#ensureChain();
    const blockTag =
      blockNumber === "latest" ? blockNumber : toHex(decimalBlock(blockNumber, "blockNumber"));
    const code = await this.#rpc<Hex>("eth_getCode", [address.toLowerCase(), blockTag]);
    if (typeof code !== "string" || !code.startsWith("0x")) {
      throw new Error("RPC_CODE_RESPONSE_INVALID");
    }
    return code.toLowerCase() as Hex;
  }

  async read(after: IndexerCursor | null): Promise<RawLogPage | null> {
    await this.#ensureChain();
    if (after && after.chainId !== 56) throw new Error("RPC_CURSOR_CHAIN_UNSUPPORTED");
    const latest = await this.#block("latest");
    const head = BigInt(latest.number);
    const scanAfterValue = after?.value ?? null;
    if (!this.#scanInitialized || scanAfterValue !== this.#scanAfterValue) {
      this.#nextScanBlock = after ? BigInt(after.blockNumber) : this.#fromBlock;
      this.#scanAfterValue = scanAfterValue;
      this.#scanInitialized = true;
    }
    let fromBlock = this.#nextScanBlock;
    for (let page = 0; page < this.#maxPagesPerRead && fromBlock <= head; page += 1) {
      const toBlock =
        fromBlock + this.#maxBlockSpan - 1n < head ? fromBlock + this.#maxBlockSpan - 1n : head;
      const logs = (await this.#logs(fromBlock, toBlock)).map((log) => this.#normalizeLog(log));
      const eligible = after ? logs.filter((log) => afterCursor(log, after)) : logs;
      if (eligible.length > 0) {
        const deliveries = await Promise.all(eligible.map((log) => this.#delivery(log)));
        return { chainId: 56, deliveries };
      }
      fromBlock = toBlock + 1n;
      this.#nextScanBlock = fromBlock;
    }
    return null;
  }
}

export function createViemBscLogSourceFromEnv(
  options: ViemBscLogSourceEnvOptions,
  environment: NodeJS.ProcessEnv = process.env,
): ViemBscLogSource {
  const rpcUrl = environment.BSC_RPC_URL;
  if (!rpcUrl) throw new Error("BSC_RPC_URL_MISSING");
  return new ViemBscLogSource({ ...options, rpcUrl });
}
