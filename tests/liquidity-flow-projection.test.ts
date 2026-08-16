import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NormalizedPoolEvent } from "../apps/indexer/src/types.js";
import {
  projectLiquidityFlowEvent,
  stableLiquidityFlowEvents,
} from "../apps/indexer/src/liquidity-flow.js";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const normalizedRoot = path.join(root, "artifacts/acceptance/P02-03/golden/normalized");
const goldenFiles = [
  "pcsv3/PoolCreated.json",
  "pcsv3/Mint.json",
  "pcsv3/Burn.json",
  "pcsv3/Collect.json",
  "pcsv3/Swap.json",
  "univ3/PoolCreated.json",
  "univ3/Mint.json",
  "univ3/Burn.json",
  "univ3/Collect.json",
  "univ3/Swap.json",
  "pcsv4/Initialize.json",
  "pcsv4/ModifyLiquidity.json",
  "pcsv4/Swap.json",
  "univ4/Initialize.json",
  "univ4/ModifyLiquidity.json",
  "univ4/Swap.json",
] as const;

function goldenEvents(): NormalizedPoolEvent[] {
  return goldenFiles.map((filename) =>
    JSON.parse(readFileSync(path.join(normalizedRoot, filename), "utf8")),
  ) as NormalizedPoolEvent[];
}

describe("P02-04 liquidity flow projection", () => {
  it("projects create, add, and remove from all 16 production Decoder Goldens", () => {
    const projected = goldenEvents()
      .map(projectLiquidityFlowEvent)
      .filter((event) => event !== null);

    expect(projected).toHaveLength(10);
    expect(projected.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {})).toEqual({ add: 4, create: 4, remove: 2 });
    expect(new Set(projected.map(({ dex }) => dex))).toEqual(
      new Set(["pcsv3", "univ3", "pcsv4", "univ4"]),
    );
    expect(projected.every(({ chain_id, finality }) => chain_id === 56 && finality === "observed"))
      .toBe(true);
  });

  it("keeps all non-authoritative display fields null, including V4 token amounts", () => {
    const projected = goldenEvents()
      .map(projectLiquidityFlowEvent)
      .filter((event) => event !== null);

    for (const event of projected) {
      expect(event.nft_id, event.id).toBeNull();
      expect(event.usd_value, event.id).toBeNull();
      expect(event.in_range, event.id).toBeNull();
      expect(event.token0_symbol, event.id).toBeNull();
      expect(event.token1_symbol, event.id).toBeNull();
      if (event.version === "v4" && event.event_type !== "create") {
        expect(event.amount0, event.id).toBeNull();
        expect(event.amount1, event.id).toBeNull();
      }
    }
  });

  it("deduplicates and canonically sorts duplicate, reversed Golden input", () => {
    const projected = goldenEvents()
      .map(projectLiquidityFlowEvent)
      .filter((event) => event !== null);
    const scrambled = [...projected].reverse().concat(projected[2]!, projected[0]!);

    const stable = stableLiquidityFlowEvents(scrambled);

    expect(stable).toHaveLength(projected.length);
    expect(stable.map(({ block_number }) => BigInt(block_number))).toEqual(
      [...stable.map(({ block_number }) => BigInt(block_number))].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
    expect(new Set(stable.map(({ id }) => id)).size).toBe(stable.length);
  });
});
