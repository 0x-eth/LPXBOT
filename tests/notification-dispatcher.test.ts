import {
  FixedWindowDeliveryRateGate,
  NotificationDispatcher,
  type DispatchDestinationResult,
  type DispatchOutboxDelivery,
  type NotificationDispatchOutbox,
} from "../apps/dispatcher/src/dispatcher.js";
import { describe, expect, it } from "vitest";

function delivery(overrides: Partial<DispatchOutboxDelivery> = {}): DispatchOutboxDelivery {
  return {
    attemptCount: 0,
    channel: "webhook",
    deliveryId: "delivery-1",
    destinationId: "destination-1",
    destinationRevision: 4,
    leaseExpiresAt: null,
    leaseToken: null,
    payload: {
      conditionSummary: "volumeUsd gte 1000",
      metricVersion: "market-metrics/v1",
      monitorId: "monitor-1",
      monitorName: "Volume watch",
      monitorRevision: 3,
      poolKey: `56:0x${"a".repeat(40)}`,
      windowEnd: "2026-08-18T00:00:00.000Z",
    },
    userId: "user-1",
    ...overrides,
  };
}

function readyDestination(
  item: DispatchOutboxDelivery,
  overrides: Partial<Extract<DispatchDestinationResult, { status: "ready" }>["destination"]> = {},
): DispatchDestinationResult {
  return {
    destination: {
      config: {
        method: "POST",
        secretRef: "secret-ref://fixture/webhook/destination-1",
        template: { text: "{{monitor.name}}" },
        url: "https://hooks.fixture.example/event",
      },
      destinationId: item.destinationId,
      name: "Operations",
      revision: item.destinationRevision,
      type: "webhook",
      userId: item.userId,
      ...overrides,
    },
    status: "ready",
  };
}

class FixtureOutbox implements NotificationDispatchOutbox {
  readonly calls: Array<{ input: unknown; method: string }> = [];
  readonly due: DispatchOutboxDelivery[];
  markResult = true;

  constructor(items: DispatchOutboxDelivery[]) {
    this.due = items;
  }

  async peekDue(input: { limit: number }) {
    this.calls.push({ input, method: "peekDue" });
    return this.due.slice(0, input.limit).map((item) => structuredClone(item));
  }

  async claimDue(input: { deliveryIds: string[]; leaseOwner: string; limit: number }) {
    this.calls.push({ input, method: "claimDue" });
    return this.due
      .filter(({ deliveryId }) => input.deliveryIds.includes(deliveryId))
      .slice(0, input.limit)
      .map((item) => ({
        ...structuredClone(item),
        attemptCount: item.attemptCount + 1,
        leaseExpiresAt: "2026-08-18T00:01:00.000Z",
        leaseToken: `lease-${item.deliveryId}`,
      }));
  }

  async markDead(input: unknown) {
    this.calls.push({ input, method: "markDead" });
    return this.markResult;
  }

  async markDelivered(input: unknown) {
    this.calls.push({ input, method: "markDelivered" });
    return this.markResult;
  }

  async markRetry(input: unknown) {
    this.calls.push({ input, method: "markRetry" });
    return this.markResult;
  }
}

describe("P03-04 notification Dispatcher", () => {
  it("takes hierarchical permits before claim and delivers with the exact secret tuple", async () => {
    const item = delivery();
    const outbox = new FixtureOutbox([item]);
    const secretReads: unknown[] = [];
    const adapterInputs: unknown[] = [];
    const dispatcher = new NotificationDispatcher({
      adapters: {
        telegram: { deliver: async () => ({ errorCode: "UNEXPECTED", status: "dead" }) },
        webhook: {
          async deliver(input) {
            adapterInputs.push(structuredClone(input));
            return { acknowledgement: "HTTP_204", status: "delivered" };
          },
        },
      },
      batchLimit: 10,
      destinations: { resolve: async () => readyDestination(item) },
      leaseOwner: "dispatcher-fixture-a",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      outbox,
      rateGate: new FixedWindowDeliveryRateGate({
        channels: { webhook: { intervalMilliseconds: 60_000, limit: 2 } },
        destinations: { "destination-1": { intervalMilliseconds: 60_000, limit: 1 } },
        global: { intervalMilliseconds: 60_000, limit: 3 },
      }),
      secrets: {
        async read(input) {
          secretReads.push(input);
          return "fixture-hmac-material-at-least-thirty-two-bytes";
        },
      },
    });

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      late: 0,
      retrying: 0,
    });
    expect(outbox.calls.map(({ method }) => method)).toEqual([
      "peekDue",
      "claimDue",
      "markDelivered",
    ]);
    expect(secretReads).toEqual([
      {
        kind: "webhook-hmac",
        secretRef: "secret-ref://fixture/webhook/destination-1",
        userId: "user-1",
      },
    ]);
    expect(adapterInputs).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        secret: "fixture-hmac-material-at-least-thirty-two-bytes",
        values: expect.objectContaining({
          "delivery.id": "delivery-1",
          "monitor.name": "Volume watch",
        }),
      }),
    ]);
    expect(outbox.calls.at(-1)).toEqual({
      input: {
        acknowledgement: "HTTP_204",
        deliveryId: "delivery-1",
        leaseToken: "lease-delivery-1",
      },
      method: "markDelivered",
    });
  });

  it("does not claim or increment attempts when any rate gate has no permit", async () => {
    const item = delivery();
    const outbox = new FixtureOutbox([item]);
    const gate = new FixedWindowDeliveryRateGate({
      global: { intervalMilliseconds: 60_000, limit: 1 },
    });
    expect(gate.tryAcquire(item, new Date("2026-08-18T00:00:00.000Z"))).toBe(true);
    const dispatcher = new NotificationDispatcher({
      adapters: {
        telegram: { deliver: async () => ({ status: "delivered" as const }) },
        webhook: { deliver: async () => ({ status: "delivered" as const }) },
      },
      destinations: { resolve: async () => readyDestination(item) },
      leaseOwner: "dispatcher-fixture-rate",
      now: () => new Date("2026-08-18T00:00:01.000Z"),
      outbox,
      rateGate: gate,
      secrets: { read: async () => "fixture" },
    });

    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ claimed: 0 });
    expect(outbox.calls.map(({ method }) => method)).toEqual(["peekDue"]);
    expect(item.attemptCount).toBe(0);
  });

  it.each([
    ["not-found", "DESTINATION_NOT_FOUND"],
    ["disabled", "DESTINATION_DISABLED"],
    ["revision-not-found", "DESTINATION_REVISION_NOT_FOUND"],
  ] as const)("marks a %s destination permanently failed before reading secrets", async (status, errorCode) => {
    const item = delivery();
    const outbox = new FixtureOutbox([item]);
    let secretReads = 0;
    const dispatcher = new NotificationDispatcher({
      adapters: {
        telegram: { deliver: async () => ({ status: "delivered" as const }) },
        webhook: { deliver: async () => ({ status: "delivered" as const }) },
      },
      destinations: { resolve: async () => ({ status }) },
      leaseOwner: "dispatcher-fixture-destination",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      outbox,
      secrets: {
        async read() {
          secretReads += 1;
          return "fixture";
        },
      },
    });
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ failed: 1 });
    expect(secretReads).toBe(0);
    expect(outbox.calls.at(-1)).toMatchObject({ input: { errorCode }, method: "markDead" });
  });

  it("persists retry/dead classifications and ignores late lease results", async () => {
    const retryItem = delivery({ deliveryId: "retry-delivery", destinationId: "retry-destination" });
    const deadItem = delivery({ deliveryId: "dead-delivery", destinationId: "dead-destination" });
    const outbox = new FixtureOutbox([retryItem, deadItem]);
    outbox.markResult = false;
    const dispatcher = new NotificationDispatcher({
      adapters: {
        telegram: { deliver: async () => ({ status: "delivered" as const }) },
        webhook: {
          async deliver(input) {
            return input.deliveryId === "retry-delivery"
              ? {
                  errorCode: "HTTP_429",
                  retryAfterSeconds: 75,
                  status: "retry" as const,
                }
              : { errorCode: "HTTP_400", status: "dead" as const };
          },
        },
      },
      destinations: {
        resolve: async (candidate) => readyDestination(candidate),
      },
      leaseOwner: "dispatcher-fixture-late",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      outbox,
      secrets: { read: async () => "fixture" },
    });
    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      claimed: 2,
      delivered: 0,
      failed: 0,
      late: 2,
      retrying: 0,
    });
    expect(outbox.calls.filter(({ method }) => method === "markRetry")[0]).toMatchObject({
      input: { errorCode: "HTTP_429", retryAfterSeconds: 75 },
    });
    expect(outbox.calls.filter(({ method }) => method === "markDead")[0]).toMatchObject({
      input: { errorCode: "HTTP_400" },
    });
  });

  it("stops claiming and waits for an in-flight delivery during graceful shutdown", async () => {
    const item = delivery();
    const outbox = new FixtureOutbox([item]);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatcher = new NotificationDispatcher({
      adapters: {
        telegram: { deliver: async () => ({ status: "delivered" as const }) },
        webhook: {
          async deliver() {
            await pending;
            return { acknowledgement: "HTTP_204", status: "delivered" as const };
          },
        },
      },
      destinations: { resolve: async () => readyDestination(item) },
      leaseOwner: "dispatcher-fixture-stop",
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      outbox,
      secrets: { read: async () => "fixture" },
    });
    const batch = dispatcher.dispatchBatch();
    await Promise.resolve();
    await Promise.resolve();
    const stopped = dispatcher.stop();
    await expect(dispatcher.dispatchBatch()).resolves.toMatchObject({ claimed: 0 });
    release();
    await expect(batch).resolves.toMatchObject({ delivered: 1 });
    await expect(stopped).resolves.toBeUndefined();
    expect(outbox.calls.filter(({ method }) => method === "claimDue")).toHaveLength(1);
  });
});
