import type { PoolBlocklistSnapshot } from "../packages/api-contract/src/index.js";
import {
  createPoolEligibilityPolicy,
  type PoolEligibilityCandidate,
  type PoolEligibilityPolicy,
} from "../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const blockedPoolKey = `56:0x${"1".repeat(40)}`;
const allowedPoolKey = `56:0x${"2".repeat(64)}`;
const blockedToken = `0x${"a".repeat(40)}`;
const otherToken = `0x${"b".repeat(40)}`;

const snapshot: PoolBlocklistSnapshot = {
  blocklistHash: `sha256:${"c".repeat(64)}`,
  entries: [
    { chainId: 56, identity: blockedPoolKey, scope: "pool" },
    { chainId: 56, identity: blockedToken, scope: "token" },
  ],
  revision: 2,
  schemaVersion: 1,
  updatedAt: "2026-08-17T08:00:00.000Z",
};

function candidate(overrides: Partial<PoolEligibilityCandidate> = {}): PoolEligibilityCandidate {
  return {
    chainId: 56,
    poolKey: allowedPoolKey,
    token0Address: otherToken,
    token1Address: `0x${"d".repeat(40)}`,
    ...overrides,
  };
}

describe("P02-11 shared PoolEligibilityPolicy", () => {
  it("excludes a blocked poolKey or either known canonical Token address", () => {
    const policy = createPoolEligibilityPolicy(snapshot);

    expect(policy.evaluate(candidate({ poolKey: blockedPoolKey }))).toMatchObject({
      blockedBy: [{ identity: blockedPoolKey, scope: "pool" }],
      eligible: false,
    });
    expect(policy.evaluate(candidate({ token0Address: blockedToken }))).toMatchObject({
      blockedBy: [{ identity: blockedToken, scope: "token" }],
      eligible: false,
    });
    expect(policy.evaluate(candidate({ token1Address: blockedToken }))).toMatchObject({
      blockedBy: [{ identity: blockedToken, scope: "token" }],
      eligible: false,
    });
    expect(
      policy.evaluate(candidate({ poolKey: blockedPoolKey, token0Address: blockedToken })).blockedBy,
    ).toEqual([
      { identity: blockedPoolKey, scope: "pool" },
      { identity: blockedToken, scope: "token" },
    ]);
  });

  it("records missing/non-canonical Token identity limitations and never guesses from symbols", () => {
    const policy = createPoolEligibilityPolicy(snapshot);
    expect(policy.evaluate(candidate({ token0Address: null, token1Address: null }))).toEqual({
      blockedBy: [],
      eligible: true,
      limitations: [
        { code: "TOKEN_ADDRESS_MISSING", field: "token0Address" },
        { code: "TOKEN_ADDRESS_MISSING", field: "token1Address" },
      ],
    });
    expect(
      policy.evaluate({
        ...candidate(),
        token0Address: "WBNB",
        token0Symbol: blockedToken,
      } as PoolEligibilityCandidate & { token0Symbol: string }),
    ).toEqual({
      blockedBy: [],
      eligible: true,
      limitations: [{ code: "TOKEN_ADDRESS_NON_CANONICAL", field: "token0Address" }],
    });
  });

  it("filters before caller limits while preserving eligible source order", () => {
    const policy = createPoolEligibilityPolicy(snapshot);
    const rows = [
      candidate({ poolKey: blockedPoolKey }),
      candidate({ poolKey: `56:0x${"3".repeat(40)}` }),
      candidate({ poolKey: `56:0x${"4".repeat(40)}` }),
    ];
    const result = policy.filter(rows);
    expect(result.candidates.map(({ poolKey }) => poolKey)).toEqual([
      `56:0x${"3".repeat(40)}`,
      `56:0x${"4".repeat(40)}`,
    ]);
    expect(result.limitations).toEqual([]);
  });

  it("exposes one consumer interface for ranking, search, recommendations, groups, compare, monitoring and strategy", () => {
    const policy = createPoolEligibilityPolicy(snapshot);
    const consume = (consumer: PoolEligibilityPolicy) =>
      consumer.filter([candidate(), candidate({ token1Address: blockedToken })]).candidates;

    for (const consumerName of [
      "top-fees",
      "by-token",
      "recommendations",
      "grouping",
      "comparison",
      "monitoring-contract",
      "strategy-contract",
    ]) {
      expect(consume(policy), consumerName).toEqual([candidate()]);
    }
  });
});
