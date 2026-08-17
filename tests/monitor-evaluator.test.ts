import { readFileSync } from "node:fs";

import {
  evaluateMonitorSnapshot,
  monitorCandidateKey,
  type MonitorEvaluationInput,
  type MonitorMetricSnapshot,
} from "../packages/domain/src/monitor-evaluator.js";
import { describe, expect, it, vi } from "vitest";

interface GoldenCase {
  conditionPatch?: { append: MonitorEvaluationInput["monitor"]["conditions"][number] };
  expected: { candidateKey?: string; matched: boolean; reason?: string };
  id: string;
  patch: Record<string, unknown>;
  remove?: string[];
}

interface EvaluationFixture {
  input: {
    cases: GoldenCase[];
    evaluatedAt: string;
    monitor: MonitorEvaluationInput["monitor"];
    snapshotDefaults: MonitorMetricSnapshot;
  };
}

const fixture = JSON.parse(
  readFileSync("artifacts/acceptance/P03-01/fixtures/evaluation-cases.json", "utf8"),
) as EvaluationFixture;

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  const final = parts.pop()!;
  let cursor = target;
  for (const part of parts) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[final] = value;
}

function removePath(target: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  const final = parts.pop()!;
  let cursor = target;
  for (const part of parts) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[final];
}

function goldenInput(testCase: GoldenCase): MonitorEvaluationInput {
  const monitor = structuredClone(fixture.input.monitor);
  const snapshot = structuredClone(fixture.input.snapshotDefaults);
  for (const [path, value] of Object.entries(testCase.patch ?? {})) {
    setPath(snapshot as unknown as Record<string, unknown>, path, value);
  }
  for (const path of testCase.remove ?? []) {
    removePath(snapshot as unknown as Record<string, unknown>, path);
  }
  if (testCase.conditionPatch) monitor.conditions.push(testCase.conditionPatch.append);
  return { evaluatedAt: fixture.input.evaluatedAt, monitor, snapshot };
}

describe("P03-02 pure monitor evaluator", () => {
  for (const testCase of fixture.input.cases) {
    it(`replays P03-01 evaluation fixture: ${testCase.id}`, () => {
      const result = evaluateMonitorSnapshot(goldenInput(testCase));
      expect(result.matched).toBe(testCase.expected.matched);
      if (result.matched) {
        expect(result.candidate.candidateKey).toBe(testCase.expected.candidateKey);
        expect(result.candidate.blocklistHash).toBe(
          fixture.input.snapshotDefaults.blocklistHash,
        );
      } else {
        expect(result.reason).toBe(testCase.expected.reason);
      }
    });
  }

  it("uses exact base-10 gte/lte comparison without Number coercion", () => {
    const input = goldenInput(fixture.input.cases[0]!);
    input.monitor.conditions = [
      {
        enabled: true,
        id: "volumeUsd",
        operator: "lte",
        value: "90071992547409931234567890.000000000000000001",
      },
    ];
    input.snapshot.metrics.volumeUsd = {
      state: "value",
      value: "90071992547409931234567890.000000000000000001",
    };
    expect(evaluateMonitorSnapshot(input).matched).toBe(true);
    input.snapshot.metrics.volumeUsd.value = "90071992547409931234567890.000000000000000002";
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "CONDITION_FALSE",
    });
  });

  it("fails closed for future generations, version mismatches, and unknown filter metadata", () => {
    const input = goldenInput(fixture.input.cases[0]!);
    input.snapshot.generatedAt = "2026-08-17T09:07:31Z";
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "FUTURE_GENERATED_AT",
    });

    input.snapshot.generatedAt = "2026-08-17T09:05:30Z";
    input.snapshot.metricVersion = "market-metrics/v2";
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "METRIC_VERSION_MISMATCH",
    });

    input.snapshot.metricVersion = "market-metrics/v1";
    input.monitor.excludeHanToken = true;
    input.snapshot.hasHanToken = "unknown";
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "HAN_TOKEN_UNKNOWN",
    });

    input.monitor.excludeHanToken = false;
    input.monitor.excludeHook = true;
    input.snapshot.hasHook = "unknown";
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "HOOK_UNKNOWN",
    });
  });

  it("fails closed for every partial canonical generation", () => {
    const input = goldenInput(fixture.input.cases[0]!);
    input.snapshot.partial = true;
    input.snapshot.partialFields = ["tvlUsd"];
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "REQUIRED_METRIC_PARTIAL",
    });
  });

  it("rejects more than sixteen enabled conditions and has no implicit clock or network I/O", () => {
    const input = goldenInput(fixture.input.cases[0]!);
    input.monitor.conditions = Array.from({ length: 17 }, () => ({
      enabled: true as const,
      id: "volumeUsd" as const,
      operator: "gte" as const,
      value: "1",
    }));
    expect(evaluateMonitorSnapshot(input)).toMatchObject({
      matched: false,
      reason: "INVALID_MONITOR",
    });

    input.monitor.conditions.length = 1;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("clock I/O");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("network I/O");
    });
    try {
      expect(evaluateMonitorSnapshot(input).matched).toBe(true);
    } finally {
      dateNow.mockRestore();
      globalThis.fetch = originalFetch;
    }
  });

  it("matches the frozen SHA-256 candidate known-answer", () => {
    expect(
      monitorCandidateKey({
        metricVersion: "market-metrics/v1",
        monitorId: "11111111-1111-4111-8111-111111111111",
        poolKey: `56:0x${"a".repeat(40)}`,
        revision: 3,
        windowEnd: "2026-08-17T09:05:00Z",
      }),
    ).toBe("5835a4499d16bcbac214e8c99753bcf3d5d7b06f100b0ced9c19a179d8ee4909");
  });
});
