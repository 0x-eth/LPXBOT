import { createHash } from "node:crypto";

export type MonitorConditionMetric =
  | "volumeUsd"
  | "feesUsd"
  | "feeTvlRatio"
  | "tvlUsd"
  | "transactionCount"
  | "metricVersion"
  | "activeTvlUsd"
  | "feeAtvlRatio";

export type MonitorEvaluationCondition =
  | {
      enabled: boolean;
      id: Exclude<MonitorConditionMetric, "metricVersion">;
      operator: "gte" | "lte";
      value: string;
    }
  | {
      enabled: boolean;
      id: "metricVersion";
      operator: "eq";
      value: string;
    };

export interface MonitorEvaluationDefinition {
  conditions: MonitorEvaluationCondition[];
  enabled: boolean;
  excludeHanToken?: boolean;
  excludeHook?: boolean;
  monitorId: string;
  poolKey: string;
  revision: number;
  userId: string;
  windowMinutes: number;
}

export interface MonitorMetricValue {
  state: "value" | "null" | "non-finite";
  value: number | string | null;
}

export interface MonitorMetricSnapshot {
  blockedIdentities?: string[];
  blocklistHash: string;
  canonicalBlockHash: string;
  generatedAt: string;
  hasHanToken?: boolean | "unknown";
  hasHook?: boolean | "unknown";
  metricVersion: string;
  metrics: {
    feeTvlRatio: MonitorMetricValue;
    feesUsd: MonitorMetricValue;
    transactionCount: MonitorMetricValue;
    tvlUsd: MonitorMetricValue;
    volumeUsd: MonitorMetricValue;
    [metric: string]: MonitorMetricValue;
  };
  partial: boolean;
  partialFields?: string[];
  poolKey: string;
  ready: boolean;
  replacesGenerationId?: string | null;
  sourceGenerationId: string;
  token0Address: string;
  token1Address: string;
  windowEnd: string;
  windowStart: string;
}

export interface MonitorEvaluationInput {
  evaluatedAt: string;
  monitor: MonitorEvaluationDefinition;
  snapshot: MonitorMetricSnapshot;
}

export type MonitorNoMatchReason =
  | "MONITOR_DISABLED"
  | "INVALID_MONITOR"
  | "INPUT_IDENTITY_MISMATCH"
  | "INPUT_WINDOW_MISMATCH"
  | "INVALID_TIMESTAMP"
  | "FUTURE_GENERATED_AT"
  | "WINDOW_AFTER_GENERATED_AT"
  | "STALE"
  | "SNAPSHOT_NOT_READY"
  | "REQUIRED_METRIC_PARTIAL"
  | "BLOCKLIST_NOT_READY"
  | "POOL_NOT_ELIGIBLE"
  | "HAN_TOKEN_UNKNOWN"
  | "HAN_TOKEN_EXCLUDED"
  | "HOOK_UNKNOWN"
  | "HOOK_EXCLUDED"
  | "UNSUPPORTED_METRIC"
  | "METRIC_VERSION_MISMATCH"
  | "METRIC_MISSING"
  | "METRIC_NULL"
  | "METRIC_NON_FINITE"
  | "CONDITION_FALSE";

export interface MonitorCandidate {
  blocklistHash: string;
  candidateKey: string;
  canonicalBlockHash: string;
  createdAt: string;
  generatedAt: string;
  matchedConditions: MonitorEvaluationCondition[];
  metricVersion: string;
  monitorId: string;
  monitorRevision: number;
  poolKey: string;
  sourceGenerationId: string;
  userId: string;
  windowEnd: string;
}

export type MonitorEvaluationResult =
  { matched: false; reason: MonitorNoMatchReason } | { candidate: MonitorCandidate; matched: true };

interface DecimalParts {
  coefficient: bigint;
  scale: number;
}

const timestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u;
const blocklistHashPattern = /^sha256:[0-9a-f]{64}$/u;
const unsupportedMetrics = new Set<MonitorConditionMetric>(["activeTvlUsd", "feeAtvlRatio"]);

function timestampNanoseconds(value: string): bigint | null {
  const match = timestampPattern.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 19) !== match[1]
  ) {
    return null;
  }
  const fraction = (match[2] ?? "").padEnd(9, "0");
  return BigInt(milliseconds) * 1_000_000n + BigInt(fraction === "" ? "0" : fraction);
}

function decimalParts(value: string | number): DecimalParts | null {
  const text = typeof value === "number" ? String(value) : value;
  if (text.length === 0 || text.length > 256) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`.replace(/^0+(?=\d)/u, "");
  const coefficient = BigInt(`${match[1]}${digits}`);
  return { coefficient, scale: fraction.length };
}

function compareDecimal(left: string | number, right: string | number): number | null {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (!leftParts || !rightParts) return null;
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function monitorCandidateKey(input: {
  metricVersion: string;
  monitorId: string;
  poolKey: string;
  revision: number;
  windowEnd: string;
}): string {
  const canonical = [
    "monitor-candidate/v1",
    input.monitorId,
    String(input.revision),
    input.poolKey,
    input.windowEnd,
    input.metricVersion,
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function noMatch(reason: MonitorNoMatchReason): MonitorEvaluationResult {
  return { matched: false, reason };
}

function metricFailure(metric: MonitorMetricValue | undefined): MonitorNoMatchReason | null {
  if (metric === undefined) return "METRIC_MISSING";
  if (metric.state === "null" || metric.value === null) return "METRIC_NULL";
  if (metric.state === "non-finite") return "METRIC_NON_FINITE";
  if (metric.state !== "value" || decimalParts(metric.value) === null) return "METRIC_NON_FINITE";
  return null;
}

export function evaluateMonitorSnapshot(input: MonitorEvaluationInput): MonitorEvaluationResult {
  const { evaluatedAt, monitor, snapshot } = input;
  if (!monitor.enabled) return noMatch("MONITOR_DISABLED");
  const conditions = monitor.conditions.filter((condition) => condition.enabled);
  if (
    conditions.length === 0 ||
    conditions.length > 16 ||
    !Number.isSafeInteger(monitor.revision) ||
    monitor.revision < 1 ||
    ![1, 5, 15, 30, 60].includes(monitor.windowMinutes)
  ) {
    return noMatch("INVALID_MONITOR");
  }
  if (monitor.poolKey !== snapshot.poolKey) return noMatch("INPUT_IDENTITY_MISMATCH");

  const evaluatedAtNs = timestampNanoseconds(evaluatedAt);
  const generatedAtNs = timestampNanoseconds(snapshot.generatedAt);
  const windowStartNs = timestampNanoseconds(snapshot.windowStart);
  const windowEndNs = timestampNanoseconds(snapshot.windowEnd);
  if (
    evaluatedAtNs === null ||
    generatedAtNs === null ||
    windowStartNs === null ||
    windowEndNs === null
  ) {
    return noMatch("INVALID_TIMESTAMP");
  }
  if (windowEndNs - windowStartNs !== BigInt(monitor.windowMinutes) * 60_000_000_000n) {
    return noMatch("INPUT_WINDOW_MISMATCH");
  }
  if (generatedAtNs > evaluatedAtNs) return noMatch("FUTURE_GENERATED_AT");
  if (windowEndNs > generatedAtNs) return noMatch("WINDOW_AFTER_GENERATED_AT");
  if (evaluatedAtNs - generatedAtNs > 120_000_000_000n) return noMatch("STALE");
  if (!snapshot.ready) return noMatch("SNAPSHOT_NOT_READY");

  if (snapshot.partial) {
    return noMatch("REQUIRED_METRIC_PARTIAL");
  }

  if (!blocklistHashPattern.test(snapshot.blocklistHash)) return noMatch("BLOCKLIST_NOT_READY");
  const blocked = new Set(snapshot.blockedIdentities ?? []);
  if (
    blocked.has(snapshot.poolKey) ||
    blocked.has(snapshot.token0Address) ||
    blocked.has(snapshot.token1Address)
  ) {
    return noMatch("POOL_NOT_ELIGIBLE");
  }

  if (monitor.excludeHanToken) {
    if (snapshot.hasHanToken !== true && snapshot.hasHanToken !== false) {
      return noMatch("HAN_TOKEN_UNKNOWN");
    }
    if (snapshot.hasHanToken) return noMatch("HAN_TOKEN_EXCLUDED");
  }
  if (monitor.excludeHook) {
    if (snapshot.hasHook !== true && snapshot.hasHook !== false) return noMatch("HOOK_UNKNOWN");
    if (snapshot.hasHook) return noMatch("HOOK_EXCLUDED");
  }

  for (const condition of conditions) {
    if (unsupportedMetrics.has(condition.id)) return noMatch("UNSUPPORTED_METRIC");
    if (condition.id === "metricVersion") {
      if (condition.value !== snapshot.metricVersion) return noMatch("METRIC_VERSION_MISMATCH");
      continue;
    }
    const metric = snapshot.metrics[condition.id];
    const failure = metricFailure(metric);
    if (failure) return noMatch(failure);
    const comparison = compareDecimal(metric!.value as string | number, condition.value);
    if (comparison === null || (condition.operator === "gte" ? comparison < 0 : comparison > 0)) {
      return noMatch(comparison === null ? "METRIC_NON_FINITE" : "CONDITION_FALSE");
    }
  }

  const candidateKey = monitorCandidateKey({
    metricVersion: snapshot.metricVersion,
    monitorId: monitor.monitorId,
    poolKey: monitor.poolKey,
    revision: monitor.revision,
    windowEnd: snapshot.windowEnd,
  });
  return {
    candidate: {
      blocklistHash: snapshot.blocklistHash,
      candidateKey,
      canonicalBlockHash: snapshot.canonicalBlockHash,
      createdAt: evaluatedAt,
      generatedAt: snapshot.generatedAt,
      matchedConditions: conditions.map((condition) => ({ ...condition })),
      metricVersion: snapshot.metricVersion,
      monitorId: monitor.monitorId,
      monitorRevision: monitor.revision,
      poolKey: monitor.poolKey,
      sourceGenerationId: snapshot.sourceGenerationId,
      userId: monitor.userId,
      windowEnd: snapshot.windowEnd,
    },
    matched: true,
  };
}
