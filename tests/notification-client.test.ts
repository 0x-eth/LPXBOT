import type {
  DestinationDraft,
  NotificationDestination,
  NotificationDestinationPatch,
  NotificationPreferences,
} from "../packages/api-contract/src/index.js";
import {
  NotificationClient,
  NotificationRequestError,
} from "../apps/web/src/notification-client.js";
import { describe, expect, it, vi } from "vitest";

const destinationId = "34000000-0000-4000-8000-000000000001";
const userId = "34000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-18T01:00:00.000Z";

const preferences: NotificationPreferences = {
  categories: {
    "feedback-replied": false,
    "monitor-match": true,
    "operation-failed": false,
    "position-closed": false,
    "position-moved": false,
    "task-created": false,
  },
  revision: 1,
  updatedAt: timestamp,
};

const destination: NotificationDestination = {
  categories: ["monitor-match"],
  config: {
    method: "POST",
    secretConfigured: true,
    secretRef: "secretref://notification/fixture-1",
    template: { message: "{{monitor.name}}" },
    url: "https://hooks.example.test/lpx",
  },
  createdAt: timestamp,
  destinationId,
  enabled: true,
  name: "Operations webhook",
  revision: 2,
  type: "webhook",
  updatedAt: timestamp,
  userId,
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, requestId: "p03-03-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("P03-03 notification browser client", () => {
  it("strictly loads preferences, owned Telegram options, and redacted destinations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      switch (String(input)) {
        case "/api/notification-preferences":
          return success(preferences);
        case "/api/notification-destinations/options":
          return success({ telegramIdentityId: "700000000001" });
        case "/api/notification-destinations":
          return success([destination]);
        default:
          throw new Error(`Unexpected request: ${String(input)}`);
      }
    });
    const client = new NotificationClient(fetcher);

    await expect(client.getPreferences()).resolves.toEqual(preferences);
    await expect(client.getDestinationOptions()).resolves.toEqual({
      telegramIdentityId: "700000000001",
    });
    await expect(client.listDestinations()).resolves.toEqual([destination]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          cache: "no-store",
          credentials: "include",
          headers: expect.objectContaining({ Accept: "application/json" }),
          method: "GET",
        }),
      );
    }

    const credentialLeak = new NotificationClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        success([
          {
            ...destination,
            config: { ...destination.config, signingSecret: "must-never-render" },
          },
        ]),
      ),
    );
    await expect(credentialLeak.listDestinations()).rejects.toEqual(
      expect.objectContaining<Partial<NotificationRequestError>>({
        code: "NOTIFICATION_RESPONSE_INVALID",
        retryable: true,
        status: 200,
      }),
    );
  });

  it("sends CAS, idempotent CRUD, and explicit local-sink test requests", async () => {
    const draft: DestinationDraft = {
      categories: ["monitor-match"],
      config: {
        method: "POST",
        signingSecret: "fixture-signing-secret-material-0001",
        template: { message: "{{monitor.name}}" },
        url: "https://hooks.example.test/lpx",
      },
      enabled: true,
      name: "Operations webhook",
      type: "webhook",
    };
    const patch: NotificationDestinationPatch = {
      changes: { enabled: false, name: "Paused webhook" },
      expectedRevision: 2,
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = String(input);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (path === "/api/notification-preferences") {
        return success({
          ...preferences,
          categories: { ...preferences.categories, "operation-failed": true },
          revision: 2,
        });
      }
      if (path === "/api/notification-destinations/test") {
        return success({
          destinationType: "webhook",
          networkCalls: 0,
          rendered: { body: '{"message":"Local fixture monitor"}', method: "POST" },
          signed: true,
          sink: "local-sink://p03-01",
        });
      }
      return new Response(
        JSON.stringify({
          data: {
            ...destination,
            ...(init?.method === "PATCH"
              ? { enabled: false, name: "Paused webhook", revision: 3 }
              : {}),
          },
          requestId: "p03-03-client-write",
          success: true,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: init?.method === "POST" ? 201 : 200,
        },
      );
    });
    const client = new NotificationClient(fetcher);

    await client.patchPreferences({
      categories: { "operation-failed": true },
      expectedRevision: 1,
    });
    await client.createDestination(draft, "notification-create-001");
    await client.patchDestination(destinationId, patch);
    await client.deleteDestination(destinationId, 3);
    await expect(client.testDestination(draft)).resolves.toEqual({
      destinationType: "webhook",
      networkCalls: 0,
      rendered: { body: '{"message":"Local fixture monitor"}', method: "POST" },
      signed: true,
      sink: "local-sink://p03-01",
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/notification-preferences",
      expect.objectContaining({
        body: JSON.stringify({
          categories: { "operation-failed": true },
          expectedRevision: 1,
        }),
        method: "PATCH",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/notification-destinations",
      expect.objectContaining({
        body: JSON.stringify(draft),
        headers: expect.objectContaining({ "Idempotency-Key": "notification-create-001" }),
        method: "POST",
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/notification-destinations/${destinationId}`,
      expect.objectContaining({ body: JSON.stringify(patch), method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/api/notification-destinations/${destinationId}`,
      expect.objectContaining({ body: JSON.stringify({ expectedRevision: 3 }), method: "DELETE" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      5,
      "/api/notification-destinations/test",
      expect.objectContaining({ body: JSON.stringify(draft), method: "POST" }),
    );
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toEqual(expect.objectContaining({ credentials: "include" }));
    }
  });
});
