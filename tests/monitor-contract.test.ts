import {
  monitorConditionLimit,
  monitorContracts,
  monitorErrorCodes,
  monitorSupportedChainIds,
  monitorSupportedMetrics,
  monitorUnresolvedMetrics,
  type CreateMonitorRequest,
  type LifecycleMonitorRequest,
  type Monitor,
  type MonitorPage,
  type PatchMonitorRequest,
} from "../packages/api-contract/src/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

const poolKey = `56:0x${"a".repeat(40)}` as const;

describe("P03-02 monitor API contract", () => {
  it("freezes the BSC monitor routes, metrics, limits, and stable errors", () => {
    expect(monitorContracts).toEqual({
      create: { method: "POST", path: "/api/monitors" },
      delete: { method: "DELETE", path: "/api/monitors/{monitorId}" },
      disable: { method: "POST", path: "/api/monitors/{monitorId}/disable" },
      enable: { method: "POST", path: "/api/monitors/{monitorId}/enable" },
      get: { method: "GET", path: "/api/monitors/{monitorId}" },
      list: { method: "GET", path: "/api/monitors" },
      patch: { method: "PATCH", path: "/api/monitors/{monitorId}" },
    });
    expect(monitorSupportedChainIds).toEqual([56]);
    expect(monitorSupportedMetrics).toEqual([
      "volumeUsd",
      "feesUsd",
      "feeTvlRatio",
      "tvlUsd",
      "transactionCount",
      "metricVersion",
    ]);
    expect(monitorUnresolvedMetrics).toEqual(["activeTvlUsd", "feeAtvlRatio"]);
    expect(monitorConditionLimit).toBe(16);
    expect(monitorErrorCodes).toContain("MONITOR_NOT_FOUND");
    expect(monitorErrorCodes).toContain("REVISION_CONFLICT");
    expect(monitorErrorCodes).toContain("IDEMPOTENCY_CONFLICT");
    expect(monitorErrorCodes).toContain("UNSUPPORTED_METRIC");
    expect(monitorErrorCodes).toContain("REQUEST_TOO_LARGE");
  });

  it("expresses create, patch, lifecycle, aggregate, and page DTOs without writable pool identity", () => {
    const create = {
      conditions: [
        { enabled: true, id: "volumeUsd", operator: "gte", value: "1000" },
        { enabled: true, id: "metricVersion", operator: "eq", value: "market-metrics/v1" },
      ],
      excludeHanToken: true,
      excludeHook: true,
      name: "Fee monitor",
      poolKey,
      windowMinutes: 5,
    } satisfies CreateMonitorRequest;
    const patch = {
      changes: { name: "Renamed", windowMinutes: 15 },
      expectedRevision: 1,
    } satisfies PatchMonitorRequest;
    const lifecycle = { expectedRevision: 1 } satisfies LifecycleMonitorRequest;
    const monitor = {
      ...create,
      createdAt: "2026-08-17T09:00:00.000Z",
      disabledAt: "2026-08-17T09:00:00.000Z",
      enabled: false,
      enabledAt: null,
      monitorId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      updatedAt: "2026-08-17T09:00:00.000Z",
      userId: "user-fixture-001",
    } satisfies Monitor;
    const page = {
      enabledCount: 0,
      items: [monitor],
      nextCursor: null,
      totalCount: 1,
    } satisfies MonitorPage;

    expect(monitor.enabled).toBe(false);
    expect(page).toMatchObject({ enabledCount: 0, totalCount: 1 });
    expect(patch).not.toHaveProperty("poolKey");
    expect(lifecycle.expectedRevision).toBe(1);
    expectTypeOf(create.poolKey).toMatchTypeOf<`56:0x${string}`>();
  });
});
