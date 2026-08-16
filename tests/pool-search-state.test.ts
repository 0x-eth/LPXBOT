import type { MarketPoolRow } from "../packages/api-contract/src/index.js";
import {
  PoolSearchRequestManager,
  filterPoolsByIdentity,
  initialPoolSearchState,
  parsePoolSearchParameters,
  reducePoolSearch,
  writePoolSearchParameters,
} from "../apps/web/src/pool-search-state.js";
import { describe, expect, it } from "vitest";

const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const poolId = `0x${"bb".repeat(32)}`;

function row(identity: string): MarketPoolRow {
  const v3 = identity.length === 42;
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "2500",
    feesUsd: null,
    feeTvl: null,
    hooks: null,
    labelRuleVersion: "pool-labels/local-v1",
    labels: [],
    poolAddress: v3 ? (identity as `0x${string}`) : null,
    poolId: v3 ? null : (identity as `0x${string}`),
    poolKey: `56:${identity.toLowerCase()}`,
    protocol: v3 ? "pcsv3" : "univ4",
    tickSpacing: "50",
    token0Address: "0x1111111111111111111111111111111111111111",
    token0Symbol: null,
    token1Address: "0x2222222222222222222222222222222222222222",
    token1Symbol: null,
    transactionCount: null,
    tvlUsd: null,
    volumeUsd: null,
  };
}

describe("P02-06 pool search state", () => {
  it("serializes an explicit mode and clears only pool-search parameters", () => {
    const tokenSearch = writePoolSearchParameters("?fixture=pools-ready&dex=pcsv3", {
      mode: "token",
      query: address.toUpperCase().replace("0X", "0x"),
    });
    const poolSearch = writePoolSearchParameters("?fixture=pools-ready", {
      mode: "pool",
      query: address,
    });

    expect(parsePoolSearchParameters(tokenSearch)).toEqual({
      mode: "token",
      query: address,
      valid: true,
    });
    expect(parsePoolSearchParameters(poolSearch)).toEqual({
      mode: "pool",
      query: address,
      valid: true,
    });
    expect(writePoolSearchParameters(tokenSearch, null)).toBe("?fixture=pools-ready&dex=pcsv3");
    expect(parsePoolSearchParameters("?pool_search_mode=pool&pool_search=0x123")).toEqual({
      mode: "pool",
      query: "0x123",
      valid: false,
    });
  });

  it("matches V3 pool addresses and V4 pool IDs only in pool mode", () => {
    const rows = [row(address), row(poolId)];
    expect(filterPoolsByIdentity(rows, address.toUpperCase().replace("0X", "0x"))).toEqual([
      rows[0],
    ]);
    expect(filterPoolsByIdentity(rows, poolId.toUpperCase().replace("0X", "0x"))).toEqual([
      rows[1],
    ]);
    expect(filterPoolsByIdentity(rows, "0xcccccccccccccccccccccccccccccccccccccccc")).toEqual([]);
  });

  it("ignores late responses and exposes loading, ready, no-results, invalid, error and reconnecting", () => {
    const first = reducePoolSearch(initialPoolSearchState(), {
      mode: "token",
      query: address,
      requestId: 1,
      type: "start",
    });
    const second = reducePoolSearch(first, {
      mode: "token",
      query: "0xcccccccccccccccccccccccccccccccccccccccc",
      requestId: 2,
      type: "start",
    });
    expect(first.status).toBe("loading");
    expect(
      reducePoolSearch(second, { requestId: 1, rows: [row(address)], type: "success" }),
    ).toEqual(second);
    const empty = reducePoolSearch(second, { requestId: 2, rows: [], type: "success" });
    expect(empty.status).toBe("no-results");
    const ready = reducePoolSearch(second, {
      requestId: 2,
      rows: [row(address)],
      type: "success",
    });
    expect(ready.status).toBe("ready");
    expect(reducePoolSearch(second, { requestId: 2, type: "invalid" }).status).toBe("invalid");
    expect(
      reducePoolSearch(second, { code: "NETWORK_ERROR", requestId: 2, type: "error" }).status,
    ).toBe("error");
    expect(reducePoolSearch(ready, { type: "reconnecting" }).status).toBe("reconnecting");
    expect(reducePoolSearch(ready, { type: "clear" })).toEqual(initialPoolSearchState());
  });

  it("aborts the previous request and marks its generation stale", () => {
    const manager = new PoolSearchRequestManager();
    const first = manager.start();
    const second = manager.start();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(manager.isCurrent(first.requestId)).toBe(false);
    expect(manager.isCurrent(second.requestId)).toBe(true);
    manager.clear();
    expect(second.signal.aborted).toBe(true);
    expect(manager.isCurrent(second.requestId)).toBe(false);
  });
});
