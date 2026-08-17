import type {
  CreateMonitorRequest,
  Monitor,
  PatchMonitorRequest,
} from "../packages/api-contract/src/index.js";
import {
  MonitorClient,
  MonitorRequestError,
} from "../apps/web/src/monitor-client.js";
import { describe, expect, it, vi } from "vitest";

const poolKey = `56:0x${"a".repeat(40)}` as const;
const monitorId = "30000000-0000-4000-8000-000000000032";

const createRequest: CreateMonitorRequest = {
  conditions: [
    { enabled: true, id: "volumeUsd", operator: "gte", value: "1000.25" },
    { enabled: true, id: "metricVersion", operator: "eq", value: "market-metrics/v1" },
  ],
  excludeHanToken: true,
  excludeHook: true,
  name: "BSC volume",
  poolKey,
  windowMinutes: 5,
};

const monitor: Monitor = {
  ...createRequest,
  createdAt: "2026-08-17T10:00:00.000Z",
  disabledAt: "2026-08-17T10:00:00.000Z",
  enabled: false,
  enabledAt: null,
  monitorId,
  revision: 1,
  updatedAt: "2026-08-17T10:00:00.000Z",
  userId: "30000000-0000-4000-8000-000000000001",
};

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "p03-02-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P03-02 monitor browser client", () => {
  it("strictly parses a BSC monitor page and rejects malformed authoritative data", async () => {
    const client = new MonitorClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        success({ enabledCount: 0, items: [monitor], nextCursor: null, totalCount: 1 }),
      ),
    );

    await expect(client.list()).resolves.toEqual({
      enabledCount: 0,
      items: [monitor],
      nextCursor: null,
      totalCount: 1,
    });

    const malformed = new MonitorClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        success({
          enabledCount: 1,
          items: [{ ...monitor, poolKey: `1:0x${"a".repeat(40)}` }],
          nextCursor: null,
          totalCount: 1,
        }),
      ),
    );
    await expect(malformed.list()).rejects.toMatchObject({
      code: "MONITOR_RESPONSE_INVALID",
      retryable: true,
      status: 200,
    });
  });

  it("sends idempotency and revision-bearing CRUD requests with credentials", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return success(init?.method === "POST" && String(_input).endsWith("/enable")
        ? { ...monitor, enabled: true, revision: 3 }
        : { ...monitor, revision: init?.method === "PATCH" ? 2 : 1 }, init?.method === "POST" && String(_input) === "/api/monitors" ? 201 : 200);
    });
    const client = new MonitorClient(fetcher);
    const patch: PatchMonitorRequest = {
      changes: { name: "Renamed" },
      expectedRevision: 1,
    };

    await client.create(createRequest, "monitor-create-001");
    await client.patch(monitorId, patch);
    await client.enable(monitorId, 2);
    await client.disable(monitorId, 3);
    await client.delete(monitorId, 4);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/monitors",
      expect.objectContaining({
        body: JSON.stringify(createRequest),
        credentials: "include",
        headers: expect.objectContaining({ "Idempotency-Key": "monitor-create-001" }),
        method: "POST",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/monitors/${monitorId}`,
      expect.objectContaining({ body: JSON.stringify(patch), method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/monitors/${monitorId}/enable`,
      expect.objectContaining({ body: JSON.stringify({ expectedRevision: 2 }), method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/api/monitors/${monitorId}/disable`,
      expect.objectContaining({ body: JSON.stringify({ expectedRevision: 3 }), method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      `/api/monitors/${monitorId}`,
      expect.objectContaining({ body: JSON.stringify({ expectedRevision: 4 }), method: "DELETE" }),
    );
  });

  it("surfaces the strictly parsed current monitor on revision conflict", async () => {
    const current = { ...monitor, name: "Changed elsewhere", revision: 2 };
    const client = new MonitorClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            current,
            error: {
              code: "REVISION_CONFLICT",
              message: "changed",
              requestId: "p03-02-conflict",
              retryable: true,
            },
            success: false,
          }),
          { headers: { "Content-Type": "application/json" }, status: 409 },
        ),
      ),
    );

    await expect(
      client.patch(monitorId, { changes: { name: "Lost update" }, expectedRevision: 1 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<MonitorRequestError>>({
        code: "REVISION_CONFLICT",
        current,
        retryable: true,
        status: 409,
      }),
    );
  });
});
