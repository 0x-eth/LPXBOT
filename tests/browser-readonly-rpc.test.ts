import {
  BrowserReadonlyRpcClient,
  BrowserRpcError,
  browserReadonlyRpcMethods,
  browserRpcLimits,
  redactBrowserRpcUrl,
  validateBrowserRpcUrl,
} from "../apps/web/src/browser-readonly-rpc.js";
import { afterEach, describe, expect, it, vi } from "vitest";

interface RpcBody {
  id: number;
  jsonrpc: "2.0";
  method: string;
  params: unknown[];
}

function parseBody(init?: RequestInit): RpcBody {
  return JSON.parse(String(init?.body)) as RpcBody;
}

function success(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function fixtureFetcher() {
  return vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const body = parseBody(init);
    const result =
      body.method === "eth_chainId"
        ? "0x38"
        : body.method === "eth_blockNumber"
          ? "0x2dc6c01"
          : "0x0";
    return success(body.id, result);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("P04-05 browser-only read RPC", () => {
  it("accepts HTTPS, limits the development exception to loopback, and redacts every secret URL part", () => {
    expect(validateBrowserRpcUrl("https://user:pass@rpc.fixture:8443/private?k=secret").protocol).toBe(
      "https:",
    );
    expect(redactBrowserRpcUrl("https://user:pass@rpc.fixture:8443/private?k=secret")).toBe(
      "https://rpc.fixture:8443/<redacted>",
    );
    expect(validateBrowserRpcUrl("http://127.0.0.1:8545", true).href).toBe(
      "http://127.0.0.1:8545/",
    );
    for (const value of [
      "http://rpc.fixture",
      "ws://rpc.fixture",
      "https://rpc.fixture/path#fragment",
      `https://rpc.fixture/${"x".repeat(2_048)}`,
    ]) {
      expect(() => validateBrowserRpcUrl(value)).toThrowError(
        expect.objectContaining<Partial<BrowserRpcError>>({ code: "CLIENT_RPC_URL_INVALID" }),
      );
    }
    expect(
      () => new BrowserReadonlyRpcClient({ url: "https://rpc.fixture/private?token=secret" }),
    ).toThrowError(
      expect.objectContaining<Partial<BrowserRpcError>>({
        code: "CLIENT_RPC_URL_INVALID",
        state: "unconfigured",
      }),
    );
  });

  it("uses a default-deny method boundary and fixed no-credential, no-redirect fetch options", async () => {
    const fetcher = fixtureFetcher();
    const client = new BrowserReadonlyRpcClient({ fetcher, url: "https://rpc.fixture/private" });
    await expect(client.request({ method: "eth_blockNumber" })).resolves.toBe("0x2dc6c01");
    expect(fetcher).toHaveBeenCalledWith(
      "https://rpc.fixture/private",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        method: "POST",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(parseBody(fetcher.mock.calls[0]?.[1])).toEqual({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
    });

    for (const method of [
      "eth_accounts",
      "eth_requestAccounts",
      "eth_sendRawTransaction",
      "eth_sendTransaction",
      "eth_sign",
      "personal_sign",
      "eth_subscribe",
      "wallet_switchEthereumChain",
      "debug_traceCall",
    ]) {
      await expect(client.request({ method })).rejects.toMatchObject({
        code: "CLIENT_RPC_METHOD_DENIED",
        retryable: false,
      });
    }
    await expect(
      client.request([] as unknown as { method: string }),
    ).rejects.toMatchObject({ code: "CLIENT_RPC_METHOD_DENIED" });
    expect(browserReadonlyRpcMethods).not.toContain("eth_sendTransaction");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds eth_call targets and eth_getLogs ranges to the frozen read policy", async () => {
    const fetcher = fixtureFetcher();
    const client = new BrowserReadonlyRpcClient({ fetcher, url: "https://rpc.fixture" });
    await expect(
      client.request({
        method: "eth_call",
        params: [{ data: "0x1234", to: "0x1111111111111111111111111111111111111111" }, "latest"],
      }),
    ).resolves.toBe("0x0");
    await expect(
      client.request({
        method: "eth_getLogs",
        params: [{ fromBlock: "0x1", toBlock: "0x1389" }],
      }),
    ).resolves.toBe("0x0");
    await expect(client.request({ method: "eth_call", params: [{ data: "0x" }] })).rejects.toMatchObject({
      code: "CLIENT_RPC_METHOD_DENIED",
    });
    await expect(
      client.request({
        method: "eth_getLogs",
        params: [{ fromBlock: "0x1", toBlock: "0x138a" }],
      }),
    ).rejects.toMatchObject({ code: "CLIENT_RPC_METHOD_DENIED" });
    await expect(
      client.request({
        method: "eth_getLogs",
        params: [{ blockHash: `0x${"1".repeat(64)}`, fromBlock: "0x1", toBlock: "0x1" }],
      }),
    ).rejects.toMatchObject({ code: "CLIENT_RPC_METHOD_DENIED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("strictly validates JSON-RPC envelopes, provider failures, and the 1 MiB response cap", async () => {
    const cases: Array<{ expected: string; response: (id: number) => Response }> = [
      {
        expected: "CLIENT_RPC_INVALID_RESPONSE",
        response: (id) => new Response(JSON.stringify([{ id, jsonrpc: "2.0", result: "0x1" }])),
      },
      {
        expected: "CLIENT_RPC_INVALID_RESPONSE",
        response: (id) => success(id + 1, "0x1"),
      },
      {
        expected: "CLIENT_RPC_PROVIDER_ERROR",
        response: (id) =>
          new Response(JSON.stringify({ error: { code: -32_000, data: "secret" }, id, jsonrpc: "2.0" })),
      },
      {
        expected: "CLIENT_RPC_INVALID_RESPONSE",
        response: () =>
          new Response("{}", {
            headers: { "Content-Length": String(browserRpcLimits.responseBodyBytes + 1) },
          }),
      },
      {
        expected: "CLIENT_RPC_INVALID_RESPONSE",
        response: () => new Response(new Uint8Array([0xff])),
      },
    ];
    for (const testCase of cases) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
        testCase.response(parseBody(init).id),
      );
      const client = new BrowserReadonlyRpcClient({ fetcher, url: "https://rpc.fixture" });
      await expect(client.request({ method: "eth_blockNumber" })).rejects.toMatchObject({
        code: testCase.expected,
      });
    }
  });

  it("enforces five requests per second and at most two in-flight requests", async () => {
    const now = () => 10_000;
    const fastFetcher = fixtureFetcher();
    const rateClient = new BrowserReadonlyRpcClient({ fetcher: fastFetcher, now, url: "https://rpc.fixture" });
    for (let index = 0; index < 5; index += 1) {
      await rateClient.request({ method: "eth_blockNumber" });
    }
    await expect(rateClient.request({ method: "eth_blockNumber" })).rejects.toMatchObject({
      code: "CLIENT_RPC_RATE_LIMITED",
      state: "rate-limited",
    });

    const pending: Array<{ id: number; resolve: (value: Response) => void }> = [];
    const slowFetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((resolve) => {
          pending.push({ id: parseBody(init).id, resolve });
        }),
    );
    const concurrencyClient = new BrowserReadonlyRpcClient({
      fetcher: slowFetcher,
      url: "https://rpc.fixture",
    });
    const requests = [1, 2, 3].map(() => concurrencyClient.request({ method: "eth_blockNumber" }));
    await vi.waitFor(() => expect(slowFetcher).toHaveBeenCalledTimes(2));
    pending[0]!.resolve(success(pending[0]!.id, "0x1"));
    await vi.waitFor(() => expect(slowFetcher).toHaveBeenCalledTimes(3));
    pending[1]!.resolve(success(pending[1]!.id, "0x2"));
    pending[2]!.resolve(success(pending[2]!.id, "0x3"));
    await expect(Promise.all(requests)).resolves.toEqual(["0x1", "0x2", "0x3"]);
  });

  it("applies an eight-second total network timeout and validates chain test responses", async () => {
    vi.useFakeTimers();
    const hangingFetcher = vi.fn<typeof fetch>().mockImplementation(
      async () => await new Promise<Response>(() => undefined),
    );
    const client = new BrowserReadonlyRpcClient({ fetcher: hangingFetcher, url: "https://rpc.fixture" });
    const request = client.request({ method: "eth_blockNumber" });
    await vi.advanceTimersByTimeAsync(browserRpcLimits.timeoutMs);
    await expect(request).rejects.toMatchObject({
      code: "CLIENT_RPC_TIMEOUT",
      retryable: true,
      state: "timeout",
    });
    vi.useRealTimers();

    const connection = new BrowserReadonlyRpcClient({
      fetcher: fixtureFetcher(),
      url: "https://rpc.fixture",
    });
    await expect(connection.testConnection(56)).resolves.toEqual({
      blockNumber: "48000001",
      chainId: 56,
    });
    await expect(connection.testConnection(1)).rejects.toMatchObject({
      code: "CLIENT_RPC_CHAIN_MISMATCH",
      state: "chain-mismatch",
    });
  });
});
