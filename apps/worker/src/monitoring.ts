import { createHash } from "node:crypto";

export interface CanonicalMarketInputIdentity {
  generatedAt: string;
  source: "canonical-market-projection";
  sourceGenerationId: string;
  windowEnd: string;
}

export type NotificationOutboxState =
  | "pending"
  | "leased"
  | "retry-wait"
  | "delivered"
  | "dead";

export interface MonitorDestinationSelection {
  channel: "telegram" | "webhook" | "local-sink";
  destinationId: string;
  destinationRevision: number;
}

export interface MonitorDestinationSelector {
  select(input: { userId: string }): Promise<MonitorDestinationSelection[]>;
}

function byteCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
      byteCompare(left.windowEnd, right.windowEnd) ||
      byteCompare(left.generatedAt, right.generatedAt) ||
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
  const generationOrder =
    byteCompare(input.incoming.generatedAt, input.current.generatedAt) ||
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
  async select(_input: { userId: string }): Promise<MonitorDestinationSelection[]> {
    return [];
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
    const next = input.nextAttemptAt === null ? Number.NaN : new Date(input.nextAttemptAt).getTime();
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
