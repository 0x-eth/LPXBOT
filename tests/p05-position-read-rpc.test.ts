import {
  BscPositionReadRpcClient,
  createBscPositionReadRpcFromEnv,
  POSITION_READ_RPC_METHODS,
} from "../packages/chain-adapters/src/index.js";
import { describe, expect, it, vi } from "vitest";

const blockHash = `0x${"ab".repeat(32)}` as const;
const manager = "0x1111111111111111111111111111111111111111" as const;

function rpcResponse(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ id, jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
  });
}

function fixtureFetch() {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (request.method === "eth_chainId") return rpcResponse(request.id, "0x38");
    if (request.method === "eth_call") return rpcResponse(request.id, "0x1234");
    if (request.method === "eth_getCode") return rpcResponse(request.id, "0x6000");
    if (request.method === "eth_getBalance") return rpcResponse(request.id, "0x2a");
    if (request.method === "eth_getLogs") {
      return rpcResponse(request.id, [
        {
          address: manager,
          blockHash,
          blockNumber: "0x64",
          data: "0x",
          logIndex: "0x1",
          removed: false,
          topics: [blockHash],
          transactionHash: `0x${"cd".repeat(32)}`,
        },
      ]);
    }
    if (request.method === "eth_getBlockByNumber") {
      return rpcResponse(request.id, {
        hash: blockHash,
        number: "0x64",
        timestamp: "0x66c53f10",
      });
    }
    if (request.method === "eth_blockNumber") return rpcResponse(request.id, "0x64");
    throw new Error(`unexpected method ${request.method}`);
  });
}

describe("P05-02 controlled server-side BSC position RPC", () => {
  it("has an exact read-only method allowlist and rejects writes before transport", async () => {
    expect(POSITION_READ_RPC_METHODS).toEqual([
      "eth_chainId",
      "eth_blockNumber",
      "eth_call",
      "eth_getCode",
      "eth_getLogs",
      "eth_getBalance",
      "eth_getBlockByNumber",
    ]);
    const fetcher = fixtureFetch();
    const rpc = new BscPositionReadRpcClient({
      allowInsecureLoopback: true,
      fetch: fetcher,
      rpcUrl: "http://127.0.0.1:8545",
    });
    for (const method of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "eth_sign",
      "personal_sign",
      "debug_traceCall",
    ]) {
      await expect(rpc.request(method, [])).rejects.toThrow(/POSITION_RPC_METHOD_FORBIDDEN/u);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("pins every call to a decimal block and parses base-unit reads without floats", async () => {
    const fetcher = fixtureFetch();
    const rpc = new BscPositionReadRpcClient({
      allowInsecureLoopback: true,
      fetch: fetcher,
      rpcUrl: "http://localhost:8545",
    });

    await expect(rpc.call({ blockNumber: "100", data: "0x1234", to: manager })).resolves.toBe(
      "0x1234",
    );
    await expect(rpc.getCode(manager, "100")).resolves.toBe("0x6000");
    await expect(rpc.getBalance(manager, "100")).resolves.toBe(42n);
    await expect(rpc.getBlock("100")).resolves.toEqual({
      blockHash,
      blockNumber: "100",
      blockTimestamp: "2024-08-21T01:12:48.000Z",
    });
    await expect(
      rpc.getLogs({
        address: manager,
        fromBlock: "99",
        toBlock: "100",
        topics: [blockHash],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ address: manager, blockNumber: "100", logIndex: 1 }),
    ]);

    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.filter(({ method }) => method !== "eth_chainId")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "eth_call",
          params: [{ data: "0x1234", to: manager }, "0x64"],
        }),
        expect.objectContaining({ method: "eth_getCode", params: [manager, "0x64"] }),
        expect.objectContaining({ method: "eth_getBalance", params: [manager, "0x64"] }),
        expect.objectContaining({ method: "eth_getBlockByNumber", params: ["0x64", false] }),
      ]),
    );
    expect(bodies.filter(({ method }) => method === "eth_chainId")).toHaveLength(1);
  });

  it("creates only from server environment and fails closed on missing URL or wrong chain", async () => {
    expect(() => createBscPositionReadRpcFromEnv({})).toThrow(/BSC_POSITION_READ_RPC_URL_MISSING/u);
    expect(() =>
      createBscPositionReadRpcFromEnv({ BSC_POSITION_READ_RPC_URL: "http://rpc.invalid" }),
    ).toThrow(/POSITION_RPC_URL_INVALID/u);

    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return rpcResponse(request.id, "0x1");
    });
    const rpc = createBscPositionReadRpcFromEnv(
      { BSC_POSITION_READ_RPC_URL: "http://127.0.0.1:8545" },
      { allowInsecureLoopback: true, fetch: fetcher },
    );
    await expect(rpc.getBlock("latest")).rejects.toThrow(/POSITION_RPC_CHAIN_MISMATCH/u);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed provider envelopes and oversized log ranges", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 99, jsonrpc: "2.0", result: "0x38" })));
    const rpc = new BscPositionReadRpcClient({
      allowInsecureLoopback: true,
      fetch: fetcher,
      maxLogBlockSpan: 5_000,
      rpcUrl: "http://127.0.0.1:8545",
    });
    await expect(rpc.getBlock("latest")).rejects.toThrow(/POSITION_RPC_INVALID_RESPONSE/u);
    await expect(
      rpc.getLogs({ address: manager, fromBlock: "1", toBlock: "5002", topics: [] }),
    ).rejects.toThrow(/POSITION_RPC_FILTER_INVALID/u);
  });
});
