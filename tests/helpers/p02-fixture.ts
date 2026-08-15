import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type P02FixtureName = "normal" | "duplicate" | "out-of-order" | "reorg";

export interface FrozenP02FixtureEntry {
  decoderFixtureId: string;
  fixtureDecoded: {
    kind: "pool.created" | "swap" | "liquidity.add" | "liquidity.remove" | "collect";
    payload: Record<string, string | null>;
    pool: {
      feePips?: string | null;
      hooks?: string | null;
      poolAddress: string | null;
      poolId: string | null;
      tickSpacing?: string | null;
      token0?: string | null;
      token1?: string | null;
    };
    protocol: "pcsv3" | "univ3" | "pcsv4" | "univ4";
    protocolGeneration: "v3" | "v4";
  };
  fixtureLogId?: string;
  rawLog: {
    address: string;
    blockHash: string;
    blockNumber: string;
    chainId: number;
    data: string;
    logIndex: number;
    removed: boolean;
    topics: string[];
    transactionHash: string;
    transactionIndex: number;
  };
}

export interface FrozenP02Fixture {
  expected: Record<string, unknown>;
  fixtureOnly: true;
  input: FrozenP02FixtureEntry[];
  scenario: P02FixtureName;
  schemaVersion: number;
}

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function readP02Fixture(name: P02FixtureName): FrozenP02Fixture {
  return JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "artifacts", "acceptance", "P02-01", "fixtures", `${name}.json`),
      "utf8",
    ),
  ) as FrozenP02Fixture;
}

export function fixtureBlockTimestamp(blockNumber: string): string {
  const seconds = BigInt(blockNumber) - 100n;
  return new Date(Date.parse("2026-08-16T00:00:00.000Z") + Number(seconds) * 1_000).toISOString();
}

