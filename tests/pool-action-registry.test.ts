import type { MarketPoolRow } from "../packages/api-contract/src/index.js";
import {
  createPoolActionIntent,
  poolActionCommandRegistry,
  resolvePoolAction,
} from "../apps/web/src/pool-actions.js";
import { describe, expect, it } from "vitest";

function row(version: 3 | 4, overrides: Partial<MarketPoolRow> = {}): MarketPoolRow {
  const identity = version === 3 ? `0x${"1".repeat(40)}` : `0x${"2".repeat(64)}`;
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "500",
    feesUsd: "10",
    feeTvl: null,
    hooks: null,
    labelRuleVersion: "pool-labels/local-v1",
    labels: [],
    poolAddress: version === 3 ? (identity as `0x${string}`) : null,
    poolId: version === 4 ? (identity as `0x${string}`) : null,
    poolKey: `56:${identity}`,
    protocol: version === 3 ? "pcsv3" : "univ4",
    tickSpacing: "10",
    token0Address: `0x${"a".repeat(40)}`,
    token0Symbol: "AAA",
    token1Address: `0x${"b".repeat(40)}`,
    token1Symbol: "BBB",
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: null,
    ...overrides,
  };
}

describe("P02-11 pool action intent and shared command registry", () => {
  it("creates canonical V3/V4 prefill intents without symbols or unvalidated display data", () => {
    for (const candidate of [row(3), row(4)]) {
      const intent = createPoolActionIntent(candidate, "create-task");
      expect(intent).toEqual({
        action: "create-task",
        chainId: 56,
        poolAddress: candidate.poolAddress,
        poolId: candidate.poolId,
        poolKey: candidate.poolKey,
        schemaVersion: 1,
        token0Address: candidate.token0Address,
        token1Address: candidate.token1Address,
      });
      expect(intent).not.toHaveProperty("token0Symbol");
      expect(intent).not.toHaveProperty("label");
    }
  });

  it("rejects non-canonical pool identity and token prefill instead of guessing from symbols", () => {
    expect(
      createPoolActionIntent(row(3, { poolKey: `56:0x${"3".repeat(40)}` }), "share-chat"),
    ).toBeNull();
    expect(
      createPoolActionIntent(row(3, { token0Address: "WBNB" as `0x${string}` }), "create-task"),
    ).toBeNull();
    expect(
      resolvePoolAction(row(3, { token0Address: null, token0Symbol: "WBNB" }), "block-token0"),
    ).toMatchObject({ enabled: false, reason: "token0 地址不可用" });
  });

  it("uses one unique registry for every menu surface and resolves safe action results", () => {
    expect(new Set(poolActionCommandRegistry.map(({ id }) => id)).size).toBe(
      poolActionCommandRegistry.length,
    );
    expect(poolActionCommandRegistry.map(({ id }) => id)).toEqual([
      "expand-market",
      "copy-pool-address",
      "copy-token0-address",
      "copy-token1-address",
      "search-token0-pools",
      "search-token1-pools",
      "view-pool-flow",
      "view-token0-flow",
      "view-token1-flow",
      "block-pool",
      "block-token0",
      "block-token1",
      "create-task",
      "create-monitor",
      "share-chat",
    ]);

    expect(resolvePoolAction(row(3), "block-pool")).toEqual({
      enabled: true,
      result: {
        entry: { chainId: 56, identity: row(3).poolKey, scope: "pool" },
        kind: "block",
      },
    });
    expect(resolvePoolAction(row(4), "copy-pool-address")).toMatchObject({
      enabled: false,
      reason: "V4 池没有可复制的池地址",
    });
    expect(resolvePoolAction(row(3), "create-monitor")).toMatchObject({
      enabled: true,
      result: {
        intent: { action: "create-monitor", poolKey: row(3).poolKey },
        kind: "navigate",
        to: "/monitors",
      },
    });
    expect(
      resolvePoolAction(row(3), "create-task", { monitorPrefill: false, taskPrefill: true }),
    ).toMatchObject({
      enabled: true,
      result: { intent: { action: "create-task" }, kind: "navigate", to: "/tasks/running" },
    });
  });
});
