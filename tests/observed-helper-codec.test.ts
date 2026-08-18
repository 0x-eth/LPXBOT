import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  OBSERVED_HELPER_PATHS,
  ObservedHelperCodec,
  type ObservedHelperPathName,
} from "../packages/test-fixtures/src/index.js";
import { describe, expect, it } from "vitest";

const fixtureRoot = path.resolve(
  "artifacts/acceptance/P05-01/fixtures/observed-helper",
);
const pathNames = Object.keys(OBSERVED_HELPER_PATHS) as ObservedHelperPathName[];

interface FrozenFixture {
  block: { hash: string; transactions: string[] };
  classification: string;
  executionCounters: Record<string, number>;
  helper: {
    address: string;
    owner: string;
    ownerCallResult: string;
    runtimeCodeBytes: number;
    runtimeCodeHash: string;
  };
  logs: Array<{ transactionHash: string }>;
  network: { blockHash: string; blockNumber: string; chainId: number };
  observedPath: ObservedHelperPathName;
  rawInput: string;
  receipt: {
    blockHash: string;
    logs: Array<{ transactionHash: string }>;
    status: string;
    transactionHash: string;
  };
  selector: string;
  sources: Array<{ kind: string; retrievedAt: string }>;
  transaction: {
    blockHash: string;
    from: string;
    hash: string;
    input: string;
    to: string;
  };
}

async function fixturesFor(name: ObservedHelperPathName): Promise<FrozenFixture[]> {
  const directory = path.join(fixtureRoot, name);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  return Promise.all(
    files.map((file) =>
      readFile(path.join(directory, file), "utf8").then(
        (source) => JSON.parse(source) as FrozenFixture,
      ),
    ),
  );
}

describe("P05-01 test-only ObservedHelperCodec", () => {
  it("keeps all four production selectors under observation-only names", () => {
    expect(OBSERVED_HELPER_PATHS).toEqual({
      "observed-v3-path-a": expect.objectContaining({ selector: "0xadc3f25c" }),
      "observed-v3-path-b": expect.objectContaining({ selector: "0xfb691fd9" }),
      "observed-v4-path-a": expect.objectContaining({ selector: "0x71fa74ed" }),
      "observed-v4-path-b": expect.objectContaining({ selector: "0x5dfd8e50" }),
    });
  });

  it("replays at least ten independent production calldata samples per observed path", async () => {
    const allHashes = new Set<string>();
    for (const name of pathNames) {
      const fixtures = await fixturesFor(name);
      expect(fixtures).toHaveLength(10);
      for (const fixture of fixtures) {
        expect(fixture.classification).toBe("OBSERVED");
        expect(fixture.observedPath).toBe(name);
        expect(fixture.selector).toBe(OBSERVED_HELPER_PATHS[name].selector);
        expect(fixture.rawInput.startsWith(fixture.selector)).toBe(true);
        expect(fixture.transaction.input).toBe(fixture.rawInput);
        expect(fixture.transaction.to.toLowerCase()).toBe(fixture.helper.address);
        expect(fixture.transaction.from.toLowerCase()).toBe(fixture.helper.owner);
        expect(fixture.receipt.status).toBe("0x1");
        expect(fixture.receipt.blockHash).toBe(fixture.network.blockHash);
        expect(fixture.block.hash).toBe(fixture.network.blockHash);
        expect(fixture.block.transactions).toContain(fixture.transaction.hash);
        expect(fixture.logs).toEqual(fixture.receipt.logs);
        expect(
          fixture.logs.every((log) => log.transactionHash === fixture.transaction.hash),
        ).toBe(true);
        expect(fixture.helper.runtimeCodeBytes).toBeGreaterThan(0);
        expect(fixture.helper.runtimeCodeHash).toMatch(/^0x[0-9a-f]{64}$/u);
        expect(fixture.helper.ownerCallResult.slice(-40)).toBe(fixture.helper.owner.slice(2));
        expect(new Set(fixture.sources.map(({ kind }) => kind))).toEqual(
          new Set([
            "bscscan-transaction-index",
            "bscscan-transaction",
            "bsc-json-rpc",
            "bsc-archive-json-rpc",
          ]),
        );
        expect(Object.values(fixture.executionCounters).every((value) => value === 0)).toBe(
          true,
        );

        const decoded = ObservedHelperCodec.decode(fixture.rawInput);
        expect(decoded.path).toBe(name);
        expect(decoded.opaqueHeadWords).toHaveLength(
          OBSERVED_HELPER_PATHS[name].headWordCount,
        );
        expect(ObservedHelperCodec.encode(decoded)).toBe(fixture.rawInput);
        expect(allHashes.has(fixture.transaction.hash)).toBe(false);
        allHashes.add(fixture.transaction.hash);
      }
    }
    expect(allHashes.size).toBe(40);
  });

  it("fails closed for unknown selectors and non-canonical observed envelopes", () => {
    expect(() => ObservedHelperCodec.decode(`0xdeadbeef${"00".repeat(64)}`)).toThrow(
      /selector 0xdeadbeef is not frozen/u,
    );
    expect(() => ObservedHelperCodec.decode(`0x71fa74ed${"00".repeat(64)}`)).toThrow(
      /dynamic offset/u,
    );
    expect(() => ObservedHelperCodec.decode("0x71FA74ED00")).toThrow(/lowercase/u);
  });
});
