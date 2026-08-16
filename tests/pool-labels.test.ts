import type { MarketPoolRow } from "../packages/api-contract/src/index.js";
import { readFileSync } from "node:fs";
import {
  POOL_LABEL_RULE_CONTRACT,
  computePoolLabels,
  type MarketMetricEvent,
  type PoolLabelRuleContract,
} from "../packages/market-metrics/src/index.js";
import { describe, expect, it } from "vitest";

const end = "2026-08-16T01:00:00.000Z";
const start = "2026-08-16T00:55:00.000Z";
const poolAddress = "0x1111111111111111111111111111111111111111";

function row(overrides: Partial<MarketPoolRow> = {}): MarketPoolRow {
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
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "50",
    token0Address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token0Symbol: "WBNB",
    token1Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    token1Symbol: "USDT",
    transactionCount: "0",
    tvlUsd: null,
    volumeUsd: null,
    ...overrides,
  };
}

function event(
  id: string,
  seconds: number,
  overrides: Partial<MarketMetricEvent> = {},
): MarketMetricEvent {
  return {
    blockTimestamp: new Date(Date.parse(start) + seconds * 1_000).toISOString(),
    chainId: 56,
    eventId: id,
    kind: "swap",
    liquidityDelta: null,
    market: {},
    pool: {
      poolAddress,
      poolId: null,
      protocol: "pcsv3",
    },
    reverted: false,
    sqrtPriceX96: null,
    transactionHash: `0x${id.padStart(64, "0")}`,
    ...overrides,
  };
}

function labels(
  events: readonly MarketMetricEvent[],
  metricRow: MarketPoolRow,
  ruleContract: PoolLabelRuleContract = POOL_LABEL_RULE_CONTRACT,
) {
  return computePoolLabels({
    canonicalRevision: "canonical:v1:fixture",
    events,
    metricVersion: "market-metrics/v1",
    row: metricRow,
    ruleContract,
    windowEnd: end,
    windowMinutes: 5,
    windowStart: start,
  });
}

describe("P02-08 versioned pool label rule contract", () => {
  it("freezes one locally-defined source for windows, samples, thresholds and ordering", () => {
    expect(Object.isFrozen(POOL_LABEL_RULE_CONTRACT)).toBe(true);
    expect(POOL_LABEL_RULE_CONTRACT).toMatchObject({
      evidenceLevel: "locally-defined",
      nullPolicy: "omit-label",
      ruleVersion: "pool-labels/local-v1",
      scoreRange: { max: 100, min: 0 },
    });
    expect(POOL_LABEL_RULE_CONTRACT.rules.map(({ id }) => id)).toEqual([
      "high-fee-rate",
      "yield-surge",
      "yield-decline",
      "yield-stable",
      "stable-volume-price",
      "crowded",
      "volatile",
      "lp-inflow",
      "lp-outflow",
    ]);
    expect(
      POOL_LABEL_RULE_CONTRACT.rules.filter(({ exclusiveGroup }) => exclusiveGroup === "yield-trend"),
    ).toHaveLength(3);
    expect(new Set(POOL_LABEL_RULE_CONTRACT.rules.map(({ priority }) => priority)).size).toBe(
      POOL_LABEL_RULE_CONTRACT.rules.length,
    );
  });

  it.each([
    {
      expected: "high-fee-rate",
      events: [event("001", 30)],
      metricRow: row({ feeTvl: "0.01", feesUsd: "10", tvlUsd: "1000" }),
      reason: "FEE_TVL_GTE_THRESHOLD",
    },
    {
      expected: "stable-volume-price",
      events: [90, 110, 90, 110].map((volume, index) =>
        event(`10${index}`, 30 + index * 60, {
          market: { volumeUsd: String(volume) },
          sqrtPriceX96: index % 2 === 0 ? "1000" : "1001",
        }),
      ),
      metricRow: row({ transactionCount: "4", volumeUsd: "400" }),
      reason: "VOLUME_DISPERSION_LTE_THRESHOLD",
    },
    {
      expected: "yield-stable",
      events: [
        event("201", 30, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("202", 90, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("203", 210, { market: { feesUsd: "11", tvlUsd: "1000" } }),
        event("204", 270, { market: { feesUsd: "11", tvlUsd: "1000" } }),
      ],
      metricRow: row(),
      reason: "YIELD_CHANGE_ABS_LTE_THRESHOLD",
    },
    {
      expected: "yield-surge",
      events: [
        event("301", 30, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("302", 90, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("303", 210, { market: { feesUsd: "15", tvlUsd: "1000" } }),
        event("304", 270, { market: { feesUsd: "15", tvlUsd: "1000" } }),
      ],
      metricRow: row(),
      reason: "YIELD_CHANGE_GTE_THRESHOLD",
    },
    {
      expected: "yield-decline",
      events: [
        event("401", 30, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("402", 90, { market: { feesUsd: "10", tvlUsd: "1000" } }),
        event("403", 210, { market: { feesUsd: "7", tvlUsd: "1000" } }),
        event("404", 270, { market: { feesUsd: "7", tvlUsd: "1000" } }),
      ],
      metricRow: row(),
      reason: "YIELD_CHANGE_LTE_THRESHOLD",
    },
    {
      expected: "crowded",
      events: [event("005", 30)],
      metricRow: row({ transactionCount: "20" }),
      reason: "TRANSACTION_COUNT_GTE_THRESHOLD",
    },
    {
      expected: "volatile",
      events: [
        event("501", 30, { sqrtPriceX96: "1000" }),
        event("502", 90, { sqrtPriceX96: "1010" }),
        event("503", 150, { sqrtPriceX96: "1000" }),
      ],
      metricRow: row(),
      reason: "PRICE_CHANGE_GTE_THRESHOLD",
    },
    {
      expected: "lp-inflow",
      events: [
        event("601", 30, { kind: "liquidity.add", liquidityDelta: "5" }),
        event("602", 90, { kind: "liquidity.remove", liquidityDelta: "-3" }),
      ],
      metricRow: row(),
      reason: "LP_NET_FLOW_GTE_THRESHOLD",
    },
    {
      expected: "lp-outflow",
      events: [
        event("701", 30, { kind: "liquidity.add", liquidityDelta: "3" }),
        event("702", 90, { kind: "liquidity.remove", liquidityDelta: "-5" }),
      ],
      metricRow: row(),
      reason: "LP_NET_FLOW_LTE_THRESHOLD",
    },
  ])("emits $expected exactly at its Decimal threshold", ({ events, expected, metricRow, reason }) => {
    const result = labels(events, metricRow);
    const emitted = result.find(({ id }) => id === expected);
    expect(emitted).toBeDefined();
    expect(emitted).toMatchObject({
      computedAt: end,
      ruleVersion: POOL_LABEL_RULE_CONTRACT.ruleVersion,
      score: 50,
    });
    expect(emitted!.reasons.some(({ code }) => code === reason)).toBe(true);
    for (const item of result) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
      for (const detail of item.reasons) {
        expect(detail).toEqual({
          code: expect.any(String),
          observed: expect.any(String),
          operator: expect.any(String),
          threshold: expect.any(String),
          window: "5m",
        });
      }
    }
  });

  it("omits labels for nulls, missing samples and missing history instead of filling values", () => {
    expect(labels([], row())).toEqual([]);
    expect(labels([], row({ feeTvl: "0.01", feesUsd: "10", tvlUsd: "1000" }))).toEqual([]);
    expect(labels([], row({ transactionCount: "20" }))).toEqual([]);
    expect(
      labels(
        [event("801", 30, { market: { feesUsd: null, tvlUsd: null }, sqrtPriceX96: null })],
        row({ feeTvl: null, feesUsd: null, transactionCount: null, tvlUsd: null }),
      ),
    ).toEqual([]);
    expect(
      labels(
        [
          event("802", 30, { market: { feesUsd: "10", tvlUsd: "1000" } }),
          event("803", 210, { market: { feesUsd: "20", tvlUsd: "1000" } }),
        ],
        row(),
      ).map(({ id }) => id),
    ).not.toContain(expect.stringMatching(/^yield-/u));
  });

  it("uses Decimal precision, removes duplicate labels and returns priority/id stable order", () => {
    const repeated = event("901", 30, { kind: "liquidity.add", liquidityDelta: "5" });
    const result = labels(
      [
        event("900", 15),
        repeated,
        structuredClone(repeated),
        event("902", 90, { kind: "liquidity.remove", liquidityDelta: "-3" }),
      ],
      row({
        feeTvl: "0.0100000000000000000000000000000000000001",
        feesUsd: "1000000000000000000000000000000000000.1",
        transactionCount: "20",
        tvlUsd: "100000000000000000000000000000000000",
      }),
    );
    expect(result.map(({ id }) => id)).toEqual(["high-fee-rate", "crowded", "lp-inflow"]);
    expect(new Set(result.map(({ id }) => id)).size).toBe(result.length);
  });

  it("is idempotent and makes a rule-version change visible without changing input", () => {
    const input = row({ transactionCount: "20" });
    const history = [event("a00", 30)];
    const first = labels(history, input);
    expect(labels(structuredClone(history), structuredClone(input))).toEqual(first);

    const nextContract = structuredClone(POOL_LABEL_RULE_CONTRACT) as PoolLabelRuleContract;
    nextContract.ruleVersion = "pool-labels/local-v2";
    const next = labels(history, input, nextContract);
    expect(next.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(next.every(({ ruleVersion }) => ruleVersion === "pool-labels/local-v2")).toBe(true);
    expect(next).not.toEqual(first);
  });

  it("ignores duplicate and reverted branch events, then recomputes from the replacement branch", () => {
    const oldBranch = [
      event("a01", 30, { market: { feesUsd: "10", tvlUsd: "1000" }, reverted: true }),
      event("a02", 90, { market: { feesUsd: "10", tvlUsd: "1000" }, reverted: true }),
      event("a03", 210, { market: { feesUsd: "30", tvlUsd: "1000" }, reverted: true }),
      event("a04", 270, { market: { feesUsd: "30", tvlUsd: "1000" }, reverted: true }),
    ];
    const replacement = [
      event("b01", 30, { market: { feesUsd: "10", tvlUsd: "1000" } }),
      event("b02", 90, { market: { feesUsd: "10", tvlUsd: "1000" } }),
      event("b03", 210, { market: { feesUsd: "7", tvlUsd: "1000" } }),
      event("b04", 270, { market: { feesUsd: "7", tvlUsd: "1000" } }),
    ];
    const result = labels([...oldBranch, ...replacement, structuredClone(replacement[3]!)], row());
    expect(result.map(({ id }) => id)).toContain("yield-decline");
    expect(result.map(({ id }) => id)).not.toContain("yield-surge");

    const afterSecondReorg = labels(
      replacement.map((item) => ({ ...item, reverted: true })),
      row(),
    );
    expect(afterSecondReorg).toEqual([]);
  });

  it("reproduces the frozen local Golden output byte-for-structure", () => {
    const root = new URL("../artifacts/acceptance/P02-08/", import.meta.url);
    const input = JSON.parse(readFileSync(new URL("golden/input.json", root), "utf8")) as {
      canonicalRevision: string;
      events: MarketMetricEvent[];
      metricVersion: string;
      row: MarketPoolRow;
      windowEnd: string;
      windowMinutes: 5;
      windowStart: string;
    };
    const expected = JSON.parse(readFileSync(new URL("golden/output.json", root), "utf8"));
    expect(computePoolLabels({ ...input, ruleContract: POOL_LABEL_RULE_CONTRACT })).toEqual(
      expected.labels,
    );
    expect(expected).toMatchObject({
      canonicalRevision: input.canonicalRevision,
      labelRuleVersion: POOL_LABEL_RULE_CONTRACT.ruleVersion,
      metricVersion: input.metricVersion,
      windowEnd: input.windowEnd,
    });
  });
});
