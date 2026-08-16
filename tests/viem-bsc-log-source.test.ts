import { createServer, type Server } from "node:http";

import {
  READONLY_BSC_RPC_METHODS,
  ViemBscLogSource,
} from "../packages/chain-adapters/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

interface RpcCall {
  method: string;
  params: unknown[];
}

const servers: Server[] = [];

async function mockRpc(
  respond: (call: RpcCall, attempt: number) => { body?: unknown; status?: number },
): Promise<{ calls: RpcCall[]; url: string }> {
  const calls: RpcCall[] = [];
  const attempts = new Map<string, number>();
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params?: unknown[] };
      const call = { method: rpc.method, params: rpc.params ?? [] };
      calls.push(call);
      const attempt = (attempts.get(call.method) ?? 0) + 1;
      attempts.set(call.method, attempt);
      const result = respond(call, attempt);
      response.statusCode = result.status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          result.body ?? { id: rpc.id, jsonrpc: "2.0", result: rpc.method === "eth_chainId" ? "0x38" : null },
        ),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock RPC did not bind");
  return { calls, url: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P02-03 ViemBscLogSource", () => {
  it("exposes only the five approved read-only JSON-RPC methods", () => {
    expect(READONLY_BSC_RPC_METHODS).toEqual([
      "eth_chainId",
      "eth_getLogs",
      "eth_getBlockByNumber",
      "eth_getTransactionReceipt",
      "eth_getCode",
    ]);
  });

  it("rejects signing, personal, and transaction methods before transport", async () => {
    const rpc = await mockRpc(() => ({}));
    const source = new ViemBscLogSource({ fromBlock: "100", rpcUrl: rpc.url });

    for (const method of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "personal_sign",
      "eth_sign",
    ]) {
      await expect(source.request(method, [])).rejects.toThrow(/RPC_METHOD_FORBIDDEN/u);
    }
    expect(rpc.calls).toEqual([]);
  });

  it("paginates bounded block ranges and enriches logs with timestamp and parentHash", async () => {
    const block = (number: string, hash: string, parentHash: string) => ({
      hash,
      number,
      parentHash,
      timestamp: "0x64",
    });
    const rpc = await mockRpc(({ method, params }) => {
      if (method === "eth_chainId") return { body: { id: 1, jsonrpc: "2.0", result: "0x38" } };
      if (method === "eth_getBlockByNumber" && params[0] === "latest") {
        return { body: { id: 1, jsonrpc: "2.0", result: block("0x69", `0x${"69".repeat(32)}`, `0x${"68".repeat(32)}`) } };
      }
      if (method === "eth_getLogs") {
        const filter = params[0] as { fromBlock: string; toBlock: string };
        if (filter.fromBlock === "0x68") {
          return {
            body: {
              id: 1,
              jsonrpc: "2.0",
              result: [
                {
                  address: "0x0000000000000000000000000000000000000056",
                  blockHash: `0x${"68".repeat(32)}`,
                  blockNumber: "0x68",
                  data: "0x",
                  logIndex: "0x1",
                  removed: false,
                  topics: [`0x${"11".repeat(32)}`],
                  transactionHash: `0x${"22".repeat(32)}`,
                  transactionIndex: "0x2",
                },
              ],
            },
          };
        }
        return { body: { id: 1, jsonrpc: "2.0", result: [] } };
      }
      if (method === "eth_getBlockByNumber" && params[0] === "0x68") {
        return { body: { id: 1, jsonrpc: "2.0", result: block("0x68", `0x${"68".repeat(32)}`, `0x${"67".repeat(32)}`) } };
      }
      throw new Error(`unexpected ${method}`);
    });
    const source = new ViemBscLogSource({
      fromBlock: "100",
      maxBlockSpan: 2,
      maxPagesPerRead: 4,
      rpcUrl: rpc.url,
    });

    const page = await source.read(null);

    expect(
      rpc.calls.filter(({ method }) => method === "eth_getLogs").map(({ params }) => params[0]),
    ).toEqual([
      expect.objectContaining({ fromBlock: "0x64", toBlock: "0x65" }),
      expect.objectContaining({ fromBlock: "0x66", toBlock: "0x67" }),
      expect.objectContaining({ fromBlock: "0x68", toBlock: "0x69" }),
    ]);
    expect(page?.deliveries[0]).toMatchObject({
      block: {
        blockTimestamp: "100",
        parentHash: `0x${"67".repeat(32)}`,
      },
      log: { blockNumber: "104", chainId: 56, logIndex: 1 },
    });
  });

  it("retries 429/5xx with a bound and resumes after the cursor within its block", async () => {
    const delays: number[] = [];
    const rpc = await mockRpc(({ method, params }, attempt) => {
      if (method === "eth_chainId") return { body: { id: 1, jsonrpc: "2.0", result: "0x38" } };
      if (method === "eth_getBlockByNumber" && params[0] === "latest") {
        return {
          body: {
            id: 1,
            jsonrpc: "2.0",
            result: { hash: `0x${"70".repeat(32)}`, number: "0x70", parentHash: `0x${"6f".repeat(32)}`, timestamp: "0x70" },
          },
        };
      }
      if (method === "eth_getLogs" && attempt < 3) return { status: attempt === 1 ? 429 : 503 };
      if (method === "eth_getLogs") {
        return {
          body: {
            id: 1,
            jsonrpc: "2.0",
            result: [
              {
                address: "0x0000000000000000000000000000000000000056",
                blockHash: `0x${"70".repeat(32)}`,
                blockNumber: "0x70",
                data: "0x",
                logIndex: "0x3",
                removed: false,
                topics: [`0x${"11".repeat(32)}`],
                transactionHash: `0x${"22".repeat(32)}`,
                transactionIndex: "0x2",
              },
            ],
          },
        };
      }
      if (method === "eth_getBlockByNumber") {
        return {
          body: {
            id: 1,
            jsonrpc: "2.0",
            result: { hash: `0x${"70".repeat(32)}`, number: "0x70", parentHash: `0x${"6f".repeat(32)}`, timestamp: "0x70" },
          },
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const source = new ViemBscLogSource({
      fromBlock: "1",
      maxAttempts: 3,
      rpcUrl: rpc.url,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    const page = await source.read({
      blockHash: `0x${"70".repeat(32)}`,
      blockNumber: "112",
      chainId: 56,
      logIndex: 2,
      transactionIndex: 2,
      value: "cursor",
    });

    expect(delays).toEqual([100, 200]);
    expect(page?.deliveries).toHaveLength(1);
  });

  it("fails on wrong chain and treats removed or parent-discontinuous logs as reorg input", async () => {
    const wrongChain = await mockRpc(({ method }) => ({
      body: { id: 1, jsonrpc: "2.0", result: method === "eth_chainId" ? "0x1" : null },
    }));
    await expect(
      new ViemBscLogSource({ fromBlock: "1", rpcUrl: wrongChain.url }).read(null),
    ).rejects.toThrow(/RPC_CHAIN_UNSUPPORTED/u);
  });
});
