import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import {
  BscPositionReadRpcClient,
  POSITION_READ_RPC_METHODS,
} from "../../packages/chain-adapters/src/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.RUN_ANVIL_INTEGRATION === "1";
const fundedAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port allocation failed");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function rawRpc(rpcUrl: string, method: string, params: readonly unknown[]) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (!response.ok || body.error) throw new Error(`Anvil RPC failed: ${method}`);
  return body.result;
}

async function waitForRpc(rpcUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await rawRpc(rpcUrl, "eth_chainId", [])) === "0x38") return;
    } catch {
      // The isolated fixture is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Anvil did not become ready");
}

describe.skipIf(!enabled)("P05-02 local Anvil read-only RPC closure", () => {
  let anvil: ChildProcess | undefined;
  let rpcUrl = "";

  beforeAll(async () => {
    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(
      "anvil",
      ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "56", "--silent"],
      { stdio: "ignore" },
    );
    await waitForRpc(rpcUrl);
  });

  afterAll(() => {
    anvil?.kill("SIGTERM");
  });

  it("uses only the seven controlled read methods and leaves transaction count at zero", async () => {
    const methods: string[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      methods.push(body.method);
      return fetch(input, init);
    });
    const rpc = new BscPositionReadRpcClient({
      allowInsecureLoopback: true,
      fetch: fetcher,
      rpcUrl,
    });

    const snapshot = await rpc.getBlock("latest");
    expect(await rpc.request("eth_blockNumber", [])).toMatch(/^0x[0-9a-f]+$/u);
    await expect(rpc.getBalance(fundedAddress, snapshot.blockNumber)).resolves.toBeGreaterThan(0n);
    await expect(rpc.getCode(fundedAddress, snapshot.blockNumber)).resolves.toBe("0x");
    await expect(
      rpc.getLogs({
        address: fundedAddress,
        fromBlock: snapshot.blockNumber,
        toBlock: snapshot.blockNumber,
        topics: [],
      }),
    ).resolves.toEqual([]);
    await expect(
      rpc.call({ blockNumber: snapshot.blockNumber, data: "0x", to: fundedAddress }),
    ).resolves.toBe("0x");
    await expect(rpc.getBlock(snapshot.blockNumber)).resolves.toEqual(snapshot);

    const allowed = new Set<string>(POSITION_READ_RPC_METHODS);
    expect(new Set(methods)).toEqual(
      new Set([
        "eth_blockNumber",
        "eth_call",
        "eth_chainId",
        "eth_getBalance",
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_getLogs",
      ]),
    );
    expect(methods.every((method) => allowed.has(method))).toBe(true);
    expect(methods.some((method) => /send|sign|broadcast|anvil_/iu.test(method))).toBe(false);

    const block = (await rawRpc(rpcUrl, "eth_getBlockByNumber", ["latest", true])) as {
      transactions?: unknown[];
    };
    expect(block.transactions).toEqual([]);
  });
});
