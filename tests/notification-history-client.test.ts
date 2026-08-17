import {
  NotificationClient,
  NotificationRequestError,
  parseNotificationHistoryPage,
} from "../apps/web/src/notification-client.js";
import { describe, expect, it, vi } from "vitest";

const item = {
  attemptCount: 2,
  conditionSummary: "volumeUsd gte 1000",
  createdAt: "2026-08-18T00:00:00.000Z",
  deliveredAt: null,
  deliveryId: "3a000000-0000-4000-8000-000000000001",
  destination: {
    destinationId: "3a000000-0000-4000-8000-000000000002",
    name: "Operations webhook",
    type: "webhook",
  },
  errorCode: "HTTP_503",
  monitorId: "3a000000-0000-4000-8000-000000000003",
  monitorName: "Volume watch",
  nextRetryAt: "2026-08-18T00:10:00.000Z",
  poolKey: `56:0x${"a".repeat(40)}`,
  status: "retrying",
  updatedAt: "2026-08-18T00:01:00.000Z",
  windowEnd: "2026-08-17T23:55:00.000Z",
  windowMinutes: 5,
} as const;

function response(data: unknown) {
  return new Response(JSON.stringify({ data, requestId: "history-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("P03-04 notification history client", () => {
  it("encodes all filters and validates the public history page", async () => {
    const fetcher = vi.fn(async () => response({ items: [item], nextCursor: "cursor-next" }));
    const client = new NotificationClient(fetcher);
    await expect(
      client.listHistory({
        cursor: "cursor-current",
        deliveryStatus: "retrying",
        from: "2026-08-17T00:00:00.000Z",
        limit: 20,
        monitorId: item.monitorId,
        to: "2026-08-18T00:00:00.000Z",
      }),
    ).resolves.toEqual({ items: [item], nextCursor: "cursor-next" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/notifications/history?cursor=cursor-current&limit=20&monitorId=3a000000-0000-4000-8000-000000000003&deliveryStatus=retrying&from=2026-08-17T00%3A00%3A00.000Z&to=2026-08-18T00%3A00%3A00.000Z",
      expect.objectContaining({ cache: "no-store", credentials: "include", method: "GET" }),
    );
  });

  it("rejects unknown fields, private states, and malformed timestamps", () => {
    for (const invalid of [
      { items: [{ ...item, secretRef: "secret-ref://must-not-pass" }], nextCursor: null },
      { items: [{ ...item, status: "dead" }], nextCursor: null },
      { items: [{ ...item, createdAt: "not-a-time" }], nextCursor: null },
      { items: [item], nextCursor: 42 },
    ]) {
      expect(() => parseNotificationHistoryPage(invalid, 200)).toThrowError(
        expect.objectContaining<Partial<NotificationRequestError>>({
          code: "NOTIFICATION_RESPONSE_INVALID",
        }),
      );
    }
  });
});
