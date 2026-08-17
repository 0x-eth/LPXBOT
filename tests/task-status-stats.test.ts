import {
  canonicalTaskStatusStatsInput,
  shellStatsHeartbeatMilliseconds,
  TaskStatusStatsValidationError,
  type AuthoritativeTaskStatusStatsInput,
} from "../apps/api/src/shell-stats.js";
import { describe, expect, it } from "vitest";

const validInput: AuthoritativeTaskStatusStatsInput = {
  observedAt: "2026-08-17T08:00:00.000Z",
  paused: 2,
  running: 3,
  sourceRevision: 7,
  stopped: 5,
  userId: "27000000-0000-4000-8000-000000000013",
};

describe("P02-13 authoritative task status statistics contract", () => {
  it("accepts absolute non-negative safe counts and derives total exactly once", () => {
    expect(shellStatsHeartbeatMilliseconds).toBe(25_000);
    expect(canonicalTaskStatusStatsInput(validInput)).toEqual({
      ...validInput,
      total: 10,
    });
    expect(canonicalTaskStatusStatsInput({ ...validInput, paused: 0, running: 0, stopped: 0 }))
      .toMatchObject({ paused: 0, running: 0, stopped: 0, total: 0 });
  });

  it.each([
    ["negative running", { running: -1 }],
    ["fractional paused", { paused: 1.5 }],
    ["infinite stopped", { stopped: Number.POSITIVE_INFINITY }],
    ["overflow running", { running: Number.MAX_SAFE_INTEGER + 1 }],
    [
      "overflow total",
      { paused: Number.MAX_SAFE_INTEGER, running: 1, stopped: 0 },
    ],
    ["negative source revision", { sourceRevision: -1 }],
    ["fractional source revision", { sourceRevision: 1.5 }],
    ["overflow source revision", { sourceRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ["non-canonical observedAt", { observedAt: "2026-08-17 08:00:00Z" }],
    ["invalid user UUID", { userId: "telegram-123" }],
  ])("rejects %s before storage", (_label, overrides) => {
    expect(() => canonicalTaskStatusStatsInput({ ...validInput, ...overrides })).toThrow(
      TaskStatusStatsValidationError,
    );
  });
});
