import { readFileSync } from "node:fs";

import { monitorCandidateKey } from "../packages/domain/src/monitor-evaluator.js";
import {
  EmptyMonitorDestinationSelector,
  MonitorEvaluationWorker,
  candidateEvidenceDecision,
  isOutboxClaimable,
  notificationDedupeKey,
  orderCanonicalMarketInputs,
  outboxRetryDelaySeconds,
} from "../apps/worker/src/monitoring.js";
import { describe, expect, it } from "vitest";

const dedupeFixture = JSON.parse(
  readFileSync("artifacts/acceptance/P03-01/fixtures/dedupe-ordering.json", "utf8"),
);
const reorgFixture = JSON.parse(
  readFileSync("artifacts/acceptance/P03-01/fixtures/reorg-replacement.json", "utf8"),
);
const recoveryFixture = JSON.parse(
  readFileSync("artifacts/acceptance/P03-01/fixtures/outbox-recovery.json", "utf8"),
);

describe("P03-02 canonical monitor worker rules", () => {
  it("sorts authoritative inputs and removes exact duplicate generations before evaluation", () => {
    const ordered = orderCanonicalMarketInputs(
      dedupeFixture.input.deliveries.map((delivery: Record<string, unknown>) => ({
        ...delivery,
        source: "canonical-market-projection" as const,
      })),
    );
    expect(ordered.map(({ windowEnd }) => windowEnd)).toEqual(
      dedupeFixture.expected.evaluationWindowOrder,
    );
    expect(
      ordered.map((delivery) =>
        monitorCandidateKey({
          metricVersion: dedupeFixture.input.metricVersion,
          monitorId: dedupeFixture.input.monitorId,
          poolKey: dedupeFixture.input.poolKey,
          revision: dedupeFixture.input.monitorRevision,
          windowEnd: delivery.windowEnd,
        }),
      ),
    ).toEqual(dedupeFixture.expected.candidateKeys);
  });

  it("keeps candidate identity stable across canonical reorg evidence and suppresses terminal replacement", () => {
    const [oldGeneration, newGeneration] = reorgFixture.input.generations;
    const candidateKey = monitorCandidateKey({
      metricVersion: reorgFixture.input.metricVersion,
      monitorId: reorgFixture.input.monitorId,
      poolKey: reorgFixture.input.poolKey,
      revision: reorgFixture.input.monitorRevision,
      windowEnd: reorgFixture.input.windowEnd,
    });
    expect(candidateKey).toBe(reorgFixture.expected.candidateKey);
    expect(
      candidateEvidenceDecision({
        current: oldGeneration,
        incoming: newGeneration,
        outboxStates: ["pending"],
      }),
    ).toBe("replace");
    expect(
      candidateEvidenceDecision({
        current: oldGeneration,
        incoming: newGeneration,
        outboxStates: ["delivered"],
      }),
    ).toBe("suppress");
    expect(
      candidateEvidenceDecision({
        current: newGeneration,
        incoming: oldGeneration,
        outboxStates: ["pending"],
      }),
    ).toBe("ignore");
  });

  it("derives destination-revision dedupe keys and production selects no destinations", async () => {
    const input = {
      candidateKey: reorgFixture.expected.candidateKey,
      destinationId: reorgFixture.input.destinationId,
      destinationRevision: reorgFixture.input.destinationRevision,
    };
    const first = notificationDedupeKey(input);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(notificationDedupeKey(input)).toBe(first);
    expect(notificationDedupeKey({ ...input, destinationRevision: 3 })).not.toBe(first);
    expect(await new EmptyMonitorDestinationSelector().select({ userId: "user-fixture-001" })).toEqual(
      [],
    );
  });

  it("applies the frozen lease recovery and bounded deterministic retry rules", () => {
    const leaseSeconds = recoveryFixture.input.leaseDurationSeconds as number;
    expect(
      isOutboxClaimable({
        attemptCount: 1,
        leaseExpiresAt: "2026-08-17T09:07:00Z",
        maxAttempts: recoveryFixture.input.maxAttempts,
        nextAttemptAt: null,
        now: "2026-08-17T09:07:00Z",
        state: "leased",
      }),
    ).toBe(true);
    expect(
      isOutboxClaimable({
        attemptCount: 1,
        leaseExpiresAt: "2026-08-17T09:07:00Z",
        maxAttempts: recoveryFixture.input.maxAttempts,
        nextAttemptAt: null,
        now: "2026-08-17T09:06:59Z",
        state: "leased",
      }),
    ).toBe(false);
    expect(leaseSeconds).toBe(60);

    const delay = outboxRetryDelaySeconds("delivery-fixture-0001", 1);
    expect(delay).toBeGreaterThanOrEqual(30);
    expect(delay).toBeLessThanOrEqual(36);
    expect(outboxRetryDelaySeconds("delivery-fixture-0001", 1)).toBe(delay);
    expect(outboxRetryDelaySeconds("delivery-fixture-0001", 6)).toBeGreaterThanOrEqual(3_600);
    expect(outboxRetryDelaySeconds("delivery-fixture-0001", 6)).toBeLessThanOrEqual(4_320);
  });

  it("binds the current user blocklist and writes local-sink candidates only when injected", async () => {
    const evaluation = JSON.parse(
      readFileSync("artifacts/acceptance/P03-01/fixtures/evaluation-cases.json", "utf8"),
    ).input;
    const commits: Array<{ candidate: { blocklistHash: string }; destinations: unknown[] }> = [];
    const worker = new MonitorEvaluationWorker({
      blocklists: {
        get: async () => ({
          blocklistHash: evaluation.snapshotDefaults.blocklistHash,
          entries: [],
        }),
      },
      destinations: {
        select: async () => [
          {
            channel: "local-sink" as const,
            destinationId: "local-sink-fixture-001",
            destinationRevision: 1,
            payload: { fixture: true },
          },
        ],
      },
      monitors: { listEnabledForPool: async () => [evaluation.monitor] },
      repository: {
        commitCandidate: async (input) => {
          commits.push(input);
          return {
            candidateKey: input.candidate.candidateKey,
            deliveries: [],
            evidenceAction: "inserted" as const,
          };
        },
      },
    });
    const projection = {
      ...evaluation.snapshotDefaults,
      source: "canonical-market-projection" as const,
    };
    const result = await worker.process({
      evaluatedAt: evaluation.evaluatedAt,
      inputs: [projection, structuredClone(projection)],
    });
    expect(result).toMatchObject({ candidates: 1, evaluated: 1, noMatches: 0 });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      candidate: { blocklistHash: evaluation.snapshotDefaults.blocklistHash },
      destinations: [{ channel: "local-sink", destinationId: "local-sink-fixture-001" }],
    });
  });
});
