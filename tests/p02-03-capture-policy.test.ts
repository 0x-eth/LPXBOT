import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = path.resolve("scripts/capture-p02-03-golden.mjs");

describe("P02-03 live capture policy", () => {
  it("requires explicit opt-in before reading an RPC environment variable", () => {
    const environment = { ...process.env };
    delete environment.BSC_RPC_URL;
    delete environment.P02_03_CAPTURE_LIVE_BSC;

    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: environment,
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/P02_03_CAPTURE_LIVE_BSC=1 is required/u);
  });

  it("contains only the approved read methods and never embeds an RPC URL", () => {
    const source = readFileSync(scriptPath, "utf8");
    for (const method of [
      "eth_chainId",
      "eth_getLogs",
      "eth_getBlockByNumber",
      "eth_getTransactionReceipt",
      "eth_getCode",
    ]) {
      expect(source).toContain(`"${method}"`);
    }
    for (const forbidden of [
      "eth_sendTransaction",
      "eth_sendRawTransaction",
      "personal_sign",
      "http://",
      "https://",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
