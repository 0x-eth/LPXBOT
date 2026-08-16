import { Decimal } from "decimal.js";

import contractJson from "./label-rule-contract.json" with { type: "json" };
import type { MarketMetricEvent, MarketWindowMinutes, PoolMetricRow } from "./index.js";

export type PoolLabelId =
  | "high-fee-rate"
  | "stable-volume-price"
  | "yield-stable"
  | "yield-surge"
  | "yield-decline"
  | "crowded"
  | "volatile"
  | "lp-inflow"
  | "lp-outflow";

export type PoolLabelReasonOperator = ">=" | "<=" | "abs<=";

export interface PoolLabelReason {
  code: string;
  observed: string;
  operator: PoolLabelReasonOperator;
  threshold: string;
  window: string;
}

export interface ComputedPoolLabel {
  computedAt: string;
  id: PoolLabelId;
  label: string;
  reasons: PoolLabelReason[];
  ruleVersion: string;
  score: number;
}

export interface PoolLabelRule {
  exclusiveGroup: "yield-trend" | "lp-direction" | null;
  id: PoolLabelId;
  label: string;
  priority: number;
}

export interface PoolLabelRuleContract {
  deduplication: "id";
  evidenceLevel: "locally-defined";
  inputWindow: {
    canonicalEventsOnly: true;
    endBoundary: "exclusive";
    priceSource: "canonical-sqrtPriceX96-sequence-only";
    startBoundary: "inclusive";
    supportedMinutes: MarketWindowMinutes[];
    usdPriceConstruction: "forbidden";
    yieldComparison: "prior-half-vs-current-half";
  };
  minimumSamples: {
    crowded: number;
    "high-fee-rate": number;
    "lp-direction": number;
    "stable-volume-price": number;
    volatile: number;
    "yield-half": number;
  };
  nullPolicy: "omit-label";
  ordering: "priority-ascending-then-id-ascending";
  parityStatus: "not-parity-verified";
  rules: PoolLabelRule[];
  ruleVersion: string;
  schemaVersion: "1.0.0";
  scoreRange: {
    max: number;
    min: number;
    rounding: "floor";
    thresholdScore: number;
  };
  thresholds: {
    crowdedTransactionCountMin: string;
    highFeeRateFeeTvl: string;
    lpDirectionDominanceMin: string;
    stablePriceChangeMax: string;
    stableVolumeDispersionMax: string;
    volatilePriceChangeMin: string;
    yieldDeclineChangeMax: string;
    yieldStableAbsoluteChangeMax: string;
    yieldSurgeChangeMin: string;
  };
  unresolvedGap: "GAP-LABEL-ALGORITHM";
}

export interface ComputePoolLabelsInput {
  canonicalRevision: string;
  events: readonly MarketMetricEvent[];
  metricVersion: string;
  row: Pick<
    PoolMetricRow,
    "chainId" | "feeTvl" | "feesUsd" | "poolAddress" | "poolId" | "poolKey" | "tvlUsd"
  > & { transactionCount: string | null };
  ruleContract?: PoolLabelRuleContract;
  windowEnd: string;
  windowMinutes: MarketWindowMinutes;
  windowStart: string;
}

const LabelDecimal = Decimal.clone({
  precision: 96,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const POOL_LABEL_RULE_CONTRACT = deepFreeze(
  contractJson as PoolLabelRuleContract,
);

function decimal(value: string): Decimal {
  const parsed = new LabelDecimal(value);
  if (!parsed.isFinite()) throw new RangeError(`Invalid label decimal: ${value}`);
  return parsed;
}

function decimalString(value: Decimal): string {
  return value.isZero() ? "0" : value.toFixed();
}

function milliseconds(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid label timestamp: ${value}`);
  return parsed;
}

function eventPoolKey(event: MarketMetricEvent): string | null {
  const identity = event.pool.poolAddress ?? event.pool.poolId;
  return identity ? `${event.chainId}:${identity.toLowerCase()}` : null;
}

function canonicalEvents(input: ComputePoolLabelsInput): MarketMetricEvent[] {
  const start = milliseconds(input.windowStart);
  const end = milliseconds(input.windowEnd);
  const seen = new Set<string>();
  return input.events
    .filter((event) => {
      const at = milliseconds(event.blockTimestamp);
      return (
        !event.reverted &&
        at >= start &&
        at < end &&
        eventPoolKey(event) === input.row.poolKey.toLowerCase()
      );
    })
    .sort((left, right) => {
      const timeOrder = milliseconds(left.blockTimestamp) - milliseconds(right.blockTimestamp);
      return timeOrder === 0 ? left.eventId.localeCompare(right.eventId) : timeOrder;
    })
    .filter(({ eventId }) => {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      return true;
    });
}

function increasingScore(observed: Decimal, threshold: Decimal, contract: PoolLabelRuleContract) {
  const base = contract.scoreRange.thresholdScore;
  if (observed.equals(threshold) || threshold.isZero()) return base;
  const extra = observed
    .minus(threshold)
    .dividedBy(threshold.abs())
    .times(contract.scoreRange.max - base)
    .floor();
  return LabelDecimal.min(contract.scoreRange.max, new LabelDecimal(base).plus(extra)).toNumber();
}

function decreasingScore(observed: Decimal, threshold: Decimal, contract: PoolLabelRuleContract) {
  const base = contract.scoreRange.thresholdScore;
  if (observed.equals(threshold) || threshold.isZero()) return base;
  const extra = threshold
    .minus(observed)
    .dividedBy(threshold.abs())
    .times(contract.scoreRange.max - base)
    .floor();
  return LabelDecimal.min(contract.scoreRange.max, new LabelDecimal(base).plus(extra)).toNumber();
}

function boundedScore(observed: Decimal, maximum: Decimal, contract: PoolLabelRuleContract) {
  const base = contract.scoreRange.thresholdScore;
  if (observed.equals(maximum) || maximum.isZero()) return base;
  const extra = maximum
    .minus(observed)
    .dividedBy(maximum.abs())
    .times(contract.scoreRange.max - base)
    .floor();
  return LabelDecimal.min(contract.scoreRange.max, new LabelDecimal(base).plus(extra)).toNumber();
}

function priceChanges(events: readonly MarketMetricEvent[]): Decimal[] | null {
  const rawPrices = events
    .filter(({ kind }) => kind === "swap")
    .map(({ sqrtPriceX96 }) => sqrtPriceX96);
  if (rawPrices.some((value) => value === null || value === undefined)) return null;
  const prices = rawPrices.map((value) => decimal(value!));
  if (prices.some((price) => price.lessThanOrEqualTo(0))) return null;
  const changes: Decimal[] = [];
  for (let index = 1; index < prices.length; index += 1) {
    const previous = prices[index - 1]!;
    const current = prices[index]!;
    changes.push(current.pow(2).minus(previous.pow(2)).dividedBy(previous.pow(2)).abs());
  }
  return changes;
}

function volumeDispersion(events: readonly MarketMetricEvent[]): Decimal | null {
  const swaps = events.filter(({ kind }) => kind === "swap");
  const raw = swaps.map(({ market }) => market.volumeUsd);
  if (raw.some((value) => value === null || value === undefined)) return null;
  const values = raw.map((value) => decimal(value!));
  if (values.length === 0 || values.some((value) => value.isNegative())) return null;
  const mean = values
    .reduce<Decimal>((sum, value) => sum.plus(value), new LabelDecimal(0))
    .dividedBy(values.length);
  if (mean.lessThanOrEqualTo(0)) return null;
  return LabelDecimal.max(...values).minus(LabelDecimal.min(...values)).dividedBy(mean);
}

function halfYield(events: readonly MarketMetricEvent[]): Decimal | null {
  const swaps = events.filter(({ kind }) => kind === "swap");
  const fees = swaps.map(({ market }) => market.feesUsd);
  const tvls = swaps.map(({ market }) => market.tvlUsd);
  if (
    swaps.length === 0 ||
    fees.some((value) => value === null || value === undefined) ||
    tvls.some((value) => value === null || value === undefined)
  ) {
    return null;
  }
  const tvl = decimal(tvls.at(-1)!);
  if (tvl.lessThanOrEqualTo(0)) return null;
  return fees
    .reduce<Decimal>((sum, value) => sum.plus(decimal(value!)), new LabelDecimal(0))
    .dividedBy(tvl);
}

function reason(
  code: string,
  observed: Decimal,
  operator: PoolLabelReasonOperator,
  threshold: Decimal,
  window: string,
): PoolLabelReason {
  return {
    code,
    observed: decimalString(observed),
    operator,
    threshold: decimalString(threshold),
    window,
  };
}

function output(
  id: PoolLabelId,
  score: number,
  reasons: PoolLabelReason[],
  input: ComputePoolLabelsInput,
  contract: PoolLabelRuleContract,
): ComputedPoolLabel {
  const rule = contract.rules.find((candidate) => candidate.id === id);
  if (!rule) throw new RangeError(`Label rule is missing: ${id}`);
  return {
    computedAt: new Date(milliseconds(input.windowEnd)).toISOString(),
    id,
    label: rule.label,
    reasons,
    ruleVersion: contract.ruleVersion,
    score,
  };
}

export function computePoolLabels(input: ComputePoolLabelsInput): ComputedPoolLabel[] {
  const contract = input.ruleContract ?? POOL_LABEL_RULE_CONTRACT;
  if (!contract.inputWindow.supportedMinutes.includes(input.windowMinutes)) {
    throw new RangeError("Unsupported pool label window");
  }
  if (!input.canonicalRevision || !input.metricVersion) {
    throw new RangeError("Pool labels require canonical and metric revisions");
  }
  const events = canonicalEvents(input);
  const swapCount = events.filter(({ kind }) => kind === "swap").length;
  const window = `${input.windowMinutes}m`;
  const candidates: ComputedPoolLabel[] = [];

  if (
    swapCount >= contract.minimumSamples["high-fee-rate"] &&
    input.row.feeTvl !== null &&
    input.row.feesUsd !== null &&
    input.row.tvlUsd !== null
  ) {
    const observed = decimal(input.row.feeTvl);
    const threshold = decimal(contract.thresholds.highFeeRateFeeTvl);
    if (observed.greaterThanOrEqualTo(threshold)) {
      candidates.push(
        output(
          "high-fee-rate",
          increasingScore(observed, threshold, contract),
          [reason("FEE_TVL_GTE_THRESHOLD", observed, ">=", threshold, window)],
          input,
          contract,
        ),
      );
    }
  }

  const middle = (milliseconds(input.windowStart) + milliseconds(input.windowEnd)) / 2;
  const prior = events.filter((item) => milliseconds(item.blockTimestamp) < middle);
  const current = events.filter((item) => milliseconds(item.blockTimestamp) >= middle);
  const yieldMinimum = contract.minimumSamples["yield-half"];
  if (
    prior.filter(({ kind }) => kind === "swap").length >= yieldMinimum &&
    current.filter(({ kind }) => kind === "swap").length >= yieldMinimum
  ) {
    const priorYield = halfYield(prior);
    const currentYield = halfYield(current);
    if (priorYield !== null && currentYield !== null && !priorYield.isZero()) {
      const change = currentYield.minus(priorYield).dividedBy(priorYield.abs());
      const surge = decimal(contract.thresholds.yieldSurgeChangeMin);
      const decline = decimal(contract.thresholds.yieldDeclineChangeMax);
      const stable = decimal(contract.thresholds.yieldStableAbsoluteChangeMax);
      if (change.greaterThanOrEqualTo(surge)) {
        candidates.push(
          output(
            "yield-surge",
            increasingScore(change, surge, contract),
            [reason("YIELD_CHANGE_GTE_THRESHOLD", change, ">=", surge, window)],
            input,
            contract,
          ),
        );
      } else if (change.lessThanOrEqualTo(decline)) {
        candidates.push(
          output(
            "yield-decline",
            decreasingScore(change, decline, contract),
            [reason("YIELD_CHANGE_LTE_THRESHOLD", change, "<=", decline, window)],
            input,
            contract,
          ),
        );
      } else if (change.abs().lessThanOrEqualTo(stable)) {
        candidates.push(
          output(
            "yield-stable",
            boundedScore(change.abs(), stable, contract),
            [reason("YIELD_CHANGE_ABS_LTE_THRESHOLD", change.abs(), "abs<=", stable, window)],
            input,
            contract,
          ),
        );
      }
    }
  }

  if (swapCount >= contract.minimumSamples["stable-volume-price"]) {
    const dispersion = volumeDispersion(events);
    const changes = priceChanges(events);
    if (dispersion !== null && changes !== null && changes.length > 0) {
      const maxChange = LabelDecimal.max(...changes);
      const volumeMaximum = decimal(contract.thresholds.stableVolumeDispersionMax);
      const priceMaximum = decimal(contract.thresholds.stablePriceChangeMax);
      if (
        dispersion.lessThanOrEqualTo(volumeMaximum) &&
        maxChange.lessThanOrEqualTo(priceMaximum)
      ) {
        candidates.push(
          output(
            "stable-volume-price",
            Math.min(
              boundedScore(dispersion, volumeMaximum, contract),
              boundedScore(maxChange, priceMaximum, contract),
            ),
            [
              reason(
                "VOLUME_DISPERSION_LTE_THRESHOLD",
                dispersion,
                "<=",
                volumeMaximum,
                window,
              ),
              reason("PRICE_CHANGE_LTE_THRESHOLD", maxChange, "<=", priceMaximum, window),
            ],
            input,
            contract,
          ),
        );
      }
    }
  }

  if (swapCount >= contract.minimumSamples.crowded && input.row.transactionCount !== null) {
    const observed = decimal(input.row.transactionCount);
    const threshold = decimal(contract.thresholds.crowdedTransactionCountMin);
    if (observed.greaterThanOrEqualTo(threshold)) {
      candidates.push(
        output(
          "crowded",
          increasingScore(observed, threshold, contract),
          [reason("TRANSACTION_COUNT_GTE_THRESHOLD", observed, ">=", threshold, window)],
          input,
          contract,
        ),
      );
    }
  }

  if (swapCount >= contract.minimumSamples.volatile) {
    const changes = priceChanges(events);
    if (changes !== null && changes.length > 0) {
      const observed = LabelDecimal.max(...changes);
      const threshold = decimal(contract.thresholds.volatilePriceChangeMin);
      if (observed.greaterThanOrEqualTo(threshold)) {
        candidates.push(
          output(
            "volatile",
            increasingScore(observed, threshold, contract),
            [reason("PRICE_CHANGE_GTE_THRESHOLD", observed, ">=", threshold, window)],
            input,
            contract,
          ),
        );
      }
    }
  }

  const liquidity = events.filter(
    (item) =>
      (item.kind === "liquidity.add" || item.kind === "liquidity.remove") &&
      item.liquidityDelta !== null &&
      item.liquidityDelta !== undefined,
  );
  if (liquidity.length >= contract.minimumSamples["lp-direction"]) {
    const values = liquidity.map((item) => decimal(item.liquidityDelta!));
    const gross = values.reduce<Decimal>((sum, value) => sum.plus(value.abs()), new LabelDecimal(0));
    if (gross.greaterThan(0)) {
      const dominance = values
        .reduce<Decimal>((sum, value) => sum.plus(value), new LabelDecimal(0))
        .dividedBy(gross);
      const threshold = decimal(contract.thresholds.lpDirectionDominanceMin);
      if (dominance.greaterThanOrEqualTo(threshold)) {
        candidates.push(
          output(
            "lp-inflow",
            increasingScore(dominance, threshold, contract),
            [reason("LP_NET_FLOW_GTE_THRESHOLD", dominance, ">=", threshold, window)],
            input,
            contract,
          ),
        );
      } else if (dominance.lessThanOrEqualTo(threshold.negated())) {
        candidates.push(
          output(
            "lp-outflow",
            decreasingScore(dominance, threshold.negated(), contract),
            [reason("LP_NET_FLOW_LTE_THRESHOLD", dominance, "<=", threshold.negated(), window)],
            input,
            contract,
          ),
        );
      }
    }
  }

  const byId = new Map(candidates.map((label) => [label.id, label]));
  const priorities = new Map(contract.rules.map(({ id, priority }) => [id, priority]));
  return [...byId.values()].sort((left, right) => {
    const priority = (priorities.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (priorities.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    return priority === 0 ? left.id.localeCompare(right.id) : priority;
  });
}
