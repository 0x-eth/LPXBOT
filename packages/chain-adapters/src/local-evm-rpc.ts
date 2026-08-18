export const LOCAL_EVM_READ_METHODS = [
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
] as const;

export type LocalEvmReadMethod = (typeof LOCAL_EVM_READ_METHODS)[number];

interface RpcResponse {
  error?: { code?: number; message?: string };
  id?: number;
  jsonrpc?: string;
  result?: unknown;
}

export interface LocalEvmRpcClientOptions {
  expectedChainId: number;
  fetch?: typeof fetch;
  providerId: string;
  rpcUrl: string;
  timeoutMilliseconds?: number;
}

const allowedMethods = new Set<string>(LOCAL_EVM_READ_METHODS);

function loopbackHostname(value: string): boolean {
  const hostname = value.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function localEvmRpcUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("LOCAL_EVM_RPC_URL_INVALID");
  }
  if (
    url.protocol !== "http:" ||
    !loopbackHostname(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new RangeError("LOCAL_EVM_RPC_URL_INVALID");
  }
  return url.href;
}

export class LocalEvmRpcClient {
  readonly #expectedChainId: bigint;
  readonly #fetch: typeof fetch;
  readonly #providerId: string;
  readonly #rpcUrl: string;
  readonly #timeoutMilliseconds: number;
  #chainVerified = false;
  #requestId = 0;

  constructor(options: LocalEvmRpcClientOptions) {
    if (!Number.isSafeInteger(options.expectedChainId) || options.expectedChainId < 1) {
      throw new RangeError("LOCAL_EVM_CHAIN_ID_INVALID");
    }
    if (!/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(options.providerId)) {
      throw new RangeError("LOCAL_EVM_PROVIDER_ID_INVALID");
    }
    const timeoutMilliseconds = options.timeoutMilliseconds ?? 5_000;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 100) {
      throw new RangeError("LOCAL_EVM_RPC_TIMEOUT_INVALID");
    }
    this.#expectedChainId = BigInt(options.expectedChainId);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#providerId = options.providerId;
    this.#rpcUrl = localEvmRpcUrl(options.rpcUrl);
    this.#timeoutMilliseconds = timeoutMilliseconds;
  }

  get providerId(): string {
    return this.#providerId;
  }

  async request<T>(method: LocalEvmReadMethod, params: readonly unknown[]): Promise<T> {
    if (!allowedMethods.has(method)) throw new Error(`LOCAL_EVM_RPC_METHOD_FORBIDDEN: ${method}`);
    if (method !== "eth_chainId" && !this.#chainVerified) await this.#ensureChain();
    return (await this.#request(method, params)) as T;
  }

  async #ensureChain(): Promise<void> {
    const chainId = await this.#request("eth_chainId", []);
    if (typeof chainId !== "string" || BigInt(chainId) !== this.#expectedChainId) {
      throw new Error("LOCAL_EVM_RPC_CHAIN_MISMATCH");
    }
    this.#chainVerified = true;
  }

  async #request(method: LocalEvmReadMethod, params: readonly unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMilliseconds);
    try {
      const response = await this.#fetch(this.#rpcUrl, {
        body: JSON.stringify({ id: ++this.#requestId, jsonrpc: "2.0", method, params }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`LOCAL_EVM_RPC_HTTP_${String(response.status)}`);
      const payload = (await response.json()) as RpcResponse;
      if (payload.error) {
        throw new Error(`LOCAL_EVM_RPC_ERROR_${String(payload.error.code ?? "UNKNOWN")}`);
      }
      return payload.result;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("LOCAL_EVM_RPC_")) throw error;
      throw new Error("LOCAL_EVM_RPC_UNAVAILABLE", { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }
}
