import { toHex, type Address, type Hex } from "viem";

import type {
  PositionReadLog,
  PositionReadRpc,
  PositionReadSnapshot,
} from "./position-read-adapters.js";

export const POSITION_READ_RPC_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBalance",
  "eth_getBlockByNumber",
] as const;

export type PositionReadRpcMethod = (typeof POSITION_READ_RPC_METHODS)[number];

export interface BscPositionReadRpcClientOptions {
  allowInsecureLoopback?: boolean;
  fetch?: typeof fetch;
  maxLogBlockSpan?: number;
  rpcUrl: string;
  timeoutMilliseconds?: number;
}

export type BscPositionReadRpcEnvironment = Readonly<
  Partial<Record<"BSC_POSITION_READ_RPC_URL", string | undefined>>
>;

export type BscPositionReadRpcEnvironmentOptions = Omit<BscPositionReadRpcClientOptions, "rpcUrl">;

interface RpcEnvelope {
  error?: unknown;
  id?: unknown;
  jsonrpc?: unknown;
  result?: unknown;
}

interface RpcBlock {
  hash?: unknown;
  number?: unknown;
  timestamp?: unknown;
}

interface RpcLog {
  address?: unknown;
  blockHash?: unknown;
  blockNumber?: unknown;
  data?: unknown;
  logIndex?: unknown;
  removed?: unknown;
  topics?: unknown;
  transactionHash?: unknown;
}

const allowedMethods = new Set<string>(POSITION_READ_RPC_METHODS);
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const dataPattern = /^0x(?:[0-9a-fA-F]{2})*$/u;
const hashPattern = /^0x[0-9a-fA-F]{64}$/u;
const quantityPattern = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const maximumResponseBytes = 4 * 1_024 * 1_024;

function loopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function positionRpcUrl(value: string, allowInsecureLoopback: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("POSITION_RPC_URL_INVALID");
  }
  const secure = url.protocol === "https:";
  const local = allowInsecureLoopback && url.protocol === "http:" && loopback(url.hostname);
  if (
    (!secure && !local) ||
    !url.hostname ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("POSITION_RPC_URL_INVALID");
  }
  return url.href;
}

function decimalBlock(value: string, label: string): bigint {
  if (!decimalPattern.test(value)) throw new Error(`POSITION_RPC_${label}_INVALID`);
  return BigInt(value);
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
  return value.toLowerCase() as Address;
}

function data(value: unknown): Hex {
  if (typeof value !== "string" || !dataPattern.test(value)) {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
  return value.toLowerCase() as Hex;
}

function hash(value: unknown): Hex {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
  return value.toLowerCase() as Hex;
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !quantityPattern.test(value)) {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
  return BigInt(value);
}

function safeIndex(value: unknown): number {
  const parsed = quantity(value);
  const result = Number(parsed);
  if (!Number.isSafeInteger(result)) throw new Error("POSITION_RPC_INVALID_RESPONSE");
  return result;
}

function topicFilter(value: Hex | readonly Hex[] | null): Hex | readonly Hex[] | null {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((entry) => hash(entry));
  return hash(value);
}

async function boundedResponseText(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && (!decimalPattern.test(length) || BigInt(length) > maximumResponseBytes)) {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumResponseBytes) throw new Error("POSITION_RPC_INVALID_RESPONSE");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("POSITION_RPC_INVALID_RESPONSE");
  }
}

export class BscPositionReadRpcClient implements PositionReadRpc {
  readonly #fetch: typeof fetch;
  readonly #maxLogBlockSpan: bigint;
  readonly #rpcUrl: string;
  readonly #timeoutMilliseconds: number;
  #chainVerified = false;
  #requestId = 0;

  constructor(options: BscPositionReadRpcClientOptions) {
    const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
    const maxLogBlockSpan = options.maxLogBlockSpan ?? 5_000;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 100) {
      throw new Error("POSITION_RPC_TIMEOUT_INVALID");
    }
    if (!Number.isSafeInteger(maxLogBlockSpan) || maxLogBlockSpan < 1) {
      throw new Error("POSITION_RPC_FILTER_INVALID");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxLogBlockSpan = BigInt(maxLogBlockSpan);
    this.#rpcUrl = positionRpcUrl(options.rpcUrl, options.allowInsecureLoopback === true);
    this.#timeoutMilliseconds = timeoutMilliseconds;
  }

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!allowedMethods.has(method)) throw new Error(`POSITION_RPC_METHOD_FORBIDDEN: ${method}`);
    if (!Array.isArray(params)) throw new Error("POSITION_RPC_PARAMS_INVALID");
    if (method !== "eth_chainId" && !this.#chainVerified) await this.#ensureChain();
    return this.#request(method as PositionReadRpcMethod, params);
  }

  async call(input: { blockNumber: string; data: Hex; to: Address }): Promise<Hex> {
    const blockNumber = decimalBlock(input.blockNumber, "BLOCK");
    if (!addressPattern.test(input.to) || !dataPattern.test(input.data)) {
      throw new Error("POSITION_RPC_CALL_INVALID");
    }
    return data(
      await this.request("eth_call", [
        { data: input.data.toLowerCase(), to: input.to.toLowerCase() },
        toHex(blockNumber),
      ]),
    );
  }

  async getBalance(inputAddress: Address, inputBlockNumber: string): Promise<bigint> {
    const blockNumber = decimalBlock(inputBlockNumber, "BLOCK");
    if (!addressPattern.test(inputAddress)) throw new Error("POSITION_RPC_ADDRESS_INVALID");
    return quantity(
      await this.request("eth_getBalance", [inputAddress.toLowerCase(), toHex(blockNumber)]),
    );
  }

  async getBlock(blockNumber: string | "latest"): Promise<PositionReadSnapshot> {
    const requested = blockNumber === "latest" ? null : decimalBlock(blockNumber, "BLOCK");
    const tag = requested === null ? "latest" : toHex(requested);
    const value = await this.request("eth_getBlockByNumber", [tag, false]);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("POSITION_RPC_INVALID_RESPONSE");
    }
    const block = value as RpcBlock;
    const observedNumber = quantity(block.number);
    if (requested !== null && requested !== observedNumber) {
      throw new Error("POSITION_RPC_BLOCK_MISMATCH");
    }
    const timestamp = quantity(block.timestamp);
    const milliseconds = timestamp * 1_000n;
    if (milliseconds > 8_640_000_000_000_000n) {
      throw new Error("POSITION_RPC_INVALID_RESPONSE");
    }
    return {
      blockHash: hash(block.hash),
      blockNumber: observedNumber.toString(),
      blockTimestamp: new Date(Number(milliseconds)).toISOString(),
    };
  }

  async getCode(inputAddress: Address, inputBlockNumber: string): Promise<Hex> {
    const blockNumber = decimalBlock(inputBlockNumber, "BLOCK");
    if (!addressPattern.test(inputAddress)) throw new Error("POSITION_RPC_ADDRESS_INVALID");
    return data(
      await this.request("eth_getCode", [inputAddress.toLowerCase(), toHex(blockNumber)]),
    );
  }

  async getLogs(input: {
    address: Address;
    fromBlock: string;
    toBlock: string;
    topics: readonly (Hex | readonly Hex[] | null)[];
  }): Promise<readonly PositionReadLog[]> {
    const fromBlock = decimalBlock(input.fromBlock, "FILTER");
    const toBlock = decimalBlock(input.toBlock, "FILTER");
    if (
      !addressPattern.test(input.address) ||
      toBlock < fromBlock ||
      toBlock - fromBlock + 1n > this.#maxLogBlockSpan ||
      input.topics.length > 4
    ) {
      throw new Error("POSITION_RPC_FILTER_INVALID");
    }
    let topics: readonly (Hex | readonly Hex[] | null)[];
    try {
      topics = input.topics.map(topicFilter);
    } catch {
      throw new Error("POSITION_RPC_FILTER_INVALID");
    }
    const value = await this.request("eth_getLogs", [
      {
        address: input.address.toLowerCase(),
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
        topics,
      },
    ]);
    if (!Array.isArray(value)) throw new Error("POSITION_RPC_INVALID_RESPONSE");
    return value.map((item): PositionReadLog => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error("POSITION_RPC_INVALID_RESPONSE");
      }
      const log = item as RpcLog;
      if (log.removed !== false || !Array.isArray(log.topics)) {
        throw new Error("POSITION_RPC_INVALID_RESPONSE");
      }
      const observedBlock = quantity(log.blockNumber);
      if (observedBlock < fromBlock || observedBlock > toBlock) {
        throw new Error("POSITION_RPC_INVALID_RESPONSE");
      }
      return {
        address: address(log.address),
        blockHash: hash(log.blockHash),
        blockNumber: observedBlock.toString(),
        data: data(log.data),
        logIndex: safeIndex(log.logIndex),
        topics: log.topics.map(hash),
        transactionHash: hash(log.transactionHash),
      };
    });
  }

  async #ensureChain(): Promise<void> {
    const value = quantity(await this.#request("eth_chainId", []));
    if (value !== 56n) throw new Error("POSITION_RPC_CHAIN_MISMATCH");
    this.#chainVerified = true;
  }

  async #request(method: PositionReadRpcMethod, params: readonly unknown[]): Promise<unknown> {
    const id = ++this.#requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.#fetch(this.#rpcUrl, {
          body: JSON.stringify({ id, jsonrpc: "2.0", method, params }),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
      } catch {
        throw new Error(
          controller.signal.aborted ? "POSITION_RPC_TIMEOUT" : "POSITION_RPC_UNAVAILABLE",
        );
      }
      if (!response.ok || response.redirected) throw new Error("POSITION_RPC_UNAVAILABLE");
      let envelope: RpcEnvelope;
      try {
        envelope = JSON.parse(await boundedResponseText(response)) as RpcEnvelope;
      } catch (error) {
        if (error instanceof Error && error.message === "POSITION_RPC_INVALID_RESPONSE")
          throw error;
        throw new Error("POSITION_RPC_INVALID_RESPONSE", { cause: error });
      }
      if (
        typeof envelope !== "object" ||
        envelope === null ||
        Array.isArray(envelope) ||
        envelope.jsonrpc !== "2.0" ||
        envelope.id !== id ||
        Object.hasOwn(envelope, "result") === Object.hasOwn(envelope, "error")
      ) {
        throw new Error("POSITION_RPC_INVALID_RESPONSE");
      }
      if (Object.hasOwn(envelope, "error")) throw new Error("POSITION_RPC_PROVIDER_ERROR");
      return envelope.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createBscPositionReadRpcFromEnv(
  environment: BscPositionReadRpcEnvironment = process.env,
  options: BscPositionReadRpcEnvironmentOptions = {},
): BscPositionReadRpcClient {
  const rpcUrl = environment.BSC_POSITION_READ_RPC_URL;
  if (!rpcUrl) throw new Error("BSC_POSITION_READ_RPC_URL_MISSING");
  return new BscPositionReadRpcClient({ ...options, rpcUrl });
}
