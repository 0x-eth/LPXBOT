export const browserReadonlyRpcMethods = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_call",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
] as const;

export type BrowserReadonlyRpcMethod = (typeof browserReadonlyRpcMethods)[number];
export type BrowserRpcState =
  | "chain-mismatch"
  | "invalid-response"
  | "network-error"
  | "rate-limited"
  | "ready"
  | "testing"
  | "timeout"
  | "unconfigured";

export type BrowserRpcErrorCode =
  | "CLIENT_RPC_CHAIN_MISMATCH"
  | "CLIENT_RPC_INVALID_RESPONSE"
  | "CLIENT_RPC_METHOD_DENIED"
  | "CLIENT_RPC_NETWORK_ERROR"
  | "CLIENT_RPC_PROVIDER_ERROR"
  | "CLIENT_RPC_RATE_LIMITED"
  | "CLIENT_RPC_TIMEOUT"
  | "CLIENT_RPC_URL_INVALID";

export class BrowserRpcError extends Error {
  readonly code: BrowserRpcErrorCode;
  readonly retryable: boolean;
  readonly state: BrowserRpcState;

  constructor(code: BrowserRpcErrorCode, retryable: boolean, state: BrowserRpcState) {
    super(code);
    this.name = "BrowserRpcError";
    this.code = code;
    this.retryable = retryable;
    this.state = state;
  }
}

export interface BrowserReadonlyRpcRequest {
  method: string;
  params?: readonly unknown[];
}

export interface BrowserReadonlyRpcClientOptions {
  development?: boolean;
  fetcher?: typeof fetch;
  now?: () => number;
  url: string;
}

export const browserRpcLimits = Object.freeze({
  concurrentRequests: 2,
  redirects: 0,
  requestsPerSecond: 5,
  responseBodyBytes: 1_048_576,
  timeoutMs: 8_000,
});

const allowedMethods = new Set<string>(browserReadonlyRpcMethods);
const hexQuantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function validateBrowserRpcUrl(value: string, development = false): URL {
  if (new TextEncoder().encode(value).byteLength > 2_048) {
    throw new BrowserRpcError("CLIENT_RPC_URL_INVALID", false, "invalid-response");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserRpcError("CLIENT_RPC_URL_INVALID", false, "invalid-response");
  }
  const secure = url.protocol === "https:";
  const developmentLoopback = development && url.protocol === "http:" && loopback(url.hostname);
  if (
    (!secure && !developmentLoopback) ||
    url.hash !== "" ||
    !url.hostname ||
    (url.port !== "" && (!/^[0-9]+$/u.test(url.port) || Number(url.port) > 65_535))
  ) {
    throw new BrowserRpcError("CLIENT_RPC_URL_INVALID", false, "invalid-response");
  }
  return url;
}

export function redactBrowserRpcUrl(value: string, development = false): string {
  const url = validateBrowserRpcUrl(value, development);
  return `${url.protocol}//${url.host}/<redacted>`;
}

async function limitedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      BigInt(declaredLength) > BigInt(browserRpcLimits.responseBodyBytes))
  ) {
    throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > browserRpcLimits.responseBodyBytes) {
      throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > browserRpcLimits.responseBodyBytes) {
        await reader.cancel();
        throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
    }
  } finally {
    reader.releaseLock();
  }
}

export class BrowserReadonlyRpcClient {
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #url: string;
  readonly #waiting: Array<() => void> = [];
  readonly #requestTimes: number[] = [];
  #active = 0;
  #id = 0;

  constructor(options: BrowserReadonlyRpcClientOptions) {
    this.#url = validateBrowserRpcUrl(options.url, options.development).href;
    this.#fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.#now = options.now ?? (() => Date.now());
  }

  async request(input: BrowserReadonlyRpcRequest): Promise<unknown> {
    if (
      !isRecord(input) ||
      Object.keys(input).some((key) => key !== "method" && key !== "params") ||
      typeof input.method !== "string" ||
      !allowedMethods.has(input.method) ||
      (input.params !== undefined && !Array.isArray(input.params))
    ) {
      throw new BrowserRpcError("CLIENT_RPC_METHOD_DENIED", false, "invalid-response");
    }
    this.#consumeRate();
    await this.#acquire();
    const id = ++this.#id;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), browserRpcLimits.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.#fetcher(this.#url, {
          body: JSON.stringify({
            id,
            jsonrpc: "2.0",
            method: input.method,
            params: input.params ?? [],
          }),
          cache: "no-store",
          credentials: "omit",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
          mode: "cors",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new BrowserRpcError("CLIENT_RPC_TIMEOUT", true, "timeout");
        }
        throw new BrowserRpcError("CLIENT_RPC_NETWORK_ERROR", true, "network-error");
      }
      if (!response.ok || response.redirected) {
        throw new BrowserRpcError("CLIENT_RPC_NETWORK_ERROR", true, "network-error");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await limitedResponseText(response));
      } catch (error) {
        if (error instanceof BrowserRpcError) throw error;
        throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
      }
      if (
        !isRecord(parsed) ||
        parsed.jsonrpc !== "2.0" ||
        parsed.id !== id ||
        Object.hasOwn(parsed, "result") === Object.hasOwn(parsed, "error")
      ) {
        throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
      }
      if (Object.hasOwn(parsed, "error")) {
        throw new BrowserRpcError("CLIENT_RPC_PROVIDER_ERROR", false, "invalid-response");
      }
      return parsed.result;
    } finally {
      globalThis.clearTimeout(timeout);
      this.#release();
    }
  }

  async testConnection(expectedChainId: number): Promise<{ blockNumber: string; chainId: number }> {
    if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) {
      throw new BrowserRpcError("CLIENT_RPC_CHAIN_MISMATCH", false, "chain-mismatch");
    }
    const [chainResult, blockResult] = await Promise.all([
      this.request({ method: "eth_chainId" }),
      this.request({ method: "eth_blockNumber" }),
    ]);
    if (
      typeof chainResult !== "string" ||
      typeof blockResult !== "string" ||
      !hexQuantityPattern.test(chainResult) ||
      !hexQuantityPattern.test(blockResult)
    ) {
      throw new BrowserRpcError("CLIENT_RPC_INVALID_RESPONSE", false, "invalid-response");
    }
    if (BigInt(chainResult) !== BigInt(expectedChainId)) {
      throw new BrowserRpcError("CLIENT_RPC_CHAIN_MISMATCH", false, "chain-mismatch");
    }
    return { blockNumber: BigInt(blockResult).toString(), chainId: expectedChainId };
  }

  #consumeRate(): void {
    const current = this.#now();
    while (this.#requestTimes.length > 0 && this.#requestTimes[0]! <= current - 1_000) {
      this.#requestTimes.shift();
    }
    if (this.#requestTimes.length >= browserRpcLimits.requestsPerSecond) {
      throw new BrowserRpcError("CLIENT_RPC_RATE_LIMITED", true, "rate-limited");
    }
    this.#requestTimes.push(current);
  }

  async #acquire(): Promise<void> {
    if (this.#active < browserRpcLimits.concurrentRequests) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
  }

  #release(): void {
    this.#active -= 1;
    this.#waiting.shift()?.();
  }
}

export class BrowserCustomRpcSession {
  #client: BrowserReadonlyRpcClient | null = null;

  clear(): void {
    this.#client = null;
  }

  configure(options: BrowserReadonlyRpcClientOptions): BrowserReadonlyRpcClient {
    const client = new BrowserReadonlyRpcClient(options);
    this.#client = client;
    return client;
  }

  get configured(): boolean {
    return this.#client !== null;
  }

  request(input: BrowserReadonlyRpcRequest): Promise<unknown> {
    if (!this.#client) {
      throw new BrowserRpcError("CLIENT_RPC_URL_INVALID", false, "unconfigured");
    }
    return this.#client.request(input);
  }
}

export const browserCustomRpcSession = new BrowserCustomRpcSession();
