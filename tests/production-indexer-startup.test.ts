import { createServer, type Server } from "node:http";

import {
  initializeProductionIndexerAdapters,
  validateProductionIndexerConfig,
} from "../apps/indexer/src/index.js";
import { BSC_PROTOCOL_DEPLOYMENTS } from "../packages/chain-registry/src/index.js";
import { afterEach, describe, expect, it } from "vitest";
import { keccak256 } from "viem";

const servers: Server[] = [];

async function codeRpc(codeForAddress: (address: string) => string): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; method: string; params: string[] };
      const result =
        rpc.method === "eth_chainId"
          ? "0x38"
          : rpc.method === "eth_getCode"
            ? codeForAddress(rpc.params[0]!)
            : null;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: rpc.id, jsonrpc: "2.0", result }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock RPC did not bind");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

function configForCode(code: `0x${string}`) {
  return {
    chainId: 56,
    deployments: BSC_PROTOCOL_DEPLOYMENTS.map((deployment) => ({
      ...deployment,
      runtimeCodeHash: keccak256(code),
    })),
    fromBlock: "1",
  } as const;
}

describe("P02-03 production indexer startup", () => {
  it("accepts only registry-backed chain-56 config and keeps the RPC URL environment-only", () => {
    const config = configForCode("0x6000");
    expect(validateProductionIndexerConfig(config)).toBe(config);
    expect(() =>
      validateProductionIndexerConfig({ ...config, rpcUrl: "http://example.invalid" }),
    ).toThrowError(/BSC_RPC_URL_ENV_ONLY/u);
  });

  it("enables all four decoders only when every runtime code hash matches", async () => {
    const code = "0x6000" as const;
    const rpcUrl = await codeRpc(() => code);

    const initialized = await initializeProductionIndexerAdapters(configForCode(code), {
      BSC_RPC_URL: rpcUrl,
    });

    expect(initialized.chainAccessConfigurationComplete).toBe(true);
    expect(initialized.marketDecoderComplete).toBe(true);
    expect(initialized.deploymentVerification.enabled).toHaveLength(4);
    expect(JSON.stringify(initialized)).not.toContain(rpcUrl);
  });

  it("fails one mismatched protocol closed without changing chain-access completeness", async () => {
    const code = "0x6000" as const;
    const failedAddress = BSC_PROTOCOL_DEPLOYMENTS[2]!.poolManager!;
    const rpcUrl = await codeRpc((address) => (address === failedAddress ? "0x6001" : code));

    const initialized = await initializeProductionIndexerAdapters(configForCode(code), {
      BSC_RPC_URL: rpcUrl,
    });

    expect(initialized.chainAccessConfigurationComplete).toBe(true);
    expect(initialized.marketDecoderComplete).toBe(false);
    expect(initialized.deploymentVerification.enabled).toHaveLength(3);
    expect(initialized.deploymentVerification.failures).toEqual([
      { platformId: "univ4", reason: "runtime-code-hash-mismatch" },
    ]);
  });
});
