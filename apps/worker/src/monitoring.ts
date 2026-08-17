import { createHash } from "node:crypto";

import {
  evaluateMonitorSnapshot,
  type MonitorCandidate,
  type MonitorEvaluationDefinition,
  type MonitorMetricSnapshot,
} from "@lpbot/domain/monitor-evaluator";

export interface CanonicalMarketInputIdentity {
  generatedAt: string;
  source: "canonical-market-projection";
  sourceGenerationId: string;
  windowEnd: string;
}

export type NotificationOutboxState = "pending" | "leased" | "retry-wait" | "delivered" | "dead";

export interface MonitorDestinationSelection {
  channel: "telegram" | "webhook" | "local-sink";
  destinationId: string;
  destinationRevision: number;
  payload: Record<string, unknown>;
}

export interface MonitorDestinationSelector {
  select(input: { userId: string }): Promise<MonitorDestinationSelection[]>;
}

export interface CanonicalMonitorMetricInput
  extends MonitorMetricSnapshot, CanonicalMarketInputIdentity {}

export interface MonitorEvaluationBlocklistSource {
  get(userId: string): Promise<{
    blocklistHash: string;
    entries: ReadonlyArray<{ identity: string }>;
  }>;
}

export interface MonitorEvaluationMonitorSource {
  listEnabledForPool(poolKey: string): Promise<MonitorEvaluationDefinition[]>;
}

export interface MonitorCandidateCommitPort {
  commitCandidate(input: {
    candidate: MonitorCandidate;
    destinations: MonitorDestinationSelection[];
  }): Promise<unknown>;
}

export interface MonitorEvaluationWorkerOptions {
  blocklists: MonitorEvaluationBlocklistSource;
  destinations?: MonitorDestinationSelector;
  monitors: MonitorEvaluationMonitorSource;
  repository: MonitorCandidateCommitPort;
}

export interface MonitorEvaluationBatchResult {
  candidates: number;
  evaluated: number;
  noMatches: number;
}

function byteCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const timestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u;

function timestampNanoseconds(value: string): bigint {
  const match = timestampPattern.exec(value);
  if (!match) throw new RangeError("CANONICAL_MARKET_TIMESTAMP_INVALID");
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 19) !== match[1]
  ) {
    throw new RangeError("CANONICAL_MARKET_TIMESTAMP_INVALID");
  }
  const fraction = (match[2] ?? "").padEnd(9, "0");
  return BigInt(milliseconds) * 1_000_000n + BigInt(fraction === "" ? "0" : fraction);
}

function timestampCompare(left: string, right: string): number {
  const leftValue = timestampNanoseconds(left);
  const rightValue = timestampNanoseconds(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function orderCanonicalMarketInputs<T extends CanonicalMarketInputIdentity>(
  inputs: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const input of inputs) {
    if (input.source !== "canonical-market-projection") {
      throw new RangeError("CANONICAL_MARKET_INPUT_REQUIRED");
    }
    const key = `${input.windowEnd}\u0000${input.generatedAt}\u0000${input.sourceGenerationId}`;
    if (!unique.has(key)) unique.set(key, input);
  }
  return [...unique.values()].sort(
    (left, right) =>
      timestampCompare(left.windowEnd, right.windowEnd) ||
      timestampCompare(left.generatedAt, right.generatedAt) ||
      byteCompare(left.sourceGenerationId, right.sourceGenerationId),
  );
}

function evidenceGenerationId(value: { id?: string; sourceGenerationId?: string }): string {
  return value.sourceGenerationId ?? value.id ?? "";
}

export function candidateEvidenceDecision(input: {
  current: { generatedAt: string; id?: string; sourceGenerationId?: string };
  incoming: { generatedAt: string; id?: string; sourceGenerationId?: string };
  outboxStates: readonly NotificationOutboxState[];
}): "replace" | "defer" | "suppress" | "ignore" {
  let currentGeneratedAt: bigint;
  let incomingGeneratedAt: bigint;
  try {
    currentGeneratedAt = timestampNanoseconds(input.current.generatedAt);
    incomingGeneratedAt = timestampNanoseconds(input.incoming.generatedAt);
  } catch {
    throw new RangeError("CANDIDATE_GENERATED_AT_INVALID");
  }
  const generationOrder =
    (incomingGeneratedAt < currentGeneratedAt
      ? -1
      : incomingGeneratedAt > currentGeneratedAt
        ? 1
        : 0) ||
    byteCompare(evidenceGenerationId(input.incoming), evidenceGenerationId(input.current));
  if (generationOrder <= 0) return "ignore";
  if (input.outboxStates.some((state) => state === "delivered" || state === "dead")) {
    return "suppress";
  }
  if (input.outboxStates.includes("leased")) return "defer";
  return "replace";
}

export function notificationDedupeKey(input: {
  candidateKey: string;
  destinationId: string;
  destinationRevision: number;
}): string {
  const canonical = [
    "notification/v1",
    input.candidateKey,
    input.destinationId,
    String(input.destinationRevision),
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export class EmptyMonitorDestinationSelector implements MonitorDestinationSelector {
  async select(input: { userId: string }): Promise<MonitorDestinationSelection[]> {
    void input;
    return [];
  }
}

export class MonitorEvaluationWorker {
  readonly #blocklists: MonitorEvaluationBlocklistSource;
  readonly #destinations: MonitorDestinationSelector;
  readonly #monitors: MonitorEvaluationMonitorSource;
  readonly #repository: MonitorCandidateCommitPort;

  constructor(options: MonitorEvaluationWorkerOptions) {
    this.#blocklists = options.blocklists;
    this.#destinations = options.destinations ?? new EmptyMonitorDestinationSelector();
    this.#monitors = options.monitors;
    this.#repository = options.repository;
  }

  async process(input: {
    evaluatedAt: string;
    inputs: readonly CanonicalMonitorMetricInput[];
  }): Promise<MonitorEvaluationBatchResult> {
    let candidates = 0;
    let evaluated = 0;
    let noMatches = 0;
    for (const projection of orderCanonicalMarketInputs(input.inputs)) {
      const monitors = await this.#monitors.listEnabledForPool(projection.poolKey);
      for (const monitor of monitors) {
        evaluated += 1;
        const blocklist = await this.#blocklists.get(monitor.userId);
        const { source, ...snapshot } = projection;
        void source;
        const result = evaluateMonitorSnapshot({
          evaluatedAt: input.evaluatedAt,
          monitor,
          snapshot: {
            ...snapshot,
            blockedIdentities: blocklist.entries.map(({ identity }) => identity),
            blocklistHash: blocklist.blocklistHash,
          },
        });
        if (!result.matched) {
          noMatches += 1;
          continue;
        }
        const destinations = await this.#destinations.select({ userId: monitor.userId });
        await this.#repository.commitCandidate({ candidate: result.candidate, destinations });
        candidates += 1;
      }
    }
    return { candidates, evaluated, noMatches };
  }
}

export function isOutboxClaimable(input: {
  attemptCount: number;
  leaseExpiresAt: string | null;
  maxAttempts: number;
  nextAttemptAt: string | null;
  now: string;
  state: NotificationOutboxState;
}): boolean {
  if (input.attemptCount >= input.maxAttempts) return false;
  const now = new Date(input.now).getTime();
  if (!Number.isFinite(now)) return false;
  if (input.state === "pending") return true;
  if (input.state === "retry-wait") {
    const next =
      input.nextAttemptAt === null ? Number.NaN : new Date(input.nextAttemptAt).getTime();
    return Number.isFinite(next) && next <= now;
  }
  if (input.state === "leased") {
    const expiry =
      input.leaseExpiresAt === null ? Number.NaN : new Date(input.leaseExpiresAt).getTime();
    return Number.isFinite(expiry) && expiry <= now;
  }
  return false;
}

const retryBackoffSeconds = [30, 120, 600, 1_800, 3_600] as const;

export function outboxRetryDelaySeconds(deliveryId: string, failedAttempt: number): number {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError("OUTBOX_ATTEMPT_INVALID");
  }
  const index = Math.min(failedAttempt - 1, retryBackoffSeconds.length - 1);
  const base = retryBackoffSeconds[index]!;
  const digest = createHash("sha256").update(deliveryId, "utf8").digest();
  const ratio = digest.readUInt32BE(0) / 0xffff_ffff;
  return base + Math.floor(base * 0.2 * ratio);
}
